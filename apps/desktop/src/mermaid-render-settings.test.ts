import { describe, expect, it } from 'vitest'
import {
  createMermaidRenderSettings,
  mermaidRenderSettingsKey,
  renderMermaidRenderSettings,
} from './mermaid-render-settings'

describe('Mermaid plugin render settings', () => {
  it('defaults to mixed mode and ignores invalid legacy values', () => {
    expect(createMermaidRenderSettings().get()).toBe('live')
    expect(createMermaidRenderSettings({ getItem: () => 'invalid', setItem() {} }).get()).toBe(
      'live',
    )
  })
  it('persists each strategy across recreation without writing application settings', () => {
    const values = new Map<string, string>()
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value)
      },
    }
    const settings = createMermaidRenderSettings(storage)
    for (const mode of ['source', 'preview', 'live'] as const) {
      settings.set(mode)
      expect(settings.get()).toBe(mode)
      expect(createMermaidRenderSettings(storage).get()).toBe(mode)
    }
    expect([...values.keys()]).toEqual([mermaidRenderSettingsKey])
  })
  it('does not publish a failed save and survives unreadable storage', () => {
    const settings = createMermaidRenderSettings({
      getItem() {
        throw new Error('denied')
      },
      setItem() {
        throw new Error('full')
      },
    })
    expect(() => settings.set('source')).toThrow('full')
    expect(settings.get()).toBe('live')
  })
  it('rejects invalid runtime values', () => {
    const settings = createMermaidRenderSettings()
    expect(() => settings.set('invalid' as 'source')).toThrow()
    expect(settings.get()).toBe('live')
  })
  it('renders a plugin-specific accessible control with selected persisted mode', () => {
    const html = renderMermaidRenderSettings('preview')
    expect(html).toContain('aria-label="Mermaid 渲染策略"')
    expect(html).toContain('<option value="preview" selected>渲染</option>')
    expect(html).toContain('仅影响 Mermaid 代码块，不改变文档模式')
    expect(html).not.toContain('data-view-mode-selector')
  })
})
