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

/** Only the final catalog-ready notification may coalesce an already applied
 * presentation. Explicit commands, invalidation and lifecycle changes still
 * take the normal refresh path. Recording before await also protects in-flight
 * work; a late result never updates this identity receipt. */
export function createCatalogReadyRefreshGate() {
  let requested:
    { readonly scope: object; readonly document: object; readonly rendering: string } | undefined
  return {
    reset(): void {
      requested = undefined
    },
    requested(scope: object, document: object, rendering: string): void {
      requested = { scope, document, rendering }
    },
    canRetain(input: {
      readonly scope: object
      readonly document: object
      readonly rendering: string
      readonly installedBindings: string
      readonly currentBindings: string
    }): boolean {
      return (
        requested?.scope === input.scope &&
        requested.document === input.document &&
        requested.rendering === input.rendering &&
        input.installedBindings === input.currentBindings
      )
    },
  }
}
