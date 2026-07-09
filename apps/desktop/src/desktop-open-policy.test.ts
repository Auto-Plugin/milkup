import { describe, expect, it } from 'vitest'

import {
  metadataFromOpenFileResult,
  resolveDesktopMemoryViewportFallbackPolicy,
  resolveDesktopOpenPolicy,
} from './desktop-open-policy'

const testThresholds = Object.freeze({
  incrementalBytes: 10,
  largeBytes: 40,
  ultraLargeBytes: 100,
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

  it('routes incremental memory files to the virtual viewport renderer', () => {
    const policy = resolveDesktopOpenPolicy(
      { path: 'D:/notes/incremental.md', sizeBytes: 20 },
      { thresholds: testThresholds },
    )

    expect(policy).toMatchObject({
      renderStrategy: 'virtual-dom',
      useMemoryVirtualViewport: true,
      useNativeLargeFile: false,
    })
    expect(policy.virtualViewport).toMatchObject({
      enabled: true,
      overscanLines: 12,
    })
  })

  it('marks large and ultra-large files for the native large-file path', () => {
    expect(
      resolveDesktopOpenPolicy(
        { path: 'D:/notes/large.md', sizeBytes: 40 },
        { thresholds: testThresholds },
      ),
    ).toMatchObject({
      renderStrategy: 'viewport-dom',
      useMemoryVirtualViewport: false,
      useNativeLargeFile: true,
    })

    expect(
      resolveDesktopOpenPolicy(
        { path: 'D:/notes/huge.md', sizeBytes: 100 },
        { thresholds: testThresholds },
      ).featurePolicy.mode,
    ).toBe('ultra-large')
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
        mode: 'large',
      },
    })

    expect(
      resolveDesktopOpenPolicy({ path: 'D:/notes/2m-plus.md', sizeBytes: 3 * 1024 * 1024 }),
    ).toMatchObject({
      useNativeLargeFile: true,
      featurePolicy: {
        mode: 'ultra-large',
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
        mode: 'incremental',
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
