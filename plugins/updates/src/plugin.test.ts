import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  SdkPluginReleasesHost,
  SdkReleaseCheckResult,
  SdkReleaseStatus,
} from '@milkup/plugin-sdk'
import { createController } from './controller'
import plugin from './plugin'

const release = {
  id: 'release-1',
  version: '2.1.0',
  notes: '<img src=x onerror=alert(1)>\n**literal markdown** [link](https://example.com)',
  date: '2026-10-15',
}
function backend() {
  return {
    check: vi.fn(async (): Promise<SdkReleaseCheckResult> => ({
      configured: true,
      channel: 'stable',
      currentVersion: '2.0.0',
      release,
    })),
    stage: vi.fn(async () => {}),
    status: vi.fn(async (): Promise<SdkReleaseStatus> => ({
      phase: 'downloading',
      received: 1024,
      total: 4096,
    })),
    cancel: vi.fn(async () => {}),
    requestInstall: vi.fn(async (): Promise<{ status: 'cancelled' | 'installing' }> => ({
      status: 'cancelled',
    })),
  } satisfies SdkPluginReleasesHost
}
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
const controllers: ReturnType<typeof createController>[] = []
function setup(api = backend()) {
  const changed = vi.fn()
  const controller = createController(api, changed)
  controllers.push(controller)
  return { api, changed, controller }
}
afterEach(async () => {
  await plugin.deactivate()
  await Promise.all(controllers.splice(0).map((controller) => controller.dispose()))
  vi.useRealTimers()
})
const flush = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve()
}
type Node = {
  tag?: string
  text?: string
  children?: Node[]
  action?: { command: string }
  attributes?: Record<string, string>
}
function nodes(value: unknown): Node[] {
  if (!value || typeof value !== 'object') return []
  const node = value as Node
  return [node, ...(node.children ?? []).flatMap(nodes)]
}
function render(phase: 'mount' | 'update' | 'dispose' = 'update') {
  return plugin.renderers['updates-modal']({ node: { phase } })
}
function text(value: unknown) {
  return nodes(value)
    .map((node) => node.text || '')
    .join('\n')
}
function activate(api = backend()) {
  const requestUpdate = vi.fn(async () => {})
  const lifecycle = plugin.activate({
    pluginId: 'milkup.updates',
    permissions: ['app:updates'],
    host: {
      releases: api,
      ui: { requestUpdate, revealLine: async () => {} },
    },
  })
  return { api, requestUpdate, lifecycle }
}

