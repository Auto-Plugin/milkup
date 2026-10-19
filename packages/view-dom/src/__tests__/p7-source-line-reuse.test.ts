import { afterEach, describe, expect, it } from 'vitest'
import {
  ChangeSet,
  EditorState,
  MemoryTextDocument,
  Selection,
  type Transaction,
} from '@milkup/core'
import { EditorView } from '../editor-view'

const unicode = '👩🏽‍💻'
const fixture = (count = 1024, eol = '\n') =>
  Array.from(
    { length: count },
    (_, index) => `line ${String(index + 1).padStart(4, '0')} 中文 ${unicode} é 尾`,
  ).join(eol)
const views: EditorView[] = []

afterEach(() => {
  for (const view of views.splice(0)) view.destroy()
  document.body.replaceChildren()
})

function create(text: string, selection = Selection.cursor(0), virtual = false) {
  const view = new EditorView({
    parent: document.body,
    mode: 'source',
    state: new EditorState({ doc: new MemoryTextDocument(text), selection }),
    ...(virtual
      ? {
          virtualViewport: { enabled: true, lineHeight: 20, viewportHeight: 100, overscanLines: 1 },
        }
      : {}),
  })
  views.push(view)
  return view
}
const lines = (view: EditorView) =>
  Array.from(view.contentDOM.querySelectorAll<HTMLElement>('.milkup-line'))

// Independent UTF-16 offsets, including CRLF bytes omitted only from displayed line text.
function expectedLines(text: string) {
  let from = 0
  return text.split('\n').map((raw, index) => {
    const content = raw.endsWith('\r') ? raw.slice(0, -1) : raw
    const value = { number: index + 1, from, to: from + content.length, text: content || '\u200b' }
    from += raw.length + 1
    return value
  })
}
function assertContent(view: EditorView, expected: string, bounded = false) {
  expect(view.state.doc.text).toBe(expected)
  const actual = lines(view)
  const source = expectedLines(expected)
  if (!bounded) expect(actual).toHaveLength(source.length)
  for (const element of actual) {
    const number = Number(element.dataset.line)
    expect({
      number,
      from: Number(element.dataset.from),
      to: Number(element.dataset.to),
      text: element.textContent,
    }).toEqual(source[number - 1])
  }
}
function apply(view: EditorView, changes: ChangeSet, selection = view.state.selection) {
  const transaction: Transaction = { changes, selection, historyGroup: 'isolate' }
  view.updateState(view.state.applyTransaction(transaction), [transaction])
}

