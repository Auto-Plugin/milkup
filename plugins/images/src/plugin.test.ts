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
  initializing: false,
  policy: 'assets',
  alt: '',
  ...patch,
})
function flatten(node: SdkRendererOutput): Exclude<SdkRendererOutput, string>[] {
  if (typeof node === 'string') return []
  if (Array.isArray(node)) return node.flatMap(flatten)
  return [node, ...('children' in node ? (node.children ?? []).flatMap(flatten) : [])]
}
describe('controlled image UI and command lifecycle', () => {
  it('uses labelled native fields and explicit fixed directory options', () => {
    const nodes = flatten(render(state()))
    expect(
      nodes.filter((node) => node.type === 'field').map((node) => [node.key, node.label]),
    ).toEqual([
      ['policy', '资源目录'],
      ['alt', '替代文本'],
    ])
    expect(
      nodes
        .find((node) => node.type === 'field' && node.key === 'policy')
        ?.options?.map((option) => option.value),
    ).toEqual(['assets', 'document-assets'])
  })
  it('keeps malicious filename and error text as text, never HTML', () => {
    const nodes = flatten(
      render(
        state({ fileName: '<img src=x onerror=alert(1)>.png', error: '<script>error</script>' }),
      ),
    )
    expect(
      nodes.some(
        (node) => node.type === 'element' && node.text === '图片：<img src=x onerror=alert(1)>.png',
      ),
    ).toBe(true)
    expect(
      nodes.some(
        (node) =>
          node.type === 'element' &&
          node.attributes?.role === 'alert' &&
          node.text === '<script>error</script>',
      ),
    ).toBe(true)
    expect(JSON.stringify(nodes)).not.toContain('"html":')
  })
  it('disables competing import/field edits while keeping cancellation available', () => {
    const nodes = flatten(render(state({ phase: 'staging' })))
    expect(nodes.filter((node) => node.type === 'field').every((node) => node.disabled)).toBe(true)
    expect(
      nodes.find((node) => node.type === 'element' && node.action?.command === 'images.choose')
        ?.disabled,
    ).toBe(true)
    expect(
      nodes.find((node) => node.type === 'element' && node.action?.command === 'images.cancel')
        ?.disabled,
    ).toBe(false)
  })
  it('shows invalid text beside its field and offers a fresh chooser after failure', () => {
    const invalid = flatten(render(state({ invalidAlt: '太长' })))
    expect(invalid.find((node) => node.type === 'field' && node.key === 'alt')?.invalid).toBe(true)
    const failure = flatten(render(state({ phase: 'error', error: '导入失败' })))
    expect(
      failure.find((node) => node.type === 'element' && node.action?.command === 'images.choose')
        ?.text,
    ).toBe('重新选择图片')
  })
  it('returns from image commands immediately while the native chooser is pending', async () => {
    let resolve!: (value: { status: 'cancelled' }) => void
    const pending = new Promise<{ status: 'cancelled' }>((r) => {
      resolve = r
    })
    const prepareDocument = vi.fn(() => pending)
    const activation = await plugin.activate?.({
      host: { ui: { requestUpdate: vi.fn(async () => {}) } },
    } as unknown as SdkPluginActivationContext)
    const host = {
      resources: { prepareDocument, abort: vi.fn(async () => {}) },
      editing: { release: vi.fn(async () => {}) },
    }
    const result = plugin.commands?.['images.choose']?.({
      host,
    } as unknown as SdkPluginCommandContext)
    expect(result).toBeUndefined()
    expect(prepareDocument).toHaveBeenCalledTimes(1)
    resolve({ status: 'cancelled' })
    await Promise.resolve()
    await Promise.resolve()
    await activation?.dispose?.()
  })
  it('visible=false cancels pending work but focus/blur does not', async () => {
    let resolve!: (value: { status: 'cancelled' }) => void
    const pending = new Promise<{ status: 'cancelled' }>((r) => {
      resolve = r
    })
    let signal: AbortSignal | undefined
    const host = {
      resources: {
        prepareDocument: vi.fn((_request, options) => {
          signal = options.signal
          return pending
        }),
        abort: vi.fn(async () => {}),
      },
      editing: { release: vi.fn(async () => {}) },
    }
    const activation = await plugin.activate?.({ host: {} } as SdkPluginActivationContext)
    plugin.commands?.['images.choose']?.({ host } as unknown as SdkPluginCommandContext)
    plugin.renderers?.['images-panel']?.({ node: { phase: 'blur', visible: true } } as never)
    expect(signal?.aborted).toBe(false)
    plugin.renderers?.['images-panel']?.({ node: { phase: 'update', visible: false } } as never)
    expect(signal?.aborted).toBe(true)
    resolve({ status: 'cancelled' })
    await Promise.resolve()
    await activation?.dispose?.()
  })
})