describe('update state and resource lifecycle', () => {
  it('shows unavailable, current, and available metadata', async () => {
    const { controller, api } = setup()
    api.check.mockResolvedValueOnce({
      configured: false,
      channel: 'preview',
      currentVersion: '2.0.0',
    })
    await controller.check()
    expect(controller.state).toMatchObject({
      phase: 'unavailable',
      currentVersion: '2.0.0',
      channel: 'preview',
    })
    api.check.mockResolvedValueOnce({
      configured: true,
      channel: 'stable',
      currentVersion: '2.0.0',
    })
    await controller.check()
    expect(controller.state.phase).toBe('current')
    await controller.check()
    expect(controller.state).toMatchObject({ phase: 'available', release })
  })
  it('provides a permission error without a backend', async () => {
    const controller = createController(undefined, () => {})
    controllers.push(controller)
    await controller.check()
    expect(controller.state).toMatchObject({ phase: 'error', retry: 'check' })
    expect(controller.state.error).toContain('app:updates')
  })
  it('retries a check error and ignores concurrent checks', async () => {
    const { controller, api } = setup()
    const pending = deferred<SdkReleaseCheckResult>()
    api.check.mockReturnValueOnce(pending.promise)
    const check = controller.check()
    await controller.check()
    expect(api.check).toHaveBeenCalledTimes(1)
    pending.reject(new Error('offline'))
    await check
    expect(controller.state).toMatchObject({ phase: 'error', error: 'offline', retry: 'check' })
    await controller.check()
    expect(controller.state.phase).toBe('available')
  })
  it('polls download and verification then stops at ready', async () => {
    vi.useFakeTimers()
    const { controller, api } = setup()
    api.status
      .mockResolvedValueOnce({ phase: 'downloading', received: 1024, total: null })
      .mockResolvedValueOnce({ phase: 'verifying', received: 4096, total: 4096 })
      .mockResolvedValue({ phase: 'ready', received: 4096, total: 4096 })
    await controller.check()
    await controller.download()
    expect(controller.state).toMatchObject({ phase: 'downloading', received: 1024, total: null })
    await vi.advanceTimersByTimeAsync(500)
    expect(controller.state.phase).toBe('verifying')
    await vi.advanceTimersByTimeAsync(500)
    expect(controller.state.phase).toBe('ready')
    await vi.advanceTimersByTimeAsync(5000)
    expect(api.status).toHaveBeenCalledTimes(3)
  })
  it('does not overlap polls and ignores status returned after cancellation', async () => {
    vi.useFakeTimers()
    const { controller, api } = setup()
    const status = deferred<SdkReleaseStatus>()
    api.status.mockReturnValueOnce(status.promise)
    await controller.check()
    const download = controller.download()
    await flush()
    await vi.advanceTimersByTimeAsync(5000)
    expect(api.status).toHaveBeenCalledTimes(1)
    await controller.cancel()
    status.resolve({ phase: 'ready', received: 4096, total: 4096 })
    await download
    expect(controller.state.phase).toBe('available')
    expect(vi.getTimerCount()).toBe(0)
  })
  it('waits for stage acknowledgement before cancelling', async () => {
    const { controller, api } = setup()
    const stage = deferred<void>()
    api.stage.mockReturnValueOnce(stage.promise)
    await controller.check()
    const download = controller.download()
    const cancel = controller.cancel()
    await flush()
    expect(api.cancel).not.toHaveBeenCalled()
    stage.resolve()
    await Promise.all([download, cancel])
    expect(api.cancel).toHaveBeenCalledWith(release.id)
    expect(api.status).not.toHaveBeenCalled()
    expect(controller.state.phase).toBe('available')
  })
  it('preserves cancellation failures as retryable cancellation', async () => {
    const { controller, api } = setup()
    await controller.check()
    await controller.download()
    api.cancel.mockRejectedValueOnce(new Error('busy'))
    await controller.cancel()
    expect(controller.state).toMatchObject({ phase: 'error', retry: 'cancel' })
    await controller.download()
    await controller.check()
    expect(api.stage).toHaveBeenCalledTimes(1)
    await controller.cancel()
    expect(controller.state.phase).toBe('available')
  })
  it('cleans up failed download before a retry and reports backend errors', async () => {
    const { controller, api } = setup()
    api.status.mockResolvedValueOnce({
      phase: 'error',
      received: 0,
      total: null,
      error: 'signature mismatch',
    })
    await controller.check()
    await controller.download()
    expect(controller.state).toMatchObject({
      phase: 'error',
      error: 'signature mismatch',
      retry: 'download',
    })
    await controller.check()
    expect(api.check).toHaveBeenCalledTimes(1)
    await controller.download()
    expect(api.cancel).toHaveBeenCalledWith(release.id)
    expect(api.stage).toHaveBeenCalledTimes(2)
    expect(controller.state.phase).toBe('downloading')
  })
  it('reports stage and status exceptions', async () => {
    const { controller, api } = setup()
    await controller.check()
    api.stage.mockRejectedValueOnce(new Error('disk full'))
    await controller.download()
    expect(controller.state.error).toBe('disk full')
    api.status.mockRejectedValueOnce(new Error('transport closed'))
    await controller.download()
    expect(controller.state).toMatchObject({
      phase: 'error',
      error: 'transport closed',
      retry: 'download',
    })
  })
  it('keeps ready after declined installation and installing after acceptance', async () => {
    const { controller, api } = setup()
    api.status.mockResolvedValue({ phase: 'ready', received: 1, total: 1 })
    await controller.check()
    await controller.download()
    await controller.install()
    expect(controller.state.phase).toBe('ready')
    api.requestInstall.mockResolvedValueOnce({ status: 'installing' })
    await controller.install()
    expect(controller.state.phase).toBe('installing')
    await controller.install()
    expect(api.requestInstall).toHaveBeenCalledTimes(2)
  })
  it('disposes idempotently, stops polling and rejects late check results', async () => {
    vi.useFakeTimers()
    const { controller, api, changed } = setup()
    await controller.check()
    await controller.download()
    const updates = changed.mock.calls.length
    await controller.dispose()
    await controller.dispose()
    await vi.advanceTimersByTimeAsync(5000)
    expect(api.cancel).toHaveBeenCalledTimes(1)
    expect(api.status).toHaveBeenCalledTimes(1)
    expect(changed).toHaveBeenCalledTimes(updates)
    const second = setup()
    const pending = deferred<SdkReleaseCheckResult>()
    second.api.check.mockReturnValueOnce(pending.promise)
    const check = second.controller.check()
    await second.controller.dispose()
    pending.resolve({ configured: true, channel: 'stable', currentVersion: '2.0.0', release })
    await check
    expect(second.controller.state.phase).toBe('checking')
  })
  it('disposes while install confirmation is pending without awaiting it', async () => {
    const { controller, api, changed } = setup()
    api.status.mockResolvedValue({ phase: 'ready', received: 1, total: 1 })
    const pending = deferred<{ status: 'cancelled' | 'installing' }>()
    api.requestInstall.mockReturnValueOnce(pending.promise)
    await controller.check()
    await controller.download()
    const install = controller.install()
    expect(controller.state.phase).toBe('confirming')
    const updates = changed.mock.calls.length
    await controller.dispose()
    expect(api.cancel).toHaveBeenCalledWith(release.id)
    pending.resolve({ status: 'cancelled' })
    await install
    expect(changed).toHaveBeenCalledTimes(updates)
  })
  it('cancels a stage that acknowledges after disposal without starting polls', async () => {
    const { controller, api, changed } = setup()
    const pending = deferred<void>()
    api.stage.mockReturnValueOnce(pending.promise)
    await controller.check()
    const download = controller.download()
    const disposal = controller.dispose()
    const updates = changed.mock.calls.length
    pending.resolve()
    await Promise.all([download, disposal])
    expect(api.cancel).toHaveBeenCalledTimes(1)
    expect(api.status).not.toHaveBeenCalled()
    expect(changed).toHaveBeenCalledTimes(updates)
  })
  it('blocks duplicate download/install operations and surfaces installation rejection', async () => {
    const { controller, api } = setup()
    const pending = deferred<{ status: 'cancelled' | 'installing' }>()
    api.status.mockResolvedValue({ phase: 'ready', received: 1, total: 1 })
    api.requestInstall.mockReturnValueOnce(pending.promise)
    await controller.check()
    const download = controller.download()
    await controller.download()
    await download
    expect(api.stage).toHaveBeenCalledTimes(1)
    const install = controller.install()
    await controller.install()
    await controller.check()
    await controller.download()
    expect(api.requestInstall).toHaveBeenCalledTimes(1)
    pending.reject(new Error('document could not be saved'))
    await install
    expect(controller.state).toMatchObject({
      phase: 'error',
      error: 'document could not be saved',
      retry: 'download',
    })
  })
})

