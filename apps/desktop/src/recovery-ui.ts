import type { RecoveryRecord } from './recovery'

export function createRecoveryUi(
  root: HTMLElement,
  options: {
    list: (
      includeArchived: boolean,
    ) => Promise<{ records: readonly RecoveryRecord[]; warnings: readonly string[] }>
    restore: (record: RecoveryRecord) => Promise<void>
    dismiss: (record: RecoveryRecord) => Promise<void>
    changed: (open: boolean) => void
  },
) {
  const overlay = document.createElement('section')
  overlay.className = 'confirm-overlay recovery-overlay'
  overlay.hidden = true
  overlay.innerHTML = `<section class="confirm-dialog recovery-dialog" role="dialog" aria-modal="true" aria-labelledby="recovery-title" aria-describedby="recovery-description">
    <h2 id="recovery-title">恢复记录</h2>
    <p id="recovery-description">恢复点只包含已完成检查点的内容，之后的输入可能丢失。恢复将打开独立副本，不覆盖原文件。放弃恢复仅归档，数据仍保留。</p>
    <div data-recovery-list></div><p data-recovery-error role="alert" hidden></p>
    <footer class="confirm-dialog-actions"><button type="button" class="dialog-button secondary" data-recovery-close>暂不恢复</button></footer>
  </section>`
  root.append(overlay)
  let busy = false
  let includeArchived = false
  const error = overlay.querySelector<HTMLElement>('[data-recovery-error]')!
  const closeButton = overlay.querySelector<HTMLButtonElement>('[data-recovery-close]')!
  const hide = () => {
    overlay.hidden = true
    options.changed(false)
  }
  const close = () => {
    if (!busy) hide()
  }
  closeButton.addEventListener('click', close)
  window.addEventListener(
    'keydown',
    (event) => {
      if (overlay.hidden) return
      event.stopImmediatePropagation()
      if (event.isComposing || event.keyCode === 229) return
      if (event.key === 'Escape') {
        event.preventDefault()
        close()
      } else if (event.key === 'Tab' || event.code === 'Tab') {
        event.preventDefault()
        const buttons = Array.from(
          overlay.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
        )
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
        buttons[(index + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length]?.focus()
      } else if (event.ctrlKey || event.metaKey) event.preventDefault()
    },
    true,
  )
  const showError = (value: unknown) => {
    error.textContent = String(value)
    error.hidden = false
  }
  const setBusy = (value: boolean) => {
    busy = value
    for (const button of Array.from(overlay.querySelectorAll<HTMLButtonElement>('button')))
      button.disabled = value
  }
  const render = async () => {
    error.hidden = true
    const result = await options.list(includeArchived)
    const list = overlay.querySelector<HTMLElement>('[data-recovery-list]')!
    list.replaceChildren()
    for (const record of result.records) {
      const row = document.createElement('article')
      row.className = 'recovery-record'
      const title = document.createElement('h3')
      title.textContent = record.originalPath ?? '未命名草稿'
      const detail = document.createElement('p')
      detail.textContent = `${new Date(record.createdAt).toLocaleString()} · 恢复点 v${record.version} · ${record.bytes.toLocaleString()} 字节${record.disposition === 'pending' ? '' : ' · 已归档'}`
      const restore = document.createElement('button')
      restore.type = 'button'
      restore.className = 'dialog-button primary'
      restore.textContent = '打开恢复副本'
      restore.dataset.recoveryRestore = record.id
      restore.addEventListener('click', async () => {
        setBusy(true)
        try {
          await options.restore(record)
          setBusy(false)
          close()
        } catch (e) {
          setBusy(false)
          showError(e)
        }
      })
      const dismiss = document.createElement('button')
      dismiss.type = 'button'
      dismiss.className = 'dialog-button secondary'
      dismiss.textContent = '放弃本次恢复（保留数据）'
      dismiss.dataset.recoveryDismiss = record.id
      dismiss.addEventListener('click', async () => {
        setBusy(true)
        try {
          await options.dismiss(record)
          await render()
          setBusy(false)
          closeButton.focus()
        } catch (e) {
          setBusy(false)
          showError(e)
        }
      })
      row.append(title, detail, restore, dismiss)
      list.append(row)
    }
    if (!result.records.length) {
      const empty = document.createElement('p')
      empty.textContent = '没有可恢复的已退出会话。'
      list.append(empty)
    }
    if (result.warnings.length) showError(result.warnings.join('\n'))
    return result.records.length + result.warnings.length
  }
  const open = async (archived = false, onlyIfNeeded = false) => {
    includeArchived = archived
    try {
      const count = await render()
      if (onlyIfNeeded && !count) return
    } catch (e) {
      showError(e)
    }
    overlay.hidden = false
    options.changed(true)
    closeButton.focus()
  }
  return { open, close, hide, isOpen: () => !overlay.hidden }
}