describe('ordinary source single-line rendering reuse', () => {
  for (const number of [1, 512, 1024])
    for (const operation of ['insert', 'delete', 'replace'] as const)
      it(`retains unrelated line nodes for Unicode ${operation} at line ${number}`, () => {
        const text = fixture()
        const line = new MemoryTextDocument(text).line(number)
        const from = line.from + line.text.indexOf(unicode)
        const to = operation === 'insert' ? from : from + unicode.length
        const insert = operation === 'delete' ? '' : '汉字🧑🏾‍🚀é'
        const selection = Selection.range(from, to)
        const view = create(text, selection)
        const before = lines(view)
        const expected = text.slice(0, from) + insert + text.slice(to)
        const target = from + insert.length
        apply(view, ChangeSet.replace(from, to, insert), Selection.cursor(target))
        const after = lines(view)
        expect(
          after.every((element, index) => index === number - 1 || element === before[index]),
        ).toBe(true)
        assertContent(view, expected)
        expect(view.state.selection.main.anchor).toBe(target)
        expect(view.state.selection.main.head).toBe(target)
        expect(
          view.cursorLayerDOM.querySelector<HTMLElement>('.milkup-cursor')?.dataset.position,
        ).toBe(String(target))
        expect(view.state.history.undoStack).toHaveLength(1)
        view.updateState(view.state.undo())
        assertContent(view, text)
        expect(view.state.selection.main.anchor).toBe(from)
        expect(view.state.selection.main.head).toBe(to)
        view.updateState(view.state.redo())
        assertContent(view, expected)
        expect(view.state.selection.main.head).toBe(target)
      })

  it('retains CRLF source bytes and shifts every later line offset without replacing its node', () => {
    const text = fixture(1024, '\r\n')
    const view = create(text)
    const before = lines(view)
    const from = view.state.doc.line(512).from
    apply(view, ChangeSet.insert(from, '新增😀'))
    assertContent(view, text.slice(0, from) + '新增😀' + text.slice(from))
    expect(lines(view).every((element, index) => index === 511 || element === before[index])).toBe(
      true,
    )
  })

  for (const operation of ['empty-to-text', 'text-to-empty'] as const)
    it(`keeps zero-width placeholders confined to display for ${operation}`, () => {
      const text = operation === 'empty-to-text' ? 'before\n\nafter' : 'before\n中文😀\nafter'
      const view = create(text)
      const before = lines(view)
      const line = view.state.doc.line(2)
      const insert = operation === 'empty-to-text' ? '中文😀' : ''
      apply(view, ChangeSet.replace(line.from, line.to, insert))
      assertContent(view, text.slice(0, line.from) + insert + text.slice(line.to))
      expect(lines(view)[0]).toBe(before[0])
      expect(lines(view)[2]).toBe(before[2])
      expect(view.state.doc.text).not.toContain('\u200b')
    })

  it('preserves a reversed selection in a retained later line and restores it through history', () => {
    const text = fixture()
    const last = new MemoryTextDocument(text).line(1024)
    const original = Selection.range(last.to, last.from + 3)
    const view = create(text, original)
    const before = lines(view)
    const insert = '新😀'
    const shifted = Selection.range(last.to + insert.length, last.from + 3 + insert.length)
    apply(view, ChangeSet.insert(0, insert), shifted)
    expect(lines(view)[1023]).toBe(before[1023])
    assertContent(view, insert + text)
    expect(view.state.selection.main.anchor).toBe(last.to + insert.length)
    expect(view.state.selection.main.head).toBe(last.from + 3 + insert.length)
    expect(view.state.selection.main.anchor).toBeGreaterThan(view.state.selection.main.head)
    view.updateState(view.state.undo())
    expect(view.state.selection.main.anchor).toBe(last.to)
    expect(view.state.selection.main.head).toBe(last.from + 3)
    assertContent(view, text)
    view.updateState(view.state.redo())
    expect(view.state.selection.main.anchor).toBe(last.to + insert.length)
    expect(view.state.selection.main.head).toBe(last.from + 3 + insert.length)
  })

  for (const kind of ['grow', 'shrink'] as const)
    it(`uses updated offsets when clicking a retained later line after ${kind}`, () => {
      const text = fixture()
      const view = create(text)
      const before = lines(view)
      const insert = kind === 'grow' ? '新😀' : ''
      const to = kind === 'grow' ? 0 : 2
      apply(view, ChangeSet.replace(0, to, insert))
      const expected = insert + text.slice(to)
      const last = lines(view)[1023]!
      expect(last).toBe(before[1023])
      const descriptor = Object.getOwnPropertyDescriptor(document, 'caretPositionFromPoint')
      Object.defineProperty(document, 'caretPositionFromPoint', {
        configurable: true,
        value: () => ({ offsetNode: last.firstChild, offset: 3 }),
      })
      try {
        last.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      } finally {
        if (descriptor) Object.defineProperty(document, 'caretPositionFromPoint', descriptor)
        else Reflect.deleteProperty(document, 'caretPositionFromPoint')
      }
      expect(view.state.selection.main.head).toBe(expectedLines(expected)[1023]!.from + 3)
      expect(document.activeElement).toBe(view.inputDOM)
      expect(view.state.history.undoStack).toHaveLength(1)
      assertContent(view, expected)
    })

  it('retains a final empty line and moves its absolute end offset', () => {
    const text = fixture(1023) + '\n'
    const view = create(text)
    const last = lines(view)[1023]!
    apply(view, ChangeSet.insert(0, '😀'))
    expect(lines(view)[1023]).toBe(last)
    expect(last.textContent).toBe('\u200b')
    expect(last.dataset.from).toBe(String(text.length + 2))
    expect(last.dataset.to).toBe(String(text.length + 2))
    assertContent(view, '😀' + text)
  })

  it('preserves outer and affected-line scroll when an edit leaves selection unchanged', () => {
    const text = fixture()
    const view = create(text)
    const edited = lines(view)[511]!
    view.dom.scrollTop = 780
    view.dom.scrollLeft = 25
    edited.scrollLeft = 41
    const from = view.state.doc.line(512).from
    apply(view, ChangeSet.insert(from, '新增😀'))
    expect(view.dom.scrollTop).toBe(780)
    expect(view.dom.scrollLeft).toBe(25)
    expect(lines(view)[511]!.scrollLeft).toBe(41)
    assertContent(view, text.slice(0, from) + '新增😀' + text.slice(from))
  })
})

