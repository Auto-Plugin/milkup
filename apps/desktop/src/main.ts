import { ActionRegistry, ChangeSet, EditorState, MemoryTextDocument, Selection } from '@milkup/core'
import type { ActionDefinition, ActionPermission, Command, Editor, Transaction } from '@milkup/core'
import {
  createBrowserWorkerPluginHost,
  createIsolatedPluginModule,
  createSidecarPluginModule,
  PluginRuntime,
} from '@milkup/plugin'
import type { BrowserWorkerPluginHost, PluginManifest } from '@milkup/plugin'
import {
  applyFileWatchEvent,
  applyCloseDecision,
  createDocumentSession,
  createDocumentSessionFromOpenResult,
  createFileWatchEvent,
  evaluateCloseProtection,
  getFileActionDocumentId,
  getRevealTarget,
  getSaveSafety,
  prepareTextForFileSave,
  recordRecentFile,
  recordDocumentTransaction,
  recordFileReloadResult,
  recordFileSaveResult,
  recordModeChange,
} from '@milkup/tauri-bridge'
import type { FileAction, RecentFileEntry, SessionViewMode } from '@milkup/tauri-bridge'
import { EditorView } from '@milkup/view-dom'
import type { ViewMode } from '@milkup/view-dom'

import { createDesktopAssetProvider } from './asset-service'
import { createDesktopFileService } from './file-service'
import { createDesktopLargeTextFileService } from './large-file-service'
import { createDesktopPluginFileBroker } from './plugin-file-broker'
import { createDesktopPluginSidecarProcess } from './plugin-sidecar'
import './style.css'

const initialText = [
  '# 未命名',
  '',
  '这是 milkup v2 的桌面编辑器。',
  '',
  '- Markdown 源文档仍然是唯一事实来源。',
  '- 保存状态由 DocumentSession 跟踪。',
  '',
].join('\n')

const messages = {
  titleUntitled: '未命名',
  stateClean: '已保存',
  stateDirty: '有未保存更改',
  pathUnsaved: '未保存',
  recentNone: '无',
  ready: '就绪',
  newDocumentSource: '# 未命名\n\n',
  buttons: {
    new: '新建',
    open: '打开',
    save: '保存',
    saveAs: '另存为',
    reveal: '在文件夹中显示',
    close: '关闭标签',
    simulateChange: '模拟外部修改',
    simulateDelete: '模拟外部删除',
    reloadExternal: '重新载入外部更改',
    source: '源码',
    live: '实时',
    preview: '预览',
  },
  labels: {
    document: '文档',
    path: '路径',
    version: '版本',
    saved: '已保存版本',
    external: '外部状态',
    lineEnding: '换行符',
    notice: '提示',
    recent: '最近文件',
  },
  notices: {
    externalDeleted: '检测到外部文件已删除',
    externalModified: '检测到外部文件已修改',
    newDocumentCreated: '已新建文档',
    openCancelled: '已取消打开',
    openedDocument: '已打开文档',
    saveCancelled: '已取消保存',
    saved: '已保存',
    reloadCancelled: '已取消重新载入',
    reloadedExternal: '已重新载入外部更改',
    saveAsCancelled: '已取消另存为',
    savedAs: '已另存为',
    revealFailed: '无法在文件夹中显示',
    closedDocument: '已关闭文档',
    externalChangeIgnored: '未保存文档，已忽略外部修改模拟',
    externalDeleteIgnored: '未保存文档，已忽略外部删除模拟',
  },
} as const

const app = document.querySelector<HTMLDivElement>('#app')

if (!app) {
  throw new Error('Desktop root element was not found')
}

