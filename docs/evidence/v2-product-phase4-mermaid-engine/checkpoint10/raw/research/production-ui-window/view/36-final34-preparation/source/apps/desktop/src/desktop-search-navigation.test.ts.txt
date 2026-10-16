import { describe, expect, it } from 'vitest'

import type { DesktopSearchState } from './desktop-document-search'
import {
  createDesktopSearchNavigationState,
  moveDesktopSearchNavigationIndex,
} from './desktop-search-navigation'

describe('desktop search navigation', () => {
  it('formats empty search state as non-navigable', () => {
    expect(createDesktopSearchNavigationState(undefined, -1)).toEqual({
      activeIndex: -1,
      count: 0,
      label: '0/0',
      canNavigate: false,
    })
  })

  it('clamps active index for result labels', () => {
    expect(createDesktopSearchNavigationState(createSearchState(3), 99)).toEqual({
      activeIndex: 2,
      count: 3,
      label: '3/3',
      canNavigate: true,
    })
  })

  it('cycles previous and next result indexes', () => {
    const state = createSearchState(3)

    expect(moveDesktopSearchNavigationIndex(state, 0, -1)).toBe(2)
    expect(moveDesktopSearchNavigationIndex(state, 2, 1)).toBe(0)
    expect(moveDesktopSearchNavigationIndex(state, -1, 1)).toBe(1)
    expect(moveDesktopSearchNavigationIndex(undefined, -1, 1)).toBe(-1)
  })
})

function createSearchState(count: number): DesktopSearchState {
  return {
    phase: 'done',
    query: 'q',
    matches: Array.from({ length: count }, (_value, index) => ({
      from: index,
      to: index + 1,
      line: index + 1,
      lineOffset: 0,
      text: 'q',
    })),
    scannedLineCount: count,
    complete: true,
  }
}

it('uses the complete native result count across bounded pages', () => {
  const search = {
    phase: 'done' as const,
    query: 'x',
    matches: [],
    matchCount: 1000000,
    matchOffset: 999900,
    nativeSearchId: 'native',
    complete: true,
    scannedLineCount: 10000,
  }
  expect(createDesktopSearchNavigationState(search, 999999)).toMatchObject({
    label: '1000000/1000000',
    canNavigate: true,
  })
  expect(moveDesktopSearchNavigationIndex(search, 999999, 1)).toBe(0)
  expect(moveDesktopSearchNavigationIndex(search, 0, -1)).toBe(999999)
  expect(createDesktopSearchNavigationState({ ...search, phase: 'searching' }, 0).canNavigate).toBe(
    false,
  )
})