describe('ordinary source changed-line fallback boundaries', () => {
  for (const kind of [
    'insert-newline',
    'delete-newline',
    'insert-carriage-return',
    'delete-carriage-return',
    'multiple-changes',
    'multiple-transactions',
    'untracked-state',
  ] as const)
    it(`fully reconciles source and offsets for ${kind}`, () => {
      const text = fixture(8, kind === 'delete-carriage-return' ? '\r\n' : '\n')
      const view = create(text)
      const before = lines(view)
      const second = view.state.doc.line(2)
      let expected: string
      if (kind === 'insert-newline') {
        expected = text.slice(0, second.from) + '\n' + text.slice(second.from)
        apply(view, ChangeSet.insert(second.from, '\n'))
      } else if (kind === 'delete-newline') {
        expected = text.slice(0, second.to) + text.slice(second.to + 1)
        apply(view, ChangeSet.delete(second.to, second.to + 1))
      } else if (kind === 'insert-carriage-return') {
        expected = text.slice(0, second.to) + '\r' + text.slice(second.to)
        apply(view, ChangeSet.insert(second.to, '\r'))
      } else if (kind === 'delete-carriage-return') {
        expected = text.slice(0, second.to) + text.slice(second.to + 1)
        apply(view, ChangeSet.delete(second.to, second.to + 1))
      } else if (kind === 'multiple-changes') {
        expected = '甲' + text.slice(1, second.from) + '乙' + text.slice(second.from + 1)
        apply(
          view,
          ChangeSet.of([
            { from: 0, to: 1, insert: '甲' },
            { from: second.from, to: second.from + 1, insert: '乙' },
          ]),
        )
      } else if (kind === 'multiple-transactions') {
        const first: Transaction = { changes: ChangeSet.insert(0, '甲') }
        const next: Transaction = { changes: ChangeSet.insert(1, '乙') }
        const state = view.state.applyTransaction(first).applyTransaction(next)
        expected = '甲乙' + text
        view.updateState(state, [first, next])
      } else {
        expected = '甲' + text
        view.updateState(new EditorState({ doc: new MemoryTextDocument(expected) }))
      }
      assertContent(view, expected)
      expect(lines(view).at(-1)).not.toBe(before.at(-1))
    })

  it('repairs a missing unrelated line instead of returning from a partial patch', () => {
    const text = fixture(8)
    const view = create(text)
    lines(view)[5]!.remove()
    apply(view, ChangeSet.insert(0, '甲'))
    assertContent(view, '甲' + text)
  })

  it('keeps virtual source rendering bounded and updates visible offsets for an offscreen edit', () => {
    const text = fixture()
    const view = create(text, Selection.cursor(0), true)
    view.dom.scrollTop = 400
    view.dom.dispatchEvent(new Event('scroll'))
    const before = lines(view)
    const fromLine = view.contentDOM.dataset.fromLine
    const toLine = view.contentDOM.dataset.toLine
    const spacerHeights = Array.from(
      view.contentDOM.querySelectorAll<HTMLElement>('[data-spacer]'),
    ).map((element) => element.style.height)
    apply(view, ChangeSet.insert(0, '甲😀'))
    expect(view.contentDOM.dataset.virtualized).toBe('true')
    expect(view.contentDOM.dataset.fromLine).toBe(fromLine)
    expect(view.contentDOM.dataset.toLine).toBe(toLine)
    expect(lines(view).length).toBeLessThan(10)
    expect(lines(view)[0]).not.toBe(before[0])
    expect(
      Array.from(view.contentDOM.querySelectorAll<HTMLElement>('[data-spacer]')).map(
        (element) => element.style.height,
      ),
    ).toEqual(spacerHeights)
    assertContent(view, '甲😀' + text, true)
  })
})
