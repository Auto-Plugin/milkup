export type DocumentScaleMode = 'normal' | 'incremental' | 'large' | 'ultra-large'

export type ParseStrategy = 'full' | 'incremental' | 'local-window' | 'on-demand'
export type RenderStrategy = 'full-dom' | 'virtual-dom' | 'viewport-dom'
export type LiveRenderStrategy = 'full' | 'viewport' | 'source-first'
export type SearchStrategy = 'memory' | 'background-index' | 'chunked'
export type OutlineStrategy = 'full' | 'background' | 'on-demand' | 'disabled'
export type PluginRenderStrategy = 'full' | 'viewport-safe' | 'manual'
export type StoreStrategy = 'memory' | 'chunked'

export interface DocumentScaleThresholds {
  readonly incrementalBytes: number
  readonly largeBytes: number
  readonly ultraLargeBytes: number
}

export interface DocumentScaleInput {
  readonly sizeBytes: number
  readonly thresholds?: Partial<DocumentScaleThresholds>
}

export interface FeatureDegradationPolicy {
  readonly mode: DocumentScaleMode
  readonly store: StoreStrategy
  readonly parse: ParseStrategy
  readonly render: RenderStrategy
  readonly liveRender: LiveRenderStrategy
  readonly search: SearchStrategy
  readonly outline: OutlineStrategy
  readonly pluginRendering: PluginRenderStrategy
  readonly autoRenderMermaid: boolean
  readonly fullDocumentDomRequired: boolean
  readonly fullDocumentParseRequired: boolean
}

export const MIB = 1024 * 1024
export const GIB = 1024 * MIB

export const DEFAULT_DOCUMENT_SCALE_THRESHOLDS: DocumentScaleThresholds = Object.freeze({
  incrementalBytes: 10 * MIB,
  largeBytes: 100 * MIB,
  ultraLargeBytes: GIB,
})

export function classifyDocumentScale(input: DocumentScaleInput): DocumentScaleMode {
  const sizeBytes = assertValidSize(input.sizeBytes)
  const thresholds = normalizeThresholds(input.thresholds)

  if (sizeBytes < thresholds.incrementalBytes) {
    return 'normal'
  }

  if (sizeBytes < thresholds.largeBytes) {
    return 'incremental'
  }

  if (sizeBytes < thresholds.ultraLargeBytes) {
    return 'large'
  }

  return 'ultra-large'
}

export function getFeatureDegradationPolicy(mode: DocumentScaleMode): FeatureDegradationPolicy {
  switch (mode) {
    case 'normal':
      return freezePolicy({
        mode,
        store: 'memory',
        parse: 'full',
        render: 'full-dom',
        liveRender: 'full',
        search: 'memory',
        outline: 'full',
        pluginRendering: 'full',
        autoRenderMermaid: true,
        fullDocumentDomRequired: true,
        fullDocumentParseRequired: true,
      })
    case 'incremental':
      return freezePolicy({
        mode,
        store: 'memory',
        parse: 'incremental',
        render: 'virtual-dom',
        liveRender: 'full',
        search: 'background-index',
        outline: 'background',
        pluginRendering: 'viewport-safe',
        autoRenderMermaid: true,
        fullDocumentDomRequired: false,
        fullDocumentParseRequired: false,
      })
    case 'large':
      return freezePolicy({
        mode,
        store: 'chunked',
        parse: 'local-window',
        render: 'viewport-dom',
        liveRender: 'viewport',
        search: 'chunked',
        outline: 'on-demand',
        pluginRendering: 'viewport-safe',
        autoRenderMermaid: false,
        fullDocumentDomRequired: false,
        fullDocumentParseRequired: false,
      })
    case 'ultra-large':
      return freezePolicy({
        mode,
        store: 'chunked',
        parse: 'on-demand',
        render: 'viewport-dom',
        liveRender: 'source-first',
        search: 'chunked',
        outline: 'disabled',
        pluginRendering: 'manual',
        autoRenderMermaid: false,
        fullDocumentDomRequired: false,
        fullDocumentParseRequired: false,
      })
  }
}

export function resolveFeatureDegradationPolicy(
  input: DocumentScaleInput,
): FeatureDegradationPolicy {
  return getFeatureDegradationPolicy(classifyDocumentScale(input))
}

function normalizeThresholds(
  thresholds: Partial<DocumentScaleThresholds> | undefined,
): DocumentScaleThresholds {
  const normalized = {
    ...DEFAULT_DOCUMENT_SCALE_THRESHOLDS,
    ...(thresholds ?? {}),
  }

  if (
    normalized.incrementalBytes <= 0 ||
    normalized.largeBytes <= normalized.incrementalBytes ||
    normalized.ultraLargeBytes <= normalized.largeBytes
  ) {
    throw new RangeError('Document scale thresholds must be positive and increasing')
  }

  return normalized
}

function assertValidSize(sizeBytes: number): number {
  if (!Number.isFinite(sizeBytes) || sizeBytes < 0) {
    throw new RangeError(`Invalid document size: ${sizeBytes}`)
  }

  return sizeBytes
}

function freezePolicy(policy: FeatureDegradationPolicy): FeatureDegradationPolicy {
  return Object.freeze(policy)
}