app.innerHTML = `
  <main class="desktop-shell">
    <header class="topbar">
      <div class="document-title">
        <span data-dirty-dot class="dirty-dot" aria-hidden="true"></span>
        <div>
          <h1 data-title>${messages.titleUntitled}</h1>
          <p data-session-state>${messages.stateClean}</p>
        </div>
      </div>
      <div class="toolbar">
        <button type="button" data-command="new">${messages.buttons.new}</button>
        <button type="button" data-command="open-sample">${messages.buttons.open}</button>
        <button type="button" data-command="save">${messages.buttons.save}</button>
        <button type="button" data-command="save-as">${messages.buttons.saveAs}</button>
        <button type="button" data-command="reveal">${messages.buttons.reveal}</button>
        <button type="button" data-command="close">${messages.buttons.close}</button>
        <button type="button" data-command="external-change">${messages.buttons.simulateChange}</button>
        <button type="button" data-command="external-delete">${messages.buttons.simulateDelete}</button>
        <button type="button" data-command="reload-external">${messages.buttons.reloadExternal}</button>
        <div class="mode-switch" role="group" aria-label="编辑器模式">
          <button type="button" data-mode-button="source">${messages.buttons.source}</button>
          <button type="button" data-mode-button="live">${messages.buttons.live}</button>
          <button type="button" data-mode-button="preview">${messages.buttons.preview}</button>
        </div>
      </div>
    </header>
    <section class="workspace">
      <aside class="sidebar" aria-label="文档会话">
        <dl>
          <div>
            <dt>${messages.labels.document}</dt>
            <dd data-stat="document-id"></dd>
          </div>
          <div>
            <dt>${messages.labels.path}</dt>
            <dd data-stat="path"></dd>
          </div>
          <div>
            <dt>${messages.labels.version}</dt>
            <dd data-stat="version"></dd>
          </div>
          <div>
            <dt>${messages.labels.saved}</dt>
            <dd data-stat="saved"></dd>
          </div>
          <div>
            <dt>${messages.labels.external}</dt>
            <dd data-stat="external"></dd>
          </div>
          <div>
            <dt>${messages.labels.lineEnding}</dt>
            <dd data-stat="line-ending"></dd>
          </div>
          <div>
            <dt>${messages.labels.notice}</dt>
            <dd data-stat="notice"></dd>
          </div>
          <div>
            <dt>${messages.labels.recent}</dt>
            <dd data-stat="recent"></dd>
          </div>
        </dl>
      </aside>
      <section class="editor-host" data-editor-host></section>
    </section>
  </main>
`

const editorHost = app.querySelector<HTMLElement>('[data-editor-host]')

if (!editorHost) {
  throw new Error('Desktop editor host was not found')
}

let state = new EditorState({
  doc: new MemoryTextDocument(initialText),
})
const fileService = createDesktopFileService()
const assetProvider = createDesktopAssetProvider({
  getMarkdownPath: () => session.file?.path,
})

let session = createDocumentSession({
  documentId: 'desktop-untitled-1',
  viewMode: 'source',
})
let notice: string = messages.ready
let recentFiles: readonly RecentFileEntry[] = []
let disposeFileWatchEvents: (() => void) | undefined

let view: EditorView | undefined

const desktopPluginEditor: Editor = {
  get state() {
    return state
  },
  dispatch(transaction: Transaction): void {
    if (!view) {
      throw new Error('Desktop editor view was not initialized')
    }

    state = state.applyTransaction(transaction)
    session = recordDocumentTransaction(session, transaction)
    view.updateState(state, [transaction])
    renderSession()
  },
  command(command: Command): boolean {
    return command.run(desktopPluginEditor)
  },
  undo(): boolean {
    if (!state.history.canUndo) {
      return false
    }

    state = state.undo()
    session = recordDocumentTransaction(session, {
      changes: ChangeSet.insert(state.selection.main.head, ''),
      origin: { type: 'history.undo' },
    })
    view?.updateState(state)
    renderSession()
    return true
  },
  redo(): boolean {
    if (!state.history.canRedo) {
      return false
    }

    state = state.redo()
    session = recordDocumentTransaction(session, {
      changes: ChangeSet.insert(state.selection.main.head, ''),
      origin: { type: 'history.redo' },
    })
    view?.updateState(state)
    renderSession()
    return true
  },
}

view = new EditorView({
  parent: editorHost,
  state,
  mode: session.viewMode,
  assetProvider,
  dispatch: (transaction: Transaction) => {
    if (!view) {
      throw new Error('Desktop editor view was not initialized')
    }

    state = state.applyTransaction(transaction)
    session = recordDocumentTransaction(session, transaction)
    view.updateState(state, [transaction])
    renderSession()
  },
})

renderSession()
updateModeButtons(view.viewMode)
view.inputDOM.focus({ preventScroll: true })

