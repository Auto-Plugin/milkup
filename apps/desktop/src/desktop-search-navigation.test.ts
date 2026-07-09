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
