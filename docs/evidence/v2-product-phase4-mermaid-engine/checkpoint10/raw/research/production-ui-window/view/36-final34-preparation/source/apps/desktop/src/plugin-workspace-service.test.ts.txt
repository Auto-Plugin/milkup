import { describe, expect, it, vi } from 'vitest'
import {
  createDesktopWorkspaceAdapter,
  type WorkspaceInvoke,
  type WorkspaceOpenRequest,
} from './plugin-workspace-service'
import { createDocumentSession } from '@milkup/tauri-bridge'
import { createDocumentTransitionController } from './document-transition'

const nativeInvoke = vi.hoisted(() => vi.fn())
vi.mock('@tauri-apps/api/core', () => ({ invoke: nativeInvoke }))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((yes) => {
    resolve = yes
  })
  return { promise, resolve }
}
const root = { id: 'root-1', key: 'stable-key', label: 'Notes' }
function fixture(
  openDocument: (
    request: WorkspaceOpenRequest,
  ) => Promise<{ status: 'opened' | 'cancelled' }> = async () => ({ status: 'cancelled' }),
) {
  const responses = new Map<string, unknown>([
    ['workspace_create_scope', 'scope-1'],
    ['workspace_choose_root', root],
    ['workspace_refresh_root', { ...root, id: 'root-2' }],
    [
      'workspace_prepare_open',
      { id: 'lease-1', path: '/notes/a.md', sizeBytes: 30, readonly: false },
    ],
    [
      'workspace_read_file',
      {
        documentId: 'doc',
        file: { path: '/notes/a.md' },
        text: '# 内容 👩🏽‍💻\r\n',
        diskSnapshotHash: 'hash',
      },
    ],
  ])
  const invoke = vi.fn(async (command: string, _args?: Record<string, unknown>): Promise<unknown> =>
    responses.get(command),
  )
  const service = createDesktopWorkspaceAdapter({ invoke: invoke as WorkspaceInvoke, openDocument })
  return { ...service, invoke, responses }
}
const tick = async () => {
  for (let index = 0; index < 12; index++) await Promise.resolve()
}

