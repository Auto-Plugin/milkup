import { MemoryAssetProvider } from '@milkup/assets'
import { ChangeSet, EditorState, MemoryTextDocument, Selection } from '@milkup/core'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  buildLineProjection,
  coordinateToPosition,
  createInputProxy,
  EditorView,
  getVisibleLineWindow,
  positionToLineOffset,
  positionToRect,
  renderCursorOverlay,
  renderMarkdownLines,
  renderPlainTextLineWindow,
  renderPlainTextLines,
  renderSelectionOverlay,
  scrollPositionIntoView,
  sourcePositionToVisualOffset,
  visualOffsetToSourcePosition,
} from '../index'

function createState(text: string, selection = Selection.cursor(0)): EditorState {
  return new EditorState({
    doc: new MemoryTextDocument(text),
    selection,
  })
}

function readCodingPlanFixture(): string {
  return readFileSync(resolve(__dirname, '../../../../docs/coding-plan.md'), 'utf8')
}

function createLineFixture(lineCount: number): string {
  return Array.from({ length: lineCount }, (_value, index) => `line ${index + 1}`).join('\n')
}

function createPasteEvent(
  data: Record<string, string>,
  files: readonly { readonly name: string; readonly type: string }[] = [],
): Event {
  const event = new Event('paste', { bubbles: true, cancelable: true })

  Object.defineProperty(event, 'clipboardData', {
    value: {
      files,
      getData(type: string): string {
        return data[type] ?? ''
      },
    },
  })

  return event
}

async function flushAsyncPaste(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

function withCaretRangeFromPoint(node: Node, offset: number): () => void {
  const documentWithCaretPoint = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
    caretRangeFromPoint?: (x: number, y: number) => Range | null
  }
  const previousCaretPositionFromPoint = documentWithCaretPoint.caretPositionFromPoint
  const previousCaretRangeFromPoint = documentWithCaretPoint.caretRangeFromPoint

  Object.defineProperty(document, 'caretPositionFromPoint', {
    configurable: true,
    value: () => ({
      offsetNode: node,
      offset,
    }),
  })

  Object.defineProperty(document, 'caretRangeFromPoint', {
    configurable: true,
    value: () =>
      ({
        startContainer: node,
        startOffset: offset,
      }) as unknown as Range,
  })

  return () => {
    Object.defineProperty(document, 'caretPositionFromPoint', {
      configurable: true,
      value: previousCaretPositionFromPoint,
    })
    Object.defineProperty(document, 'caretRangeFromPoint', {
      configurable: true,
      value: previousCaretRangeFromPoint,
    })
  }
}

function firstTextNode(root: ParentNode | null | undefined): Text {
  const node = root?.ownerDocument?.createTreeWalker(root, NodeFilter.SHOW_TEXT).nextNode()

  if (!(node instanceof Text)) {
    throw new Error('Expected a text node')
  }

  return node
}

