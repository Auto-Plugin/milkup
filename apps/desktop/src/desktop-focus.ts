/** Focus navigation for the desktop shell; no plugin or document state. */
export function canRestoreFocus(target: HTMLElement | null): target is HTMLElement {
  return (
    !!target &&
    target.isConnected &&
    !target.matches(':disabled') &&
    !target.closest('[hidden], [inert]') &&
    target.getClientRects().length > 0 &&
    target.ownerDocument.defaultView?.getComputedStyle(target).visibility !== 'hidden'
  )
}

export function restoreDesktopFocus(target: HTMLElement | null, fallback: () => void): void {
  if (canRestoreFocus(target)) {
    target.focus({ preventScroll: true })
    if (target.ownerDocument.activeElement === target) return
  }
  fallback()
}

/** Follow the current visible tab order after an asynchronous editor decision. */
export function moveDesktopFocus(from: HTMLElement, backward: boolean): void {
  const candidates = Array.from(
    from.ownerDocument.querySelectorAll<HTMLElement>(
      'a[href], area[href], button, input, select, textarea, summary, [tabindex], [contenteditable="true"]',
    ),
  ).filter((element) => element.tabIndex >= 0 && canRestoreFocus(element))
  // Positive tabindex comes first; stable sorting preserves DOM order within groups.
  candidates.sort((a, b) => (a.tabIndex || Infinity) - (b.tabIndex || Infinity))
  if (!candidates.length) return
  const index = candidates.indexOf(from)
  // Programmatic focus may land on tabindex=-1 (for example the editor's
  // container). Use its DOM position instead of jumping to the document edge.
  const adjacent =
    index < 0
      ? candidates.filter(
          (candidate) =>
            candidate.tabIndex === 0 &&
            from.compareDocumentPosition(candidate) &
              (backward ? Node.DOCUMENT_POSITION_PRECEDING : Node.DOCUMENT_POSITION_FOLLOWING),
        )
      : []
  const next =
    index < 0
      ? backward
        ? (adjacent.at(-1) ?? candidates.at(-1))
        : (adjacent[0] ?? candidates[0])
      : candidates[(index + (backward ? -1 : 1) + candidates.length) % candidates.length]
  next?.focus()
}