describe('controlled modal UI and short commands', () => {
  it('renders release notes as plain text with stable accessible button labels', async () => {
    activate()
    render('mount')
    expect(plugin.commands['updates.check']()).toBeUndefined()
    await flush()
    const output = render()
    expect(text(output)).toContain('当前版本：2.0.0')
    expect(text(output)).toContain('更新渠道：stable')
    expect(nodes(output).find((node) => node.attributes?.['aria-label'] === '版本说明')?.text).toBe(
      release.notes,
    )
    expect(
      nodes(output).some((node) => ['a', 'img', 'script', 'iframe'].includes(node.tag || '')),
    ).toBe(false)
    for (const node of nodes(output).filter((node) => node.tag === 'button'))
      expect(node.attributes?.['aria-label']).toBeTruthy()
  })
  it('continues background downloads on modal disposal and refreshes when reopened', async () => {
    vi.useFakeTimers()
    const { api, requestUpdate, lifecycle } = activate()
    api.status.mockResolvedValue({ phase: 'downloading', received: 1024, total: null })
    render('mount')
    plugin.commands['updates.check']()
    await flush()
    plugin.commands['updates.download']()
    await flush()
    expect(text(render())).toContain('总大小未知')
    render('dispose')
    const updates = requestUpdate.mock.calls.length
    api.status.mockResolvedValue({ phase: 'ready', received: 4096, total: 4096 })
    await vi.advanceTimersByTimeAsync(500)
    expect(api.cancel).not.toHaveBeenCalled()
    expect(requestUpdate).toHaveBeenCalledTimes(updates)
    expect(text(render('mount'))).toContain('已通过签名校验')
    await lifecycle.dispose()
    expect(api.cancel).toHaveBeenCalledWith(release.id)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('acknowledges installation immediately while host confirmation is pending', async () => {
    const { api, lifecycle } = activate()
    api.status.mockResolvedValue({ phase: 'ready', received: 1, total: 1 })
    const pending = deferred<{ status: 'cancelled' | 'installing' }>()
    api.requestInstall.mockReturnValueOnce(pending.promise)
    render('mount')
    plugin.commands['updates.check']()
    await flush()
    plugin.commands['updates.download']()
    await flush()
    expect(plugin.commands['updates.install']()).toBeUndefined()
    expect(text(render())).toContain('宿主确认窗口')
    await lifecycle.dispose()
    pending.resolve({ status: 'cancelled' })
    await flush()
    expect(api.cancel).toHaveBeenCalledWith(release.id)
  })
})