function rect(left: number, top = 0, height = 20): DOMRect {
  return {
    left,
    right: left,
    top,
    bottom: top + height,
    width: 0,
    height,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect
}

describe('EditorView', () => {
  it('renders a plain text document into line wrappers', () => {
    const parent = document.createElement('main')
    const view = new EditorView({
      parent,
      state: createState('hello\nworld'),
    })
    const lines = Array.from(view.contentDOM.querySelectorAll<HTMLElement>('.milkup-line'))

    expect(parent.querySelector('.milkup-editor')).toBe(view.dom)
    expect(view.dom.dataset.mode).toBe('source')
    expect(view.contentDOM.getAttribute('contenteditable')).toBe('false')
    expect(lines).toHaveLength(2)
    expect(lines.map((line) => line.textContent)).toEqual(['hello', 'world'])
    expect(lines.map((line) => line.dataset.line)).toEqual(['1', '2'])
    expect(lines.map((line) => [line.dataset.from, line.dataset.to])).toEqual([
      ['0', '5'],
      ['6', '11'],
    ])
  })

  it('renders search highlights and distinguishes the active result', () => {
    const parent = document.createElement('main')
    const view = new EditorView({ parent, state: createState('target text') })

    view.setSearchHighlights([{ from: 0, to: 6, line: 1 }], 0)

    const highlight = view.searchLayerDOM.querySelector<HTMLElement>('.milkup-search-highlight')
    expect(highlight?.dataset.from).toBe('0')
    expect(highlight?.dataset.to).toBe('6')
    expect(highlight?.classList.contains('is-active')).toBe(true)
  })

  it('renders empty lines with a zero-width placeholder without changing document text', () => {
    const parent = document.createElement('main')
    const view = new EditorView({
      parent,
      state: createState('a\n\nb'),
    })
    const lines = Array.from(view.contentDOM.querySelectorAll<HTMLElement>('.milkup-line'))

    expect(lines).toHaveLength(3)
    expect(lines[1]?.textContent).toBe('\u200b')
    expect(view.state.doc.text).toBe('a\n\nb')
  })

  it('updates rendered lines when editor state changes', () => {
    const parent = document.createElement('main')
    const initial = createState('hello')
    const view = new EditorView({ parent, state: initial })
    const initialParse = view.markdownParse
    const next = initial.applyTransaction({
      changes: ChangeSet.insert(5, '\nworld'),
      selection: Selection.cursor(11),
      origin: { type: 'input.type' },
    })
    const update = view.updateState(next)

    expect(update.previousState).toBe(initial)
    expect(update.state).toBe(next)
    expect(view.state).toBe(next)
    expect(
      Array.from(view.contentDOM.querySelectorAll('.milkup-line')).map((line) => line.textContent),
    ).toEqual(['hello', 'world'])
    expect(view.markdownParse.version).toBe(initialParse.version + 1)
    expect(view.markdownParse.cache.source).toBe('hello\nworld')
  })

  it('renders cursor overlay from editor selection', () => {
    const parent = document.createElement('main')
    const view = new EditorView({
      parent,
      state: createState('hello\nworld', Selection.cursor(7)),
    })
    const cursor = view.cursorLayerDOM.querySelector<HTMLElement>('.milkup-cursor')

    expect(cursor?.dataset.position).toBe('7')
    expect(cursor?.dataset.line).toBe('2')
    expect(cursor?.dataset.offset).toBe('1')
    expect(cursor?.dataset.empty).toBe('true')
    expect(cursor?.style.left).toBe('8px')
    expect(cursor?.style.top).toBe('20px')
  })

  it('updates cursor overlay when editor state changes', () => {
    const parent = document.createElement('main')
    const initial = createState('hello\nworld', Selection.cursor(0))
    const view = new EditorView({ parent, state: initial })
    const next = new EditorState({
      doc: initial.doc,
      selection: Selection.cursor(11),
      history: initial.history,
    })

    view.updateState(next)

    const cursor = view.cursorLayerDOM.querySelector<HTMLElement>('.milkup-cursor')
    expect(cursor?.dataset.position).toBe('11')
    expect(cursor?.dataset.line).toBe('2')
    expect(cursor?.dataset.offset).toBe('5')
  })

  it('updates only selection and cursor layers for source selection-only changes', () => {
    const parent = document.createElement('main')
    const initial = createState('- one\n- two\n- three', Selection.cursor(0))
    const view = new EditorView({ parent, state: initial, mode: 'source' })
    const firstRenderedLine = view.contentDOM.querySelector<HTMLElement>('.milkup-line')
    const next = new EditorState({
      doc: initial.doc,
      selection: Selection.cursor(13),
      history: initial.history,
    })

    view.updateState(next, [{ selection: next.selection, origin: { type: 'command' } }])

    expect(view.contentDOM.querySelector<HTMLElement>('.milkup-line')).toBe(firstRenderedLine)
    expect(view.cursorLayerDOM.querySelector<HTMLElement>('.milkup-cursor')?.dataset.position).toBe(
      '13',
    )
  })

  it('virtualizes source line rendering to the visible window with overscan', () => {
    const parent = document.createElement('main')
    const view = new EditorView({
      parent,
      state: createState(createLineFixture(1_000)),
      mode: 'source',
      virtualViewport: {
        enabled: true,
        lineHeight: 20,
        viewportHeight: 100,
        overscanLines: 2,
      },
    })
    const lines = Array.from(view.contentDOM.querySelectorAll<HTMLElement>('.milkup-line'))

    expect(view.contentDOM.dataset.virtualized).toBe('true')
    expect(view.contentDOM.dataset.fromLine).toBe('1')
    expect(view.contentDOM.dataset.toLine).toBe('7')
    expect(lines).toHaveLength(7)
    expect(lines.map((line) => line.dataset.line)).toEqual(['1', '2', '3', '4', '5', '6', '7'])
    expect(
      view.contentDOM.querySelector<HTMLElement>('[data-spacer="bottom"]')?.style.height,
    ).toBe('19860px')
  })

  it('updates the virtual source window on scroll without rendering offscreen lines', () => {
    const parent = document.createElement('main')
    const view = new EditorView({
      parent,
      state: createState(createLineFixture(1_000)),
      mode: 'source',
      virtualViewport: {
        enabled: true,
        lineHeight: 20,
        viewportHeight: 100,
        overscanLines: 1,
      },
    })

    view.dom.scrollTop = 400
    view.dom.dispatchEvent(new Event('scroll'))

    const lines = Array.from(view.contentDOM.querySelectorAll<HTMLElement>('.milkup-line'))

    expect(view.contentDOM.dataset.fromLine).toBe('20')
    expect(view.contentDOM.dataset.toLine).toBe('26')
    expect(lines).toHaveLength(7)
    expect(lines[0]?.dataset.line).toBe('20')
    expect(lines.at(-1)?.dataset.line).toBe('26')
    expect(view.contentDOM.querySelector<HTMLElement>('.milkup-line[data-line="1"]')).toBeNull()
  })

  it('scrolls virtual source cursors into view before rendering the target line', () => {
    const parent = document.createElement('main')
    const state = createState(createLineFixture(1_000))
    const targetLine = state.doc.line(800)
    const view = new EditorView({
      parent,
      state,
      mode: 'source',
      virtualViewport: {
        enabled: true,
        lineHeight: 20,
        viewportHeight: 100,
        overscanLines: 1,
      },
    })

    view.updateState(createState(state.doc.text, Selection.cursor(targetLine.from)))
    view.ensureCursorVisible({ scrollPadding: 0, viewportHeight: 100 })

    expect(view.dom.scrollTop).toBeGreaterThan(0)
    expect(Number(view.contentDOM.dataset.fromLine)).toBeLessThanOrEqual(800)
    expect(Number(view.contentDOM.dataset.toLine)).toBeGreaterThanOrEqual(800)
    expect(view.contentDOM.querySelector<HTMLElement>('.milkup-line[data-line="800"]')).not.toBeNull()
  })

  it('rerenders live content for selection-only changes so syntax visibility updates', () => {
    const parent = document.createElement('main')
    const initial = createState('`coding-plan.md` later', Selection.cursor(21))
    const view = new EditorView({ parent, state: initial, mode: 'live' })
    const firstRenderedLine = view.contentDOM.querySelector<HTMLElement>('.milkup-line')
    const next = new EditorState({
      doc: initial.doc,
      selection: Selection.cursor(6),
      history: initial.history,
    })

    view.updateState(next, [{ selection: next.selection, origin: { type: 'command' } }])

    expect(view.contentDOM.querySelector<HTMLElement>('.milkup-line')).not.toBe(firstRenderedLine)
    expect(
      view.contentDOM.querySelector<HTMLElement>('.milkup-inline-inlineCode')?.dataset
        .syntaxVisible,
    ).toBe('true')
  })

  it('renders selection overlay for non-collapsed ranges', () => {
    const parent = document.createElement('main')
    const view = new EditorView({
      parent,
      state: createState('hello\nworld', Selection.range(1, 8)),
    })
    const selection = view.selectionLayerDOM.querySelector<HTMLElement>('.milkup-selection')

    expect(selection?.dataset.from).toBe('1')
    expect(selection?.dataset.to).toBe('8')
    expect(selection?.dataset.fromLine).toBe('1')
    expect(selection?.dataset.fromOffset).toBe('1')
    expect(selection?.dataset.toLine).toBe('2')
    expect(selection?.dataset.toOffset).toBe('2')
    expect(selection?.style.left).toBe('8px')
    expect(selection?.style.top).toBe('0px')
  })

  it('aligns selection overlays to measured DOM rects after scrolling', () => {
    const parent = document.createElement('main')
    document.body.append(parent)
    const previousCreateRange = document.createRange.bind(document)
    const view = new EditorView({
      parent,
      state: createState('hello\nworld', Selection.cursor(0)),
    })
    view.selectionLayerDOM.getBoundingClientRect = () =>
      ({
        left: 20,
        right: 220,
        top: 100,
        bottom: 300,
        width: 200,
        height: 200,
        x: 20,
        y: 100,
        toJSON: () => ({}),
      }) as DOMRect
    HTMLElement.prototype.getBoundingClientRect
    const previousGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect
    HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
      if (this.classList.contains('milkup-line')) {
        return {
          left: 20,
          right: 220,
          top: 140,
          bottom: 161,
          width: 200,
          height: 21,
          x: 20,
          y: 140,
          toJSON: () => ({}),
        } as DOMRect
      }

      return previousGetBoundingClientRect.call(this)
    }
    document.createRange = () => {
      const range = previousCreateRange()
      range.getClientRects = () =>
        [
          {
            left: 52,
            right: 92,
            top: 146,
            bottom: 167,
            width: 40,
            height: 21,
            x: 52,
            y: 146,
            toJSON: () => ({}),
          } as DOMRect,
        ] as unknown as DOMRectList
      return range
    }

    try {
      view.updateState(
        new EditorState({
          doc: view.state.doc,
          selection: Selection.range(1, 4),
          history: view.state.history,
        }),
      )
    } finally {
      document.createRange = previousCreateRange
      HTMLElement.prototype.getBoundingClientRect = previousGetBoundingClientRect
    }

    const selection = view.selectionLayerDOM.querySelector<HTMLElement>('.milkup-selection')

    expect(selection?.style.left).toBe('32px')
    expect(selection?.style.top).toBe('46px')
    expect(selection?.style.width).toBe('40px')
    expect(selection?.style.height).toBe('21px')
  })

  it('creates a hidden textarea input proxy outside document content', () => {
    const parent = document.createElement('main')
    const view = new EditorView({ parent, state: createState('hello') })

    expect(view.inputDOM).toBeInstanceOf(HTMLTextAreaElement)
    expect(view.inputDOM.className).toBe('milkup-input-proxy')
    expect(view.inputDOM.getAttribute('aria-hidden')).toBe('true')
    expect(view.contentDOM.contains(view.inputDOM)).toBe(false)
    expect(view.dom.contains(view.inputDOM)).toBe(true)
  })

  it('inserts text from the input proxy through a transaction', () => {
    const parent = document.createElement('main')
    const view = new EditorView({
      parent,
      state: createState('hello', Selection.cursor(5)),
    })

    view.inputDOM.value = '!'
    view.inputDOM.dispatchEvent(new Event('input'))

    expect(view.state.doc.text).toBe('hello!')
    expect(view.state.selection.main.head).toBe(6)
    expect(view.inputDOM.value).toBe('')
  })

  it('replaces selected text from the input proxy through a transaction', () => {
    const parent = document.createElement('main')
    const view = new EditorView({
      parent,
      state: createState('hello', Selection.range(1, 4)),
    })

    view.inputDOM.value = 'i'
    view.inputDOM.dispatchEvent(new Event('input'))

    expect(view.state.doc.text).toBe('hio')
    expect(view.state.selection.main.head).toBe(2)
  })

  it('inserts printable keydown text without native textarea input', () => {
    const parent = document.createElement('main')
    const view = new EditorView({
      parent,
      state: createState('hello', Selection.cursor(5)),
    })
    const event = new KeyboardEvent('keydown', { key: '!', cancelable: true })

    view.inputDOM.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    expect(view.inputDOM.value).toBe('')
    expect(view.state.doc.text).toBe('hello!')
    expect(view.state.selection.main.head).toBe(6)
  })

  it('inserts spaces from keydown without native textarea input', () => {
    const parent = document.createElement('main')
    const view = new EditorView({
      parent,
      state: createState('hello', Selection.cursor(5)),
    })
    const event = new KeyboardEvent('keydown', { key: ' ', cancelable: true })

    view.inputDOM.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    expect(view.inputDOM.value).toBe('')
    expect(view.state.doc.text).toBe('hello ')
    expect(view.state.selection.main.head).toBe(6)
  })

  it('pastes plain text through one undoable transaction', () => {
    const parent = document.createElement('main')
    const view = new EditorView({
      parent,
      state: createState('hello', Selection.cursor(5)),
    })
    const event = createPasteEvent({ 'text/plain': '\nworld' })

    view.inputDOM.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    expect(view.state.doc.text).toBe('hello\nworld')
    expect(view.state.selection.main.head).toBe(11)
    expect(view.markdownParse.invalidatedRange).toEqual({ from: 0, to: 5 })
    expect(view.state.undo().doc.text).toBe('hello')
  })

  it('converts html-only paste to markdown before dispatching', () => {
    const parent = document.createElement('main')
    const view = new EditorView({
      parent,
      state: createState('', Selection.cursor(0)),
    })
    const event = createPasteEvent({ 'text/html': '<h1>Answer</h1><ul><li>one</li></ul>' })

    view.inputDOM.dispatchEvent(event)

    expect(view.state.doc.text).toBe('# Answer\n\n- one')
    expect(view.state.history.canUndo).toBe(true)
  })

  it('pastes html tables and survives source/live mode switches', () => {
    const parent = document.createElement('main')
    const view = new EditorView({
      parent,
      state: createState('', Selection.cursor(0)),
      mode: 'live',
    })
    const event = createPasteEvent({
      'text/html':
        '<table><tr><th>Name</th><th>Status</th></tr><tr><td>paste</td><td>ok</td></tr></table>',
    })

    view.inputDOM.dispatchEvent(event)
    const pastedState = view.state
    const history = view.state.history
    const parseState = view.markdownParse

    view.setMode('source')
    view.setMode('live')

    expect(view.state).toBe(pastedState)
    expect(view.state.history).toBe(history)
    expect(view.markdownParse).toBe(parseState)
    expect(view.state.doc.text).toBe('| Name | Status |\n| --- | --- |\n| paste | ok |')
    expect(view.state.undo().doc.text).toBe('')
  })

  it('imports pasted image files and inserts markdown image syntax', async () => {
    const parent = document.createElement('main')
    const assetProvider = new MemoryAssetProvider()
    const view = new EditorView({
      parent,
      assetProvider,
      state: createState('image: ', Selection.cursor(7)),
    })
    const event = createPasteEvent({}, [
      { name: 'Diagram Final.PNG', type: 'image/png' },
      { name: 'notes.txt', type: 'text/plain' },
    ])

    view.inputDOM.dispatchEvent(event)
    await flushAsyncPaste()

    expect(event.defaultPrevented).toBe(true)
    expect(assetProvider.assets).toHaveLength(1)
    expect(assetProvider.assets[0]?.relativePath).toBe('assets/diagram-final.png')
    expect(view.state.doc.text).toBe('image: ![diagram-final](assets/diagram-final.png)')
    expect(view.state.undo().doc.text).toBe('image: ')
  })

  it('pastes literal plain text inside fenced code blocks', () => {
    const parent = document.createElement('main')
    const text = '```py\n\n```'
    const view = new EditorView({
      parent,
      state: createState(text, Selection.cursor(6)),
      mode: 'live',
    })
    const event = createPasteEvent({
      'text/plain': 'def f():\n\n    return 1',
      'text/html': '<p><strong>def f</strong></p>',
    })

    view.inputDOM.dispatchEvent(event)

    expect(view.state.doc.text).toBe('```py\ndef f():\n\n    return 1\n```')
    expect(view.state.undo().doc.text).toBe(text)
  })

  it('does not commit document changes during composition updates', () => {
    const parent = document.createElement('main')
    const view = new EditorView({
      parent,
      state: createState('hello', Selection.cursor(5)),
    })

    view.inputDOM.dispatchEvent(new CompositionEvent('compositionstart'))
    view.inputDOM.value = 'n'
    view.inputDOM.dispatchEvent(new Event('input'))
    view.inputDOM.dispatchEvent(new CompositionEvent('compositionupdate', { data: 'ni' }))

    expect(view.state.doc.text).toBe('hello')
    expect(view.state.selection.main.head).toBe(5)
    expect(view.state.history.canUndo).toBe(false)
  })

  it('commits composition text as one history entry', () => {
    const parent = document.createElement('main')
    const view = new EditorView({
      parent,
      state: createState('hello', Selection.cursor(5)),
    })

    view.inputDOM.dispatchEvent(new CompositionEvent('compositionstart'))
    view.inputDOM.dispatchEvent(new CompositionEvent('compositionupdate', { data: 'ni' }))
    view.inputDOM.dispatchEvent(new CompositionEvent('compositionend', { data: '你' }))

    expect(view.state.doc.text).toBe('hello你')
    expect(view.state.selection.main.head).toBe(6)
    expect(view.state.undo().doc.text).toBe('hello')
  })

  it('deletes backward through the input proxy', () => {
    const parent = document.createElement('main')
    const view = new EditorView({
      parent,
      state: createState('hello', Selection.cursor(5)),
    })

    view.inputDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace' }))

    expect(view.state.doc.text).toBe('hell')
    expect(view.state.selection.main.head).toBe(4)
  })

  it('deletes the selected range on Backspace', () => {
    const parent = document.createElement('main')
    const view = new EditorView({
      parent,
      state: createState('hello', Selection.range(1, 4)),
    })

    view.inputDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace' }))

    expect(view.state.doc.text).toBe('ho')
    expect(view.state.selection.main.head).toBe(1)
  })

  it('inserts a newline on Enter through a transaction', () => {
    const parent = document.createElement('main')
    const view = new EditorView({
      parent,
      state: createState('hello', Selection.cursor(5)),
    })
    const event = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true })

    view.inputDOM.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    expect(view.state.doc.text).toBe('hello\n')
    expect(view.state.selection.main.head).toBe(6)
    expect(view.state.history.canUndo).toBe(true)
  })

  it('replaces the selected range with a newline on Enter', () => {
    const parent = document.createElement('main')
    const view = new EditorView({
      parent,
      state: createState('hello', Selection.range(1, 4)),
    })

    view.inputDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))

    expect(view.state.doc.text).toBe('h\no')
    expect(view.state.selection.main.head).toBe(2)
  })

  it('deletes forward through the input proxy', () => {
    const parent = document.createElement('main')
    const view = new EditorView({
      parent,
      state: createState('hello', Selection.cursor(1)),
    })

    view.inputDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete' }))

    expect(view.state.doc.text).toBe('hllo')
    expect(view.state.selection.main.head).toBe(1)
  })

  it('deletes the selected range on Delete', () => {
    const parent = document.createElement('main')
    const view = new EditorView({
      parent,
      state: createState('hello', Selection.range(1, 4)),
    })

    view.inputDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete' }))

    expect(view.state.doc.text).toBe('ho')
    expect(view.state.selection.main.head).toBe(1)
  })

  it('moves the cursor with horizontal arrows without entering history', () => {
    const parent = document.createElement('main')
    const view = new EditorView({
      parent,
      state: createState('hello', Selection.cursor(3)),
    })

    view.inputDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }))
    expect(view.state.selection.main.head).toBe(2)

    view.inputDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }))
    expect(view.state.selection.main.head).toBe(3)
    expect(view.state.history.canUndo).toBe(false)
  })

  it('extends selection with shift-arrow keys without entering history', () => {
    const parent = document.createElement('main')
    const view = new EditorView({
      parent,
      state: createState('hello', Selection.cursor(5)),
    })

    view.inputDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', shiftKey: true }))
    view.inputDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', shiftKey: true }))

    expect(view.state.selection.main.anchor).toBe(5)
    expect(view.state.selection.main.head).toBe(3)
    expect(view.selectionLayerDOM.querySelector('.milkup-selection')).toBeTruthy()
    expect(view.state.history.canUndo).toBe(false)
  })

  it('collapses a selected range with horizontal arrows', () => {
    const parent = document.createElement('main')
    const view = new EditorView({
      parent,
      state: createState('hello', Selection.range(1, 4)),
    })

    view.inputDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }))
    expect(view.state.selection.main.head).toBe(1)

    view.updateState(createState('hello', Selection.range(1, 4)))
    view.inputDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }))
    expect(view.state.selection.main.head).toBe(4)
  })

  it('moves the cursor vertically while preserving line offset when possible', () => {
    const parent = document.createElement('main')
    const view = new EditorView({
      parent,
      state: createState('abc\nde\nfghi', Selection.cursor(6)),
    })

    view.inputDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' }))
    expect(view.state.selection.main.head).toBe(2)

    view.inputDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }))
    expect(view.state.selection.main.head).toBe(6)
  })

  it('caps vertical arrow movement to the target line length', () => {
    const parent = document.createElement('main')
    const view = new EditorView({
      parent,
      state: createState('abc\nde', Selection.cursor(3)),
    })

    view.inputDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }))

    expect(view.state.selection.main.head).toBe(6)
  })

  it('places the cursor by clicking a line wrapper', () => {
    const parent = document.createElement('main')
    document.body.append(parent)
    const view = new EditorView({
      parent,
      state: createState('hello\nworld', Selection.cursor(0)),
    })
    const secondLine = view.contentDOM.querySelectorAll<HTMLElement>('.milkup-line')[1]
    const textNode = firstTextNode(secondLine)
    const restoreCaretRange = withCaretRangeFromPoint(textNode, 3)

    try {
      secondLine?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    } finally {
      restoreCaretRange()
    }

    expect(view.state.selection.main.head).toBe(9)
    expect(view.state.history.canUndo).toBe(false)
    expect(document.activeElement).toBe(view.inputDOM)
  })

  it('does not guess a source cursor position without browser hit-testing', () => {
    const parent = document.createElement('main')
    document.body.append(parent)
    const view = new EditorView({
      parent,
      state: createState('hello\nworld', Selection.cursor(0)),
    })
    const secondLine = view.contentDOM.querySelectorAll<HTMLElement>('.milkup-line')[1]

    if (!secondLine) {
      throw new Error('Second editor line was not rendered')
    }

    secondLine.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 124 }))

    expect(view.state.selection.main.head).toBe(0)
    expect(view.state.history.canUndo).toBe(false)
  })

  it('uses browser caret hit-testing for precise click placement when available', () => {
    const parent = document.createElement('main')
    document.body.append(parent)
    const view = new EditorView({
      parent,
      state: createState('abcdef', Selection.cursor(0)),
    })
    const line = view.contentDOM.querySelector<HTMLElement>('.milkup-line')
    const text = line?.firstChild

    if (!line || !text) {
      throw new Error('Editor line text was not rendered')
    }

    const restoreCaretRange = withCaretRangeFromPoint(text, 5)

    try {
      line.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 1, clientY: 1 }))
    } finally {
      restoreCaretRange()
    }

    expect(view.state.selection.main.head).toBe(5)
  })

  it('aligns the cursor to the measured wrapped visual row', () => {
    const parent = document.createElement('main')
    const view = new EditorView({
      parent,
      state: createState('wrapped line text', Selection.cursor(8)),
      mode: 'live',
    })
    const line = view.contentDOM.querySelector<HTMLElement>('.milkup-line')

    if (!line) {
      throw new Error('Expected rendered line')
    }

    const previousGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect
    HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
      if (
        this.classList.contains('milkup-line') ||
        this.classList.contains('milkup-cursor-layer')
      ) {
        return {
          left: 20,
          right: 140,
          top: 10,
          bottom: 52,
          width: 120,
          height: 42,
          x: 20,
          y: 10,
          toJSON: () => ({}),
        } as DOMRect
      }

      return previousGetBoundingClientRect.call(this)
    }
    view.cursorLayerDOM.getBoundingClientRect = () =>
      ({
        left: 20,
        right: 140,
        top: 10,
        bottom: 52,
        width: 120,
        height: 42,
        x: 20,
        y: 10,
        toJSON: () => ({}),
      }) as DOMRect

    const previousCreateRange = document.createRange.bind(document)
    document.createRange = () => {
      const range = previousCreateRange()
      range.getBoundingClientRect = () =>
        ({
          left: 84,
          right: 84,
          top: 31,
          bottom: 52,
          width: 0,
          height: 21,
          x: 84,
          y: 31,
          toJSON: () => ({}),
        }) as DOMRect
      return range
    }

    try {
      view.updateState(
        new EditorState({
          doc: view.state.doc,
          selection: Selection.cursor(9),
          history: view.state.history,
        }),
      )
    } finally {
      document.createRange = previousCreateRange
      HTMLElement.prototype.getBoundingClientRect = previousGetBoundingClientRect
    }

    const nextCursor = view.cursorLayerDOM.querySelector<HTMLElement>('.milkup-cursor')

    expect(nextCursor?.style.top).toBe('21px')
    expect(nextCursor?.style.height).toBe('21px')
  })

  it('keeps the hidden input proxy aligned with the cursor overlay', () => {
    const parent = document.createElement('main')
    const view = new EditorView({
      parent,
      state: createState('hello\nworld', Selection.cursor(8)),
    })

    expect(view.inputDOM.style.left).toBe('42px')
    expect(view.inputDOM.style.top).toBe('44px')
    expect(view.inputDOM.style.height).toBe('20px')
  })

  it('maps live clicks through hidden heading markers', () => {
    const parent = document.createElement('main')
    document.body.append(parent)
    const view = new EditorView({
      parent,
      state: createState('# Title\n\nbody', Selection.cursor(13)),
      mode: 'live',
    })
    const heading = view.contentDOM.querySelector<HTMLElement>('.milkup-block-heading')

    if (!heading) {
      throw new Error('Heading line was not rendered')
    }

    const content = heading.querySelector<HTMLElement>('.milkup-heading-content')?.firstChild

    if (!content) {
      throw new Error('Heading content was not rendered')
    }

    const restoreCaretRange = withCaretRangeFromPoint(content, 0)
    heading.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        right: 120,
        bottom: 20,
        width: 120,
        height: 20,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect

    try {
      heading.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 0, clientY: 0 }))
    } finally {
      restoreCaretRange()
    }

    expect(view.state.selection.main.head).toBe(2)
  })

  it('does not guess a live cursor position without browser hit-testing', () => {
    const parent = document.createElement('main')
    document.body.append(parent)
    const view = new EditorView({
      parent,
      state: createState('[site](url) x', Selection.cursor(12)),
      mode: 'live',
    })
    const line = view.contentDOM.querySelector<HTMLElement>('.milkup-line')

    line?.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    expect(view.state.selection.main.head).toBe(12)
    expect(view.state.history.canUndo).toBe(false)
  })

  it('selects a range by dragging across line wrappers', () => {
    const parent = document.createElement('main')
    document.body.append(parent)
    const view = new EditorView({
      parent,
      state: createState('hello\nworld', Selection.cursor(0)),
    })
    const lines = view.contentDOM.querySelectorAll<HTMLElement>('.milkup-line')
    const firstLine = lines[0]
    const firstText = firstTextNode(firstLine)
    const secondLine = lines[1]
    const secondText = firstTextNode(secondLine)
    let restoreCaretRange = withCaretRangeFromPoint(firstText, 1)

    try {
      firstLine?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
      restoreCaretRange()
      restoreCaretRange = withCaretRangeFromPoint(secondText, 3)
      secondLine?.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, button: 0 }))
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }))
    } finally {
      restoreCaretRange()
    }

    expect(view.state.selection.main.anchor).toBe(1)
    expect(view.state.selection.main.head).toBe(9)
    expect(view.state.history.canUndo).toBe(false)
    expect(view.selectionLayerDOM.querySelector('.milkup-selection')).not.toBeNull()
  })

  it('maps live clicks through hidden inline markers from browser hit-testing', () => {
    const parent = document.createElement('main')
    document.body.append(parent)
    const view = new EditorView({
      parent,
      state: createState('aa **bold** zz', Selection.cursor(14)),
      mode: 'live',
    })
    const line = view.contentDOM.querySelector<HTMLElement>('.milkup-line')
    const boldText = line?.querySelector<HTMLElement>(
      '.milkup-inline-strong .milkup-inline-content',
    )?.firstChild

    if (!line || !boldText) {
      throw new Error('Expected live inline content')
    }

    const restoreCaretRange = withCaretRangeFromPoint(boldText, 4)

    try {
      line.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    } finally {
      restoreCaretRange()
    }

    expect(view.state.selection.main.head).toBe(9)
    expect(view.state.history.canUndo).toBe(false)
  })

  it('maps live clicks inside verification result lists without jumping across the document', () => {
    const text = [
      '# 手动验收状态 - 2026-07-06',
      '',
      '本文记录当前 Windows 本地自动化/手动证据。',
      '',
      '结果：',
      '',
      '- 通过：`Native Tauri WebDriver smoke passed`',
      '- 覆盖范围：通过 WebDriver 启动真实 debug Tauri app。',
    ].join('\n')
    const parent = document.createElement('main')
    document.body.append(parent)
    const view = new EditorView({
      parent,
      state: createState(text, Selection.cursor(0)),
      mode: 'live',
    })
    let resultLine = view.contentDOM.querySelector<HTMLElement>('.milkup-line[data-line="5"]')
    let firstListLine = view.contentDOM.querySelector<HTMLElement>('.milkup-line[data-line="7"]')
    const resultText = firstTextNode(resultLine)
    let listContent = firstListLine?.querySelector<HTMLElement>('.milkup-list-content')
    const listText = firstTextNode(listContent)
    let inlineCodeText = firstListLine?.querySelector<HTMLElement>(
      '.milkup-inline-inlineCode .milkup-inline-content',
    )?.firstChild

    if (!resultLine || !firstListLine || !inlineCodeText) {
      throw new Error('Expected verification result lines')
    }

    let restoreCaretRange = withCaretRangeFromPoint(resultText, 3)

    try {
      resultLine.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      expect(view.state.selection.main.head).toBe(text.indexOf('结果') + 3)

      restoreCaretRange()
      firstListLine = view.contentDOM.querySelector<HTMLElement>('.milkup-line[data-line="7"]')
      listContent = firstListLine?.querySelector<HTMLElement>('.milkup-list-content')
      const currentListText = firstTextNode(listContent)
      if (!firstListLine) {
        throw new Error('Expected rerendered verification list line')
      }
      restoreCaretRange = withCaretRangeFromPoint(currentListText, 3)
      firstListLine.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      expect(view.state.selection.main.head).toBe(text.indexOf('通过') + 3)

      restoreCaretRange()
      firstListLine = view.contentDOM.querySelector<HTMLElement>('.milkup-line[data-line="7"]')
      inlineCodeText = firstListLine?.querySelector<HTMLElement>(
        '.milkup-inline-inlineCode .milkup-inline-content',
      )?.firstChild
      if (!firstListLine || !inlineCodeText) {
        throw new Error('Expected rerendered verification list line')
      }
      restoreCaretRange = withCaretRangeFromPoint(inlineCodeText, 6)
      firstListLine.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      expect(view.state.selection.main.head).toBe(text.indexOf('Native') + 6)
    } finally {
      restoreCaretRange()
    }

    expect(view.state.history.canUndo).toBe(false)
  })

  it('shows inline syntax immediately after moving the live cursor into the node', () => {
    const parent = document.createElement('main')
    document.body.append(parent)
    const view = new EditorView({
      parent,
      state: createState('`coding-plan.md` later', Selection.cursor(21)),
      mode: 'live',
    })
    const line = view.contentDOM.querySelector<HTMLElement>('.milkup-line')
    const inlineCode = line?.querySelector<HTMLElement>('.milkup-inline-inlineCode')
    const codeText = inlineCode?.querySelector<HTMLElement>('.milkup-inline-content')?.firstChild

    if (!line || !inlineCode || !codeText) {
      throw new Error('Expected inline code content')
    }

    expect(
      Array.from(inlineCode.querySelectorAll<HTMLElement>('.milkup-inline-marker')).every((node) =>
        node.classList.contains('milkup-marker-hidden'),
      ),
    ).toBe(true)

    const restoreCaretRange = withCaretRangeFromPoint(codeText, 'coding'.length)

    try {
      line.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
    } finally {
      restoreCaretRange()
    }

    const rerenderedInlineCode = view.contentDOM.querySelector<HTMLElement>(
      '.milkup-inline-inlineCode',
    )
    const markers = Array.from(
      rerenderedInlineCode?.querySelectorAll<HTMLElement>('.milkup-inline-marker') ?? [],
    )

    expect(view.state.selection.main.head).toBe('`coding'.length)
    expect(rerenderedInlineCode?.dataset.syntaxVisible).toBe('true')
    expect(markers.some((node) => node.classList.contains('milkup-marker-hidden'))).toBe(false)
  })

  it('snaps live text clicks to the nearest caret boundary around punctuation', () => {
    const parent = document.createElement('main')
    document.body.append(parent)
    const previousCreateRange = document.createRange.bind(document)
    const view = new EditorView({
      parent,
      state: createState('`coding-plan.md` later', Selection.cursor(21)),
      mode: 'live',
    })
    const line = view.contentDOM.querySelector<HTMLElement>('.milkup-line')
    const codeText = line?.querySelector<HTMLElement>(
      '.milkup-inline-inlineCode .milkup-inline-content',
    )?.firstChild

    if (!line || !codeText) {
      throw new Error('Expected inline code content')
    }

    const restoreCaretRange = withCaretRangeFromPoint(codeText, 'coding-'.length)

    document.createRange = () => {
      const range = previousCreateRange()
      const originalSetStart = range.setStart.bind(range)
      let rangeOffset = 0
      range.setStart = (node, offset) => {
        rangeOffset = offset
        originalSetStart(node, offset)
      }
      range.getBoundingClientRect = () =>
        rangeOffset === 'coding'.length ? rect(60) : rect(rangeOffset * 10)
      return range
    }

    try {
      line.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 61 }))
    } finally {
      restoreCaretRange()
      document.createRange = previousCreateRange
    }

    expect(view.state.selection.main.head).toBe('`coding'.length)
  })

  it('keeps the mousedown caret position when mouseup and click hit a rerendered live line', () => {
    const text =
      '- 覆盖范围：通过 WebDriver 启动真实 debug Tauri app，覆盖 native open/save/save-as test path、reload、reveal guard、真实 filesystem watcher-backed dirty/conflict regression checks。'
    const parent = document.createElement('main')
    document.body.append(parent)
    const view = new EditorView({
      parent,
      state: createState(text, Selection.cursor(0)),
      mode: 'live',
    })
    const line = view.contentDOM.querySelector<HTMLElement>('.milkup-line')
    const listContent = line?.querySelector<HTMLElement>('.milkup-list-content')
    const lineText = firstTextNode(listContent)
    const listContentFrom = Number(listContent?.dataset.from)
    let restoreCaretRange = withCaretRangeFromPoint(
      lineText,
      text.indexOf('WebDriver') - listContentFrom,
    )

    if (!line || !Number.isInteger(listContentFrom)) {
      throw new Error('Expected list line')
    }

    try {
      line.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
      expect(view.state.selection.main.head).toBe(text.indexOf('WebDriver'))

      restoreCaretRange()
      restoreCaretRange = withCaretRangeFromPoint(
        lineText,
        text.indexOf('watcher-backed') - listContentFrom,
      )
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }))
      line.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    } finally {
      restoreCaretRange()
    }

    expect(view.state.selection.main.head).toBe(text.indexOf('WebDriver'))
    expect(view.state.history.canUndo).toBe(false)
  })

  it('does not collapse a dragged selection on the following click', () => {
    const parent = document.createElement('main')
    document.body.append(parent)
    const view = new EditorView({
      parent,
      state: createState('hello\nworld', Selection.cursor(0)),
    })
    const lines = view.contentDOM.querySelectorAll<HTMLElement>('.milkup-line')
    const firstLine = lines[0]
    const firstText = firstTextNode(firstLine)
    const secondLineDuringDrag = lines[1]
    const secondText = firstTextNode(secondLineDuringDrag)
    let restoreCaretRange = withCaretRangeFromPoint(firstText, 1)

    try {
      firstLine?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
      restoreCaretRange()
      restoreCaretRange = withCaretRangeFromPoint(secondText, 3)
      secondLineDuringDrag?.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, button: 0 }))
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }))
      secondLineDuringDrag?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    } finally {
      restoreCaretRange()
    }

    expect(view.state.selection.main.anchor).toBe(1)
    expect(view.state.selection.main.head).toBe(9)
  })

  it('maps positions and coordinates through the view smoke geometry', () => {
    const parent = document.createElement('main')
    const view = new EditorView({
      parent,
      state: createState('hello\nworld', Selection.cursor(0)),
    })

    expect(view.positionToRect(8, { charWidth: 10, lineHeight: 24 })).toMatchObject({
      left: 20,
      top: 24,
      height: 24,
    })
    expect(view.coordinateToPosition({ x: 24, y: 30 }, { charWidth: 10, lineHeight: 24 })).toBe(8)
  })

  it('maps live positions and coordinates through hidden marker projections', () => {
    const parent = document.createElement('main')
    const view = new EditorView({
      parent,
      state: createState('**bold** x', Selection.cursor(9)),
      mode: 'live',
    })

    expect(view.positionToRect(8, { charWidth: 10, lineHeight: 24 })).toMatchObject({
      left: 40,
      top: 0,
      height: 24,
    })
    expect(view.coordinateToPosition({ x: 0, y: 0 }, { charWidth: 10, lineHeight: 24 })).toBe(2)
    expect(view.coordinateToPosition({ x: 40, y: 0 }, { charWidth: 10, lineHeight: 24 })).toBe(8)
  })

  it('renders live cursor overlays at projected visual offsets', () => {
    const parent = document.createElement('main')
    const view = new EditorView({
      parent,
      state: createState('**bold** x', Selection.cursor(9)),
      mode: 'live',
    })
    const cursor = view.cursorLayerDOM.querySelector<HTMLElement>('.milkup-cursor')

    expect(cursor?.dataset.position).toBe('9')
    expect(cursor?.dataset.offset).toBe('5')
    expect(cursor?.style.left).toBe('40px')
  })

  it('ensures the cursor is visible by updating scrollTop', () => {
    const parent = document.createElement('main')
    const text = Array.from({ length: 20 }, (_, index) => `line ${index + 1}`).join('\n')
    const view = new EditorView({
      parent,
      state: createState(text, Selection.cursor(text.length)),
    })

    expect(view.ensureCursorVisible({ viewportHeight: 40, scrollPadding: 0 })).toBeGreaterThan(0)
    expect(view.dom.scrollTop).toBeGreaterThan(0)
  })

  it('keeps the cursor visible after selection-changing updates', () => {
    const parent = document.createElement('main')
    const text = Array.from({ length: 20 }, (_, index) => `line ${index + 1}`).join('\n')
    const view = new EditorView({
      parent,
      state: createState(text, Selection.cursor(0)),
    })

    view.updateState(createState(text, Selection.cursor(text.length)))

    expect(view.dom.scrollTop).toBeGreaterThan(0)
  })

  it('does not scroll the editor after pointer selection updates', () => {
    const parent = document.createElement('main')
    const text = Array.from({ length: 20 }, (_, index) => `line ${index + 1}`).join('\n')
    const view = new EditorView({
      parent,
      state: createState(text, Selection.cursor(0)),
    })
    view.dom.scrollTop = 120
    const next = createState(text, Selection.cursor(text.length))

    view.updateState(next, [
      {
        selection: next.selection,
        origin: { type: 'command', id: 'view.pointer.dragSelection.start' },
        addToHistory: false,
      },
    ])

    expect(view.dom.scrollTop).toBe(120)
  })

  it('keeps the cursor visible inside a code block-like region', () => {
    const parent = document.createElement('main')
    const text = [
      '# doc',
      '',
      '```ts',
      ...Array.from({ length: 16 }, (_, index) => `const value${index} = ${index}`),
      '```',
    ].join('\n')
    const codePosition = text.indexOf('const value15')
    const view = new EditorView({
      parent,
      state: createState(text, Selection.cursor(0)),
    })

    view.updateState(createState(text, Selection.cursor(codePosition)))

    expect(view.dom.scrollTop).toBeGreaterThan(0)
  })

  it('does not force cursor scrolling when selection is unchanged', () => {
    const parent = document.createElement('main')
    const view = new EditorView({
      parent,
      state: createState('hello', Selection.cursor(0)),
    })
    view.dom.scrollTop = 80

    view.updateState(createState('hello\nworld', Selection.cursor(0)))

    expect(view.dom.scrollTop).toBe(80)
  })

  it('keeps scroll position stable when typing at a visible measured cursor', () => {
    const parent = document.createElement('main')
    const text = Array.from({ length: 80 }, (_, index) => `line ${index + 1}`).join('\n')
    const previousCreateRange = document.createRange.bind(document)
    const previousGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect
    const view = new EditorView({
      parent,
      state: createState(text, Selection.cursor(text.length)),
    })
    view.dom.scrollTop = 700

    HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
      if (this.classList.contains('milkup-editor')) {
        return {
          left: 0,
          right: 600,
          top: 100,
          bottom: 300,
          width: 600,
          height: 200,
          x: 0,
          y: 100,
          toJSON: () => ({}),
        } as DOMRect
      }

      if (this.classList.contains('milkup-cursor-layer')) {
        return {
          left: 0,
          right: 600,
          top: 800,
          bottom: 1000,
          width: 600,
          height: 200,
          x: 0,
          y: 800,
          toJSON: () => ({}),
        } as DOMRect
      }

      if (this.classList.contains('milkup-line')) {
        return {
          left: 24,
          right: 400,
          top: 180,
          bottom: 201,
          width: 376,
          height: 21,
          x: 24,
          y: 180,
          toJSON: () => ({}),
        } as DOMRect
      }

      return previousGetBoundingClientRect.call(this)
    }

    document.createRange = () => {
      const range = previousCreateRange()
      range.getBoundingClientRect = () =>
        ({
          left: 88,
          right: 88,
          top: 180,
          bottom: 201,
          width: 0,
          height: 21,
          x: 88,
          y: 180,
          toJSON: () => ({}),
        }) as DOMRect
      return range
    }

    try {
      view.inputDOM.value = '1'
      view.inputDOM.dispatchEvent(new Event('input'))
    } finally {
      document.createRange = previousCreateRange
      HTMLElement.prototype.getBoundingClientRect = previousGetBoundingClientRect
    }

    expect(view.dom.scrollTop).toBe(700)
  })

  it('allows external dispatch to own state updates', () => {
    const parent = document.createElement('main')
    const transactions: unknown[] = []
    const view = new EditorView({
      parent,
      state: createState('hello', Selection.cursor(5)),
      dispatch: (transaction) => {
        transactions.push(transaction)
      },
    })

    view.inputDOM.value = '!'
    view.inputDOM.dispatchEvent(new Event('input'))

    expect(transactions).toHaveLength(1)
    expect(view.state.doc.text).toBe('hello')
  })

  it('updates view mode without changing document state', () => {
    const parent = document.createElement('main')
    const state = createState('hello')
    const view = new EditorView({ parent, state })

    view.setMode('live')

    expect(view.viewMode).toBe('live')
    expect(view.dom.dataset.mode).toBe('live')
    expect(view.state).toBe(state)
  })

  it('rerenders live mode with markdown decorations without changing source text', () => {
    const parent = document.createElement('main')
    const state = createState('# **Title**\n\nThis is *em* and `code`.')
    const view = new EditorView({ parent, state })

    view.setMode('live')

    const heading = view.contentDOM.querySelector<HTMLElement>('.milkup-line')
    expect(view.viewMode).toBe('live')
    expect(view.state.doc.text).toBe('# **Title**\n\nThis is *em* and `code`.')
    expect(heading?.classList.contains('milkup-block-heading')).toBe(true)
    expect(view.contentDOM.querySelector('.milkup-inline-strong')?.textContent).toBe('**Title**')
    expect(view.contentDOM.querySelector('.milkup-inline-emphasis')?.textContent).toBe('*em*')
    expect(view.contentDOM.querySelector('.milkup-inline-inlineCode')?.textContent).toBe('`code`')
  })

  it('renders live mode as a markdown projection', () => {
    const parent = document.createElement('main')
    const view = new EditorView({
      parent,
      state: createState('# Title'),
      mode: 'live',
    })

    const line = view.contentDOM.querySelector<HTMLElement>('.milkup-line')
    expect(view.dom.dataset.mode).toBe('live')
    expect(line?.classList.contains('milkup-line-live')).toBe(true)
    expect(line?.classList.contains('milkup-block-heading')).toBe(true)
  })

  it('assigns heading level classes in live mode', () => {
    const parent = document.createElement('main')
    const view = new EditorView({
      parent,
      state: createState('# One\n## Two\n### Three', Selection.cursor(0)),
      mode: 'live',
    })
    const lines = Array.from(view.contentDOM.querySelectorAll<HTMLElement>('.milkup-line'))

    expect(lines[0]?.classList.contains('milkup-heading-level-1')).toBe(true)
    expect(lines[1]?.classList.contains('milkup-heading-level-2')).toBe(true)
    expect(lines[2]?.classList.contains('milkup-heading-level-3')).toBe(true)
  })

  it('keeps blockquote syntax hidden when the cursor is inside the quote', () => {
    const parent = document.createElement('main')
    const view = new EditorView({
      parent,
      state: createState('> quoted', Selection.cursor(3)),
      mode: 'live',
    })
    const marker = view.contentDOM.querySelector<HTMLElement>('.milkup-blockquote-marker')

    expect(marker?.textContent).toBe('> ')
    expect(marker?.classList.contains('milkup-marker-hidden')).toBe(true)
  })

  it('keeps table syntax hidden when the cursor is inside the table', () => {
    const parent = document.createElement('main')
    const text = '| Name | Status |\n| --- | --- |\n| Milk | ok |'
    const view = new EditorView({
      parent,
      state: createState(text, Selection.cursor(text.indexOf('Name'))),
      mode: 'live',
    })
    const markers = Array.from(view.contentDOM.querySelectorAll<HTMLElement>('.milkup-table-marker'))
    const cells = Array.from(view.contentDOM.querySelectorAll<HTMLElement>('.milkup-table-cell'))

    expect(markers.length).toBeGreaterThan(0)
    expect(markers.every((marker) => marker.classList.contains('milkup-marker-hidden'))).toBe(true)
    expect(cells.map((cell) => cell.textContent)).toEqual(['Name', 'Status', 'Milk', 'ok'])
  })

  it('keeps read-only state locked while allowing selection changes', () => {
    const parent = document.createElement('main')
    const view = new EditorView({
      parent,
      state: createState('read only', Selection.cursor(0)),
      mode: 'live',
      editable: false,
    })
    const line = view.contentDOM.querySelector<HTMLElement>('.milkup-line')
    const text = firstTextNode(line)
    const restoreCaretRange = withCaretRangeFromPoint(text, 4)

    try {
      line?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      view.inputDOM.value = ' blocked'
      view.inputDOM.dispatchEvent(new Event('input'))
      view.inputDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }))
    } finally {
      restoreCaretRange()
    }

    expect(view.state.selection.main.head).toBe(4)
    expect(view.state.doc.text).toBe('read only')

    view.setEditable(true)
    view.inputDOM.value = '!'
    view.inputDOM.dispatchEvent(new Event('input'))

    expect(view.state.doc.text).toBe('read! only')
  })

  it('does not duplicate a live heading onto the following text line', () => {
    const parent = document.createElement('main')
    const view = new EditorView({
      parent,
      state: createState('# Title\nbody', Selection.cursor(12)),
      mode: 'live',
    })
    const lines = Array.from(view.contentDOM.querySelectorAll<HTMLElement>('.milkup-line'))
    const headingMarker = lines[0]?.querySelector<HTMLElement>('.milkup-heading-marker')
    const headingContent = lines[0]?.querySelector<HTMLElement>('.milkup-heading-content')

    expect(headingMarker?.classList.contains('milkup-marker-hidden')).toBe(true)
    expect(headingContent?.textContent).toBe('Title')
    expect(lines[1]?.textContent).toBe('body')
    expect(lines[1]?.classList.contains('milkup-block-heading')).toBe(false)
  })

  it('does not render an extra heading line when a heading is followed by a blank line', () => {
    const parent = document.createElement('main')
    const view = new EditorView({
      parent,
      state: createState('# Title\n\nbody', Selection.cursor(13)),
      mode: 'live',
    })
    const lines = Array.from(view.contentDOM.querySelectorAll<HTMLElement>('.milkup-line'))
    const headingMarker = lines[0]?.querySelector<HTMLElement>('.milkup-heading-marker')
    const headingContent = lines[0]?.querySelector<HTMLElement>('.milkup-heading-content')

    expect(lines).toHaveLength(3)
    expect(lines[0]?.textContent).toBe('# Title')
    expect(headingMarker?.textContent).toBe('# ')
    expect(headingContent?.textContent).toBe('Title')
    expect(lines[1]?.textContent).toBe('\u200b')
    expect(lines[1]?.classList.contains('milkup-block-heading')).toBe(false)
  })

  it('switches modes without changing document history, selection, or scroll position', () => {
    const parent = document.createElement('main')
    const initial = createState('hello', Selection.cursor(2))
    const state = initial.applyTransaction({
      changes: ChangeSet.insert(5, ' world'),
      selection: Selection.cursor(11),
      origin: { type: 'input.type' },
    })
    const view = new EditorView({ parent, state })
    const history = view.state.history
    view.dom.scrollTop = 40

    view.setMode('live')
    view.setMode('source')

    expect(view.state.doc.text).toBe('hello world')
    expect(view.state.history).toBe(history)
    expect(view.state.selection.main.head).toBe(11)
    expect(view.dom.scrollTop).toBe(40)
    expect(view.contentDOM.querySelector('.milkup-inline')).toBeNull()
  })

  it('switches source and live mode with the cursor near link markers', () => {
    const parent = document.createElement('main')
    const state = createState('[site](url) x', Selection.cursor(11))
    const view = new EditorView({ parent, state })

    view.setMode('live')
    view.setMode('source')
    view.setMode('live')

    expect(view.state).toBe(state)
    expect(view.state.doc.text).toBe('[site](url) x')
    expect(view.state.selection.main.head).toBe(11)
    expect(view.contentDOM.querySelector('.milkup-inline-link')).not.toBeNull()
  })

  it('switches source and live mode in the middle of a document without moving anchors', () => {
    const parent = document.createElement('main')
    const text = Array.from({ length: 12 }, (_, index) => `line ${index + 1}`).join('\n')
    const cursor = text.indexOf('line 7') + 4
    const state = createState(text, Selection.cursor(cursor))
    const view = new EditorView({ parent, state })
    view.dom.scrollTop = 80

    view.setMode('live')
    view.setMode('source')

    const cursorDOM = view.cursorLayerDOM.querySelector<HTMLElement>('.milkup-cursor')
    expect(view.state).toBe(state)
    expect(view.state.selection.main.anchor).toBe(cursor)
    expect(view.state.selection.main.head).toBe(cursor)
    expect(view.dom.scrollTop).toBe(80)
    expect(cursorDOM?.dataset.position).toBe(String(cursor))
  })

  it('keeps the cursor visible after a mode switch when the viewport is measurable', () => {
    const parent = document.createElement('main')
    const text = Array.from({ length: 20 }, (_, index) => `line ${index + 1}`).join('\n')
    const view = new EditorView({
      parent,
      state: createState(text, Selection.cursor(text.length)),
    })
    Object.defineProperty(view.dom, 'clientHeight', {
      configurable: true,
      value: 40,
    })
    view.dom.scrollTop = 0

    view.setMode('live')

    expect(view.dom.scrollTop).toBeGreaterThan(0)
  })

  it('can toggle source and live mode repeatedly without changing text or history', () => {
    const parent = document.createElement('main')
    const initial = createState('**bold**', Selection.cursor(2))
    const state = initial.applyTransaction({
      changes: ChangeSet.insert(8, ' text'),
      selection: Selection.cursor(13),
      origin: { type: 'input.type' },
    })
    const view = new EditorView({ parent, state })
    const history = view.state.history

    for (let index = 0; index < 100; index += 1) {
      view.setMode(index % 2 === 0 ? 'live' : 'source')
    }

    expect(view.state.doc.text).toBe('**bold** text')
    expect(view.state.history).toBe(history)
  })

  it('keeps incomplete inline syntax editable in live mode', () => {
    const parent = document.createElement('main')
    const view = new EditorView({
      parent,
      state: createState('x *unfinished', Selection.cursor(13)),
      mode: 'live',
    })

    view.inputDOM.value = '!'
    view.inputDOM.dispatchEvent(new Event('input'))

    expect(view.state.doc.text).toBe('x *unfinished!')
    expect(view.state.selection.main.head).toBe(14)
    expect(view.state.undo().doc.text).toBe('x *unfinished')
  })

  it('rerenders only selection-affected live lines when the cursor moves', () => {
    const parent = document.createElement('main')
    const state = createState('**one**\nplain\n`two`', Selection.cursor(2))
    const view = new EditorView({ parent, state, mode: 'live' })
    const initialLines = Array.from(view.contentDOM.querySelectorAll<HTMLElement>('.milkup-line'))

    view.updateState(createState(state.doc.text, Selection.cursor(state.doc.text.indexOf('two'))))

    const nextLines = Array.from(view.contentDOM.querySelectorAll<HTMLElement>('.milkup-line'))

    expect(nextLines).toHaveLength(initialLines.length)
    expect(nextLines[0]).not.toBe(initialLines[0])
    expect(nextLines[1]).toBe(initialLines[1])
    expect(nextLines[2]).not.toBe(initialLines[2])
  })

  it('rerenders only the changed live line for single-line edits', () => {
    const parent = document.createElement('main')
    const state = createState('**one**\nplain\n`two`', Selection.cursor(11))
    const view = new EditorView({ parent, state, mode: 'live' })
    const initialLines = Array.from(view.contentDOM.querySelectorAll<HTMLElement>('.milkup-line'))
    const nextState = state.applyTransaction({
      changes: ChangeSet.insert(11, '!'),
      selection: Selection.cursor(12),
      origin: { type: 'input.type' },
    })

    view.updateState(nextState, [
      {
        changes: ChangeSet.insert(11, '!'),
        selection: Selection.cursor(12),
        origin: { type: 'input.type' },
      },
    ])

    const nextLines = Array.from(view.contentDOM.querySelectorAll<HTMLElement>('.milkup-line'))

    expect(nextLines).toHaveLength(initialLines.length)
    expect(nextLines[0]).toBe(initialLines[0])
    expect(nextLines[1]).not.toBe(initialLines[1])
    expect(nextLines[2]).toBe(initialLines[2])
    expect(view.state).toBe(nextState)
  })

  it('keeps docs/coding-plan.md live interactions bounded to affected lines', () => {
    const parent = document.createElement('main')
    const state = createState(readCodingPlanFixture(), Selection.cursor(0))
    const view = new EditorView({ parent, state, mode: 'live' })
    const initialLines = Array.from(view.contentDOM.querySelectorAll<HTMLElement>('.milkup-line'))
    const middleLine = state.doc.line(Math.floor(state.doc.lineCount / 2))
    const tailLine = state.doc.line(Math.max(1, state.doc.lineCount - 4))

    view.updateState(createState(state.doc.text, Selection.cursor(middleLine.from)))
    const middleLines = Array.from(view.contentDOM.querySelectorAll<HTMLElement>('.milkup-line'))
    const middleChangedIndexes = middleLines.flatMap((line, index) =>
      line === initialLines[index] ? [] : [index],
    )

    expect(middleLines).toHaveLength(initialLines.length)
    expect(middleChangedIndexes.length).toBeLessThanOrEqual(2)
    expect(middleLines.some((line) => line.dataset.line === String(middleLine.number))).toBe(true)

    view.updateState(createState(state.doc.text, Selection.cursor(tailLine.from)))
    const tailLines = Array.from(view.contentDOM.querySelectorAll<HTMLElement>('.milkup-line'))
    const tailChangedIndexes = tailLines.flatMap((line, index) =>
      line === middleLines[index] ? [] : [index],
    )

    expect(tailLines).toHaveLength(initialLines.length)
    expect(tailChangedIndexes.length).toBeLessThanOrEqual(2)
    expect(tailLines.some((line) => line.dataset.line === String(tailLine.number))).toBe(true)

    const typedState = view.state.applyTransaction({
      changes: ChangeSet.insert(tailLine.from, 'x'),
      selection: Selection.cursor(tailLine.from + 1),
      origin: { type: 'input.type' },
    })

    view.updateState(typedState, [
      {
        changes: ChangeSet.insert(tailLine.from, 'x'),
        selection: Selection.cursor(tailLine.from + 1),
        origin: { type: 'input.type' },
      },
    ])

    const typedLines = Array.from(view.contentDOM.querySelectorAll<HTMLElement>('.milkup-line'))
    const typedChangedIndexes = typedLines.flatMap((line, index) =>
      line === tailLines[index] ? [] : [index],
    )

    expect(typedLines).toHaveLength(initialLines.length)
    expect(typedChangedIndexes.length).toBe(1)
    const typedChangedIndex = typedChangedIndexes[0]

    if (typedChangedIndex === undefined) {
      throw new Error('Expected the typed line to be rerendered')
    }

    expect(typedLines[typedChangedIndex]?.dataset.line).toBe(String(tailLine.number))
  }, 30_000)

  it('destroys the root DOM node', () => {
    const parent = document.createElement('main')
    const view = new EditorView({ parent, state: createState('hello') })

    expect(parent.children).toHaveLength(1)
    view.destroy()
    expect(parent.children).toHaveLength(0)
  })
})

