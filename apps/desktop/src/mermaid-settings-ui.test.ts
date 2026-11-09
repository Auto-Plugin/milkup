// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import {
  renderDesktopPluginManagerElement,
  revealDesktopPluginDetails,
} from './desktop-plugin-manager-ui'
import type { DesktopPluginManagerState } from './desktop-plugin-manager'

const state: DesktopPluginManagerState = {
  records: [
    {
      manifest: { id: 'milkup.diagrams', name: 'Diagrams', version: '1.3.0', main: './plugin.js' },
      manifestPath: '/plugin.json',
      rootPath: '/plugins',
      sourcePath: '/plugin.zip',
      state: 'installed',
      enabled: true,
      installedAt: 1,
      updatedAt: 1,
      trust: 'development',
      dataRoot: '/data',
      storageRoot: '/storage',
      approvals: { hosts: [], permissions: [] },
      errors: [],
    },
  ],
  contributions: {
    commands: [],
    ui: [],
    keymaps: [],
    renderers: [],
    markdownSyntax: [],
    importers: [],
    documentTypes: [],
  },
  auditCount: 0,
  auditRecords: [],
  installFailures: [],
  mermaidRenderMode: 'live',
}

describe('Mermaid settings detail navigation', () => {
  it('keeps the strategy and keyboard focus through repeated repaint and Back', () => {
    document.body.innerHTML = '<div id="manager"></div>'
    const target = document.getElementById('manager')!
    renderDesktopPluginManagerElement(target, state)
    expect(target.querySelector('[data-mermaid-render-mode]')).toBeNull()
    revealDesktopPluginDetails(target, 'milkup.diagrams', 'details')
    const select = target.querySelector<HTMLSelectElement>('[data-mermaid-render-mode]')!
    expect(select.value).toBe('live')
    select.focus()
    renderDesktopPluginManagerElement(target, { ...state, mermaidRenderMode: 'source' })
    expect(document.activeElement).toBe(target.querySelector('[data-mermaid-render-mode]'))
    expect((document.activeElement as HTMLSelectElement).value).toBe('source')
    renderDesktopPluginManagerElement(target, { ...state, mermaidRenderMode: 'preview' })
    expect((document.activeElement as HTMLSelectElement).value).toBe('preview')
    target.querySelector<HTMLButtonElement>('[data-plugin-action="back"]')!.click()
    expect(target.querySelector('[data-mermaid-render-mode]')).toBeNull()
    revealDesktopPluginDetails(target, 'milkup.diagrams', 'details')
    expect(target.querySelector<HTMLSelectElement>('[data-mermaid-render-mode]')!.value).toBe(
      'preview',
    )
  })
})