void fileService
  .listenToFileWatchEvents((event) => {
    if (event.documentId !== session.documentId) {
      return
    }

    try {
      session = applyFileWatchEvent(session, event)
      notice =
        event.kind === 'deleted'
          ? messages.notices.externalDeleted
          : messages.notices.externalModified
    } catch (error) {
      notice = `已忽略外部文件事件：${getErrorMessage(error)}`
    }

    renderSession()
    view?.inputDOM.focus({ preventScroll: true })
  })
  .then((unlisten) => {
    disposeFileWatchEvents = unlisten
  })
  .catch((error: unknown) => {
    notice = `文件监听不可用：${getErrorMessage(error)}`
    renderSession()
  })

const desktopActionRegistry = new ActionRegistry(createDesktopActions())
const desktopActionPermissions = Object.freeze([
  'app:control',
  'document:read',
  'document:write',
  'file:read',
  'file:write',
  'view:write',
]) satisfies readonly ActionPermission[]

for (const button of Array.from(app.querySelectorAll<HTMLButtonElement>('[data-mode-button]'))) {
  button.addEventListener('click', () => {
    const mode = button.dataset.modeButton

    if (isViewMode(mode)) {
      runDesktopAction('view.setMode', { mode })
    }
  })
}

app
  .querySelector<HTMLButtonElement>('[data-command="new"]')
  ?.addEventListener('click', () => runDesktopAction('file.new'))

app
  .querySelector<HTMLButtonElement>('[data-command="open-sample"]')
  ?.addEventListener('click', () => runDesktopAction('file.open'))

app
  .querySelector<HTMLButtonElement>('[data-command="save"]')
  ?.addEventListener('click', () => runDesktopAction('file.save'))

app
  .querySelector<HTMLButtonElement>('[data-command="reload-external"]')
  ?.addEventListener('click', () => runDesktopAction('file.reloadExternal'))

app
  .querySelector<HTMLButtonElement>('[data-command="save-as"]')
  ?.addEventListener('click', () => runDesktopAction('file.saveAs'))

app
  .querySelector<HTMLButtonElement>('[data-command="reveal"]')
  ?.addEventListener('click', () => runDesktopAction('file.revealInFolder'))

app
  .querySelector<HTMLButtonElement>('[data-command="close"]')
  ?.addEventListener('click', () => runDesktopAction('file.close'))

app
  .querySelector<HTMLButtonElement>('[data-command="external-change"]')
  ?.addEventListener('click', () => runDesktopAction('file.simulateExternalChange'))

app
  .querySelector<HTMLButtonElement>('[data-command="external-delete"]')
  ?.addEventListener('click', () => runDesktopAction('file.simulateExternalDelete'))

globalThis.addEventListener('keydown', (event) => {
  const action = getDesktopShortcutAction(event)

  if (!action) {
    return
  }

  event.preventDefault()
  runDesktopAction(action.id, action.input)
})

view.inputDOM.addEventListener('copy', (event) => {
  if (copySelectionToClipboard(event)) {
    event.preventDefault()
  }
})

view.inputDOM.addEventListener('cut', (event) => {
  if (copySelectionToClipboard(event)) {
    event.preventDefault()
    runDesktopAction('document.cutSelection')
  }
})

