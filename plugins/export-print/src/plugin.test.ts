import { describe, expect, it, vi } from 'vitest'
import plugin, { render } from './plugin'
import type {
  SdkPluginActivationContext,
  SdkPluginCommandContext,
  SdkRendererOutput,
} from '@milkup/plugin-sdk'
import type { State } from './controller'
const state = (patch: Partial<State> = {}): State => ({
  phase: 'idle',
  format: 'html',
  scope: 'document',
  resources: 'embed',
  pageSize: 'a4',
  landscape: false,
  ...patch,
})
function flatten(node: SdkRendererOutput): Exclude<SdkRendererOutput, string>[] {
  if (typeof node === 'string') return []
  if (Array.isArray(node)) return node.flatMap(flatten)
  return [node, ...('children' in node ? (node.children ?? []).flatMap(flatten) : [])]
}
describe('output panel and command contract', () => {
  it('shows labeled format, range, image and paper options', () => {
    expect(
      flatten(render(state()))
        .filter((n) => n.type === 'field')
        .map((n) => n.key),
    ).toEqual(['format', 'scope', 'resources'])
    expect(
      flatten(render(state({ format: 'pdf' })))
        .filter((n) => n.type === 'field')
        .map((n) => n.key),
    ).toEqual(['format', 'scope', 'resources', 'pageSize', 'orientation'])
    const nodes = flatten(render(state({ format: 'print' })))
    expect(
      nodes.find((n) => n.type === 'element' && n.action?.command === 'exportPrint.start')?.text,
    ).toBe('打印')
  })
  it('shows captured version and warnings as safe text with progress and cancellation', () => {
    const nodes = flatten(
      render(
        state({
          phase: 'writing',
          snapshot: {
            id: 'snap',
            documentId: 'doc',
            version: 42,
            title: '<img src=x>',
            from: 2,
            to: 20,
            lineCount: 5,
            warnings: [{ code: 'omitted', message: '<script>图片未包含</script>' }],
          },
        }),
      ),
    )
    expect(nodes.some((n) => n.type === 'element' && n.text?.includes('版本 42'))).toBe(true)
    expect(
      nodes.some((n) => n.type === 'element' && n.text === '<script>图片未包含</script>'),
    ).toBe(true)
    expect(JSON.stringify(nodes)).not.toContain('"html":')
    expect(nodes.filter((n) => n.type === 'field').every((n) => n.disabled)).toBe(true)
    expect(
      nodes.find((n) => n.type === 'element' && n.action?.command === 'exportPrint.cancel')
        ?.disabled,
    ).toBe(false)
  })
  it('offers retry on failure and reports committed file and byte count', () => {
    const failed = flatten(render(state({ phase: 'error', error: '保存失败' })))
    expect(
      failed.find((n) => n.type === 'element' && n.action?.command === 'exportPrint.retry')?.text,
    ).toBe('重试')
    expect(
      failed.some(
        (n) => n.type === 'element' && n.attributes?.role === 'alert' && n.text === '保存失败',
      ),
    ).toBe(true)
    const done = flatten(
      render(
        state({ phase: 'done', result: { status: 'written', name: '中文.html', bytes: 2048 } }),
      ),
    )
    expect(done.some((n) => n.type === 'element' && n.text?.includes('中文.html（2.0 KB）'))).toBe(
      true,
    )
  })
  it('starts capture before returning from a command while preparation remains pending', async () => {
    let resolve!: (value: unknown) => void
    const pending = new Promise((r) => {
      resolve = r
    })
    const capture = vi.fn(() => pending),
      release = vi.fn(async () => {})
    const activation = await plugin.activate?.({ host: {} } as SdkPluginActivationContext)
    const result = plugin.commands?.['exportPrint.start']?.({
      host: { output: { capture, release } },
    } as unknown as SdkPluginCommandContext)
    expect(result).toBeUndefined()
    expect(capture).toHaveBeenCalledTimes(1)
    await activation?.dispose?.()
    expect(capture.mock.calls[0]?.[1].signal.aborted).toBe(true)
    resolve({ id: 'late' })
    await Promise.resolve()
    await Promise.resolve()
    expect(release).toHaveBeenCalledWith('late')
  })
  it('panel hide aborts but ordinary focus changes retain the operation', async () => {
    let resolve!: (value: unknown) => void
    const pending = new Promise((r) => {
      resolve = r
    })
    const capture = vi.fn(() => pending)
    const activation = await plugin.activate?.({ host: {} } as SdkPluginActivationContext)
    plugin.commands?.['exportPrint.start']?.({
      host: { output: { capture, release: vi.fn(async () => {}) } },
    } as unknown as SdkPluginCommandContext)
    plugin.renderers?.['export-print-panel']?.({ node: { phase: 'blur', visible: true } } as never)
    expect(capture.mock.calls[0]?.[1].signal.aborted).toBe(false)
    plugin.renderers?.['export-print-panel']?.({
      node: { phase: 'update', visible: false },
    } as never)
    expect(capture.mock.calls[0]?.[1].signal.aborted).toBe(true)
    resolve({ id: 'late' })
    await Promise.resolve()
    await activation?.dispose?.()
  })
})

describe('print outcome confirmation UI', () => {
  it('keeps controls and cancellation disabled while the host confirms a cancelled print request', () => {
    const nodes = flatten(render(state({ phase: 'printing', format: 'print', cancelling: true })))
    expect(nodes.some((n) => n.type === 'element' && n.text?.includes('正在确认打印结果'))).toBe(
      true,
    )
    expect(
      nodes
        .filter((n) => n.type === 'field' || (n.type === 'element' && n.action))
        .every((n) => n.disabled),
    ).toBe(true)
    expect(nodes.some((n) => n.type === 'element' && n.text?.includes('已取消'))).toBe(false)
  })
  it('labels uncertain print retry with the prerequisite queue check', () => {
    const nodes = flatten(
      render(
        state({
          phase: 'error',
          format: 'print',
          printUnconfirmed: true,
          error: '无法确认打印结果，请先检查打印队列，避免重复提交。',
        }),
      ),
    )
    expect(
      nodes.find((n) => n.type === 'element' && n.action?.command === 'exportPrint.retry')?.text,
    ).toBe('检查打印队列后重试')
  })
})
