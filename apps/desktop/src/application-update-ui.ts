import type { ApplicationUpdateState } from './application-update'

export const applicationUpdateMarkup = `
  <section class="application-update" aria-labelledby="application-update-title" data-application-update>
    <h4 id="application-update-title">软件更新</h4>
    <p data-update-status role="status" aria-live="polite">可手动检查新版本。下载不会自动安装。</p>
    <div data-update-release hidden>
      <strong data-update-version></strong>
      <p class="update-release-notes" data-update-notes></p>
    </div>
    <progress data-update-progress aria-label="更新下载进度" hidden></progress>
    <p data-update-bytes hidden></p>
    <p data-update-error role="alert" hidden></p>
    <div class="update-confirmation" data-update-confirmation hidden>
      <p>安装更新将关闭并重新启动 Milkup。继续前会检查并保存未保存的文档。</p>
      <button type="button" class="dialog-button primary" data-update-confirm>继续安装并重启</button>
      <button type="button" class="dialog-button secondary" data-update-later>暂不安装</button>
    </div>
    <div class="update-actions">
      <button type="button" class="dialog-button secondary" data-update-check>检查更新</button>
      <button type="button" class="dialog-button primary" data-update-download hidden>下载更新</button>
      <button type="button" class="dialog-button secondary" data-update-cancel hidden>取消下载</button>
      <button type="button" class="dialog-button primary" data-update-install hidden>安装并重启…</button>
    </div>
  </section>`

const phaseLabels: Record<ApplicationUpdateState['phase'], string> = {
  idle: '可手动检查新版本。下载不会自动安装。',
  checking: '正在检查更新…',
  unavailable: '此测试版尚未开放在线更新渠道。文档编辑和手动安装不受影响。',
  current: '当前已是此渠道的最新版本。',
  available: '发现新版本。可先阅读版本说明，再下载更新。',
  downloading: '正在下载更新，可以继续编辑文档。',
  verifying: '下载完成，正在验证更新包签名…',
  cancelling: '正在取消下载…',
  ready: '更新包已通过签名校验，准备好后可安装。',
  confirming: '请确认安装并重启。',
  installing: '正在安装更新并重启，请稍候…',
  error: '更新未完成。当前文档保持打开，请重试。',
}
const byteLabel = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(2)} MB`

const pendingFocus = new WeakMap<HTMLElement, HTMLElement>()

export function renderApplicationUpdate(
  root: HTMLElement,
  state: ApplicationUpdateState,
  native: boolean,
) {
  const active = root.ownerDocument.activeElement
  if (active instanceof HTMLElement && active.matches('[data-application-update] button'))
    pendingFocus.set(root, active)
  else if (active && active !== root.ownerDocument.body) pendingFocus.delete(root)
  const get = <T extends HTMLElement>(name: string) =>
    root.querySelector<T>(`[data-update-${name}]`)!
  get('status').textContent = native ? phaseLabels[state.phase] : '请在桌面版中检查和安装更新。'
  get('release').hidden = !state.update
  get('version').textContent = state.update ? `新版本 ${state.update.version}` : ''
  get('notes').textContent = state.update?.notes || '此版本未提供更新说明。'
  get('error').hidden = state.phase !== 'error'
  get('error').textContent = state.error ?? ''
  const progress = get<HTMLProgressElement>('progress')
  progress.hidden = !['downloading', 'verifying'].includes(state.phase)
  if (state.total && state.total > 0 && state.phase === 'downloading') {
    progress.max = state.total
    progress.value = Math.min(state.received ?? 0, state.total)
  } else progress.removeAttribute('value')
  get('bytes').hidden = state.phase !== 'downloading'
  get('bytes').textContent =
    `${byteLabel(state.received ?? 0)}${state.total ? ` / ${byteLabel(state.total)}` : ' · 总大小未知'}`
  get<HTMLButtonElement>('check').disabled =
    !native ||
    ['checking', 'downloading', 'verifying', 'cancelling', 'confirming', 'installing'].includes(
      state.phase,
    )
  get('check').textContent =
    state.phase === 'error' && state.retry === 'check' ? '重试检查' : '检查更新'
  get('download').hidden = !(
    state.phase === 'available' ||
    (state.phase === 'error' && state.retry === 'download')
  )
  get('download').textContent = state.phase === 'error' ? '重新下载并校验' : '下载更新'
  get('cancel').hidden = !['downloading', 'verifying'].includes(state.phase)
  get('install').hidden = state.phase !== 'ready'
  get('confirmation').hidden = state.phase !== 'confirming'
  // WebKit blurs a disabled/hidden button. Carry keyboard position to the next
  // action only while focus is still in this control flow, never out of the editor.
  const previous = pendingFocus.get(root)
  const target =
    state.phase === 'confirming'
      ? get<HTMLButtonElement>('later')
      : state.phase === 'ready'
        ? get<HTMLButtonElement>('install')
        : ['downloading', 'verifying'].includes(state.phase)
          ? get<HTMLButtonElement>('cancel')
          : state.phase === 'error' && state.retry === 'download'
            ? get<HTMLButtonElement>('download')
            : get<HTMLButtonElement>('check')
  if (previous && !target.disabled && !target.hidden && target.getClientRects().length) {
    const focused = root.ownerDocument.activeElement
    if (focused === root.ownerDocument.body || focused === previous) {
      target.focus()
      target.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    }
    pendingFocus.delete(root)
  }
}
