import { describe, expect, it, vi } from 'vitest'
import {
  createPluginWorkspaceBroker,
  createPluginWorkspaceHostCapabilities,
  type PluginWorkspacePage,
  PluginWorkspaceError,
  assertWorkspaceRelativePath,
} from './workspace-broker'
import { PluginRuntime, type PluginModule } from './runtime'
import { markTrustedPluginCommand, pluginCommandGesture } from './workspace-gesture'

import {
  adapter,
  manifest,
  selected,
  file,
  directory,
  deferred,
  flush,
} from './workspace-test-helpers'
function make(host = adapter()) {
  const consumed = new Set<string>()
  const broker = createPluginWorkspaceBroker({
    manifest,
    adapter: host,
    consumeGesture: (proof) => {
      if (!proof || consumed.has(proof)) return false
      consumed.add(proof)
      return true
    },
  })
  return { host, broker }
}

describe('workspace scope broker', () => {
  it('restores at most once without granting chooser/open gestures or reusing tokens', async () => {
    const host = { ...adapter(), restoreRoot: vi.fn(async () => selected) }
    const { broker } = make(host)
    const read = createPluginWorkspaceHostCapabilities(broker)
    expect(await read.restoreRoot?.()).toEqual(selected)
    expect(await read.restoreRoot?.()).toBeNull()
    expect(host.restoreRoot).toHaveBeenCalledTimes(1)
    expect(await read.listChildren(selected.id)).toMatchObject({ entries: [file, directory] })
    await expect(broker.requestOpen(file.id)).rejects.toMatchObject({ code: 'gesture-required' })
    broker.dispose()
    await expect(read.restoreRoot?.()).rejects.toMatchObject({ code: 'revoked' })
  })
  it('rejects unapproved restore before native access and releases late cancelled grants', async () => {
    const late = deferred<typeof selected>()
    const host = { ...adapter(), restoreRoot: vi.fn(() => late.promise) }
    const denied = createPluginWorkspaceBroker({
      manifest: { ...manifest, permissions: [] },
      adapter: host,
    })
    await expect(denied.restoreRoot?.()).rejects.toMatchObject({ code: 'revoked' })
    expect(host.restoreRoot).not.toHaveBeenCalled()
    const { broker } = make(host)
    const abort = new AbortController()
    const restoring = broker.restoreRoot?.({ signal: abort.signal })
    await flush()
    abort.abort()
    await expect(restoring).rejects.toMatchObject({ code: 'aborted' })
    late.resolve(selected)
    await flush()
    expect(host.releaseRoot).toHaveBeenCalledWith(selected.id)
    await expect(broker.listChildren(selected.id)).rejects.toMatchObject({ code: 'invalid-token' })
    broker.dispose()
  })

  it.each(['list', 'resolve', 'refresh', 'open'] as const)(
    'rejects %s results when disposal runs between the adapter result and publication',
    async (method) => {
      const host = adapter()
      let completed = false
      let scheduled = false
      const broker = createPluginWorkspaceBroker({
        manifest,
        adapter: host,
        consumeGesture: () => true,
        isActive: () => {
          if (completed && !scheduled) {
            scheduled = true
            queueMicrotask(() => broker.dispose())
          }
          return true
        },
      })
      await broker.chooseRoot({ gesture: 'choose' })
      await broker.listChildren(selected.id)
      host.listChildren.mockImplementationOnce(async () => {
        completed = true
        return { entries: [file], nextCursor: null }
      })
      host.resolveEntry.mockImplementationOnce(async () => {
        completed = true
        return file
      })
      host.refreshRoot.mockImplementationOnce(async () => {
        completed = true
        return { ...selected, id: 'replacement-root' }
      })
      host.requestOpen.mockImplementationOnce(async () => {
        completed = true
        return { status: 'opened' }
      })
      const result =
        method === 'list'
          ? broker.listChildren(selected.id)
          : method === 'resolve'
            ? broker.resolveEntry(selected.id, file.relativePath)
            : method === 'refresh'
              ? broker.refreshRoot(selected.id)
              : broker.requestOpen(file.id, { gesture: 'open' })
      await expect(result).rejects.toMatchObject({ code: 'revoked' })
    },
  )
  it('requires declared permission, issued roots and one-use gesture before side effects', async () => {
    const { host, broker } = make()
    await expect(broker.chooseRoot()).rejects.toMatchObject({ code: 'gesture-required' })
    expect(await broker.chooseRoot({ gesture: 'choose' })).toEqual(selected)
    await expect(broker.chooseRoot({ gesture: 'choose' })).rejects.toMatchObject({
      code: 'gesture-required',
    })
    await expect(broker.listChildren(selected.key)).rejects.toMatchObject({ code: 'invalid-token' })
    await expect(broker.requestOpen(file.id, { gesture: 'open' })).rejects.toMatchObject({
      code: 'invalid-token',
    })
    const page = await broker.listChildren(selected.id)
    expect(page.entries).toEqual([file, directory])
    await expect(broker.requestOpen(directory.id, { gesture: 'open' })).rejects.toMatchObject({
      code: 'invalid-token',
    })
    expect(await broker.requestOpen(file.id, { gesture: 'open' })).toEqual({ status: 'opened' })
    await expect(broker.requestOpen(file.id, { gesture: 'open' })).rejects.toMatchObject({
      code: 'gesture-required',
    })
    expect(host.requestOpen).toHaveBeenCalledTimes(1)
    const denied = createPluginWorkspaceBroker({
      manifest: { ...manifest, permissions: [] },
      adapter: host,
    })
    await expect(denied.chooseRoot()).rejects.toMatchObject({ code: 'revoked' })
    broker.dispose()
  })
  it.each([
    '/etc/passwd',
    '../note.md',
    'a/../b',
    './a',
    'a//b',
    'C:/a',
    '//server/a',
    'a\\b',
    'file:///a',
    'a\0b',
    'a\nb',
    'a./b',
    'a /b',
    'a/'.repeat(65) + 'b',
  ])('rejects unsafe relative path %j before adapter access', async (relative) => {
    const { host, broker } = make()
    await broker.chooseRoot({ gesture: 'choose' })
    await expect(broker.resolveEntry(selected.id, relative)).rejects.toMatchObject({
      code: 'invalid-path',
    })
    expect(host.resolveEntry).not.toHaveBeenCalled()
    broker.dispose()
  })
  it('keeps encoded-looking filenames literal and resolves only in an issued root', async () => {
    expect(() => assertWorkspaceRelativePath('notes/%2e%2e.md')).not.toThrow()
    const { host, broker } = make()
    await broker.chooseRoot({ gesture: 'choose' })
    host.resolveEntry.mockResolvedValueOnce(null)
    expect(await broker.resolveEntry(selected.id, 'missing.md')).toBeNull()
    expect(await broker.resolveEntry(selected.id, file.relativePath)).toEqual(file)
    expect(await broker.requestOpen(file.id, { gesture: 'open' })).toEqual({ status: 'opened' })
    broker.dispose()
  })
  it('binds cursors to the directory, rejects reuse and invalidates previous enumeration replies', async () => {
    const { host, broker } = make()
    await broker.chooseRoot({ gesture: 'choose' })
    await broker.listChildren(selected.id)
    await expect(
      broker.listChildren(selected.id, { directoryId: directory.id, cursor: 'cursor-1' }),
    ).rejects.toMatchObject({ code: 'invalidated' })
    const older = deferred<PluginWorkspacePage>()
    host.listChildren.mockReturnValueOnce(older.promise)
    const stale = broker.listChildren(selected.id, { cursor: 'cursor-1' })
    const rejected = expect(stale).rejects.toMatchObject({ code: 'invalidated' })
    await flush()
    await broker.listChildren(selected.id)
    older.resolve({ entries: [{ ...file, id: 'late-file' }], nextCursor: 'late-cursor' })
    await rejected
    await expect(broker.requestOpen('late-file', { gesture: 'open' })).rejects.toMatchObject({
      code: 'invalid-token',
    })
    broker.dispose()
  })
  it.each([0, -1, 201, 1.5, Infinity])('rejects unbounded page limit %s', async (limit) => {
    const { host, broker } = make()
    await broker.chooseRoot({ gesture: 'choose' })
    await expect(broker.listChildren(selected.id, { limit })).rejects.toMatchObject({
      code: 'quota',
    })
    expect(host.listChildren).not.toHaveBeenCalled()
    broker.dispose()
  })
  it('refresh replaces the grant and invalidates files and cursors; release does not open documents', async () => {
    const { host, broker } = make()
    await broker.chooseRoot({ gesture: 'choose' })
    await broker.listChildren(selected.id)
    const fresh = await broker.refreshRoot(selected.id)
    expect(fresh.key).toBe(selected.key)
    await expect(broker.listChildren(selected.id)).rejects.toMatchObject({ code: 'invalid-token' })
    await expect(broker.requestOpen(file.id, { gesture: 'open' })).rejects.toMatchObject({
      code: 'invalid-token',
    })
    await broker.releaseRoot(fresh.id)
    await expect(broker.listChildren(fresh.id)).rejects.toMatchObject({ code: 'invalid-token' })
    expect(host.requestOpen).not.toHaveBeenCalled()
    broker.dispose()
  })
  it('releases old native grants on nine consecutive root replacements', async () => {
    const { host, broker } = make()
    const nativeRoots = new Set<string>()
    let sequence = 0
    host.chooseRoot.mockImplementation(async () => {
      if (nativeRoots.size >= 8) throw new Error('Native root quota')
      const id = `root-${++sequence}`
      nativeRoots.add(id)
      return { ...selected, id }
    })
    host.releaseRoot.mockImplementation(async (id) => {
      nativeRoots.delete(id)
    })
    for (let index = 1; index <= 9; index++) {
      const chosen = await broker.chooseRoot({ gesture: `gesture-${index}` })
      expect(chosen?.id).toBe(`root-${index}`)
      expect(nativeRoots.size).toBe(1)
      if (index > 1)
        await expect(broker.listChildren(`root-${index - 1}`)).rejects.toMatchObject({
          code: 'invalid-token',
        })
    }
    expect(host.releaseRoot).toHaveBeenCalledTimes(8)
    broker.dispose()
  })
  it('cancelled chooser retains existing root; aborted late chooser is cleaned and never published', async () => {
    const { host, broker } = make()
    await broker.chooseRoot({ gesture: 'choose' })
    host.chooseRoot.mockResolvedValueOnce(null)
    expect(await broker.chooseRoot({ gesture: 'cancel' })).toBeNull()
    await broker.listChildren(selected.id)
    const late = deferred<typeof selected>()
    host.chooseRoot.mockReturnValueOnce(late.promise)
    const abort = new AbortController()
    const waiting = broker.chooseRoot({ gesture: 'again', signal: abort.signal })
    const rejected = expect(waiting).rejects.toMatchObject({ code: 'aborted' })
    await flush()
    abort.abort()
    await rejected
    late.resolve({ ...selected, id: 'late-root' })
    await flush()
    expect(host.releaseRoot).toHaveBeenCalledWith('late-root')
    await expect(broker.listChildren('late-root')).rejects.toMatchObject({ code: 'invalid-token' })
    broker.dispose()
  })
  it('aborts protected open and seals a revoked broker even if permission later returns', async () => {
    let allowed = true
    const host = adapter()
    const closing = vi.fn()
    const broker = createPluginWorkspaceBroker({
      manifest,
      adapter: host,
      isActive: () => allowed,
      onDispose: closing,
      consumeGesture: () => true,
    })
    await broker.chooseRoot()
    await broker.listChildren(selected.id)
    const late = deferred<{ status: 'opened' }>()
    host.requestOpen.mockReturnValueOnce(late.promise)
    const pending = broker.requestOpen(file.id)
    const rejected = expect(pending).rejects.toMatchObject({ code: 'revoked' })
    await flush()
    allowed = false
    await expect(broker.listChildren(selected.id)).rejects.toMatchObject({ code: 'revoked' })
    await rejected
    expect(host.requestOpen.mock.calls[0]![1]!.signal!.aborted).toBe(true)
    late.resolve({ status: 'opened' })
    allowed = true
    await expect(broker.listChildren(selected.id)).rejects.toMatchObject({ code: 'revoked' })
    broker.dispose()
    expect(closing).toHaveBeenCalledTimes(1)
  })
  it('retains safe adapter error codes while removing OS messages and paths', async () => {
    const { host, broker } = make()
    await broker.chooseRoot({ gesture: 'choose' })
    host.listChildren.mockRejectedValueOnce({
      code: 'invalidated',
      message: 'private /home/user/root',
    })
    await expect(broker.listChildren(selected.id)).rejects.toEqual(
      new PluginWorkspaceError('invalidated'),
    )
    host.listChildren.mockRejectedValueOnce(new Error('/secret/file missing'))
    await expect(broker.listChildren(selected.id)).rejects.toEqual(
      new PluginWorkspaceError('unavailable'),
    )
    broker.dispose()
  })
  it('activation surface has no chooser/open and command closure cannot substitute gesture input', async () => {
    const { broker } = make()
    const read = createPluginWorkspaceHostCapabilities(broker)
    expect(read).not.toHaveProperty('chooseRoot')
    expect(read).not.toHaveProperty('requestOpen')
    const command = createPluginWorkspaceHostCapabilities(broker, () => true, true) as ReturnType<
      typeof createPluginWorkspaceHostCapabilities
    > & { chooseRoot(options?: unknown): Promise<unknown> }
    await expect(command.chooseRoot({ gesture: 'forged' })).rejects.toMatchObject({
      code: 'gesture-required',
    })
    broker.dispose()
  })
  it('does not mark synthetic events or expose proofs on context', () => {
    const context = {}
    markTrustedPluginCommand(context, new Event('click'))
    expect(pluginCommandGesture(context, manifest.id)).toBeUndefined()
    expect(Reflect.ownKeys(context)).toEqual([])
    const forged = Object.create(Event.prototype)
    Object.defineProperties(forged, {
      isTrusted: { value: true },
      type: { value: 'click' },
      eventPhase: { value: 2 },
    })
    expect(() => markTrustedPluginCommand(context, forged)).not.toThrow()
    expect(pluginCommandGesture(context, manifest.id)).toBeUndefined()
  })
  it('runtime exposes capability only with permission and rejects retained activation methods after disable', async () => {
    const { broker } = make()
    const captured: unknown[] = []
    const module: PluginModule = {
      activate: ({ host }) => {
        captured.push(host.workspace)
      },
    }
    const runtime = new PluginRuntime({
      allowedPermissions: ['workspace:read'],
      allowInProcessModules: true,
      workspaceBroker: broker,
    })
    runtime.loadPlugin({ manifest, module })
    await runtime.enablePlugin(manifest.id)
    expect(captured[0]).not.toHaveProperty('chooseRoot')
    await runtime.disablePlugin(manifest.id)
    await expect(
      (captured[0] as { releaseRoot(id: string): Promise<void> }).releaseRoot('root-1'),
    ).rejects.toMatchObject({ code: 'revoked' })
    runtime.loadPlugin({ manifest: { ...manifest, id: 'denied', permissions: [] }, module })
    await runtime.enablePlugin('denied')
    expect(captured[1]).toBeUndefined()
    broker.dispose()
  })
})
