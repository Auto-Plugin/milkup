import { describe, expect, it } from 'vitest'

import { resolvePluginContributionViewRefreshAction } from './editor-view-refresh'

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
