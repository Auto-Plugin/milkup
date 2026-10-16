export type PluginContributionViewRefreshAction =
  'preserve-large-source' | 'restore-large-source' | 'recreate-editor' | 'apply-current-state'

export interface PluginContributionViewRefreshInput {
  readonly hasEditorView: boolean
  readonly hasSourceView: boolean
  readonly hasLargeDocumentPreview: boolean
}

export function resolvePluginContributionViewRefreshAction(
  input: PluginContributionViewRefreshInput,
): PluginContributionViewRefreshAction {
  if (input.hasLargeDocumentPreview) {
    return input.hasSourceView ? 'preserve-large-source' : 'restore-large-source'
  }

  return input.hasEditorView ? 'recreate-editor' : 'apply-current-state'
}
