import type { ChangeSet } from '@milkup/core'

const blockRanges = ['presentationBlockFrom', 'presentationBlockTo'] as const
const sourceRanges = [
  'from',
  'to',
  'codeFrom',
  'presentationFrom',
  'presentationTo',
  ...blockRanges,
]

/** Remap retained DOM, including block bounds that refer outside this row. */
export function mapLineSourceRanges(
  line: HTMLElement,
  changes: ChangeSet,
  options: { readonly skipContentRanges?: boolean } = {},
): void {
  const elements = options.skipContentRanges
    ? [line]
    : [
        line,
        ...Array.from(
          line.querySelectorAll<HTMLElement>(
            '[data-from], [data-to], [data-code-from], [data-presentation-from], [data-presentation-to], [data-presentation-block-from], [data-presentation-block-to]',
          ),
        ),
      ]
  for (const element of elements) {
    for (const key of options.skipContentRanges ? blockRanges : sourceRanges) {
      const value = element.dataset[key]
      if (value === undefined) continue
      const position = Number(value)
      if (!Number.isInteger(position) || position < 0) continue
      // A code block's start stays anchored before an edit within its opener;
      // its end moves even on rows preceding an edit inside the block.
      const affinity = key === 'to' || key.endsWith('To') ? 1 : -1
      element.dataset[key] = String(changes.mapPosition(position, affinity))
    }
  }
}
