import { definePlugin } from '@milkup/plugin-sdk'
import type {
  SdkPluginActivationContext,
  SdkPluginRendererContext,
  SdkRendererOutput,
} from '@milkup/plugin-sdk'
import { createController, type State } from './controller'
let controller: ReturnType<typeof createController> | undefined
let visible = false
const plugin = definePlugin({
  activate(context: SdkPluginActivationContext) {
    controller?.dispose()
    visible = false
    const current = createController(context.host.keymap, () => {
      if (current === controller && visible)
        void context.host.ui?.requestUpdate('shortcuts-modal').catch(() => undefined)
    })
    controller = current
    return {
      dispose() {
        current.dispose()
        if (controller === current) {
          controller = undefined
          visible = false
        }
      },
    }
  },
  deactivate() {
    controller?.dispose()
    controller = undefined
    visible = false
  },
  commands: {
    'shortcuts.field': (_context, input) => controller?.edit(input),
    'shortcuts.save': () => {
      void controller?.save()
    },
    'shortcuts.cancel': () => controller?.cancel(),
    'shortcuts.reset': () => {
      void controller?.reset()
    },
    'shortcuts.reload': () => {
      void controller?.load()
    },
  },
  renderers: {
    'shortcuts-modal': (context: SdkPluginRendererContext): SdkRendererOutput => {
      if (context.node?.phase === 'dispose') {
        visible = false
        controller?.cancel()
        return ''
      }
      // Activation precedes host command registration. Read the catalogue only
      // after the view opens, and refresh it when reopening after plugin changes.
      if (!visible) {
        visible = true
        void controller?.load()
      }
      return render(controller?.state ?? { phase: 'loading', draft: {} })
    },
  },
})
export default plugin
const text = (value: string, role?: string): SdkRendererOutput => ({
  type: 'element',
  tag: 'span',
  text: value,
  ...(role ? { attributes: { role } } : {}),
})
const button = (id: string, title: string): SdkRendererOutput => ({
  type: 'element',
  tag: 'button',
  text: title,
  attributes: { class: 'dialog-button secondary', 'aria-label': title },
  action: { command: `shortcuts.${id}` },
})
function render(state: State): SdkRendererOutput {
  const busy = state.phase === 'loading' || state.phase === 'saving'
  const children: SdkRendererOutput[] = [
    text(
      'Mod 在 Windows/Linux 为 Ctrl，在 macOS 为 ⌘。每个快捷键是一组按键；多个候选快捷键用空格分隔，留空取消绑定。',
    ),
    text('输入框保留原生文本编辑、输入法与剪贴板；F6、Tab、Escape 等固定导航键不能重绑定。'),
  ]
  if (busy)
    children.push(text(state.phase === 'loading' ? '正在加载快捷键…' : '正在保存快捷键…', 'status'))
  if (state.snapshot?.error) children.push(text(state.snapshot.error, 'alert'))
  const fields: SdkRendererOutput[] = []
  for (const command of state.snapshot?.commands ?? []) {
    if (command.available && command.bindable)
      fields.push({
        type: 'field',
        kind: 'text',
        key: command.id,
        label: `${command.title} (${command.id})`,
        value: state.draft[command.id] ?? command.keys.join(' '),
        disabled: busy,
        help: `默认：${command.defaultKeys.join(' / ') || '未绑定'}`,
        placeholder: '例如 Mod+Shift+K',
        onChange: { command: 'shortcuts.field' },
      })
    else
      fields.push(
        text(
          `${command.title} (${command.id})：${!command.available ? '当前不可用' : '需提供参数，不能直接绑定'}${command.input ? ` · ${command.input}` : ''}`,
        ),
      )
  }
  children.push({
    type: 'element',
    tag: 'span',
    attributes: { class: 'plugin-form' },
    children: fields,
  })
  // Keep transaction feedback beside the controls at the end of the long catalogue.
  if (state.error) children.push(text(state.error, 'alert'))
  if (state.message) children.push(text(state.message, 'status'))
  const actions: SdkRendererOutput[] = []
  if (!busy) {
    if (state.snapshot && Object.keys(state.draft).length)
      actions.push(button('save', '保存快捷键'), button('cancel', '取消修改'))
    if (state.snapshot) actions.push(button('reset', '恢复默认快捷键'))
    actions.push(button('reload', '重新加载快捷键'))
  }
  children.push({
    type: 'element',
    tag: 'span',
    attributes: { class: 'plugin-actions' },
    children: actions,
  })
  children.push({ type: 'element', tag: 'strong', text: '上下文固定快捷键' })
  for (const item of state.snapshot?.fixedShortcuts ?? [])
    children.push(text(`${item.keys} · ${item.title}：${item.description}`))
  return { type: 'element', tag: 'span', attributes: { class: 'plugin-ui-state' }, children }
}
