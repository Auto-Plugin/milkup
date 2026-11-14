export type DocumentScaleMode = 'full' | 'performance'

export type ParseStrategy = 'full' | 'local-window'
export type RenderStrategy = 'full-dom' | 'virtual-dom' | 'viewport-dom'
export type LiveRenderStrategy = 'full' | 'viewport'
export type SearchStrategy = 'memory' | 'chunked'
export type PluginRenderStrategy = 'full' | 'viewport-safe'
export type StoreStrategy = 'memory' | 'chunked'

export interface DocumentScaleThresholds {
  readonly performanceBytes: number
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
  readonly pluginRendering: PluginRenderStrategy
  readonly autoRenderMermaid: boolean
  readonly fullDocumentDomRequired: boolean
  readonly fullDocumentParseRequired: boolean
}

export const MIB = 1024 * 1024
export const GIB = 1024 * MIB

export const DEFAULT_DOCUMENT_SCALE_THRESHOLDS: DocumentScaleThresholds = Object.freeze({
  performanceBytes: 128 * 1024,
})

export function classifyDocumentScale(input: DocumentScaleInput): DocumentScaleMode {
  const sizeBytes = assertValidSize(input.sizeBytes)
  const thresholds = normalizeThresholds(input.thresholds)

  if (sizeBytes < thresholds.performanceBytes) {
    return 'full'
  }

  return 'performance'
}

export function getFeatureDegradationPolicy(mode: DocumentScaleMode): FeatureDegradationPolicy {
  switch (mode) {
    case 'full':
      return freezePolicy({
        mode,
        store: 'memory',
        parse: 'full',
        render: 'full-dom',
        liveRender: 'full',
        search: 'memory',
        pluginRendering: 'full',
        autoRenderMermaid: true,
        fullDocumentDomRequired: true,
        fullDocumentParseRequired: true,
      })
    case 'performance':
      return freezePolicy({
        mode,
        store: 'chunked',
        parse: 'local-window',
        render: 'viewport-dom',
        liveRender: 'viewport',
        search: 'chunked',
        pluginRendering: 'viewport-safe',
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

  if (normalized.performanceBytes <= 0) {
    throw new RangeError('Document scale threshold must be positive')
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