describe('desktop workspace scope and descriptor ownership', () => {
  it('does not race cancellation cleanup against an acceptance already sent to native', async () => {
    const controller = createDocumentTransitionController({
      session: () => createDocumentSession({ documentId: 'draft' }),
      busy: () => false,
      flushEdits: async () => {},
      save: async () => true,
      saveFailureMessage: () => '',
      show: vi.fn(),
      hide: vi.fn(),
      onError: vi.fn(),
    })
    const acceptance = deferred<void>()
    const install = vi.fn()
    const f = fixture(async (request) => {
      const outcome = await controller.requestAndWait(
        'open',
        async (signal) => {
          const lease = await request.prepare()
          await lease.accept()
          if (!signal.aborted) install()
        },
        { signal: request.signal },
      )
      return { status: outcome.status === 'completed' ? 'opened' : 'cancelled' }
    })
    f.responses.set('workspace_finish_open', acceptance.promise)
    const pending = f.adapter.requestOpen('file-1')
    await tick()
    expect(f.invoke).toHaveBeenCalledWith('workspace_finish_open', {
      scopeId: 'scope-1',
      openId: 'lease-1',
      accepted: true,
    })
    controller.cancel()
    await tick()
    expect(
      f.invoke.mock.calls.filter(([command]) => command === 'workspace_finish_open'),
    ).toHaveLength(1)
    acceptance.resolve()
    await expect(pending).resolves.toEqual({ status: 'cancelled' })
    await tick()
    expect(install).not.toHaveBeenCalled()
    expect(
      f.invoke.mock.calls.filter(([command]) => command === 'workspace_finish_open'),
    ).toHaveLength(1)
  })

  it('leaves an accepted document owned by the host after later abort and adapter disposal', async () => {
    const controller = createDocumentTransitionController({
      session: () => createDocumentSession({ documentId: 'draft' }),
      busy: () => false,
      flushEdits: async () => {},
      save: async () => true,
      saveFailureMessage: () => '',
      show: vi.fn(),
      hide: vi.fn(),
      onError: vi.fn(),
    })
    const paint = deferred<void>()
    const f = fixture(async (request) => {
      const outcome = await controller.requestAndWait(
        'open',
        async (_signal, commit) => {
          const lease = await request.prepare()
          await lease.accept()
          commit()
          await paint.promise
        },
        { signal: request.signal },
      )
      return { status: outcome.status === 'completed' ? 'opened' : 'cancelled' }
    })
    const abort = new AbortController()
    await expect(f.adapter.requestOpen('file-1', { signal: abort.signal })).resolves.toEqual({
      status: 'opened',
    })
    abort.abort()
    f.dispose()
    await tick()
    expect(f.invoke.mock.calls.filter(([command]) => command === 'workspace_finish_open')).toEqual([
      ['workspace_finish_open', { scopeId: 'scope-1', openId: 'lease-1', accepted: true }],
    ])
    expect(f.invoke).toHaveBeenCalledWith('workspace_release_scope', { scopeId: 'scope-1' })
    paint.resolve()
    await tick()
  })

  it.each([
    'invalidated',
    'invalid-path',
    'invalid-token',
    'revoked',
    'quota',
    'busy',
    'unavailable',
  ] as const)('preserves only the whitelisted native %s error code', async (code) => {
    nativeInvoke.mockRejectedValueOnce(`[${code}] /private/notes/secret.md`)
    const service = createDesktopWorkspaceAdapter({
      openDocument: async () => ({ status: 'cancelled' }),
    })
    await expect(service.adapter.chooseRoot()).rejects.toMatchObject({
      name: 'PluginWorkspaceError',
      code,
      message: `Workspace operation failed: ${code}`,
    })
  })

  it.each([
    '/private/notes/secret.md',
    'native [invalidated] /private/notes',
    '[unknown] /private/notes',
  ])('sanitizes unrecognized native errors: %s', async (message) => {
    nativeInvoke.mockRejectedValueOnce(new Error(message))
    const service = createDesktopWorkspaceAdapter({
      openDocument: async () => ({ status: 'cancelled' }),
    })
    await expect(service.adapter.chooseRoot()).rejects.toMatchObject({
      name: 'PluginWorkspaceError',
      code: 'unavailable',
      message: 'Workspace operation failed: unavailable',
    })
  })

  it.each(['abort', 'cancel'] as const)(
    'releases a lease returned after protected navigation has already settled by %s',
    async (cancellation) => {
      const controller = createDocumentTransitionController({
        session: () => createDocumentSession({ documentId: 'draft' }),
        busy: () => false,
        flushEdits: async () => {},
        save: async () => true,
        saveFailureMessage: () => '',
        show: vi.fn(),
        hide: vi.fn(),
        onError: vi.fn(),
      })
      const prepared = deferred<{
        id: string
        path: string
        sizeBytes: number
        readonly: boolean
      }>()
      const f = fixture(async (request) => {
        const outcome = await controller.requestAndWait(
          'open',
          async (signal) => {
            const lease = await request.prepare()
            if (signal.aborted) throw new DOMException('Cancelled', 'AbortError')
            await lease.read('doc')
          },
          { signal: request.signal },
        )
        return { status: outcome.status === 'completed' ? 'opened' : 'cancelled' }
      })
      f.responses.set('workspace_prepare_open', prepared.promise)
      const abort = new AbortController()
      const pending = f.adapter.requestOpen('file-1', { signal: abort.signal })
      await tick()
      expect(f.invoke).toHaveBeenCalledWith('workspace_prepare_open', {
        scopeId: 'scope-1',
        fileId: 'file-1',
      })
      if (cancellation === 'abort') abort.abort()
      else controller.cancel()
      await expect(pending).resolves.toEqual({ status: 'cancelled' })
      prepared.resolve({ id: 'lease-late', path: '/notes/a.md', sizeBytes: 30, readonly: false })
      await tick()
      expect(
        f.invoke.mock.calls.filter(([command]) => command === 'workspace_finish_open'),
      ).toEqual([
        ['workspace_finish_open', { scopeId: 'scope-1', openId: 'lease-late', accepted: false }],
      ])
      expect(f.invoke.mock.calls.some(([command]) => command === 'workspace_read_file')).toBe(false)
    },
  )

  it('does not prepare or read a file when the protected transition is cancelled', async () => {
    const f = fixture()
    await expect(f.adapter.requestOpen('file-1')).resolves.toEqual({ status: 'cancelled' })
    expect(f.invoke.mock.calls.map(([command]) => command)).toEqual(['workspace_create_scope'])
  })

  it('uses only the native lease for reads and accepts it only after validation', async () => {
    const f = fixture(async (request) => {
      const lease = await request.prepare()
      const file = await lease.read('doc')
      expect(file.text).toBe('# 内容 👩🏽‍💻\r\n')
      await lease.validate()
      await lease.accept()
      return { status: 'opened' }
    })
    await expect(f.adapter.requestOpen('file-1')).resolves.toEqual({ status: 'opened' })
    expect(f.invoke).toHaveBeenCalledWith('workspace_read_file', {
      scopeId: 'scope-1',
      openId: 'lease-1',
      documentId: 'doc',
    })
    expect(f.invoke).toHaveBeenLastCalledWith('workspace_finish_open', {
      scopeId: 'scope-1',
      openId: 'lease-1',
      accepted: true,
    })
    expect(f.invoke.mock.calls.every(([, args]) => !args || !('path' in args))).toBe(true)
  })

  it('releases a prepared lease when native validation detects replacement', async () => {
    const f = fixture(async (request) => {
      const lease = await request.prepare()
      await lease.read('doc')
      await lease.validate()
      return { status: 'opened' }
    })
    f.invoke.mockImplementation(async (command) => {
      if (command === 'workspace_validate_open') throw Error('invalidated')
      return f.responses.get(command)
    })
    await expect(f.adapter.requestOpen('file-1')).rejects.toThrow('invalidated')
    expect(f.invoke).toHaveBeenLastCalledWith('workspace_finish_open', {
      scopeId: 'scope-1',
      openId: 'lease-1',
      accepted: false,
    })
  })

  it('cleans a late selected root after cancellation', async () => {
    const chosen = deferred<typeof root>()
    const f = fixture()
    f.responses.set('workspace_choose_root', chosen.promise)
    const controller = new AbortController()
    const pending = f.adapter.chooseRoot({ signal: controller.signal })
    await tick()
    controller.abort()
    chosen.resolve(root)
    await expect(pending).rejects.toThrow('取消')
    expect(f.invoke).toHaveBeenCalledWith('workspace_release_root', {
      scopeId: 'scope-1',
      rootId: root.id,
    })
  })

  it('cleans a late pagination cursor and rejects its results after cancellation', async () => {
    const page = deferred<{ entries: never[]; nextCursor: string }>()
    const f = fixture()
    f.responses.set('workspace_list_children', page.promise)
    const controller = new AbortController()
    const pending = f.adapter.listChildren(root.id, { signal: controller.signal, limit: 100 })
    await tick()
    controller.abort()
    page.resolve({ entries: [], nextCursor: 'cursor-1' })
    await expect(pending).rejects.toThrow('取消')
    expect(f.invoke).toHaveBeenCalledWith('workspace_cancel_cursor', {
      scopeId: 'scope-1',
      cursor: 'cursor-1',
    })
  })

  it('revokes in-flight protected opens and cleans late scope creation exactly once', async () => {
    const scope = deferred<string>()
    const open = vi.fn(async () => ({ status: 'opened' as const }))
    const f = fixture(open)
    f.responses.set('workspace_create_scope', scope.promise)
    const pending = f.adapter.requestOpen('file-1')
    f.dispose()
    f.dispose()
    scope.resolve('scope-1')
    await expect(pending).rejects.toThrow('取消')
    await tick()
    expect(open).not.toHaveBeenCalled()
    expect(
      f.invoke.mock.calls.filter(([command]) => command === 'workspace_release_scope'),
    ).toHaveLength(1)
    await expect(f.adapter.chooseRoot()).rejects.toThrow('取消')
  })

  it('aborts an already displayed protected transition on disable', async () => {
    let signal: AbortSignal | undefined
    const f = fixture(async (request) => {
      signal = request.signal
      return new Promise((resolve) =>
        request.signal.addEventListener('abort', () => resolve({ status: 'cancelled' }), {
          once: true,
        }),
      )
    })
    const pending = f.adapter.requestOpen('file-1')
    await tick()
    expect(signal?.aborted).toBe(false)
    f.dispose()
    await expect(pending).resolves.toEqual({ status: 'cancelled' })
    expect(signal?.aborted).toBe(true)
  })
})
