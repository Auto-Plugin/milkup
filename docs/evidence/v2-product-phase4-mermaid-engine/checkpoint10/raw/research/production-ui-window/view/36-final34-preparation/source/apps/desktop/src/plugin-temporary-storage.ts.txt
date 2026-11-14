import {
  assertTemporaryKeys,
  assertTemporaryEntries,
  assertTemporaryValues,
  type PluginTemporaryStore,
} from '@milkup/plugin'

export interface DesktopTemporaryStorage {
  create(pluginId: string): Promise<PluginTemporaryStore>
}
export interface TemporaryStorageQuota {
  readonly totalBytes: number
  readonly storeBytes: number
  readonly totalPages: number
  readonly totalStores: number
}
const defaultQuota: TemporaryStorageQuota = {
  totalBytes: 512 * 1024 * 1024,
  storeBytes: 256 * 1024 * 1024,
  totalPages: 131072,
  totalStores: 32,
}
const pageOverhead = 1024
const storeOverhead = 1024
interface Counters {
  bytes: number
  pages: number
  stores: number
}
interface StoreMeta {
  id: string
  owner: string
  pluginId: string
  bytes: number
  pages: number
}
interface Page {
  storeId: string
  key: string
  value: string
  chargedBytes: number
}

/** A separate disposable-index DB. Never reads, clears or migrates document/recovery storage. */
export function createDesktopTemporaryStorage(
  options: {
    readonly indexedDB?: IDBFactory
    readonly databaseName?: string
    readonly keyRange?: typeof IDBKeyRange
    readonly quota?: TemporaryStorageQuota
  } = {},
): DesktopTemporaryStorage {
  const factory = options.indexedDB ?? globalThis.indexedDB
  const keyRange = options.keyRange ?? globalThis.IDBKeyRange
  const quota = options.quota ?? defaultQuota
  const owner = crypto.randomUUID()
  let database: Promise<IDBDatabase> | undefined
  function open(): Promise<IDBDatabase> {
    if (!factory || !keyRange)
      return Promise.reject(new Error('Temporary plugin storage requires IndexedDB'))
    return (database ??= new Promise((resolve, reject) => {
      const request = factory.open(options.databaseName ?? 'milkup-plugin-temporary-v1', 1)
      let failed = false
      request.onupgradeneeded = () => {
        const db = request.result
        db.createObjectStore('meta')
        db.createObjectStore('pages', { keyPath: ['storeId', 'key'] })
      }
      request.onerror = () => {
        failed = true
        reject(request.error ?? new Error('Temporary storage database open failed'))
      }
      request.onblocked = () => {
        failed = true
        reject(new Error('Temporary storage database is blocked'))
      }
      request.onsuccess = () => {
        if (failed) {
          request.result.close()
          return
        }
        request.result.onversionchange = () => request.result.close()
        resolve(request.result)
      }
    }))
  }
  async function transaction<T>(
    mode: IDBTransactionMode,
    work: (tx: IDBTransaction) => Promise<T>,
  ): Promise<T> {
    const db = await open()
    const tx = db.transaction(['meta', 'pages'], mode)
    const completed = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onabort = () => reject(tx.error ?? new Error('Temporary storage transaction aborted'))
      tx.onerror = () => {
        /* onabort carries the transaction result */
      }
    })
    // Attach rejection immediately so a request failure cannot leave an unhandled abort.
    void completed.catch(() => undefined)
    try {
      const result = await work(tx)
      await completed
      return result
    } catch (error) {
      try {
        tx.abort()
      } catch {
        /* transaction may already be aborted */
      }
      await completed.catch(() => undefined)
      throw error
    }
  }
  async function counters(tx: IDBTransaction): Promise<Counters> {
    return (
      (await requestValue<Counters | undefined>(tx.objectStore('meta').get('global'))) ?? {
        bytes: 0,
        pages: 0,
        stores: 0,
      }
    )
  }
  function checkQuota(global: Counters, store: StoreMeta): void {
    if (
      global.bytes > quota.totalBytes ||
      store.bytes > quota.storeBytes ||
      global.pages > quota.totalPages ||
      global.stores > quota.totalStores
    ) {
      throw new Error(
        'Temporary plugin storage quota exceeded; retained indexes from interrupted sessions also count toward the shared quota',
      )
    }
  }
  return Object.freeze({
    create: async (pluginId: string): Promise<PluginTemporaryStore> => {
      const id = crypto.randomUUID()
      await transaction('readwrite', async (tx) => {
        const global = await counters(tx)
        global.bytes += storeOverhead
        global.stores++
        const meta: StoreMeta = { id, owner, pluginId, bytes: storeOverhead, pages: 0 }
        checkQuota(global, meta)
        tx.objectStore('meta').put(global, 'global')
        tx.objectStore('meta').put(meta, id)
      })
      let closed = false
      let closing: Promise<void> | undefined
      let inFlight = 0
      function assertOpen(): void {
        if (closed) throw new Error('Temporary store is disposed')
      }
      async function run<T>(
        mode: IDBTransactionMode,
        work: (tx: IDBTransaction, meta: StoreMeta) => Promise<T>,
      ): Promise<T> {
        assertOpen()
        if (inFlight >= 16) throw new Error('Temporary store concurrency quota exceeded')
        inFlight++
        try {
          const result = await transaction(mode, async (tx) => {
            assertOpen()
            const meta = await requestValue<StoreMeta | undefined>(tx.objectStore('meta').get(id))
            if (!meta || meta.owner !== owner || meta.pluginId !== pluginId)
              throw new Error('Temporary store is unavailable')
            return work(tx, meta)
          })
          assertOpen()
          return result
        } finally {
          inFlight--
        }
      }
      const getMany = async (keys: readonly string[]): Promise<readonly (string | null)[]> => {
        assertTemporaryKeys(keys)
        return run('readonly', async (tx) => {
          // Read serially and enforce the aggregate cap before retaining another page.
          const values: (string | null)[] = []
          let bytes = 0
          for (const key of keys) {
            const page = await requestValue<Page | undefined>(
              tx.objectStore('pages').get([id, key]),
            )
            const value = page?.value ?? null
            bytes += assertTemporaryValues([value])
            if (bytes > 256 * 1024) throw new Error('Temporary storage batch exceeds 256 KiB')
            values.push(value)
          }
          return values
        })
      }
      const setMany = async (
        entries: readonly { readonly key: string; readonly value: string }[],
      ): Promise<void> => {
        assertTemporaryEntries(entries)
        await run('readwrite', async (tx, meta) => {
          const global = await counters(tx)
          for (const entry of entries) {
            const previous = await requestValue<Page | undefined>(
              tx.objectStore('pages').get([id, entry.key]),
            )
            const chargedBytes =
              new TextEncoder().encode(entry.value).length + entry.key.length + pageOverhead
            const delta = chargedBytes - (previous?.chargedBytes ?? 0)
            global.bytes += delta
            meta.bytes += delta
            if (!previous) {
              global.pages++
              meta.pages++
            }
            checkQuota(global, meta)
            tx.objectStore('pages').put({
              storeId: id,
              key: entry.key,
              value: entry.value,
              chargedBytes,
            } satisfies Page)
          }
          tx.objectStore('meta').put(global, 'global')
          tx.objectStore('meta').put(meta, id)
        })
      }
      return Object.freeze({
        get: async (key: string) => (await getMany([key]))[0] ?? null,
        set: (key: string, value: string) => setMany([{ key, value }]),
        getMany,
        setMany,
        dispose: () => {
          closed = true
          return (closing ??= transaction('readwrite', async (tx) => {
            const meta = await requestValue<StoreMeta | undefined>(tx.objectStore('meta').get(id))
            if (!meta || meta.owner !== owner) return
            const global = await counters(tx)
            global.bytes -= meta.bytes
            global.pages -= meta.pages
            global.stores--
            tx.objectStore('pages').delete(keyRange.bound([id, ''], [id, '\uffff']))
            tx.objectStore('meta').delete(id)
            tx.objectStore('meta').put(global, 'global')
          }))
        },
      })
    },
  })
}
function requestValue<T>(request: IDBRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result as T)
    request.onerror = () => reject(request.error ?? new Error('Temporary storage request failed'))
  })
}
