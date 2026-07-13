import { describe, expect, it } from 'vitest'

import {
  metadataFromOpenFileResult,
  resolveDesktopMemoryViewportFallbackPolicy,
  resolveDesktopOpenPolicy,
} from './desktop-open-policy'

const testThresholds = Object.freeze({
  performanceBytes: 10,
})

describe('desktop open policy', () => {
  it('keeps small files on the full DOM memory path', () => {
    expect(
      resolveDesktopOpenPolicy(
        { path: 'D:/notes/small.md', sizeBytes: 9 },
        { thresholds: testThresholds },
      ),
    ).toMatchObject({
      renderStrategy: 'full-dom',
      useMemoryVirtualViewport: false,
      useNativeLargeFile: false,
    })
  })

  it('routes small performance-mode files to the memory viewport renderer', () => {
    const policy = resolveDesktopOpenPolicy(
      { path: 'D:/notes/performance.md', sizeBytes: 20 },
      { thresholds: testThresholds, nativeLargeFileBytes: 40 },
    )

    expect(policy).toMatchObject({
      renderStrategy: 'virtual-dom',
      useMemoryVirtualViewport: true,
      useNativeLargeFile: false,
      featurePolicy: {
        mode: 'performance',
      },
    })
    expect(policy.virtualViewport).toMatchObject({
      enabled: true,
      overscanLines: 24,
    })
  })

  it('uses the native large-file path as an internal performance-mode route', () => {
    expect(
      resolveDesktopOpenPolicy(
        { path: 'D:/notes/large.md', sizeBytes: 40 },
        { thresholds: testThresholds, nativeLargeFileBytes: 40 },
      ),
    ).toMatchObject({
      renderStrategy: 'viewport-dom',
      useMemoryVirtualViewport: false,
      useNativeLargeFile: true,
      featurePolicy: {
        mode: 'performance',
      },
    })
  })

  it('uses conservative Windows preview defaults for editor routing', () => {
    expect(
      resolveDesktopOpenPolicy({ path: 'D:/notes/128k-plus.md', sizeBytes: 200 * 1024 }),
    ).toMatchObject({
      renderStrategy: 'virtual-dom',
      useMemoryVirtualViewport: true,
      useNativeLargeFile: false,
    })

    expect(
      resolveDesktopOpenPolicy({ path: 'D:/notes/256k-plus.md', sizeBytes: 300 * 1024 }),
    ).toMatchObject({
      renderStrategy: 'viewport-dom',
      useMemoryVirtualViewport: false,
      useNativeLargeFile: true,
      featurePolicy: {
        mode: 'performance',
      },
    })

    expect(
      resolveDesktopOpenPolicy({ path: 'D:/notes/2m-plus.md', sizeBytes: 3 * 1024 * 1024 }),
    ).toMatchObject({
      useNativeLargeFile: true,
      featurePolicy: {
        mode: 'performance',
      },
    })
  })

  it('can force a memory viewport fallback without changing user-facing editor capabilities', () => {
    expect(
      resolveDesktopMemoryViewportFallbackPolicy({
        path: 'D:/notes/native-fallback.md',
        sizeBytes: 3 * 1024 * 1024,
      }),
    ).toMatchObject({
      renderStrategy: 'virtual-dom',
      useMemoryVirtualViewport: true,
      useNativeLargeFile: false,
      featurePolicy: {
        mode: 'performance',
      },
    })
  })

  it('derives metadata from normal open results until native metadata is available', () => {
    expect(
      metadataFromOpenFileResult({
        documentId: 'doc-1',
        file: { path: 'D:/notes/open.md' },
        text: 'hello',
        diskSnapshotHash: 'hash',
        readonly: true,
      }),
    ).toEqual({
      path: 'D:/notes/open.md',
      sizeBytes: 5,
      readonly: true,
    })
  })
})
