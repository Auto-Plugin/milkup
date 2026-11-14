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
export default definePlugin({
  activate(context: SdkPluginActivationContext) {
    void controller?.dispose()
    visible = false
    const current = createController(
      context.host.storage,
      () => {
        if (visible && controller === current)
          void context.host.ui?.requestUpdate('images-panel').catch(() => {})
      },
      async (message) => {
        if (controller === current) await context.host.ui?.notify({ kind: 'error', message })
      },
    )
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
    'images.choose': (context: SdkPluginCommandContext) => {
      void controller?.choose(context.host)
    },
    'images.paste': (context: SdkPluginCommandContext, input: unknown) => {
      void controller?.paste(context.host, input)
    },
    'images.change': (_context: SdkPluginCommandContext, input: unknown) => {
      if (!input || typeof input !== 'object') return
      const { field, value } = input as Record<string, unknown>
      if (typeof field === 'string' && typeof value === 'string') controller?.change(field, value)
    },
    'images.cancel': () => {
      void controller?.cancel()
    },
  },
  renderers: {
    'images-panel': (context: SdkPluginRendererContext): SdkRendererOutput => {
      if (context.node?.phase === 'dispose' || context.node?.visible === false) {
        visible = false
        void controller?.close()
        return ''
      }
      visible = true
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
const button = (command: string, label: string, disabled: boolean): SdkRendererOutput => ({
  type: 'element',
  tag: 'button',
  text: label,
  disabled,
  action: { command },
  attributes: { class: 'dialog-button secondary', 'aria-label': label },
})
const messages: Record<State['phase'], string> = {
  idle: '选择本地图片，或回到编辑器粘贴图片。',
  preparing: '正在确认文档保存位置；未命名文档需先保存。',
  choosing: '请选择 PNG、JPEG 或 WebP 图片。',
  staging: '正在保存图片资源…',
  applying: '正在将图片引用插入文档…',
  done: '图片已插入。可使用撤销移除引用，图片文件会保留。',
  cancelled: '已取消待处理导入。',
  error: '',
}
export function render(state?: State): SdkRendererOutput {
  const busy = !!state && ['preparing', 'choosing', 'staging', 'applying'].includes(state.phase)
  const disabled = !state || state.initializing || busy
  const children: SdkRendererOutput[] = [
    text('图片先保存到文档旁的资源目录，再插入引用。取消首次保存不会导入图片。'),
    {
      type: 'field',
      key: 'policy',
      kind: 'select',
      label: '资源目录',
      value: state?.policy ?? 'assets',
      disabled,
      onChange: { command: 'images.change' },
      options: [
        { value: 'assets', label: '共享 assets 目录' },
        { value: 'document-assets', label: '当前文档专属目录' },
      ],
      help: '专属目录由宿主按文档名生成，例如 笔记.assets；此选择仅影响之后导入的图片。',
    },
    {
      type: 'field',
      key: 'alt',
      kind: 'text',
      label: '替代文本',
      value: state?.alt ?? '',
      disabled,
      onChange: { command: 'images.change' },
      invalid: !!state?.invalidAlt,
      help: state?.invalidAlt ?? '简要描述图片内容，最多 512 个字符；留空表示装饰性图片。',
      placeholder: '例如：项目结构示意图',
    },
  ]
  if (state?.fileName) children.push(text(`图片：${state.fileName}`))
  const status = !state || state.initializing ? '正在读取导入策略…' : messages[state.phase]
  if (status) children.push(text(status, 'status'))
  if (state?.error) children.push(text(state.error, 'alert'))
  if (state?.warning) children.push(text(state.warning, 'status'))
  children.push({
    type: 'element',
    tag: 'span',
    attributes: { class: 'plugin-actions' },
    children: [
      button(
        'images.choose',
        state?.phase === 'error' ? '重新选择图片' : '选择并插入图片',
        disabled || !!state?.invalidAlt,
      ),
      button('images.cancel', '取消导入', !busy),
    ],
  })
  return { type: 'element', tag: 'span', attributes: { class: 'plugin-form' }, children }
}
