import { Download, RefreshCw, RotateCw, X } from 'lucide'
import { iconSvg } from './icons'
import type { ApplicationUpdatePhase, ApplicationUpdateState } from './application-updates'

const labels: Record<ApplicationUpdatePhase, string> = {
  idle: '可手动检查新版本。下载不会自动安装。',
  checking: '正在检查更新…',
  unavailable: '此版本尚未配置在线更新渠道。',
  current: '当前已是此渠道的最新版本。',
  available: '发现新版本。请阅读版本说明后下载。',
  downloading: '正在下载更新。可关闭菜单并继续编辑文档。',
  verifying: '下载完成，正在验证更新包签名…',
  ready: '更新包已通过签名校验，可以请求安装。',
  cancelling: '正在取消下载…',
  confirming: '请在确认窗口中决定是否安装。安装前会检查并保存未保存的文档。',
  installing: '正在安装更新并重启，请稍候…',
  error: '更新未完成，请重试。',
}
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[character]!,
  )
const actionIcons = { download: Download, check: RefreshCw, install: RotateCw, cancel: X }
const button = (action: keyof typeof actionIcons, label: string) =>
  `<button type="button" class="dialog-button" data-application-update-action="${action}">${iconSvg(actionIcons[action])}<span>${label}</span></button>`

/** Plain host HTML only; release notes never become executable markup or links. */
export function renderApplicationUpdates(state: ApplicationUpdateState): string {
  const busy = [
    'checking',
    'downloading',
    'verifying',
    'cancelling',
    'confirming',
    'installing',
  ].includes(state.phase)
  const parts = [
    `<div class="application-updates-content" aria-busy="${busy}">`,
    `<p class="application-update-status" role="status" aria-live="polite">${labels[state.phase]}</p>`,
  ]
  if (state.currentVersion)
    parts.push(
      `<p class="application-update-version">当前版本 ${escape(state.currentVersion)}${state.channel ? ` · ${escape(state.channel)}` : ''}</p>`,
    )
  if (state.release) {
    parts.push(`<h3>更新版本 ${escape(state.release.version)}</h3>`)
    if (state.release.date) parts.push(`<p>${escape(state.release.date)}</p>`)
    if (state.release.notes)
      parts.push(`<pre class="application-update-notes">${escape(state.release.notes)}</pre>`)
  }
  if (state.received !== undefined) {
    const received = (state.received / 1048576).toFixed(1)
    const total = state.total ? `${(state.total / 1048576).toFixed(1)} MB` : '总大小未知'
    parts.push(`<p class="application-update-progress">已接收 ${received} MB / ${total}</p>`)
  }
  if (state.error)
    parts.push(`<p class="application-update-error" role="alert">${escape(state.error)}</p>`)
  const actions: string[] = []
  if (state.phase === 'error' && state.retry === 'check') actions.push(button('check', '重试检查'))
  if (
    state.release &&
    (state.phase === 'available' || (state.phase === 'error' && state.retry === 'download'))
  )
    actions.push(button('download', '下载更新'))
  if (
    state.release &&
    (['downloading', 'verifying', 'ready'].includes(state.phase) ||
      (state.phase === 'error' && state.retry === 'cancel'))
  )
    actions.push(button('cancel', state.phase === 'ready' ? '清除已下载更新' : '取消下载'))
  if (state.release && state.phase === 'ready') actions.push(button('install', '请求安装更新'))
  if (actions.length)
    parts.push(`<div class="application-update-actions">${actions.join('')}</div>`)
  parts.push('</div>')
  return parts.join('')
}
