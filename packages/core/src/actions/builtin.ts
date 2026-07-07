import { ChangeSet } from '../change/change'
import { Selection } from '../selection/selection'
import type { Transaction } from '../transaction/transaction'
import { type ActionContext, type ActionDefinition, type ActionInputSchema } from './registry'

interface ReplaceSelectionInput {
  readonly text: string
}

interface SetSelectionInput {
  readonly anchor: number
  readonly head?: number
}

interface SetViewModeInput {
  readonly mode: 'source' | 'live' | 'preview'
}

interface FilePathInput {
  readonly path?: string
}

export function createBuiltinActions(): readonly ActionDefinition[] {
  return Object.freeze([
    undoAction,
    redoAction,
    replaceSelectionAction,
    setSelectionAction,
    setViewModeAction,
    openFileAction,
    saveFileAction,
    saveFileAsAction,
    closeDocumentAction,
  ])
}

const undoAction: ActionDefinition<Record<string, never>, boolean> = {
  id: 'core.undo',
  title: 'Undo',
  category: 'core',
  permissions: ['document:write'],
  risk: 'write',
  run: (context) => requireEditor(context).undo(),
}

const redoAction: ActionDefinition<Record<string, never>, boolean> = {
  id: 'core.redo',
  title: 'Redo',
  category: 'core',
  permissions: ['document:write'],
  risk: 'write',
  run: (context) => requireEditor(context).redo(),
}

const replaceSelectionAction: ActionDefinition<
  ReplaceSelectionInput,
  { readonly changed: boolean }
> = {
  id: 'document.replaceSelection',
  title: 'Replace Selection',
  category: 'document',
  permissions: ['document:write'],
  risk: 'write',
  inputSchema: {
    type: 'object',
    properties: {
      text: { type: 'string', required: true },
    },
  },
  run: (context, input) => {
    const editor = requireEditor(context)
    const range = editor.state.selection.main
    const changes = ChangeSet.replace(range.from, range.to, input.text)

    if (changes.empty) {
      return Object.freeze({ changed: false })
    }

    editor.dispatch({
      changes,
      selection: Selection.cursor(range.from + input.text.length),
      origin: { type: 'command', id: 'document.replaceSelection' },
      historyGroup: 'isolate',
    })

    return Object.freeze({ changed: true })
  },
}

const setSelectionAction: ActionDefinition<SetSelectionInput, { readonly selection: Selection }> = {
  id: 'document.setSelection',
  title: 'Set Selection',
  category: 'document',
  permissions: ['document:read'],
  risk: 'safe',
  inputSchema: {
    type: 'object',
    properties: {
      anchor: { type: 'number', required: true },
      head: { type: 'number' },
    },
  },
  run: (context, input) => {
    const editor = requireEditor(context)
    const selection =
      input.head === undefined
        ? Selection.cursor(input.anchor)
        : Selection.range(input.anchor, input.head)

    editor.dispatch({
      selection,
      origin: { type: 'command', id: 'document.setSelection' },
      addToHistory: false,
    })

    return Object.freeze({ selection })
  },
}

const setViewModeAction: ActionDefinition<
  SetViewModeInput,
  { readonly mode: SetViewModeInput['mode'] }
> = {
  id: 'view.setMode',
  title: 'Set View Mode',
  category: 'view',
  permissions: ['view:write'],
  risk: 'safe',
  inputSchema: {
    type: 'object',
    properties: {
      mode: { type: 'string', required: true },
    },
  },
  run: (context, input) => {
    if (!isViewMode(input.mode)) {
      throw new Error(`Invalid view mode: ${input.mode}`)
    }

    const transaction: Transaction = {
      effects: [{ type: 'view.mode', value: input.mode }],
      origin: { type: 'mode.switch' },
      addToHistory: false,
    }

    requireEditor(context).dispatch(transaction)
    return Object.freeze({ mode: input.mode })
  },
}

const openFileAction: ActionDefinition<FilePathInput, never> = {
  id: 'file.open',
  title: 'Open File',
  category: 'file',
  permissions: ['file:read'],
  risk: 'safe',
  inputSchema: filePathInputSchema(false),
  run: () => {
    throw new Error('file.open requires a host file adapter')
  },
}

const saveFileAction: ActionDefinition<Record<string, never>, never> = {
  id: 'file.save',
  title: 'Save File',
  category: 'file',
  permissions: ['file:write'],
  risk: 'write',
  run: () => {
    throw new Error('file.save requires a host file adapter')
  },
}

const saveFileAsAction: ActionDefinition<FilePathInput, never> = {
  id: 'file.saveAs',
  title: 'Save File As',
  category: 'file',
  permissions: ['file:write'],
  risk: 'write',
  inputSchema: filePathInputSchema(false),
  run: () => {
    throw new Error('file.saveAs requires a host file adapter')
  },
}

const closeDocumentAction: ActionDefinition<Record<string, never>, never> = {
  id: 'file.close',
  title: 'Close Document',
  category: 'file',
  permissions: ['app:control'],
  risk: 'destructive',
  requiresConfirmation: true,
  run: () => {
    throw new Error('file.close requires a host document manager')
  },
}

function filePathInputSchema(required: boolean): ActionInputSchema {
  return {
    type: 'object',
    properties: {
      path: { type: 'string', required },
    },
  }
}

function requireEditor(context: ActionContext) {
  if (!context.editor) {
    throw new Error('Action requires an editor context')
  }

  return context.editor
}

function isViewMode(mode: string): mode is SetViewModeInput['mode'] {
  return mode === 'source' || mode === 'live' || mode === 'preview'
}
