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
    const current = createController(() => {
      if (visible && controller === current)
        void context.host.ui?.requestUpdate('export-print-panel').catch(() => {})
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
    'exportPrint.start': (context: SdkPluginCommandContext) => {
      controller?.start(context.host)
    },
    'exportPrint.retry': (context: SdkPluginCommandContext) => {
      controller?.start(context.host)
    },
    'exportPrint.cancel': () => {
      void controller?.cancel()
    },
    'exportPrint.change': (_context: SdkPluginCommandContext, input: unknown) => {
      if (!input || typeof input !== 'object') return
      const { field, value } = input as Record<string, unknown>
      if (typeof field === 'string' && typeof value === 'string') controller?.change(field, value)
    },
  },
  renderers: {
    'export-print-panel': (context: SdkPluginRendererContext): SdkRendererOutput => {
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
  idle: '将当前文档保存为 HTML、PDF，或发送到打印机。',
  preparing: '正在准备内容与图片…',
  choosing: '请选择保存位置。',
  writing: '正在写入文件，请稍候…',
  printing: '正在准备打印，请在打印窗口中确认。',
  done: '',
  cancelled: '本次输出已取消。可以调整选项后重新开始。',
  error: '',
}
export function render(state?: State): SdkRendererOutput {
  const busy = !!state && ['preparing', 'choosing', 'writing', 'printing'].includes(state.phase)
  const disabled = !state || busy
  const select = (
    key: string,
    label: string,
    value: string,
    options: [string, string][],
    help?: string,
  ): SdkRendererOutput => ({
    type: 'field',
    key,
    kind: 'select',
    label,
    value,
    disabled,
    onChange: { command: 'exportPrint.change' },
    options: options.map(([value, label]) => ({ value, label })),
    ...(help ? { help } : {}),
  })
  const children: SdkRendererOutput[] = [
    text('导出与打印'),
    select('format', '输出格式', state?.format ?? 'html', [
      ['html', 'HTML 网页'],
      ['pdf', 'PDF 文档'],
      ['print', '打印'],
    ]),
    select(
      'scope',
      '内容范围',
      state?.scope ?? 'document',
      [
        ['document', '整篇文档'],
        ['selection', '所选内容'],
      ],
      '选择“所选内容”时，请先在编辑器中选中文字。',
    ),
    select(
      'resources',
      '图片',
      state?.resources ?? 'embed',
      [
        ['embed', '包含图片'],
        ['omit', '不包含图片'],
      ],
      '包含图片便于离线阅读；无法使用的资源会在下方提示。',
    ),
  ]
  if (state?.format !== 'html')
    children.push(
      select('pageSize', '纸张大小', state?.pageSize ?? 'a4', [
        ['a4', 'A4'],
        ['letter', 'Letter'],
      ]),
      select('orientation', '页面方向', state?.landscape ? 'landscape' : 'portrait', [
        ['portrait', '纵向'],
        ['landscape', '横向'],
      ]),
    )
  if (state?.snapshot) {
    children.push(
      text(
        `${state.snapshot.title || '未命名文档'} · 版本 ${state.snapshot.version} · ${state.snapshot.lineCount} 行`,
      ),
    )
    children.push(text('输出使用开始时的内容；之后的编辑不会加入本次输出。'))
    for (const warning of state.snapshot.warnings) children.push(text(warning.message, 'status'))
  }
  const status = state?.cancelling
    ? '正在确认打印结果，请稍候。暂勿再次提交打印。'
    : state
      ? messages[state.phase]
      : '正在准备导出工具…'
  if (status) children.push(text(status, 'status'))
  if (state?.phase === 'done')
    children.push(
      text(
        state.result
          ? `已保存 ${state.result.name}（${formatBytes(state.result.bytes)}）。`
          : '已提交打印。请在打印队列中查看进度。',
        'status',
      ),
    )
  if (state?.error) children.push(text(state.error, 'alert'))
  const label =
    state?.phase === 'error'
      ? state.format === 'print' && state.printUnconfirmed
        ? '检查打印队列后重试'
        : '重试'
      : state?.format === 'print'
        ? '打印'
        : `导出 ${state?.format === 'pdf' ? 'PDF' : 'HTML'}`
  children.push({
    type: 'element',
    tag: 'span',
    attributes: { class: 'plugin-actions' },
    children: [
      button(state?.phase === 'error' ? 'exportPrint.retry' : 'exportPrint.start', label, disabled),
      button('exportPrint.cancel', '取消', !busy || !!state?.cancelling),
    ],
  })
  return {
    type: 'element',
    tag: 'span',
    attributes: { class: 'plugin-form', 'aria-label': '导出与打印' },
    children,
  }
}
function formatBytes(bytes: number) {
  return bytes < 1024
    ? `${bytes} B`
    : bytes < 1024 * 1024
      ? `${(bytes / 1024).toFixed(1)} KB`
      : `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
