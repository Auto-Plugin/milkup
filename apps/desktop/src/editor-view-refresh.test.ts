import { describe, expect, it } from 'vitest'

import {
  createCatalogReadyRefreshGate,
  resolvePluginContributionViewRefreshAction,
} from './editor-view-refresh'

describe('plugin contribution view refresh', () => {
  it('preserves an active native large-file source view', () => {
    expect(
      resolvePluginContributionViewRefreshAction({
        hasEditorView: false,
        hasSourceView: true,
        hasLargeDocumentPreview: true,
      }),
    ).toBe('preserve-large-source')
  })

  it('restores the source view when a large preview temporarily has no view', () => {
    expect(
      resolvePluginContributionViewRefreshAction({
        hasEditorView: false,
        hasSourceView: false,
        hasLargeDocumentPreview: true,
      }),
    ).toBe('restore-large-source')
  })

  it('recreates only the regular editor view for new plugin renderers', () => {
    expect(
      resolvePluginContributionViewRefreshAction({
        hasEditorView: true,
        hasSourceView: false,
        hasLargeDocumentPreview: false,
      }),
    ).toBe('recreate-editor')
  })
})

describe('final catalog-ready refresh receipt', () => {
  const snapshot = () => ({
    scope: {},
    document: {},
    rendering: 'diagrams:epoch1:approved:live:light:revision0',
    installedBindings: 'no-controlled-renderers:markdown-default',
    currentBindings: 'no-controlled-renderers:markdown-default',
  })
  it('does not guess before a provider has observed the current renderer', () => {
    expect(createCatalogReadyRefreshGate().canRetain(snapshot())).toBe(false)
  })
  it('preserves repeated final notifications after a cold request, including pending work', () => {
    const gate = createCatalogReadyRefreshGate(),
      input = snapshot()
    gate.requested(input.scope, input.document, input.rendering)
    expect(gate.canRetain(input)).toBe(true)
    expect(gate.canRetain(input)).toBe(true)
  })
  it('rejects another view/document, changed rendering settings and newly installed syntax', () => {
    const gate = createCatalogReadyRefreshGate(),
      input = snapshot()
    gate.requested(input.scope, input.document, input.rendering)
    for (const change of [
      { scope: {} },
      { document: {} },
      { rendering: 'disabled' },
      { rendering: 'epoch2-package-replaced' },
      { rendering: 'epoch3-rolled-back' },
      { rendering: 'source-mode' },
      { rendering: 'preview-mode' },
      { rendering: 'dark-theme' },
      { rendering: 'settings-invalidation1' },
      { rendering: 'math-added' },
      { currentBindings: 'new-controlled-renderer' },
      { currentBindings: 'new-markdown-syntax' },
    ]) {
      expect(gate.canRetain({ ...input, ...change })).toBe(false)
    }
  })
  it('does not let a request from an old view authorize preservation of its replacement', () => {
    const gate = createCatalogReadyRefreshGate(),
      old = snapshot(),
      current = snapshot()
    gate.requested(old.scope, old.document, old.rendering)
    expect(gate.canRetain(current)).toBe(false)
    gate.requested(current.scope, current.document, current.rendering)
    expect(gate.canRetain(current)).toBe(true)
    gate.reset()
    expect(gate.canRetain(current)).toBe(false)
  })
})
