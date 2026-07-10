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
  readonly nativeLargeFileBytes?: number
}

const defaultNativeLargeFileBytes = 256 * 1024

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
  const nativeLargeFileBytes = options.nativeLargeFileBytes ?? defaultNativeLargeFileBytes
  const usePerformanceMode = featurePolicy.mode === 'performance'
  const useNativeLargeFile = usePerformanceMode && metadata.sizeBytes >= nativeLargeFileBytes
  const useMemoryVirtualViewport = usePerformanceMode && !useNativeLargeFile

  return Object.freeze({
    metadata,
    featurePolicy,
    renderStrategy: useMemoryVirtualViewport ? 'virtual-dom' : featurePolicy.render,
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
      performanceBytes: 128 * 1024,
    },
    nativeLargeFileBytes: Number.MAX_SAFE_INTEGER,
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
