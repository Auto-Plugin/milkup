import { definePlugin } from '@milkup/plugin-sdk'
import type {
  SdkPluginActivationContext,
  SdkPluginRendererContext,
  SdkRendererOutput,
} from '@milkup/plugin-sdk'
import { createController, type Phase, type State } from './controller'

let controller: ReturnType<typeof createController> | undefined
let visible = false

const plugin = definePlugin({
  activate(context: SdkPluginActivationContext) {
    const previous = controller
    void previous?.dispose()
    visible = false
    const current = createController(context.host.releases, () => {
      if (controller === current && visible)
        void context.host.ui?.requestUpdate('updates-modal').catch(() => undefined)
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
    const current = controller
    controller = undefined
    visible = false
    return current?.dispose()
  },
  // Commands acknowledge immediately. Async state updates refresh controlled UI;
  // particularly, requestInstall must not keep the command RPC open for minutes.
  commands: {
    'updates.check': () => {
      void controller?.check()
    },
    'updates.download': () => {
      void controller?.download()
    },
    'updates.cancel': () => {
      void controller?.cancel()
    },
    'updates.install': () => {
      void controller?.install()
    },
  },
  renderers: {
    'updates-modal': (context: SdkPluginRendererContext): SdkRendererOutput => {
      if (context.node?.phase === 'dispose') {
        visible = false
        return ''
      }
      visible = true
      return render(controller?.state ?? { phase: 'idle' })
    },
  },
})
export default plugin

const labels: Record<Phase, string> = {
  idle: '可手动检查新版本。下载不会自动安装。',
  checking: '正在检查更新…',
  unavailable: '此版本尚未配置在线更新渠道。',
  current: '当前已是此渠道的最新版本。',
  available: '发现新版本。请阅读版本说明后下载。',
  downloading: '正在下载更新。可关闭此窗口并继续编辑文档。',
  verifying: '下载完成，正在验证更新包签名…',
  ready: '更新包已通过签名校验，可以请求安装。',
  cancelling: '正在取消下载…',
  confirming: '请在宿主确认窗口中决定是否安装。安装前会检查并保存未保存的文档。',
  installing: '正在安装更新并重启，请稍候…',
  error: '更新未完成，请重试。',
}
function span(text: string, attributes: Record<string, string> = {}): SdkRendererOutput {
  return { type: 'element', tag: 'span', text, attributes }
}
function button(command: string, text: string, label = text): SdkRendererOutput {
  return {
    type: 'element',
    tag: 'button',
    text,
    attributes: { class: 'dialog-button secondary', 'aria-label': label },
    action: { command },
  }
}
function render(state: State): SdkRendererOutput {
  const children: SdkRendererOutput[] = [span(labels[state.phase], { role: 'status' })]
  if (state.currentVersion) children.push(span(`当前版本：${state.currentVersion}`))
  if (state.channel) children.push(span(`更新渠道：${state.channel}`))
  if (state.release) {
    children.push({ type: 'element', tag: 'strong', text: `新版本：${state.release.version}` })
    if (state.release.date) children.push(span(`发布日期：${state.release.date}`))
    // Notes are always controlled text nodes, never HTML, markdown or links.
    children.push({
      type: 'element',
      tag: 'span',
      attributes: { class: 'plugin-text-block', 'aria-label': '版本说明' },
      text: state.release.notes || '此版本未提供更新说明。',
    })
  }
  if (state.phase === 'downloading' || state.phase === 'verifying') {
    const bytes = (value: number) => `${(Math.max(0, value) / 1024 / 1024).toFixed(2)} MB`
    children.push(
      span(
        `已下载 ${bytes(state.received ?? 0)}${state.total && state.total > 0 ? ` / ${bytes(state.total)}` : ' · 总大小未知'}`,
        { 'aria-label': '更新下载进度' },
      ),
    )
  }
  if (state.phase === 'error') children.push(span(state.error || '更新失败。', { role: 'alert' }))
  const actions: SdkRendererOutput[] = []
  if (
    ['idle', 'unavailable', 'current', 'available'].includes(state.phase) ||
    (state.phase === 'error' && state.retry === 'check')
  )
    actions.push(
      button('updates.check', state.phase === 'error' ? '重试检查' : '检查更新', '检查更新'),
    )
  if (state.phase === 'available' || (state.phase === 'error' && state.retry === 'download'))
    actions.push(
      button(
        'updates.download',
        state.phase === 'error' ? '重新下载并校验' : '下载更新',
        '下载更新',
      ),
    )
  if (
    ['downloading', 'verifying', 'ready'].includes(state.phase) ||
    (state.phase === 'error' && state.retry === 'cancel')
  )
    actions.push(
      button(
        'updates.cancel',
        state.phase === 'ready'
          ? '丢弃已下载更新'
          : state.phase === 'error'
            ? '重试取消'
            : '取消下载',
        '取消下载',
      ),
    )
  if (state.phase === 'ready')
    actions.push(button('updates.install', '安装并重启…', '请求安装更新'))
  children.push({
    type: 'element',
    tag: 'span',
    attributes: { class: 'plugin-actions' },
    children: actions,
  })
  return { type: 'element', tag: 'span', attributes: { class: 'plugin-ui-state' }, children }
}
