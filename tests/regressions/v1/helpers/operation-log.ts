import { ChangeSet, EditorState, MemoryTextDocument, Selection } from '@milkup/core'
import type { Transaction } from '@milkup/core'
import { EditorView } from '@milkup/view-dom'
import type { ViewMode } from '@milkup/view-dom'

export type RegressionOperation =
  | {
      readonly type: 'dispatch'
      readonly origin: string
      readonly transaction: Transaction
      readonly beforeText: string
      readonly afterText: string
      readonly beforeSelection: SelectionSnapshot
      readonly afterSelection: SelectionSnapshot
      readonly undoDepth: number
    }
  | {
      readonly type: 'mode'
      readonly mode: ViewMode
      readonly text: string
      readonly selection: SelectionSnapshot
      readonly undoDepth: number
    }
  | {
      readonly type: 'paste'
      readonly strategy: 'plain' | 'html'
      readonly data: ClipboardDataFixture
      readonly beforeText: string
      readonly afterText: string
      readonly beforeSelection: SelectionSnapshot
      readonly afterSelection: SelectionSnapshot
      readonly undoDepth: number
    }
  | {
      readonly type: 'undo'
      readonly beforeText: string
      readonly afterText: string
      readonly beforeSelection: SelectionSnapshot
      readonly afterSelection: SelectionSnapshot
      readonly undoDepth: number
    }

export interface SelectionSnapshot {
  readonly anchor: number
  readonly head: number
}

export interface RegressionEditorHarness {
  readonly parent: HTMLElement
  readonly view: EditorView
  readonly log: readonly RegressionOperation[]
  dispatch(transaction: Transaction): void
  insertText(position: number, text: string, origin?: Transaction['origin']): void
  setMode(mode: ViewMode): void
  paste(data: ClipboardDataFixture): Promise<void>
  undo(): void
  destroy(): void
}

export interface ClipboardDataFixture {
  readonly plainText?: string
  readonly html?: string
}

export function createRegressionEditor(
  text: string,
  selection: Selection = Selection.cursor(text.length),
): RegressionEditorHarness {
  const parent = document.createElement('main')
  const operations: RegressionOperation[] = []
  let activePasteData: ClipboardDataFixture | undefined
  let state = new EditorState({
    doc: new MemoryTextDocument(text),
    selection,
  })
  const view = new EditorView({
    parent,
    state,
    dispatch: (transaction) => {
      applyTransaction(transaction, activePasteData ? undefined : operations)
    },
  })

  function applyTransaction(
    transaction: Transaction,
    targetLog: RegressionOperation[] | undefined,
  ): void {
    const beforeText = state.doc.text
    const beforeSelection = snapshotSelection(state.selection)
    state = state.applyTransaction(transaction)
    view.updateState(state, [transaction])

    targetLog?.push({
      type: 'dispatch',
      origin: transaction.origin?.type ?? 'unknown',
      transaction,
      beforeText,
      afterText: state.doc.text,
      beforeSelection,
      afterSelection: snapshotSelection(state.selection),
      undoDepth: state.history.undoStack.length,
    })
  }

  return {
    parent,
    view,
    get log() {
      return Object.freeze([...operations])
    },
    dispatch(transaction: Transaction): void {
      applyTransaction(transaction, operations)
    },
    insertText(position: number, insertedText: string, origin = { type: 'input.type' }): void {
      this.dispatch({
        changes: ChangeSet.insert(position, insertedText),
        selection: Selection.cursor(position + insertedText.length),
        origin,
        historyGroup: 'isolate',
      })
    },
    setMode(mode: ViewMode): void {
      view.setMode(mode)
      operations.push({
        type: 'mode',
        mode,
        text: state.doc.text,
        selection: snapshotSelection(state.selection),
        undoDepth: state.history.undoStack.length,
      })
    },
    async paste(data: ClipboardDataFixture): Promise<void> {
      const beforeText = state.doc.text
      const beforeSelection = snapshotSelection(state.selection)
      activePasteData = data
      view.inputDOM.dispatchEvent(createPasteEvent(data))
      await flushAsyncPaste()
      activePasteData = undefined
      operations.push({
        type: 'paste',
        strategy: data.html ? 'html' : 'plain',
        data,
        beforeText,
        afterText: state.doc.text,
        beforeSelection,
        afterSelection: snapshotSelection(state.selection),
        undoDepth: state.history.undoStack.length,
      })
    },
    undo(): void {
      const beforeText = state.doc.text
      const beforeSelection = snapshotSelection(state.selection)
      state = state.undo()
      view.updateState(state)
      operations.push({
        type: 'undo',
        beforeText,
        afterText: state.doc.text,
        beforeSelection,
        afterSelection: snapshotSelection(state.selection),
        undoDepth: state.history.undoStack.length,
      })
    },
    destroy(): void {
      view.destroy()
    },
  }
}

export async function replayOperationLog(
  initialText: string,
  operations: readonly RegressionOperation[],
  initialSelection: Selection = Selection.cursor(initialText.length),
): Promise<RegressionEditorHarness> {
  const replay = createRegressionEditor(initialText, initialSelection)

  for (const operation of operations) {
    switch (operation.type) {
      case 'dispatch':
        replay.dispatch(operation.transaction)
        break
      case 'mode':
        replay.setMode(operation.mode)
        break
      case 'paste':
        await replay.paste(operation.data)
        break
      case 'undo':
        replay.undo()
        break
    }
  }

  return replay
}

function snapshotSelection(selection: Selection): SelectionSnapshot {
  return Object.freeze({
    anchor: selection.main.anchor,
    head: selection.main.head,
  })
}

function createPasteEvent(data: ClipboardDataFixture): Event {
  const event = new Event('paste', { bubbles: true, cancelable: true })

  Object.defineProperty(event, 'clipboardData', {
    value: {
      files: [],
      getData(type: string): string {
        if (type === 'text/plain') {
          return data.plainText ?? ''
        }

        if (type === 'text/html') {
          return data.html ?? ''
        }

        return ''
      },
    },
  })

  return event
}

async function flushAsyncPaste(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}
