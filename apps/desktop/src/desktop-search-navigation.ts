import type { DesktopSearchState } from './desktop-document-search'

export interface DesktopSearchNavigationState {
  readonly activeIndex: number
  readonly count: number
  readonly label: string
  readonly canNavigate: boolean
}

export function createDesktopSearchNavigationState(
  searchState: DesktopSearchState | undefined,
  activeIndex: number,
): DesktopSearchNavigationState {
  const count = searchState?.matches.length ?? 0
  const normalizedIndex = count > 0 ? clamp(activeIndex, 0, count - 1) : -1

  return Object.freeze({
    activeIndex: normalizedIndex,
    count,
    label: count > 0 ? `${normalizedIndex + 1}/${count}` : '0/0',
    canNavigate: count > 0,
  })
}

export function moveDesktopSearchNavigationIndex(
  searchState: DesktopSearchState | undefined,
  activeIndex: number,
  delta: -1 | 1,
): number {
  const count = searchState?.matches.length ?? 0

  if (count === 0) {
    return -1
  }

  const current = activeIndex >= 0 && activeIndex < count ? activeIndex : 0
  return (current + delta + count) % count
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}
