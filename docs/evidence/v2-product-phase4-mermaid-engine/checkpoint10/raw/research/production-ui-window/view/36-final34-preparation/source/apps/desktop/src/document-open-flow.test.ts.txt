import { describe, expect, it, vi } from 'vitest'

import { runOpenDocumentFlow } from './document-open-flow'
import { createOpenStageTracker } from './open-stage-diagnostics'

describe('document open flow', () => {
  it('publishes loading state before a delayed open resolves', async () => {
    const states: string[] = []
    let resolveOpen:
      | ((result: {
          readonly documentId: string
          readonly file: { readonly path: string }
          readonly text: string
          readonly diskSnapshotHash: string
        }) => void)
      | undefined
    const open = vi.fn(
      () =>
        new Promise<{
          readonly documentId: string
          readonly file: { readonly path: string }
          readonly text: string
          readonly diskSnapshotHash: string
        }>((resolve) => {
          resolveOpen = resolve
        }),
    )

    const promise = runOpenDocumentFlow({
      open,
      tracker: createOpenStageTracker({ label: 'delayed.md', now: () => 0 }),
      onLoadingState: (state) => states.push(state.phase),
      onResult: vi.fn(),
      onCancel: vi.fn(),
      onError: vi.fn(),
    })

    expect(states).toEqual(['opening'])

    resolveOpen?.({
      documentId: 'doc-1',
      file: { path: 'D:/notes/delayed.md' },
      text: '# Delayed\n',
      diskSnapshotHash: 'hash',
    })
    await promise

    expect(states).toEqual(['opening', 'indexing', 'ready'])
  })

  it('restores readiness and calls cancel when open is cancelled', async () => {
    const states: string[] = []
    const onCancel = vi.fn()

    await runOpenDocumentFlow({
      open: async () => undefined,
      tracker: createOpenStageTracker({ label: 'cancelled', now: () => 0 }),
      onLoadingState: (state) => states.push(state.phase),
      onResult: vi.fn(),
      onCancel,
      onError: vi.fn(),
    })

    expect(states).toEqual(['opening', 'ready'])
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('publishes failed state without applying a result when open rejects', async () => {
    const states: string[] = []
    const onResult = vi.fn()
    const onError = vi.fn()

    await runOpenDocumentFlow({
      open: async () => {
        throw new Error('disk read failed')
      },
      tracker: createOpenStageTracker({ label: 'failed.md', now: () => 0 }),
      onLoadingState: (state) => states.push(`${state.phase}:${state.message ?? ''}`),
      onResult,
      onCancel: vi.fn(),
      onError,
    })

    expect(states).toEqual(['opening:', 'failed:disk read failed'])
    expect(onResult).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledTimes(1)
  })
})
