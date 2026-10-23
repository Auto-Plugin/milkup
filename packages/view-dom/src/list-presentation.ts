import type { Selection } from '@milkup/core'

/** CommonMark accepts a bare bullet at EOL. Live input keeps it literal until
 * the user commits its separator; this never changes the parsed source. */
export function isUnfinishedBulletMarker(line: string): boolean {
  return /^[ \t]*[-+*]$/u.test(line)
}

/** Preserve loaded empty tasks at EOL, but leave an active, undelimited prefix
 * literal while its caret can continue typing. A following word is not a task. */
export function presentedTaskMarkerLength(
  text: string,
  from: number,
  editingSelection?: Selection,
): number | undefined {
  const match = /^([ \t]*\[[ xX]\])([ \t]+|$)/u.exec(text)
  if (!match) return undefined
  const length = match[0].length
  if (
    match[2] === '' &&
    editingSelection?.ranges.some((range) => range.empty && range.head === from + length)
  )
    return undefined
  return length
}
