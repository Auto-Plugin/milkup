import type { SyntaxNode } from '@milkup/markdown'

export function applyTableAlignments(line: HTMLElement, table: SyntaxNode | undefined): void {
  const alignments = table?.data?.alignments
  if (!Array.isArray(alignments)) return
  line.querySelectorAll<HTMLElement>('.milkup-table-cell').forEach((cell, column) => {
    const alignment: unknown = alignments[column]
    if (alignment === 'left' || alignment === 'center' || alignment === 'right') {
      cell.style.textAlign = alignment
    }
  })
}

export function createTaskMarker(
  document: Document,
  from: number,
  to: number,
  text: string,
): HTMLButtonElement {
  const task = document.createElement('button')
  task.type = 'button'
  task.className = 'milkup-task-marker'
  task.dataset.from = String(from)
  task.dataset.to = String(to)
  task.dataset.checked = String(/[xX]/u.test(text))
  task.setAttribute('role', 'checkbox')
  task.setAttribute('aria-checked', task.dataset.checked)
  task.setAttribute('aria-label', 'Toggle task')
  return task
}

export function taskMarkerFromEvent(
  event: Event,
  content: HTMLElement,
): HTMLButtonElement | undefined {
  const target = event.target
  const task =
    target instanceof Element ? target.closest<HTMLButtonElement>('.milkup-task-marker') : null
  return task && content.contains(task) ? task : undefined
}

export function syncTaskAvailability(content: HTMLElement, editable: boolean): void {
  content
    .querySelectorAll<HTMLButtonElement | HTMLSelectElement>(
      '.milkup-task-marker, .milkup-code-language',
    )
    .forEach((task) => {
      if (task.disabled === editable) task.disabled = !editable
    })
}

/** Change exactly the ASCII check character; offsets remain UTF-16 source offsets. */
export function taskMarkerEdit(
  from: number,
  text: string,
): { from: number; to: number; insert: string } | undefined {
  const marker = /^(\s*\[)([ xX])\]\s*$/u.exec(text)
  if (!marker) return
  const position = from + marker[1]!.length
  return { from: position, to: position + 1, insert: marker[2] === ' ' ? 'x' : ' ' }
}
