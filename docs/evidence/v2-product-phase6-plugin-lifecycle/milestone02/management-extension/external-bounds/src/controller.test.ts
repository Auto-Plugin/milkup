import { expect, it, vi } from 'vitest'
import { createController } from './controller'
import { render } from './view'
const summary = { id: 'example.plugin', title: 'Example', description: 'Plugin description' }
const detail = {
  pluginId: summary.id,
  revision: 1,
  entryRevision: 2,
  title: summary.title,
  description: summary.description,
  version: '1.0.0',
  host: 'worker' as const,
  state: 'disabled' as const,
  compatibility: {
    compatible: false,
    hostVersion: '2.0.0-beta.1',
    sdkVersion: '0.3.7',
    requiredSdk: '>=0.4.0',
  },
  permissions: { declared: ['file:write'], approved: [], added: ['file:write'], removed: [] },
  networkOrigins: { declared: [], approved: [], added: [], removed: [] },
  diagnostics: [
    { code: 'incompatible', message: 'Requires newer SDK', severity: 'error' as const },
  ],
}
function setup() {
  const host = {
    snapshot: vi.fn(async () => ({ revision: 1, items: [summary] })),
    describe: vi.fn(async () => detail),
    requestHostView: vi.fn(async () => ({ status: 'opened' as const })),
  }
  return { host, controller: createController(host) }
}
it('ordinary list contains logo/title/description and keeps status/version/permissions in details', async () => {
  const { controller } = setup()
  await controller.refresh()
  const output = JSON.stringify(render(controller.state))
  expect(output).toContain('Example')
  expect(output).toContain('Plugin description')
  expect(output).not.toContain('file:write')
  expect(output).not.toContain('已停用')
  expect(output).not.toContain('1.0.0')
  await controller.select(summary.id)
  expect(JSON.stringify(render(controller.state))).toContain('file:write')
  expect(JSON.stringify(render(controller.state))).toContain('Requires newer SDK')
})
it('trusted navigation is requested synchronously and cannot approve or mutate', async () => {
  const { controller, host } = setup()
  await controller.refresh()
  await controller.select(summary.id)
  const opening = controller.openTrusted(host, 'details')
  expect(host.requestHostView).toHaveBeenCalledWith(
    { pluginId: summary.id, revision: 1, view: 'details' },
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  )
  await opening
  expect(controller.state.message).toContain('打开')
  expect(JSON.stringify(render(controller.state))).not.toContain('management.approve')
})
it('missing capability is explicit and never masquerades as an empty catalog', async () => {
  const controller = createController(undefined)
  await controller.refresh()
  expect(controller.state.phase).toBe('error')
  expect(controller.state.message).toContain('权限')
})
it('ignores late details after close and aborts the outstanding request', async () => {
  const { controller, host } = setup()
  await controller.refresh()
  let done!: (value: typeof detail) => void
  host.describe.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        done = resolve
      }),
  )
  const reading = controller.select(summary.id)
  controller.close()
  done(detail)
  await reading
  expect(controller.state.details).toBeUndefined()
  expect(host.describe.mock.calls[0]![1]!.signal.aborted).toBe(true)
})
it('stale revisions produce refresh guidance without automatic navigation retry', async () => {
  const { controller, host } = setup()
  await controller.refresh()
  await controller.select(summary.id)
  host.requestHostView.mockRejectedValueOnce({ code: 'stale' })
  await controller.openTrusted(host, 'settings')
  expect(controller.state.message).toContain('刷新')
  expect(host.requestHostView).toHaveBeenCalledTimes(1)
})

it('does not request navigation without selected details', async () => {
  const { controller, host } = setup()
  await controller.refresh()
  await controller.openTrusted(host, 'details')
  expect(host.requestHostView).not.toHaveBeenCalled()
})
it('disposal makes all later actions inert', async () => {
  const { controller, host } = setup()
  controller.dispose()
  await controller.refresh()
  await controller.select(summary.id)
  await controller.openTrusted(host, 'details')
  expect(host.snapshot).not.toHaveBeenCalled()
  expect(host.requestHostView).not.toHaveBeenCalled()
})
it('keeps untrusted titles as text nodes and never introduces markup', async () => {
  const { controller, host } = setup()
  host.snapshot.mockResolvedValueOnce({
    revision: 1,
    items: [{ ...summary, title: '<script>not code</script>' }],
  })
  await controller.refresh()
  const output = JSON.stringify(render(controller.state))
  expect(output).toContain('"text":"<script>not code</script>"')
  expect(output).not.toContain('"tag":"script"')
})
it('does not accept mismatched identities returned for a requested detail', async () => {
  const { controller, host } = setup()
  await controller.refresh()
  host.describe.mockResolvedValueOnce({ ...detail, revision: 2 })
  await controller.select(summary.id)
  expect(controller.state.details).toBeUndefined()
  expect(controller.state.message).toContain('刷新')
})
it('shows cancelled navigation without treating it as an approval', async () => {
  const { controller, host } = setup()
  await controller.refresh()
  await controller.select(summary.id)
  host.requestHostView.mockResolvedValueOnce({ status: 'cancelled' } as never)
  await controller.openTrusted(host, 'details')
  expect(controller.state.message).toContain('取消')
})
