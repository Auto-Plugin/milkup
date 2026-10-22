import { definePlugin } from '@milkup/plugin-sdk'
import type {
  SdkPluginActivationContext,
  SdkPluginCommandContext,
  SdkPluginRendererContext,
  SdkRendererOutput,
} from '@milkup/plugin-sdk'
import { createController, type State } from './controller'

let controller: ReturnType<typeof createController> | undefined
let visible = false
const input = (value: unknown): { id?: string; path?: string } => {
  if (!value || typeof value !== 'object') return {}
  const record = value as Record<string, unknown>
  return {
    ...(typeof record.id === 'string' ? { id: record.id } : {}),
    ...(typeof record.path === 'string' ? { path: record.path } : {}),
  }
}
export default definePlugin({
  activate(context: SdkPluginActivationContext) {
    void controller?.dispose()
    visible = false
    const current = createController(context.host.workspace, context.host.storage, () => {
      if (controller === current && visible)
        void context.host.ui?.requestUpdate('workspace-panel').catch(() => {})
    })
    controller = current
    return {
      dispose() {
        if (controller === current) {
          controller = undefined
          visible = false
        }
        return current.dispose()
      },
    }
  },
  deactivate() {
    const previous = controller
    controller = undefined
    visible = false
    return previous?.dispose()
  },
  // Preserve this trusted invocation's capability while returning immediately;
  // native pickers and save protection may outlive the command RPC timeout.
  commands: {
    'workspace.choose': (context: SdkPluginCommandContext) => {
      void controller?.choose(context.host?.workspace)
    },
    'workspace.refresh': () => {
      void controller?.refresh()
    },
    'workspace.toggle': (_context: SdkPluginCommandContext, value: unknown) => {
      void controller?.toggle(input(value).id || '')
    },
    'workspace.more': (_context: SdkPluginCommandContext, value: unknown) => {
      void controller?.more(input(value).id || '')
    },
    'workspace.open': (context: SdkPluginCommandContext, value: unknown) => {
      void controller?.open(context.host?.workspace, { id: input(value).id || '' })
    },
    'workspace.recent': (context: SdkPluginCommandContext, value: unknown) => {
      void controller?.open(context.host?.workspace, { path: input(value).path || '' })
    },
    'workspace.cancel': () => {
      controller?.cancel()
    },
  },
  renderers: {
    'workspace-panel': (context: SdkPluginRendererContext): SdkRendererOutput => {
      if (context.node?.phase === 'dispose' || context.node?.visible === false) {
        visible = false
        controller?.cancel()
        return ''
      }
      visible = true
      void controller?.restore()
      return render(controller?.state)
    },
  },
})

const span = (text: string, attributes: Record<string, string> = {}): SdkRendererOutput => ({
  type: 'element',
  tag: 'span',
  text,
  attributes,
})
function button(
  command: string,
  text: string,
  input?: Record<string, string>,
  attributes: Record<string, string> = {},
): SdkRendererOutput {
  return {
    type: 'element',
    tag: 'button',
    text,
    attributes: { class: 'dialog-button secondary', 'aria-label': text, ...attributes },
    action: { command, ...(input ? { input } : {}) },
  }
}
const statuses = {
  idle: 'Markdown 文件 · 按需展开目录，不扫描整个文件夹。',
  choosing: '请选择要授权的文件夹…',
  loading: '正在加载目录…',
  opening: '正在请求宿主打开文件…',
  cancelled: '操作已取消，可重新加载目录或刷新。',
  error: '操作未完成。',
}
export function render(state?: State): SdkRendererOutput {
  const busy = state && ['choosing', 'loading', 'opening'].includes(state.phase)
  const toolbar: SdkRendererOutput[] = [
    button('workspace.choose', state?.root ? '更换文件夹…' : '选择文件夹…', undefined, {
      'aria-label': '选择工作区文件夹',
    }),
  ]
  if (state?.root) toolbar.push(button('workspace.refresh', '刷新'))
  if (busy) toolbar.push(button('workspace.cancel', '取消操作'))
  const children: SdkRendererOutput[] = [
    {
      type: 'element',
      tag: 'span',
      attributes: { class: 'plugin-tree-toolbar plugin-actions' },
      children: toolbar,
    },
    span(state?.root?.label || '尚未授权文件夹', { class: 'plugin-list-summary' }),
    span(
      state && (state.root || state.phase !== 'idle')
        ? state.phase === 'cancelled' && !state.root
          ? '操作已取消，可重新选择文件夹。'
          : statuses[state.phase]
        : '选择文件夹后，下次打开工作区将尝试恢复；无法访问时请重新选择。',
      { role: 'status', class: 'plugin-list-summary' },
    ),
  ]
  if (state?.error)
    children.push(span(state.error, { role: 'alert', class: 'plugin-list-summary' }))
  if (state?.root) {
    const items: SdkRendererOutput[] = []
    const append = (id: string, level: number) => {
      const directory = state.directories.get(id)
      if (!directory) return
      for (const entry of directory.entries) {
        const nested = state.directories.get(entry.id)
        const attributes: Record<string, string> = {
          class: 'plugin-tree-item',
          role: 'treeitem',
          'aria-level': String(level),
          'aria-label': entry.relativePath,
        }
        if (entry.kind === 'directory') attributes['aria-expanded'] = String(!!nested?.expanded)
        else
          attributes['aria-current'] = state.current === entry.relativePath ? 'location' : 'false'
        items.push(
          button(
            entry.kind === 'directory' ? 'workspace.toggle' : 'workspace.open',
            `${entry.kind === 'directory' ? (nested?.expanded ? '▾ ' : '▸ ') : ''}${entry.name}`,
            { id: entry.id },
            attributes,
          ),
        )
        if (entry.kind === 'directory' && nested?.expanded) append(entry.id, level + 1)
      }
      if (directory.cursor || !directory.loaded) {
        const label = directory.loaded
          ? '加载更多'
          : directory.entries.length
            ? '重新加载目录'
            : '加载目录'
        items.push(
          button(
            'workspace.more',
            label,
            { id },
            {
              'aria-label': `${id ? findPath(state, id) : state.root?.label}：${label}`,
            },
          ),
        )
      }
    }
    append('', 1)
    children.push({
      type: 'element',
      tag: 'span',
      attributes: { class: 'plugin-tree-list', role: 'tree', 'aria-label': '工作区文件' },
      children: items,
    })
    if (!items.length && !busy)
      children.push(
        span('此目录没有可显示的 Markdown 文件。', {
          class: 'plugin-list-summary',
        }),
      )
    if (state.recent.length) {
      children.push(span('最近打开', { class: 'plugin-list-summary' }))
      children.push({
        type: 'element',
        tag: 'span',
        attributes: { class: 'plugin-navigation-secondary-list', 'aria-label': '最近文件' },
        children: state.recent.map((path) =>
          button(
            'workspace.recent',
            path,
            { path },
            { 'aria-label': `最近文件：${path}`, class: 'plugin-tree-item' },
          ),
        ),
      })
    }
  }
  return {
    type: 'element',
    tag: 'span',
    attributes: { class: 'plugin-list-panel plugin-navigation-panel' },
    children,
  }
}
function findPath(state: State, id: string): string {
  return (
    [...state.directories.values()]
      .flatMap((directory) => directory.entries)
      .find((entry) => entry.id === id)?.relativePath || id
  )
}
