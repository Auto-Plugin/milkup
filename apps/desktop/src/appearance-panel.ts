import { ExternalLink, RotateCcw, Upload } from 'lucide'
import { iconSvg } from './icons'
import type { ThemePreference } from './appearance'
import type { ThemeStyleController } from './appearance-theme'
import baseCss from './style.css?raw'
import panelCss from './appearance-panel.css?raw'

export function themePreviewDocument(css: string, mode: 'light' | 'dark'): string {
  // Opaque sandbox, no scripts, no forms, no navigation or resources. Theme rules have
  // already passed the same compiler used for the real document; CSP is defense in depth.
  return `<!doctype html><html data-theme="${mode}"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><style>${baseCss.replace(/<\/style/gi, '<\\/style')}\n${css.replace(/<\/style/gi, '<\\/style')}\nhtml,body{min-height:0;height:100%;overflow:hidden}body{background:var(--app-bg)}.sample{width:600px;height:340px;transform:scale(.35);transform-origin:top left;background:var(--panel-bg);border:1px solid var(--border)}.sample-bar{height:35px;background:var(--chrome-bg);border-bottom:1px solid var(--border);padding:8px;color:var(--text-muted);font:12px system-ui}.sample-grid{display:grid;grid-template-columns:100px 1fr;height:305px}.sample-side{background:var(--panel-subtle);border-right:1px solid var(--border);padding:14px 10px;font:12px system-ui;color:var(--text-muted)}.sample-side div{padding:7px 0}.milkup-editor{height:305px}.milkup-editor-content{padding:18px}.milkup-line{margin-bottom:8px}</style></head><body><div class="sample"><div class="sample-bar">● ● ●　Milkup</div><div class="sample-grid"><aside class="sample-side"><div>文档</div><div>笔记.md</div><div>示例.md</div></aside><div class="milkup-editor" data-mode="live"><div class="milkup-editor-content"><div class="milkup-line milkup-block-heading milkup-heading-level-1">写下你的想法</div><div class="milkup-line milkup-line-live">文字、<span class="milkup-inline-strong">重点</span>与<span class="milkup-inline-link">链接</span>。</div><div class="milkup-line milkup-block-blockquote">让内容清楚，阅读自然。</div><div class="milkup-line milkup-block-code"><span class="milkup-code-token-keyword">const</span> theme = <span class="milkup-code-token-string">'Milkup'</span></div><div class="milkup-line milkup-block-table"><span class="milkup-table-cell">计划</span><span class="milkup-table-cell">完成</span></div></div></div></div></div></body></html>`
}
export function createAppearancePanel(options: {
  container: HTMLElement
  styles: ThemeStyleController
  getMode: () => ThemePreference
  changeMode: (mode: ThemePreference) => Promise<void>
  chooseFile: () => Promise<string | null>
  native: boolean
}) {
  const owner = options.container.ownerDocument
  const style = owner.createElement('style')
  style.textContent = panelCss
  owner.head.append(style)
  options.container.innerHTML = `<h3>外观</h3><fieldset class="theme-modes"><legend>模式</legend><div class="theme-mode-options">${(['light', 'dark', 'system'] as const).map((mode) => `<button type="button" class="theme-mode" data-theme-mode="${mode}" aria-pressed="false"><span class="theme-preview ${mode === 'system' ? 'theme-preview-system' : ''}"><iframe sandbox="" tabindex="-1" aria-hidden="true" title="${mode === 'dark' ? '深色' : '浅色'}样式预览" data-preview="${mode === 'dark' ? 'dark' : 'light'}"></iframe>${mode === 'system' ? '<iframe sandbox="" tabindex="-1" aria-hidden="true" title="系统深色部分" data-preview="dark"></iframe>' : ''}</span><span>${mode === 'light' ? '浅色' : mode === 'dark' ? '深色' : '系统'}</span></button>`).join('')}</div></fieldset><div class="theme-style-row"><div><span class="theme-label">样式</span><strong data-theme-name></strong></div><button type="button" class="dialog-button secondary" data-theme-import>${iconSvg(Upload)}<span>导入 CSS</span></button></div><div class="theme-file-actions"><button type="button" data-theme-open>${iconSvg(ExternalLink)}<span>打开当前主题文件</span></button><button type="button" data-theme-reset>${iconSvg(RotateCcw)}<span>恢复默认</span></button></div><p class="theme-support">Milkup 主题 CSS 支持亮暗配色、统一字号/行高、字体族、字重、字距、装饰、边框颜色与渐变。不支持逐行尺寸、间距或任意网站/Typora CSS；主题不能加载资源或改变菜单布局。打开默认主题可查看示例。</p><p class="theme-feedback" role="status" aria-live="polite" data-theme-feedback></p>`
  const feedback = options.container.querySelector<HTMLElement>('[data-theme-feedback]')!
  let actionBusy = false
  let previousCss = ''
  let disposed = false
  let localError: string | undefined
  const sync = () => {
    const state = options.styles.getState()
    options.container.querySelector<HTMLElement>('[data-theme-name]')!.textContent = state.name
    feedback.textContent =
      localError ??
      state.error ??
      state.warning ??
      (options.native ? '' : '浏览器预览无法导入或打开系统主题文件。')
    feedback.dataset.error = String(!!localError || !!state.error)
    for (const button of Array.from(
      options.container.querySelectorAll<HTMLButtonElement>('[data-theme-mode]'),
    )) {
      button.setAttribute('aria-pressed', String(button.dataset.themeMode === options.getMode()))
      button.disabled = actionBusy || state.busy
    }
    for (const button of Array.from(
      options.container.querySelectorAll<HTMLButtonElement>(
        '[data-theme-import],[data-theme-open],[data-theme-reset]',
      ),
    ))
      button.disabled = !options.native || state.busy || actionBusy
    options.container.querySelector<HTMLButtonElement>('[data-theme-open]')!.title = state.path
    if (state.css !== previousCss) {
      previousCss = state.css
      for (const frame of Array.from(
        options.container.querySelectorAll<HTMLIFrameElement>('iframe[data-preview]'),
      ))
        frame.srcdoc = themePreviewDocument(state.css, frame.dataset.preview as 'light' | 'dark')
    }
  }
  const click = async (event: Event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>('button')
    if (!button || button.disabled || disposed || actionBusy) return
    actionBusy = true
    localError = undefined
    sync()
    try {
      if (button.dataset.themeMode) {
        await options.changeMode(button.dataset.themeMode as ThemePreference)
      } else if (button.hasAttribute('data-theme-import'))
        await options.styles.importFile(await options.chooseFile())
      else if (button.hasAttribute('data-theme-reset')) await options.styles.reset()
      else if (button.hasAttribute('data-theme-open')) await options.styles.openCurrent()
    } catch (e) {
      if (!disposed) localError = `外观操作未完成：${String(e)}`
    } finally {
      actionBusy = false
      if (!disposed) sync()
    }
  }
  options.container.addEventListener('click', click)
  const unsubscribe = options.styles.subscribe(sync)
  return {
    refresh: sync,
    dispose() {
      disposed = true
      unsubscribe()
      style.remove()
      options.container.removeEventListener('click', click)
    },
  }
}
