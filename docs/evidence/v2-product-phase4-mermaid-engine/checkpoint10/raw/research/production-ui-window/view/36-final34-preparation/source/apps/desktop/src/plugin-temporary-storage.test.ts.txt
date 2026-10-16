import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import {
  createDesktopTemporaryStorage,
  type TemporaryStorageQuota,
} from './plugin-temporary-storage'

function fixture(quota?: TemporaryStorageQuota) {
  const indexedDB = new IDBFactory()
  const options = { indexedDB, keyRange: IDBKeyRange, ...(quota ? { quota } : {}) }
  return { create: () => createDesktopTemporaryStorage(options) }
}

describe('disk-backed temporary plugin pages', () => {
  it('isolates plugin and host instance stores and deletes only its own pages', async () => {
    const f = fixture()
    const first = await f.create().create('same-plugin')
    const otherInstance = await f.create().create('same-plugin')
    const otherPlugin = await f.create().create('other-plugin')
    await first.setMany([
      { key: 'page-0', value: 'first' },
      { key: 'page-1', value: '中文😀' },
    ])
    await otherInstance.set('page-0', 'second')
    await otherPlugin.set('page-0', 'third')
    await expect(first.getMany(['page-1', 'missing', 'page-0'])).resolves.toEqual([
      '中文😀',
      null,
      'first',
    ])
    await first.dispose()
    await first.dispose()
    await expect(first.get('page-0')).rejects.toThrow('disposed')
    await expect(otherInstance.get('page-0')).resolves.toBe('second')
    await expect(otherPlugin.get('page-0')).resolves.toBe('third')
  })

  it('atomically charges replacement values and rolls back a batch exceeding byte quota', async () => {
    const storage = fixture({
      totalBytes: 7000,
      storeBytes: 7000,
      totalPages: 20,
      totalStores: 4,
    }).create()
    const store = await storage.create('plugin')
    await store.set('page', 'before')
    await expect(
      store.setMany([
        { key: 'page', value: 'changed' },
        { key: 'big', value: 'x'.repeat(6000) },
      ]),
    ).rejects.toThrow('quota exceeded')
    await expect(store.get('page')).resolves.toBe('before')
    await expect(store.get('big')).resolves.toBeNull()
    await store.set('page', 'x'.repeat(3000))
    await store.set('page', 'small')
    await store.set('next', 'x'.repeat(2000))
    await expect(store.get('next')).resolves.toHaveLength(2000)
  })

  it('enforces UTF-8 batch caps, key count, page count and duplicate-key rejection', async () => {
    const store = await fixture({ totalBytes: 1e7, storeBytes: 1e7, totalPages: 2, totalStores: 2 })
      .create()
      .create('plugin')
    await expect(store.set('page', '中'.repeat(100000))).rejects.toThrow('256 KiB')
    await expect(store.getMany(Array.from({ length: 33 }, (_, i) => `p${i}`))).rejects.toThrow(
      '1-32',
    )
    await expect(
      store.setMany([
        { key: 'same', value: 'a' },
        { key: 'same', value: 'b' },
      ]),
    ).rejects.toThrow('duplicate')
    await expect(store.get('../escape')).rejects.toThrow('safe characters')
    await expect(store.set(123 as unknown as string, 'invalid-key')).rejects.toThrow(
      'safe characters',
    )
    await store.set('page1', 'a'.repeat(140000))
    await store.set('page2', 'b'.repeat(140000))
    await expect(store.getMany(['page1', 'page2'])).rejects.toThrow('256 KiB')
    await expect(store.set('page3', 'small')).rejects.toThrow('quota exceeded')
  })

  it('serializes simultaneous transactions and never revives pages after disposal', async () => {
    const store = await fixture().create().create('plugin')
    await Promise.all([store.set('a', 'one'), store.set('a', 'two'), store.set('b', 'three')])
    await expect(store.getMany(['a', 'b'])).resolves.toEqual(['two', 'three'])
    const pending = store.set('late', 'must not persist')
    const closed = store.dispose()
    await expect(pending).rejects.toThrow('disposed')
    await closed
    await expect(store.set('late', 'again')).rejects.toThrow('disposed')
  })

  it('counts interrupted-session stores against a shared quota without clearing another owner', async () => {
    const f = fixture({ totalBytes: 50000, storeBytes: 50000, totalPages: 10, totalStores: 2 })
    const interrupted = await f.create().create('plugin')
    await interrupted.set('retained', 'orphan-budget')
    const current = await f.create().create('plugin')
    await expect(f.create().create('third')).rejects.toThrow('interrupted sessions')
    await expect(interrupted.get('retained')).resolves.toBe('orphan-budget')
    await current.dispose()
    const replacement = await f.create().create('replacement')
    await replacement.set('p', 'new')
    await expect(interrupted.get('retained')).resolves.toBe('orphan-budget')
  })
})