function createDesktopActions(): readonly ActionDefinition[] {
  return Object.freeze([
    {
      id: 'file.new',
      title: 'New Document',
      category: 'file',
      permissions: ['app:control'],
      risk: 'safe',
      run: () => createNewDocument(),
    },
    {
      id: 'file.open',
      title: 'Open File',
      category: 'file',
      permissions: ['file:read'],
      risk: 'safe',
      run: () => openDocument(),
    },
    {
      id: 'file.save',
      title: 'Save File',
      category: 'file',
      permissions: ['file:write'],
      risk: 'write',
      run: () => saveDocument(),
    },
    {
      id: 'file.saveAs',
      title: 'Save File As',
      category: 'file',
      permissions: ['file:write'],
      risk: 'write',
      run: () => saveDocumentAs(),
    },
    {
      id: 'file.reloadExternal',
      title: 'Reload External Changes',
      category: 'file',
      permissions: ['file:read'],
      risk: 'write',
      run: () => reloadExternalDocument(),
    },
    {
      id: 'file.revealInFolder',
      title: 'Reveal in Folder',
      category: 'file',
      permissions: ['file:read'],
      risk: 'safe',
      run: () => revealCurrentFile(),
    },
    {
      id: 'file.close',
      title: 'Close Document',
      category: 'file',
      permissions: ['app:control'],
      risk: 'destructive',
      requiresConfirmation: true,
      run: () => closeCurrentDocument(),
    },
    {
      id: 'file.simulateExternalChange',
      title: 'Simulate External Change',
      category: 'file',
      permissions: ['file:write'],
      risk: 'write',
      run: () => simulateExternalChange(),
    },
    {
      id: 'file.simulateExternalDelete',
      title: 'Simulate External Delete',
      category: 'file',
      permissions: ['file:write'],
      risk: 'write',
      run: () => simulateExternalDelete(),
    },
    {
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
      run: (_context, input) => {
        const mode = (input as { readonly mode?: unknown }).mode
        const viewMode = typeof mode === 'string' ? mode : undefined

        if (!isViewMode(viewMode)) {
          throw new Error(`Invalid view mode: ${String(mode)}`)
        }

        setViewMode(viewMode)
      },
    },
    {
      id: 'document.selectAll',
      title: 'Select All',
      category: 'document',
      permissions: ['document:read'],
      risk: 'safe',
      run: () => selectWholeDocument(),
    },
    {
      id: 'document.cutSelection',
      title: 'Cut Selection',
      category: 'document',
      permissions: ['document:write'],
      risk: 'write',
      run: () => cutCurrentSelection(),
    },
    {
      id: 'core.undo',
      title: 'Undo',
      category: 'core',
      permissions: ['document:write'],
      risk: 'write',
      run: () => desktopPluginEditor.undo(),
    },
    {
      id: 'core.redo',
      title: 'Redo',
      category: 'core',
      permissions: ['document:write'],
      risk: 'write',
      run: () => desktopPluginEditor.redo(),
    },
  ])
}

function runDesktopAction(id: string, input: unknown = {}): void {
  void desktopActionRegistry
    .run(
      id,
      {
        editor: desktopPluginEditor,
        permissions: desktopActionPermissions,
        confirm: () => true,
      },
      input,
    )
    .catch((error: unknown) => {
      notice = `命令执行失败：${getErrorMessage(error)}`
      renderSession()
      view?.inputDOM.focus({ preventScroll: true })
    })
}

function createNewDocument(): void {
  if (!view) {
    return
  }

  const action: FileAction = {
    kind: 'new',
    documentId: `desktop-untitled-${Date.now()}`,
  }

  unwatchCurrentFile()
  state = new EditorState({
    doc: new MemoryTextDocument(messages.newDocumentSource),
  })
  session = createDocumentSession({
    documentId: getRequiredDocumentId(action),
    viewMode: view.viewMode,
  })
  view.updateState(state)
  notice = messages.notices.newDocumentCreated
  renderSession()
  view.inputDOM.focus({ preventScroll: true })
}

async function openDocument(): Promise<void> {
  if (!view) {
    return
  }

  const result = await fileService.openFile()

  if (!result) {
    notice = messages.notices.openCancelled
    renderSession()
    view.inputDOM.focus({ preventScroll: true })
    return
  }

  unwatchCurrentFile()
  state = new EditorState({
    doc: new MemoryTextDocument(result.text),
  })
  session = createDocumentSessionFromOpenResult(result, view.viewMode)
  recentFiles = recordRecentFile(recentFiles, result.file, Date.now())
  watchCurrentFile()
  view.updateState(state)
  notice = messages.notices.openedDocument
  renderSession()
  view.inputDOM.focus({ preventScroll: true })
}

async function saveDocument(): Promise<void> {
  if (!view) {
    return
  }

  const action: FileAction = {
    kind: 'save',
    documentId: session.documentId,
  }

  getRequiredDocumentId(action)
  const safety = getSaveSafety(session)

  if (!safety.canSave) {
    notice = translateSaveSafetyMessage(safety.message)
    renderSession()
    view.inputDOM.focus({ preventScroll: true })
    return
  }

  const result = await fileService.saveFile(
    session,
    prepareTextForFileSave(session, state.doc.text),
  )

  if (!result) {
    notice = messages.notices.saveCancelled
    renderSession()
    view.inputDOM.focus({ preventScroll: true })
    return
  }

  session = recordFileSaveResult(session, result)
  recentFiles = recordRecentFile(recentFiles, result.file, Date.now())
  watchCurrentFile()
  notice = messages.notices.saved
  renderSession()
  view.inputDOM.focus({ preventScroll: true })
}