describe('renderPlainTextLines', () => {
  it('can render without constructing an EditorView', () => {
    const lines = renderPlainTextLines(document, createState('x\ny'))

    expect(lines.map((line) => line.textContent)).toEqual(['x', 'y'])
  })

  it('can render a bounded source line window without constructing an EditorView', () => {
    const lines = renderPlainTextLineWindow(document, createState(createLineFixture(20)), 5, 8)

    expect(lines.map((line) => line.dataset.line)).toEqual(['5', '6', '7', '8'])
    expect(lines.map((line) => line.textContent)).toEqual(['line 5', 'line 6', 'line 7', 'line 8'])
  })

  it('can render markdown decorations without constructing an EditorView', () => {
    const lines = renderMarkdownLines(
      document,
      createState('# Title\n\n`code`\n\n> quote\n\n- item\n\n```ts\nconst x = 1\n```'),
    )

    expect(lines[0]?.classList.contains('milkup-block-heading')).toBe(true)
    expect(lines[2]?.querySelector('.milkup-inline-inlineCode')?.textContent).toBe('`code`')
    expect(lines[4]?.classList.contains('milkup-block-blockquote')).toBe(true)
    expect(lines[6]?.classList.contains('milkup-block-list')).toBe(true)
    expect(lines[8]?.classList.contains('milkup-block-code')).toBe(true)
    expect(lines[9]?.querySelector('.milkup-inline')).toBeNull()
  })

  it('renders list markers separately from inline-decorated list content', () => {
    const lines = renderMarkdownLines(document, createState('- **one**\n\n3. `two`\n'))
    const unorderedMarker = lines[0]?.querySelector<HTMLElement>('.milkup-list-marker')
    const orderedMarker = lines[2]?.querySelector<HTMLElement>('.milkup-list-marker')
    const unorderedContent = lines[0]?.querySelector<HTMLElement>('.milkup-list-content')
    const orderedContent = lines[2]?.querySelector<HTMLElement>('.milkup-list-content')

    expect(unorderedMarker?.textContent).toBe('•')
    expect(orderedMarker?.textContent).toBe('3.')
    expect(unorderedMarker?.dataset.from).toBe('0')
    expect(orderedMarker?.dataset.from).toBe('11')
    expect(unorderedContent?.querySelector('.milkup-inline-strong')?.textContent).toBe('**one**')
    expect(orderedContent?.querySelector('.milkup-inline-inlineCode')?.textContent).toBe('`two`')
  })

  it('renders every item in a contiguous list', () => {
    const lines = renderMarkdownLines(document, createState('- one\n- two\n- three\n'))

    expect(lines.slice(0, 3).every((line) => line.classList.contains('milkup-block-list'))).toBe(
      true,
    )
    expect(
      lines.slice(0, 3).map((line) => line.querySelector('.milkup-list-marker')?.textContent),
    ).toEqual(['•', '•', '•'])
  })

  it('hides heading markers when the cursor is outside the heading', () => {
    const lines = renderMarkdownLines(document, createState('# Title\n\nbody', Selection.cursor(9)))
    const marker = lines[0]?.querySelector<HTMLElement>('.milkup-heading-marker')
    const content = lines[0]?.querySelector<HTMLElement>('.milkup-heading-content')

    expect(marker?.textContent).toBe('# ')
    expect(marker?.classList.contains('milkup-marker-hidden')).toBe(true)
    expect(content?.textContent).toBe('Title')
  })

  it('shows heading markers when the cursor is inside the heading', () => {
    const lines = renderMarkdownLines(document, createState('# Title\n\nbody', Selection.cursor(3)))
    const marker = lines[0]?.querySelector<HTMLElement>('.milkup-heading-marker')

    expect(marker?.classList.contains('milkup-marker-hidden')).toBe(false)
  })

  it('renders blockquote markers separately from quote content', () => {
    const lines = renderMarkdownLines(
      document,
      createState('> **quote**\n\nbody', Selection.cursor(14)),
    )
    const marker = lines[0]?.querySelector<HTMLElement>('.milkup-blockquote-marker')
    const content = lines[0]?.querySelector<HTMLElement>('.milkup-blockquote-content')

    expect(marker?.textContent).toBe('> ')
    expect(marker?.classList.contains('milkup-marker-hidden')).toBe(true)
    expect(content?.querySelector('.milkup-inline-strong')?.textContent).toBe('**quote**')
  })

  it('renders table rows as editable live cells', () => {
    const lines = renderMarkdownLines(
      document,
      createState('| Name | Status |\n| --- | --- |\n| milk | ok |\n', Selection.cursor(34)),
    )
    const headerCells = Array.from(
      lines[0]?.querySelectorAll<HTMLElement>('.milkup-table-cell') ?? [],
    )
    const delimiterMarker = lines[1]?.querySelector<HTMLElement>('.milkup-table-marker')
    const bodyCells = Array.from(
      lines[2]?.querySelectorAll<HTMLElement>('.milkup-table-cell') ?? [],
    )

    expect(lines[0]?.classList.contains('milkup-block-table')).toBe(true)
    expect(headerCells.map((cell) => cell.textContent)).toEqual(['Name', 'Status'])
    expect(delimiterMarker?.classList.contains('milkup-marker-hidden')).toBe(true)
    expect(bodyCells.map((cell) => cell.textContent)).toEqual(['milk', 'ok'])
  })

  it('can render link decorations without constructing an EditorView', () => {
    const lines = renderMarkdownLines(document, createState('[site](https://example.com)'))

    expect(lines[0]?.querySelector('.milkup-inline-link')?.textContent).toBe(
      '[site](https://example.com)',
    )
  })

  it('hides inline markers when the cursor is outside the syntax node', () => {
    const lines = renderMarkdownLines(document, createState('**bold** x', Selection.cursor(9)))
    const strong = lines[0]?.querySelector<HTMLElement>('.milkup-inline-strong')
    const markers = Array.from(strong?.querySelectorAll<HTMLElement>('.milkup-inline-marker') ?? [])

    expect(strong?.dataset.syntaxVisible).toBe('false')
    expect(markers).toHaveLength(2)
    expect(markers.every((marker) => marker.classList.contains('milkup-marker-hidden'))).toBe(true)
  })

  it('shows inline markers when the cursor is inside the syntax node', () => {
    const lines = renderMarkdownLines(document, createState('**bold** x', Selection.cursor(4)))
    const strong = lines[0]?.querySelector<HTMLElement>('.milkup-inline-strong')
    const markers = Array.from(strong?.querySelectorAll<HTMLElement>('.milkup-inline-marker') ?? [])

    expect(strong?.dataset.syntaxVisible).toBe('true')
    expect(markers.some((marker) => marker.classList.contains('milkup-marker-hidden'))).toBe(false)
  })

  it('shows inline markers when selection crosses the syntax node', () => {
    const lines = renderMarkdownLines(document, createState('**bold** x', Selection.range(0, 10)))
    const strong = lines[0]?.querySelector<HTMLElement>('.milkup-inline-strong')

    expect(strong?.dataset.syntaxVisible).toBe('true')
  })

  it('hides link syntax while keeping the label visible when cursor is outside', () => {
    const lines = renderMarkdownLines(document, createState('[site](url) x', Selection.cursor(12)))
    const link = lines[0]?.querySelector<HTMLElement>('.milkup-inline-link')
    const label = link?.querySelector<HTMLElement>('.milkup-inline-content')
    const hiddenSyntax = Array.from(
      link?.querySelectorAll<HTMLElement>('.milkup-marker-hidden') ?? [],
    )

    expect(link?.dataset.syntaxVisible).toBe('false')
    expect(label?.textContent).toBe('site')
    expect(hiddenSyntax.map((node) => node.textContent).join('')).toBe('[](' + 'url' + ')')
  })

  it('shows link syntax when the cursor is inside the link node', () => {
    const lines = renderMarkdownLines(document, createState('[site](url) x', Selection.cursor(2)))
    const link = lines[0]?.querySelector<HTMLElement>('.milkup-inline-link')
    const hiddenSyntax = link?.querySelector('.milkup-marker-hidden')

    expect(link?.dataset.syntaxVisible).toBe('true')
    expect(hiddenSyntax).toBeNull()
  })

  it('hides and shows inline code markers based on cursor position', () => {
    const outside = renderMarkdownLines(document, createState('`code` x', Selection.cursor(7)))
    const inside = renderMarkdownLines(document, createState('`code` x', Selection.cursor(2)))
    const outsideMarkers = Array.from(
      outside[0]?.querySelectorAll<HTMLElement>(
        '.milkup-inline-inlineCode .milkup-inline-marker',
      ) ?? [],
    )
    const insideHiddenMarker = inside[0]?.querySelector(
      '.milkup-inline-inlineCode .milkup-marker-hidden',
    )

    expect(
      outsideMarkers.every((marker) => marker.classList.contains('milkup-marker-hidden')),
    ).toBe(true)
    expect(insideHiddenMarker).toBeNull()
  })

  it('does not hide markers for incomplete inline syntax', () => {
    const lines = renderMarkdownLines(document, createState('x *unfinished', Selection.cursor(0)))
    const emphasis = lines[0]?.querySelector<HTMLElement>('.milkup-inline-emphasis')
    const marker = emphasis?.querySelector<HTMLElement>('.milkup-inline-marker')

    expect(emphasis?.dataset.status).toBe('incomplete')
    expect(emphasis?.dataset.syntaxVisible).toBe('true')
    expect(marker?.classList.contains('milkup-marker-hidden')).toBe(false)
  })
})

