import { definePlugin } from '@milkup/plugin-sdk'
import type {
  SdkPluginActivationContext,
  SdkPluginRendererContext,
  SdkRendererOutput,
  SdkSettingsField,
} from '@milkup/plugin-sdk'
import { createController, type State } from './controller'

export const fields = [
  ['editor.fontFamily', '编辑字体', '选择等宽、系统或衬线字体。'],
  ['editor.fontSize', '字体大小', '以像素为单位；修改后立即预览。'],
  ['editor.lineWidth', '正文宽度', '0 表示自动。只限制实时预览正文；源码模式保持不折行。'],
  ['editor.lineHeight', '行高', '以字号的倍数设置行间距。'],
  ['editor.indentSize', '缩进宽度', 'Tab 与缩进操作使用的空格数。'],
  ['editor.indentStyle', '缩进方式', '选择空格或制表符；不会重写已有文档。'],
  ['appearance.theme', '外观主题', '可跟随系统或选择浅色、深色。'],
  ['appearance.zoom', '界面缩放', '使用宿主原生界面缩放。'],
] as const
const optionLabels: Record<string, string> = {
  monospace: '等宽字体',
  system: '跟随系统',
  serif: '衬线字体',
  spaces: '空格',
  tabs: '制表符',
  light: '浅色',
  dark: '深色',
}
let controller: ReturnType<typeof createController> | undefined
let visible = false
export default definePlugin({
  activate(context: SdkPluginActivationContext) {
    void controller?.dispose()
    visible = false
    const current = createController(context.host.settings, () => {
      if (visible && controller === current)
        void context.host.ui?.requestUpdate('preferences-panel').catch(() => {})
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
  commands: {
    'preferences.change': (_context: unknown, input: unknown) => {
      if (!input || typeof input !== 'object') return
      const { field, value } = input as Record<string, unknown>
      if (typeof field === 'string' && typeof value === 'string')
        void controller?.change(field, value)
    },
    'preferences.save': () => {
      void controller?.save()
    },
    'preferences.cancel': () => {
      void controller?.cancel()
    },
    'preferences.reset': () => {
      void controller?.reset()
    },
    'preferences.retry': () => {
      void controller?.retry()
    },
  },
  renderers: {
    'preferences-panel': (context: SdkPluginRendererContext): SdkRendererOutput => {
      if (context.node?.phase === 'dispose' || context.node?.visible === false) {
        visible = false
        void controller?.close()
        return ''
      }
      visible = true
      void controller?.open()
      return render(controller?.state)
    },
  },
})
const text = (value: string, role?: string): SdkRendererOutput => ({
  type: 'element',
  tag: 'span',
  text: value,
  ...(role ? { attributes: { role } } : {}),
})
function button(command: string, label: string, disabled = false): SdkRendererOutput {
  return {
    type: 'element',
    tag: 'button',
    text: label,
    disabled,
    action: { command },
    attributes: { class: 'dialog-button secondary', 'aria-label': label },
  }
}
function fieldOutput(
  key: string,
  label: string,
  help: string,
  schema: SdkSettingsField,
  state: State,
): SdkRendererOutput {
  const common = {
    type: 'field' as const,
    key,
    label,
    value: state.drafts[key] ?? '',
    onChange: { command: 'preferences.change' },
    disabled: state.phase === 'loading' || state.phase === 'saving',
    invalid: !!state.invalid[key],
    help: state.invalid[key] || help,
  }
  if (schema.type === 'number')
    return {
      ...common,
      kind: 'number',
      min: schema.allowZero ? 0 : schema.minimum,
      max: schema.maximum,
      ...(schema.step ? { step: schema.step } : {}),
    }
  const options = schema.type === 'enum' ? schema.options : [true, false]
  return {
    ...common,
    kind: 'select',
    options: options.map((value) => ({
      value: String(value),
      label:
        key === 'appearance.zoom'
          ? `${Number(value) * 100}%`
          : key === 'editor.fontFamily' && value === 'system'
            ? '系统字体'
            : optionLabels[String(value)] || String(value),
    })),
  }
}
export function render(state?: State): SdkRendererOutput {
  const busy = !state || state.phase === 'loading' || state.phase === 'saving'
  const children: SdkRendererOutput[] = [
    text('修改即时预览。保存后下次启动仍会保留；取消或关闭会撤销未保存的更改。'),
  ]
  if (state?.snapshot)
    for (const [key, label, help] of fields) {
      const schema = state.snapshot.schema[key]
      if (schema) children.push(fieldOutput(key, label, help, schema, state))
    }
  const status =
    !state || state.phase === 'loading'
      ? '正在加载偏好…'
      : state.phase === 'saving'
        ? '正在保存偏好…'
        : state.message
  if (status) children.push(text(status, 'status'))
  if (state?.error) children.push(text(state.error, 'alert'))
  children.push({
    type: 'element',
    tag: 'span',
    attributes: { class: 'plugin-actions' },
    children: [
      button(
        'preferences.save',
        '保存',
        busy || !state?.snapshot || !!Object.keys(state.invalid).length,
      ),
      button('preferences.cancel', '取消更改', busy),
      button('preferences.reset', '预览默认值', busy || !state?.snapshot),
      ...(state?.error ? [button('preferences.retry', '重新加载', busy)] : []),
    ],
  })
  return { type: 'element', tag: 'span', attributes: { class: 'plugin-form' }, children }
}