async function reloadExternalDocument(): Promise<void> {
  if (!view) {
    return
  }

  if (session.externalChangeState !== 'modified-clean') {
    notice = `无法重新载入：${session.externalChangeState}`
    renderSession()
    view.inputDOM.focus({ preventScroll: true })
    return
  }

  const result = await fileService.reloadFile(session)

  if (!result) {
    notice = messages.notices.reloadCancelled
    renderSession()
    view.inputDOM.focus({ preventScroll: true })
    return
  }

  state = new EditorState({
    doc: new MemoryTextDocument(result.text),
  })
  session = recordFileReloadResult(session, result)
  recentFiles = recordRecentFile(recentFiles, result.file, Date.now())
  watchCurrentFile()
  view.updateState(state)
  notice = messages.notices.reloadedExternal
  renderSession()
  view.inputDOM.focus({ preventScroll: true })
}

async function saveDocumentAs(): Promise<void> {
  if (!view) {
    return
  }

  const action: FileAction = {
    kind: 'saveAs',
    documentId: session.documentId,
    path: session.file?.path ?? 'untitled.md',
  }
  const safety = getSaveSafety(session)

  if (!safety.canSave) {
    notice = translateSaveSafetyMessage(safety.message)
    renderSession()
    view.inputDOM.focus({ preventScroll: true })
    return
  }

  getRequiredDocumentId(action)
  const result = await fileService.saveFileAs(
    session,
    prepareTextForFileSave(session, state.doc.text),
  )

  if (!result) {
    notice = messages.notices.saveAsCancelled
    renderSession()
    view.inputDOM.focus({ preventScroll: true })
    return
  }

  session = recordFileSaveResult(session, result)
  recentFiles = recordRecentFile(recentFiles, result.file, Date.now())
  watchCurrentFile()
  notice = messages.notices.savedAs
  renderSession()
  view.inputDOM.focus({ preventScroll: true })
}

async function revealCurrentFile(): Promise<void> {
  const action: FileAction = {
    kind: 'revealInFolder',
    documentId: session.documentId,
  }
  const target = getRevealTarget([session], action)

  if (!target.canReveal) {
    notice = `无法在文件夹中显示：${target.reason}`
    renderSession()
    view?.inputDOM.focus({ preventScroll: true })
    return
  }

  const revealed = await fileService.revealInFolder(action, target.path)
  notice = revealed ? `已在文件夹中显示：${target.path}` : messages.notices.revealFailed
  renderSession()
  view?.inputDOM.focus({ preventScroll: true })
}

function closeCurrentDocument(): void {
  if (!view) {
    return
  }

  const decision = evaluateCloseProtection([session], {
    scope: 'tab',
    documentIds: [session.documentId],
  })

  if (!decision.allowClose) {
    applyCloseDecision([session], decision, 'cancel')
    notice = `无法关闭：${decision.blockedDocumentIds.join(', ')} 有未保存更改`
    renderSession()
    view.inputDOM.focus({ preventScroll: true })
    return
  }

  unwatchCurrentFile()
  state = new EditorState({
    doc: new MemoryTextDocument(''),
  })
  session = createDocumentSession({
    documentId: `desktop-untitled-${Date.now()}`,
    viewMode: view.viewMode,
  })
  view.updateState(state)
  notice = messages.notices.closedDocument
  renderSession()
  view.inputDOM.focus({ preventScroll: true })
}

function simulateExternalChange(): void {
  if (!session.file) {
    notice = messages.notices.externalChangeIgnored
    renderSession()
    view?.inputDOM.focus({ preventScroll: true })
    return
  }

  session = applyFileWatchEvent(
    session,
    createFileWatchEvent({
      kind: 'modified',
      documentId: session.documentId,
      file: session.file,
      diskSnapshotHash: `external:${Date.now()}`,
    }),
  )
  notice = messages.notices.externalModified
  renderSession()
  view?.inputDOM.focus({ preventScroll: true })
}

function simulateExternalDelete(): void {
  if (!session.file) {
    notice = messages.notices.externalDeleteIgnored
    renderSession()
    view?.inputDOM.focus({ preventScroll: true })
    return
  }

  session = applyFileWatchEvent(
    session,
    createFileWatchEvent({
      kind: 'deleted',
      documentId: session.documentId,
      file: session.file,
    }),
  )
  notice = messages.notices.externalDeleted
  renderSession()
  view?.inputDOM.focus({ preventScroll: true })
}