describe('position helpers', () => {
  it('maps a document position to line and offset', () => {
    const mapped = positionToLineOffset(createState('hello\nworld'), 8)

    expect(mapped.line.number).toBe(2)
    expect(mapped.offset).toBe(2)
  })

  it('maps a document position to a smoke rect', () => {
    const rect = positionToRect(createState('hello\nworld'), 8, {
      charWidth: 10,
      lineHeight: 24,
    })

    expect(rect).toEqual({
      left: 20,
      top: 24,
      right: 20,
      bottom: 48,
      width: 0,
      height: 24,
    })
  })

  it('maps a smoke coordinate to a document position', () => {
    const pos = coordinateToPosition(
      createState('hello\nworld'),
      { x: 24, y: 30 },
      {
        charWidth: 10,
        lineHeight: 24,
      },
    )

    expect(pos).toBe(8)
  })

  it('clamps smoke coordinates to the document line bounds', () => {
    expect(coordinateToPosition(createState('abc\nde'), { x: 999, y: 999 })).toBe(6)
    expect(coordinateToPosition(createState('abc\nde'), { x: -999, y: -999 })).toBe(0)
  })

  it('computes the scrollTop needed to reveal a position', () => {
    const state = createState('a\nb\nc', Selection.cursor(4))

    expect(
      scrollPositionIntoView({
        state,
        position: 4,
        currentScrollTop: 0,
        viewportHeight: 20,
        scrollPadding: 0,
      }),
    ).toBe(40)
    expect(
      scrollPositionIntoView({
        state,
        position: 4,
        currentScrollTop: 40,
        viewportHeight: 20,
        scrollPadding: 0,
      }),
    ).toBe(40)
  })

  it('computes a visible line window with top and bottom spacers', () => {
    expect(
      getVisibleLineWindow({
        lineCount: 100,
        scrollTop: 400,
        viewportHeight: 100,
        lineHeight: 20,
        overscanLines: 2,
      }),
    ).toEqual({
      fromLine: 19,
      toLine: 27,
      topSpacerHeight: 360,
      bottomSpacerHeight: 1460,
    })
  })

  it('can render cursor overlay without constructing an EditorView', () => {
    const cursors = renderCursorOverlay(document, createState('hello', Selection.cursor(3)))

    expect(cursors).toHaveLength(1)
    expect(cursors[0]?.dataset.position).toBe('3')
  })

  it('can render selection overlay without constructing an EditorView', () => {
    const selections = renderSelectionOverlay(document, createState('hello', Selection.range(1, 4)))

    expect(selections).toHaveLength(1)
    expect(selections[0]?.dataset.from).toBe('1')
    expect(selections[0]?.dataset.to).toBe('4')
  })

  it('can create an input proxy directly', () => {
    const input = createInputProxy(document)

    expect(input.className).toBe('milkup-input-proxy')
    expect(input.spellcheck).toBe(false)
    expect(input.value).toBe('')
  })
})

