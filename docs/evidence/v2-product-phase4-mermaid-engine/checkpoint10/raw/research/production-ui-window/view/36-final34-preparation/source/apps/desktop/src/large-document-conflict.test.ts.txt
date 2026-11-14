import { describe, expect, it } from 'vitest'

import { getLargeExternalReloadDecision } from './large-document-conflict'

describe('large document conflict decisions', () => {
  it('reloads clean external modifications without confirmation', () => {
    expect(
      getLargeExternalReloadDecision({
        dirty: false,
        externalChangeState: 'modified-clean',
      }),
    ).toEqual({ kind: 'reload' })
  })

  it('requires confirmation before discarding dirty large-file edits', () => {
    expect(
      getLargeExternalReloadDecision({
        dirty: true,
        externalChangeState: 'conflict',
      }),
    ).toMatchObject({
      kind: 'confirm-discard-and-reload',
    })
  })

  it('blocks deleted or unchanged external states with user-facing guidance', () => {
    expect(
      getLargeExternalReloadDecision({
        dirty: false,
        externalChangeState: 'deleted-clean',
      }),
    ).toMatchObject({
      kind: 'blocked',
      message: expect.stringContaining('另存为'),
    })

    expect(
      getLargeExternalReloadDecision({
        dirty: false,
        externalChangeState: 'none',
      }),
    ).toMatchObject({
      kind: 'blocked',
    })
  })
})