function setViewMode(mode: SessionViewMode): void {
  if (!view) {
    return
  }

  view.setMode(mode)
  session = recordModeChange(session, mode)
  updateModeButtons(mode)
  renderSession()
  view.inputDOM.focus({ preventScroll: true })
}

function selectWholeDocument(): void {
  desktopPluginEditor.dispatch({
    selection: Selection.range(0, state.doc.length),
    origin: { type: 'command', id: 'document.selectAll' },
    addToHistory: false,
  })
  view?.inputDOM.focus({ preventScroll: true })
}

function cutCurrentSelection(): boolean {
  const range = state.selection.main

  if (range.empty) {
    return false
  }

  desktopPluginEditor.dispatch({
    changes: ChangeSet.delete(range.from, range.to),
    selection: Selection.cursor(range.from),
    origin: { type: 'command', id: 'document.cutSelection' },
    historyGroup: 'isolate',
  })
  view?.inputDOM.focus({ preventScroll: true })
  return true
}

function copySelectionToClipboard(event: ClipboardEvent): boolean {
  const range = state.selection.main

  if (range.empty || !event.clipboardData) {
    return false
  }

  event.clipboardData.setData('text/plain', state.doc.slice(range.from, range.to))
  return true
}

function getDesktopShortcutAction(
  event: KeyboardEvent,
): { readonly id: string; readonly input?: unknown } | undefined {
  if (event.altKey || event.isComposing) {
    return undefined
  }

  const isMac = navigator.platform.toLowerCase().includes('mac')
  const primaryPressed = isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey

  if (!primaryPressed) {
    return undefined
  }

  switch (event.key.toLowerCase()) {
    case '1':
      return { id: 'view.setMode', input: { mode: 'source' } }
    case '2':
      return { id: 'view.setMode', input: { mode: 'live' } }
    case '3':
      return { id: 'view.setMode', input: { mode: 'preview' } }
    case 'a':
      return { id: 'document.selectAll' }
    case 'n':
      return { id: 'file.new' }
    case 'o':
      return { id: 'file.open' }
    case 'r':
      return { id: 'file.reloadExternal' }
    case 's':
      return { id: event.shiftKey ? 'file.saveAs' : 'file.save' }
    case 'w':
      return { id: 'file.close' }
    case 'y':
      return { id: 'core.redo' }
    case 'z':
      return { id: event.shiftKey ? 'core.redo' : 'core.undo' }
    default:
      return undefined
  }
}

function renderSession(): void {
  setText('[data-title]', session.file?.path ?? messages.titleUntitled)
  setText(
    '[data-session-state]',
    `${session.dirty ? messages.stateDirty : messages.stateClean} · ${state.doc.length} 字符`,
  )
  setText('[data-stat="document-id"]', session.documentId)
  setText('[data-stat="path"]', session.file?.path ?? messages.pathUnsaved)
  setText('[data-stat="version"]', String(session.documentVersion))
  setText('[data-stat="saved"]', String(session.savedVersion))
  setText('[data-stat="external"]', session.externalChangeState)
  setText('[data-stat="line-ending"]', session.lineEnding)
  setText('[data-stat="notice"]', notice)
  setText(
    '[data-stat="recent"]',
    recentFiles.length === 0
      ? messages.recentNone
      : recentFiles.map((file) => file.path).join('\n'),
  )

  const dirtyDot = app?.querySelector<HTMLElement>('[data-dirty-dot]')
  dirtyDot?.classList.toggle('is-dirty', session.dirty)
}

function watchCurrentFile(): void {
  void fileService.watchFile(session).catch((error: unknown) => {
    notice = `文件监听不可用：${getErrorMessage(error)}`
    renderSession()
  })
}

function unwatchCurrentFile(): void {
  const documentId = session.documentId

  void fileService.unwatchFile(documentId).catch((error: unknown) => {
    notice = `清理文件监听失败：${getErrorMessage(error)}`
    renderSession()
  })
}

function updateModeButtons(mode: ViewMode): void {
  for (const button of Array.from(
    app?.querySelectorAll<HTMLButtonElement>('[data-mode-button]') ?? [],
  )) {
    const active = button.dataset.modeButton === mode
    button.dataset.active = String(active)
    button.setAttribute('aria-pressed', String(active))
  }
}

