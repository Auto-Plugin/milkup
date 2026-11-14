/** Host-owned presentation preference for the diagrams plugin, never a document mode.
 * Keep this outside the signed plugin manifest's settings schema. */
export type MermaidRenderMode = 'source' | 'preview' | 'live'
export const mermaidRenderSettingsKey = 'milkup.desktop.plugins.milkup.diagrams.render-mode.v1'

export function isMermaidRenderMode(value: unknown): value is MermaidRenderMode {
  return value === 'source' || value === 'preview' || value === 'live'
}

export function createMermaidRenderSettings(storage?: Pick<Storage, 'getItem' | 'setItem'>) {
  let mode: MermaidRenderMode = 'live'
  try {
    const saved = storage?.getItem(mermaidRenderSettingsKey)
    if (isMermaidRenderMode(saved)) mode = saved
  } catch {
    // An inaccessible or obsolete preference must not prevent opening documents.
  }
  return {
    get: (): MermaidRenderMode => mode,
    set(value: MermaidRenderMode): void {
      if (!isMermaidRenderMode(value)) throw new Error('无效的 Mermaid 渲染策略')
      if (value === mode) return
      // Publish only after persistence succeeds, so the UI can report/revert failures.
      if (!storage) throw new Error('本地设置存储不可用')
      storage.setItem(mermaidRenderSettingsKey, value)
      mode = value
    },
  }
}

export function renderMermaidRenderSettings(mode: MermaidRenderMode): string {
  return `<section data-plugin-settings-schema data-mermaid-settings>
    <h4>Mermaid 渲染策略</h4>
    <label>渲染策略 <select data-mermaid-render-mode aria-label="Mermaid 渲染策略">
      ${(['source', 'preview', 'live'] as const).map((value, index) => `<option value="${value}"${mode === value ? ' selected' : ''}>${['源码', '渲染', '混合'][index]}</option>`).join('')}
    </select></label>
    <p>仅影响 Mermaid 代码块，不改变文档模式。源码：显示代码；渲染：显示图形；混合：编辑当前块时显示代码，其他块显示图形。保存后立即生效。</p>
    <p data-mermaid-settings-error role="status" hidden></p>
  </section>`
}
