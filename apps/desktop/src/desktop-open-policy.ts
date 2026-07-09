import { resolveFeatureDegradationPolicy } from '@milkup/core'
import type {
  DocumentScaleThresholds,
  FeatureDegradationPolicy,
  RenderStrategy,
} from '@milkup/core'
import type { OpenFileResult } from '@milkup/tauri-bridge'
import type { VirtualViewportConfig } from '@milkup/view-dom'

export interface DesktopOpenFileMetadata {
  readonly path: string
  readonly sizeBytes: number
  readonly readonly?: boolean
}

export interface DesktopOpenPolicy {
  readonly metadata: DesktopOpenFileMetadata
  readonly featurePolicy: FeatureDegradationPolicy
  readonly renderStrategy: RenderStrategy
  readonly useMemoryVirtualViewport: boolean
  readonly useNativeLargeFile: boolean
  readonly virtualViewport?: VirtualViewportConfig
}

export interface DesktopOpenPolicyOptions {
  readonly thresholds?: Partial<DocumentScaleThresholds>
}

const desktopVirtualViewportConfig: VirtualViewportConfig = Object.freeze({
  enabled: true,
  lineHeight: 21,
  overscanLines: 12,
})

export function resolveDesktopOpenPolicy(
  metadata: DesktopOpenFileMetadata,
  options: DesktopOpenPolicyOptions = {},
): DesktopOpenPolicy {
  const featurePolicy = resolveFeatureDegradationPolicy({
    sizeBytes: metadata.sizeBytes,
    ...(options.thresholds === undefined ? {} : { thresholds: options.thresholds }),
  })
  const useMemoryVirtualViewport =
    featurePolicy.store === 'memory' && featurePolicy.render === 'virtual-dom'
  const useNativeLargeFile = featurePolicy.store === 'chunked'

  return Object.freeze({
    metadata,
    featurePolicy,
    renderStrategy: featurePolicy.render,
    useMemoryVirtualViewport,
    useNativeLargeFile,
    ...(useMemoryVirtualViewport ? { virtualViewport: desktopVirtualViewportConfig } : {}),
  })
}

export function resolveDesktopMemoryViewportFallbackPolicy(
  metadata: DesktopOpenFileMetadata,
): DesktopOpenPolicy {
  return resolveDesktopOpenPolicy(metadata, {
    thresholds: {
      incrementalBytes: 128 * 1024,
      largeBytes: Number.MAX_SAFE_INTEGER - 1,
      ultraLargeBytes: Number.MAX_SAFE_INTEGER,
    },
  })
}

export function metadataFromOpenFileResult(result: OpenFileResult): DesktopOpenFileMetadata {
  return Object.freeze({
    path: result.file.path,
    sizeBytes: estimateUtf8ByteSize(result.text),
    ...(result.readonly === undefined ? {} : { readonly: result.readonly }),
  })
}

function estimateUtf8ByteSize(text: string): number {
  return new TextEncoder().encode(text).byteLength
}