function setText(selector: string, value: string): void {
  const target = app?.querySelector<HTMLElement>(selector)

  if (target) {
    target.textContent = value
  }
}

function isViewMode(value: string | undefined): value is SessionViewMode {
  return value === 'source' || value === 'live' || value === 'preview'
}

function getRequiredDocumentId(action: FileAction): string {
  const documentId = getFileActionDocumentId(action)

  if (!documentId) {
    throw new Error(`File action ${action.kind} is not bound to a document`)
  }

  return documentId
}

function translateSaveSafetyMessage(message: string): string {
  if (message.includes('changed outside the editor')) {
    return '文件已在编辑器外发生变化。请先重新载入或处理冲突后再保存。'
  }

  if (message.includes('deleted outside the editor')) {
    return '文件已在编辑器外被删除。请先另存为或处理冲突后再保存。'
  }

  if (message.includes('does not have a file path')) {
    return '当前文档还没有文件路径，请使用“另存为”。'
  }

  return message
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function runDesktopWorkerFilePluginFixture(path: string): Promise<unknown> {
  const manifest = createDesktopWorkerFilePluginManifest()
  const fileBroker = createDesktopPluginFileBroker({
    manifest,
    roots: [{ id: 'fixture', path: getDirectoryPath(path) }],
  })
  let workerHost: BrowserWorkerPluginHost | undefined

  try {
    const worker = new Worker(new URL('./plugin-worker.ts', import.meta.url), {
      type: 'module',
      name: 'milkup-desktop-plugin-worker-fixture',
    })
    workerHost = createBrowserWorkerPluginHost({
      worker,
      manifest,
      moduleSpecifier: 'milkup://desktop/worker-file-plugin',
      fileBroker,
    })
    const registry = new ActionRegistry()
    const runtime = new PluginRuntime({
      actionRegistry: registry,
      allowedPermissions: ['file:read', 'file:write'],
      fileBroker,
    })

    await workerHost.ready
    runtime.loadPlugin({
      manifest,
      module: createIsolatedPluginModule({
        manifest,
        host: workerHost.host,
      }),
    })
    await runtime.enablePlugin(manifest.id)

    const result = await registry.run(
      'desktopWorkerFile.readWriteInsert',
      {
        editor: desktopPluginEditor,
        permissions: ['file:read', 'file:write'],
      },
      { path },
    )
    await runtime.unloadPlugin(manifest.id)

    return result
  } finally {
    workerHost?.dispose()
  }
}

async function runDesktopSidecarPluginFixture(
  executable: string,
  args: readonly string[] = [],
): Promise<unknown> {
  const manifest = createDesktopSidecarPluginManifest()
  const registry = new ActionRegistry()
  const runtime = new PluginRuntime({
    actionRegistry: registry,
    allowedHosts: ['sidecar'],
    allowedPermissions: ['document:write'],
  })
  const module = createSidecarPluginModule({
    manifest,
    moduleSpecifier: 'milkup://desktop/sidecar-fixture',
    process: createDesktopPluginSidecarProcess({
      executable,
      args,
    }),
    timeoutMs: 10_000,
  })

  runtime.loadPlugin({
    manifest,
    module,
  })

  try {
    await runtime.enablePlugin(manifest.id)

    return await registry.run(
      'desktopSidecar.insertText',
      {
        editor: desktopPluginEditor,
        permissions: ['document:write'],
      },
      { text: 'native sidecar content' },
    )
  } finally {
    await runtime.unloadPlugin(manifest.id).catch(() => undefined)
  }
}

async function runDesktopLargeTextFileBenchmark(path: string): Promise<unknown> {
  const service = createDesktopLargeTextFileService()
  const documentId = `large-benchmark-${Date.now()}`
  const timings: Record<string, number> = {}

  try {
    const opened = await measure('openMs', timings, () => service.open(documentId, path))
    const headChunk = await measure('headChunkMs', timings, () =>
      service.readChunk(documentId, 0, Math.min(4096, opened.sizeBytes)),
    )
    const firstWindow = await measure('firstWindowMs', timings, () =>
      service.readLineWindow(documentId, 1, Math.min(8, opened.lineCount)),
    )
    const middleLine = Math.max(1, Math.floor(opened.lineCount / 2))
    const middleWindow = await measure('middleWindowMs', timings, () =>
      service.readLineWindow(documentId, middleLine, Math.min(opened.lineCount, middleLine + 7)),
    )
    const tailLine = Math.max(1, opened.lineCount - 7)
    const tailWindow = await measure('tailWindowMs', timings, () =>
      service.readLineWindow(documentId, tailLine, opened.lineCount),
    )
    const changes = [
      {
        fromUtf16: firstWindow.fromUtf16,
        toUtf16: firstWindow.fromUtf16,
        insert: '<!-- head -->\n',
      },
      {
        fromUtf16: middleWindow.fromUtf16,
        toUtf16: middleWindow.fromUtf16,
        insert: '<!-- middle -->\n',
      },
      { fromUtf16: tailWindow.fromUtf16, toUtf16: tailWindow.fromUtf16, insert: '<!-- tail -->\n' },
    ]
    const changed = await measure('applyMs', timings, () =>
      service.applyChanges(documentId, opened.version, changes),
    )
    const flushed = await measure('flushMs', timings, () =>
      service.flush(documentId, changed.version),
    )

    return {
      documentId,
      path,
      opened,
      headChunk: {
        fromByte: headChunk.fromByte,
        toByte: headChunk.toByte,
        fromUtf16: headChunk.fromUtf16,
        toUtf16: headChunk.toUtf16,
      },
      windows: {
        first: summarizeLineWindow(firstWindow),
        middle: summarizeLineWindow(middleWindow),
        tail: summarizeLineWindow(tailWindow),
      },
      changed,
      flushed,
      timings,
    }
  } finally {
    await service.close(documentId).catch(() => undefined)
  }
}

async function measure<T>(
  name: string,
  timings: Record<string, number>,
  run: () => Promise<T>,
): Promise<T> {
  const startedAt = performance.now()

  try {
    return await run()
  } finally {
    timings[name] = Math.round((performance.now() - startedAt) * 100) / 100
  }
}

function summarizeLineWindow(window: {
  readonly fromLine: number
  readonly toLine: number
  readonly fromByte: number
  readonly toByte: number
  readonly fromUtf16: number
  readonly toUtf16: number
  readonly text: string
}): Record<string, number> {
  return {
    fromLine: window.fromLine,
    toLine: window.toLine,
    fromByte: window.fromByte,
    toByte: window.toByte,
    fromUtf16: window.fromUtf16,
    toUtf16: window.toUtf16,
    textLength: window.text.length,
  }
}

function createDesktopWorkerFilePluginManifest(): PluginManifest {
  return {
    id: 'desktop-worker-file-fixture',
    name: 'Desktop Worker File Fixture',
    version: '1.0.0',
    permissions: ['file:read', 'file:write'],
    contributes: {
      commands: [
        {
          id: 'desktopWorkerFile.readWriteInsert',
          title: 'Read, Write, and Insert',
          action: 'desktopWorkerFile.readWriteInsert',
          permissions: ['file:read', 'file:write'],
          inputSchema: {
            type: 'object',
            properties: {
              path: { type: 'string', required: true },
            },
          },
        },
      ],
    },
  }
}

function createDesktopSidecarPluginManifest(): PluginManifest {
  return {
    id: 'desktop-sidecar-fixture',
    name: 'Desktop Sidecar Fixture',
    version: '1.0.0',
    host: 'sidecar',
    permissions: ['document:write'],
    contributes: {
      commands: [
        {
          id: 'desktopSidecar.insertText',
          title: 'Insert Sidecar Text',
          action: 'desktopSidecar.insertText',
          permissions: ['document:write'],
          inputSchema: {
            type: 'object',
            properties: {
              text: { type: 'string', required: true },
            },
          },
        },
      ],
    },
  }
}

function getDirectoryPath(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  const slashIndex = normalized.lastIndexOf('/')

  if (slashIndex <= 0) {
    throw new Error(`Desktop worker plugin fixture path must include a directory: ${path}`)
  }

  return normalized.slice(0, slashIndex)
}

Object.assign(globalThis, {
  __milkupDesktopTest: Object.freeze({
    runDesktopWorkerFilePluginFixture,
    runDesktopSidecarPluginFixture,
    runDesktopLargeTextFileBenchmark,
  }),
})

globalThis.addEventListener('beforeunload', () => {
  disposeFileWatchEvents?.()
})