describe('line projection helpers', () => {
  it('builds collapsed visual segments for hidden emphasis markers', () => {
    const projection = buildLineProjection('**bold** x', Selection.cursor(9), 0, 10)

    expect(projection.visualLength).toBe(6)
    expect(projection.segments.map((segment) => [segment.kind, segment.hidden])).toEqual([
      ['marker', true],
      ['content', false],
      ['marker', true],
      ['text', false],
    ])
    expect(projection.segments.map((segment) => [segment.visualFrom, segment.visualTo])).toEqual([
      [0, 0],
      [0, 4],
      [4, 4],
      [4, 6],
    ])
  })

  it('maps source positions through hidden marker boundaries', () => {
    const projection = buildLineProjection('**bold** x', Selection.cursor(9), 0, 10)

    expect(sourcePositionToVisualOffset(projection, 0)).toBe(0)
    expect(sourcePositionToVisualOffset(projection, 2)).toBe(0)
    expect(sourcePositionToVisualOffset(projection, 4)).toBe(2)
    expect(sourcePositionToVisualOffset(projection, 8)).toBe(4)
    expect(sourcePositionToVisualOffset(projection, 10)).toBe(6)
  })

  it('maps visual offsets back to source positions around hidden markers', () => {
    const projection = buildLineProjection('**bold** x', Selection.cursor(9), 0, 10)

    expect(visualOffsetToSourcePosition(projection, 0)).toBe(2)
    expect(visualOffsetToSourcePosition(projection, 0, -1)).toBe(0)
    expect(visualOffsetToSourcePosition(projection, 2)).toBe(4)
    expect(visualOffsetToSourcePosition(projection, 4)).toBe(8)
    expect(visualOffsetToSourcePosition(projection, 4, -1)).toBe(6)
    expect(visualOffsetToSourcePosition(projection, 6)).toBe(10)
  })

  it('keeps syntax ranges visible in projection when cursor is inside the node', () => {
    const projection = buildLineProjection('**bold** x', Selection.cursor(4), 0, 10)

    expect(projection.visualLength).toBe(10)
    expect(projection.segments.some((segment) => segment.hidden)).toBe(false)
  })

  it('collapses link marker and destination syntax while preserving label mapping', () => {
    const projection = buildLineProjection('[site](url) x', Selection.cursor(12), 0, 13)

    expect(projection.visualLength).toBe(6)
    expect(sourcePositionToVisualOffset(projection, 1)).toBe(0)
    expect(sourcePositionToVisualOffset(projection, 5)).toBe(4)
    expect(sourcePositionToVisualOffset(projection, 11)).toBe(4)
    expect(visualOffsetToSourcePosition(projection, 0)).toBe(1)
    expect(visualOffsetToSourcePosition(projection, 4)).toBe(11)
  })
})
