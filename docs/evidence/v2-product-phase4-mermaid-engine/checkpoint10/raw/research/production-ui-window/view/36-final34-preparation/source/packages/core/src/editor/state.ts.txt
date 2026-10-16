import { HistoryState, createHistoryEntry } from '../history/history'
import { Selection } from '../selection/selection'
import type { TextDocument } from '../text/document'
import { shouldAddToHistory, type Transaction } from '../transaction/transaction'

export interface EditorStateConfig {
  readonly doc: TextDocument
  readonly selection?: Selection
  readonly history?: HistoryState
  readonly facets?: ReadonlyMap<string, unknown>
}

export class EditorState {
  readonly doc: TextDocument
  readonly selection: Selection
  readonly history: HistoryState
  readonly facets: ReadonlyMap<string, unknown>

  constructor(config: EditorStateConfig) {
    this.doc = config.doc
    this.selection = config.selection ?? Selection.cursor(0)
    this.history = config.history ?? HistoryState.empty()
    this.facets = new Map(config.facets)
    Object.freeze(this)
  }

  applyTransaction(transaction: Transaction): EditorState {
    const beforeDoc = this.doc
    const beforeSelection = this.selection
    const changes = transaction.changes
    const afterDoc = changes && !changes.empty ? beforeDoc.apply(changes) : beforeDoc
    const afterSelection =
      transaction.selection ??
      (changes && !changes.empty ? beforeSelection.map(changes) : beforeSelection)

    let history = this.history

    if (shouldAddToHistory(transaction)) {
      history = history.record(
        createHistoryEntry({
          beforeDoc,
          afterDoc,
          beforeSelection,
          afterSelection,
          transaction,
        }),
      )
    }

    return new EditorState({
      doc: afterDoc,
      selection: afterSelection,
      history,
      facets: this.facets,
    })
  }

  undo(): EditorState {
    const [entry, historyWithoutUndo] = this.history.popUndo()

    if (!entry) {
      return this
    }

    const history = historyWithoutUndo.pushRedo(entry)

    return new EditorState({
      doc: entry.beforeDoc,
      selection: entry.beforeSelection,
      history,
      facets: this.facets,
    })
  }

  redo(): EditorState {
    const [entry, historyWithoutRedo] = this.history.popRedo()

    if (!entry) {
      return this
    }

    const history = historyWithoutRedo.pushUndo(entry)

    return new EditorState({
      doc: entry.afterDoc,
      selection: entry.afterSelection,
      history,
      facets: this.facets,
    })
  }
}
