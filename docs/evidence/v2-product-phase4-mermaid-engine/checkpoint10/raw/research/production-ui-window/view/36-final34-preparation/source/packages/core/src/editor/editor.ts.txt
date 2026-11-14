import type { Transaction } from '../transaction/transaction'
import type { EditorState } from './state'

export interface Command {
  readonly id?: string
  run(editor: Editor): boolean
}

export interface Editor {
  readonly state: EditorState
  dispatch(transaction: Transaction): void
  command(command: Command): boolean
  undo(): boolean
  redo(): boolean
}

export class BasicEditor implements Editor {
  private currentState: EditorState

  constructor(state: EditorState) {
    this.currentState = state
  }

  get state(): EditorState {
    return this.currentState
  }

  dispatch(transaction: Transaction): void {
    this.currentState = this.currentState.applyTransaction(transaction)
  }

  command(command: Command): boolean {
    return command.run(this)
  }

  undo(): boolean {
    if (!this.currentState.history.canUndo) {
      return false
    }

    this.currentState = this.currentState.undo()
    return true
  }

  redo(): boolean {
    if (!this.currentState.history.canRedo) {
      return false
    }

    this.currentState = this.currentState.redo()
    return true
  }
}
