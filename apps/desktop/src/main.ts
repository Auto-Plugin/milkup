import {
  ActionRegistry,
  ChangeSet,
  EditorState,
  LargeEditSession,
  largeTextEditsToChangeSet,
  MemoryDocumentSource,
  MemoryTextDocument,
  Selection,
} from '@milkup/core'
import type { ActionDefinition, ActionPermission, Command, Editor, Transaction } from '@milkup/core'
import {
  createBrowserWorkerPluginHost,
  createIsolatedPluginModule,
  createSidecarPluginModule,
  PluginRuntime,
} from '@milkup/plugin'
import {
  isPluginPackageArchive,
  parsePluginPackageArchive,
  readPluginPackageTextFile,
} from '@milkup/plugin'
import type { BrowserWorkerPluginHost, PluginManifest } from '@milkup/plugin'
import {
  applyFileWatchEvent,
  applyCloseDecision,
  createDocumentSession,
  createDocumentSessionFromOpenResult,
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
import type {
  FileAction,
  OpenFileResult,
  RecentFileEntry,
  SessionViewMode,
} from '@milkup/tauri-bridge'
import { createControlledRendererNodes, EditorView } from '@milkup/view-dom'
import { SourceDocumentView } from '@milkup/view-dom'
import type {
  ControlledRenderer,
  ControlledRendererActionDetail,
  ControlledRendererContext,
  ControlledRendererOutput,
  ViewMode,
} from '@milkup/view-dom'
import {
  Bug,
  Code2,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Eye,
  FileText,
  FilePlus2,
  FolderOpen,
  Info,
  Keyboard,
  LoaderCircle,
  Menu,
  Palette,
  PanelLeft,
  PanelLeftClose,
  Plug,
  RotateCcw,
  Save,
  SaveAll,
  Search,
  X,
} from 'lucide'
import type { IconNode } from 'lucide'

import { createDesktopAssetProvider } from './asset-service'
import {
  metadataFromOpenFileResult,
  resolveDesktopMemoryViewportFallbackPolicy,
  resolveDesktopOpenPolicy,
  type DesktopOpenPolicy,
} from './desktop-open-policy'
import { DesktopDocumentSearchController, type DesktopSearchState } from './desktop-document-search'
import {
  createDesktopSearchNavigationState,
  moveDesktopSearchNavigationIndex,
} from './desktop-search-navigation'
import {
  formatBytes,
  openLargeDocumentPreview,
  type LargeDocumentPreviewState,
} from './desktop-large-open-flow'
import { getLargeExternalReloadDecision } from './large-document-conflict'
import { applyLargeDocumentEditBatch } from './large-document-editing'
import {
  getDocumentLoadingDetail,
  getDocumentLoadingLabel,
  type DocumentLoadingState,
} from './document-open-flow'
import { createDesktopFileService } from './file-service'
import { iconSvg } from './icons'
import { createDesktopLargeTextFileService } from './large-file-service'
import {
  createDesktopPluginActions,
  DesktopPluginManager,
  renderDesktopPluginManager,
  resolvePluginEntryPath,
} from './desktop-plugin-manager'
import { DesktopPluginUiController } from './desktop-plugin-ui'
import {
  createOpenStageTracker,
  formatOpenStageDiagnostics,
  type OpenStageDiagnostics,
  type OpenStageTracker,
} from './open-stage-diagnostics'
import { createDesktopPluginFileBroker } from './plugin-file-broker'
import { createDesktopPluginSidecarProcess } from './plugin-sidecar'
import './style.css'

const initialText = ''
const desktopVirtualLineHeight = 21
const largePreviewLineCount = 80
const appProductName = 'milkup'
const appVersion = '0.1.0'
const appCopyright = 'Copyright (c) 2026 milkup. All rights reserved.'

const messages = {
  titleUntitled: '未命名',
  stateClean: '已保存',
  stateDirty: '未保存',
  stateSaving: '保存中',
  pathUnsaved: '未保存',
  recentNone: '无',
  ready: '就绪',
  newDocumentSource: '',
  buttons: {
    menu: '菜单',
    closeMenu: '关闭菜单',
    sidebar: '侧栏',
    search: '搜索',
    closeSearch: '关闭搜索',
    new: '新建',
    open: '打开',
    save: '保存',
    saveAs: '另存为',
    reveal: '在文件夹中显示',
    close: '关闭标签',
    reloadExternal: '重新载入外部更改',
    source: '源码',
    live: '实时',
    readonly: '只读',
  },
  menu: {
    file: '文件',
    appearance: '外观',
    plugins: '插件',
    shortcuts: '快捷键',
    about: '关于',
    developer: '开发者面板',
  },
  window: {
    minimize: '最小化',
    maximize: '最大化',
    restore: '还原',
    close: '关闭窗口',
  },
  closeConfirm: {
    title: '文档尚未保存',
    body: '关闭窗口前，请选择如何处理当前未保存的更改。',
    savingTitle: '正在保存',
    savingBody: '文档正在保存中，保存完成后会自动关闭窗口。',
    cancel: '取消',
    saveAndExit: '保存并退出',
    discardAndExit: '不保存并退出',
    close: '关闭提示',
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
  },
  loading: {
    title: '正在打开文档',
    body: '正在准备内容',
  },
} as const

const platform = getDesktopPlatform()

type DesktopPlatform = 'windows' | 'macos' | 'linux' | 'other'
type WindowControlAction = 'minimize' | 'maximize' | 'close'
type DocumentSaveState =
  | {
      readonly phase: 'idle'
    }
  | {
      readonly phase: 'saving'
      readonly promise: Promise<boolean>
    }

const app = document.querySelector<HTMLDivElement>('#app')

if (!app) {
  throw new Error('Desktop root element was not found')
}

const appRoot = app

appRoot.dataset.platform = platform
appRoot.dataset.sidebarCollapsed = 'true'
app.innerHTML = `
  <main class="desktop-shell">
    <header class="titlebar" data-window-drag-region>
      <button type="button" class="titlebar-menu-button" data-menu-toggle aria-label="${messages.buttons.menu}" title="${messages.buttons.menu}">
        ${iconSvg(Menu)}
      </button>
      <div class="document-title" data-window-drag-region>
        <h1 data-title>${messages.titleUntitled}</h1>
        <p data-title-path>${messages.pathUnsaved}</p>
      </div>
      <div class="plugin-toolbar-slot" data-plugin-slot="document-toolbar"></div>
      <div class="window-controls" aria-label="窗口控制">
        <button type="button" class="window-control" data-window-control="minimize" aria-label="${messages.window.minimize}" title="${messages.window.minimize}">
          <span class="window-glyph window-glyph-minimize" aria-hidden="true"></span>
        </button>
        <button type="button" class="window-control" data-window-control="maximize" aria-label="${messages.window.maximize}" title="${messages.window.maximize}" data-window-maximize>
          <span class="window-glyph window-glyph-maximize" aria-hidden="true"></span>
        </button>
        <button type="button" class="window-control window-control-close" data-window-control="close" aria-label="${messages.window.close}" title="${messages.window.close}">
          <span class="window-glyph window-glyph-close" aria-hidden="true"></span>
        </button>
      </div>
    </header>
    <section class="app-menu" data-app-menu hidden>
      <div class="app-menu-surface" role="dialog" aria-modal="true" aria-label="${messages.buttons.menu}">
        <header class="app-menu-header">
          <div>
            <h2>${messages.buttons.menu}</h2>
          </div>
          <button type="button" class="icon-button" data-menu-close aria-label="${messages.buttons.closeMenu}" title="${messages.buttons.closeMenu}">
            ${iconSvg(X)}
          </button>
        </header>
        <div class="app-menu-grid">
          <nav class="app-menu-nav" aria-label="菜单分类">
            ${menuNavButton('file', messages.menu.file, FileText, true)}
            ${menuNavButton('appearance', messages.menu.appearance, Palette)}
            ${menuNavButton('plugins', messages.menu.plugins, Plug)}
            ${menuNavButton('shortcuts', messages.menu.shortcuts, Keyboard)}
            ${menuNavButton('about', messages.menu.about, Info)}
          </nav>
          <section class="app-menu-section" data-menu-panel="file">
            <h3>${messages.menu.file}</h3>
            <div class="menu-command-list" aria-label="文件操作">
              ${toolbarButton('new', messages.buttons.new, FilePlus2)}
              ${toolbarButton('open-sample', messages.buttons.open, FolderOpen)}
              ${toolbarButton('save', messages.buttons.save, Save)}
              ${toolbarButton('save-as', messages.buttons.saveAs, SaveAll)}
              ${toolbarButton('reload-external', messages.buttons.reloadExternal, RotateCcw)}
              ${toolbarButton('reveal', messages.buttons.reveal, ExternalLink)}
              ${toolbarButton('close', messages.buttons.close, X)}
            </div>
            <details class="developer-panel">
              <summary>
                ${iconSvg(Bug)}
                <span>${messages.menu.developer}</span>
              </summary>
              <dl class="metadata-list compact">
                <div>
                  <dt>${messages.labels.document}</dt>
                  <dd data-stat="document-id"></dd>
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
                  <dt>规模模式</dt>
                  <dd data-stat="scale-mode"></dd>
                </div>
                <div>
                  <dt>渲染策略</dt>
                  <dd data-stat="render-strategy"></dd>
                </div>
                <div class="wide">
                  <dt>打开计时</dt>
                  <dd data-stat="open-timings"></dd>
                </div>
              </dl>
              <label class="developer-toggle">
                <input type="checkbox" data-developer-status-notice>
                <span>显示状态栏提示</span>
              </label>
            </details>
          </section>
          <section class="app-menu-section" data-menu-panel="appearance" hidden>
            <h3>${messages.menu.appearance}</h3>
          </section>
          <section class="app-menu-section" data-menu-panel="plugins" hidden>
            <h3>${messages.menu.plugins}</h3>
            <div data-plugin-manager></div>
            <div data-plugin-slot="menu-page"></div>
          </section>
          <section class="app-menu-section" data-menu-panel="shortcuts" hidden>
            <h3>${messages.menu.shortcuts}</h3>
          </section>
          <section class="app-menu-section" data-menu-panel="about" hidden>
            <h3>${messages.menu.about}</h3>
            <dl class="metadata-list menu-info-list">
              <div>
                <dt>软件名</dt>
                <dd>${appProductName}</dd>
              </div>
              <div>
                <dt>当前版本</dt>
                <dd>${appVersion}</dd>
              </div>
              <div>
                <dt>版权信息</dt>
                <dd>${appCopyright}</dd>
              </div>
            </dl>
          </section>
        </div>
      </div>
    </section>
    <section class="workspace">
      <aside class="sidebar" aria-label="工作区"><div data-plugin-slot="sidebar-panel"></div></aside>
      <section class="editor-panel">
        <div class="floating-search" data-floating-search hidden>
          <span class="search-status-icon" data-search-status-icon>
            <span data-search-idle-icon>${iconSvg(Search)}</span>
            <span data-search-loading hidden>${iconSvg(LoaderCircle)}</span>
          </span>
          <input type="search" aria-label="${messages.buttons.search}" placeholder="搜索文档" data-search-input />
          <span class="search-result-count" data-search-result-count>0/0</span>
          <button type="button" class="icon-button search-nav-button" data-search-previous aria-label="上一个结果" title="上一个结果" disabled>
            ${iconSvg(ChevronUp)}
          </button>
          <button type="button" class="icon-button search-nav-button" data-search-next aria-label="下一个结果" title="下一个结果" disabled>
            ${iconSvg(ChevronDown)}
          </button>
          <button type="button" class="icon-button" data-search-close aria-label="${messages.buttons.closeSearch}" title="${messages.buttons.closeSearch}">
            ${iconSvg(X)}
          </button>
        </div>
        <div class="editor-host" data-editor-host></div>
        <div class="plugin-bottom-slot" data-plugin-slot="bottom-panel"></div>
        <div class="document-loading" data-document-loading hidden>
          <div>
            <button type="button" class="icon-button loading-dismiss" data-loading-dismiss aria-label="关闭" title="关闭" hidden>
              ${iconSvg(X)}
            </button>
            <p data-loading-title>${messages.loading.title}</p>
            <span data-loading-phase>${messages.loading.body}</span>
            <span data-loading-detail></span>
          </div>
        </div>
      </section>
    </section>
    <section class="confirm-overlay" data-close-confirm hidden>
      <div class="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="close-confirm-title" aria-describedby="close-confirm-body">
        <button type="button" class="icon-button confirm-close" data-close-confirm-action="cancel" aria-label="${messages.closeConfirm.close}" title="${messages.closeConfirm.close}">
          ${iconSvg(X)}
        </button>
        <div class="confirm-dialog-content">
          <h2 id="close-confirm-title">${messages.closeConfirm.title}</h2>
          <p id="close-confirm-body">${messages.closeConfirm.body}</p>
        </div>
        <footer class="confirm-dialog-actions">
          <button type="button" class="dialog-button secondary" data-close-confirm-action="cancel">${messages.closeConfirm.cancel}</button>
          <button type="button" class="dialog-button warning" data-close-confirm-action="discard">${messages.closeConfirm.discardAndExit}</button>
          <button type="button" class="dialog-button primary" data-close-confirm-action="save">
            <span class="saving-spinner" data-close-save-spinner aria-hidden="true" hidden>${iconSvg(LoaderCircle)}</span>
            <span data-close-save-label>${messages.closeConfirm.saveAndExit}</span>
          </button>
        </footer>
      </div>
    </section>
    <section class="plugin-modal-slot" data-plugin-slot="modal"></section>
    <footer class="statusbar">
      <div class="statusbar-left">
        <button type="button" class="statusbar-button" data-sidebar-toggle aria-label="${messages.buttons.sidebar}" title="${messages.buttons.sidebar}">
          ${iconSvg(PanelLeft)}
        </button>
        <button type="button" class="statusbar-button mode-toggle" data-mode-toggle aria-label="${messages.buttons.live}" title="${messages.buttons.live}"></button>
      </div>
      <span class="statusbar-notice" data-notice hidden></span>
      <span class="statusbar-spacer"></span>
      <div class="statusbar-right">
        <span data-plugin-slot="statusbar"></span>
        <span data-document-kind>Markdown</span>
        <span data-stat="char-count">0 字符</span>
        <span class="save-state" data-save-state>
          <span class="saving-spinner" data-save-spinner aria-hidden="true" hidden>${iconSvg(LoaderCircle)}</span>
          <span data-save-dot class="dirty-dot" aria-hidden="true"></span>
          <span data-save-label>${messages.stateClean}</span>
        </span>
      </div>
    </footer>
  </main>
`

configureWindowChrome(platform)

const editorHost = app.querySelector<HTMLElement>('[data-editor-host]')

if (!editorHost) {
  throw new Error('Desktop editor host was not found')
}

const editorRoot: HTMLElement = editorHost

let state = new EditorState({
  doc: new MemoryTextDocument(initialText),
})
const fileService = createDesktopFileService()
const largeTextFileService = createDesktopLargeTextFileService()
const documentSearchController = new DesktopDocumentSearchController()
const assetProvider = createDesktopAssetProvider({
  getMarkdownPath: () => session.file?.path,
})

let session = createDocumentSession({
  documentId: 'desktop-untitled-1',
  viewMode: 'live',
})
let notice: string = messages.ready
const developerStatusNoticeStorageKey = 'milkup.desktop.developer.showStatusNotice'
let showDeveloperStatusNotice =
  globalThis.localStorage?.getItem(developerStatusNoticeStorageKey) === 'true'
let recentFiles: readonly RecentFileEntry[] = []
let disposeFileWatchEvents: (() => void) | undefined
let sidebarCollapsed = true
let menuOpen = false
let searchOpen = false
let searchResultState: DesktopSearchState | undefined
let activeSearchResultIndex = -1
let documentSearchRunId = 0
let documentPresentation: 'markdown' | 'generated-markdown' | 'custom-view' = 'markdown'
let documentSourcePath: string | undefined
let customDocumentOutput: ControlledRendererOutput | undefined
let customDocumentTitle: string | undefined
let windowMaximized = false
let closeConfirmOpen = false
let loadingState: DocumentLoadingState = Object.freeze({ phase: 'idle' })
let saveState: DocumentSaveState = Object.freeze({ phase: 'idle' })
let closeAfterCurrentSave = false
let lastOpenDiagnostics: OpenStageDiagnostics | undefined
let currentOpenPolicy: DesktopOpenPolicy = resolveDesktopOpenPolicy({
  path: 'untitled.md',
  sizeBytes: 0,
})
let largeDocumentPreview: LargeDocumentPreviewState | undefined

let view: EditorView | undefined
let sourceView: SourceDocumentView | undefined
let pluginUiViewportFrame: number | undefined

const desktopPluginEditor: Editor = {
  get state() {
    return state
  },
  dispatch(transaction: Transaction): void {
    if (isDocumentBusy()) {
      return
    }

    if (!view && !sourceView) {
      throw new Error('Desktop editor view was not initialized')
    }

    state = state.applyTransaction(transaction)
    session = recordDocumentTransaction(session, transaction)
    updateRenderedMemoryDocument([transaction])
    renderSession()
  },
  command(command: Command): boolean {
    return command.run(desktopPluginEditor)
  },
  undo(): boolean {
    if (largeDocumentPreview?.editSession) {
      if (!largeDocumentPreview.editSession.canUndo) {
        return false
      }

      void applyLargeEditHistoryBatch('undo')
      return true
    }

    if (!state.history.canUndo) {
      return false
    }

    state = state.undo()
    session = recordDocumentTransaction(session, {
      changes: ChangeSet.insert(state.selection.main.head, ''),
      origin: { type: 'history.undo' },
    })
    updateRenderedMemoryDocument()
    renderSession()
    return true
  },
  redo(): boolean {
    if (largeDocumentPreview?.editSession) {
      if (!largeDocumentPreview.editSession.canRedo) {
        return false
      }

      void applyLargeEditHistoryBatch('redo')
      return true
    }

    if (!state.history.canRedo) {
      return false
    }

    state = state.redo()
    session = recordDocumentTransaction(session, {
      changes: ChangeSet.insert(state.selection.main.head, ''),
      origin: { type: 'history.redo' },
    })
    updateRenderedMemoryDocument()
    renderSession()
    return true
  },
}

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
  'file:delete',
  'network:access',
  'view:write',
]) satisfies readonly ActionPermission[]
let invalidatePluginUi: (pluginId: string, viewId?: string) => Promise<void> = async () => undefined
const desktopPluginManager = new DesktopPluginManager({
  actionRegistry: desktopActionRegistry,
  manifestHost: createDesktopPluginManifestHost(),
  permissions: desktopActionPermissions,
  milkupVersion: appVersion,
  pluginSdkVersion: '0.1.0',
  storage: globalThis.localStorage,
  documentSource: () => {
    if (documentPresentation === 'custom-view') return undefined
    return largeDocumentPreview?.source ?? createMemoryDocumentSource()
  },
  invalidateUi: (pluginId, viewId) => invalidatePluginUi(pluginId, viewId),
  revealLine: (line) => revealPluginLine(line),
  loadSidecarModule: async (manifest, executable, capabilities) => ({
    module: createSidecarPluginModule({
      manifest,
      process: createDesktopPluginSidecarProcess({ executable }),
      ...(capabilities?.documentBroker ? { documentBroker: capabilities.documentBroker } : {}),
      ...(capabilities?.uiBroker ? { uiBroker: capabilities.uiBroker } : {}),
      timeoutMs: 10_000,
    }),
    dispose: () => undefined,
  }),
})
const desktopPluginUi = new DesktopPluginUiController(
  appRoot,
  {
    contributions: () => desktopPluginManager.state().contributions,
    renderUi: (pluginId, viewId, phase, uiState) =>
      desktopPluginManager.renderUi(pluginId, viewId, phase, uiState),
    resolveCommand: (rendererId, command) =>
      desktopPluginManager.resolveRendererCommand(rendererId, command),
    runCommand: (command, input) => runDesktopAction(command, input),
  },
  getPluginUiRenderState,
)
invalidatePluginUi = (pluginId, viewId) => desktopPluginUi.invalidate(pluginId, viewId)

for (const action of createDesktopPluginActions(desktopPluginManager)) {
  desktopActionRegistry.register(action)
}

renderPluginManager()
void desktopPluginManager.ready.then(() => {
  renderPluginManager()
  refreshPluginContributionsInViews()
  void desktopPluginUi.sync(session.documentId)
})

view = createEditorView()

renderSession()
updateModeToggle(view.viewMode)
focusActiveView()

void openInitialDocument()

app.querySelector<HTMLButtonElement>('[data-mode-toggle]')?.addEventListener('click', () => {
  runDesktopAction('view.setMode', { mode: getNextViewMode(session.viewMode) })
})

bindCommand('new', 'file.new')
bindCommand('open-sample', 'file.open')
bindCommand('save', 'file.save')
bindCommand('reload-external', 'file.reloadExternal')
bindCommand('save-as', 'file.saveAs')
bindCommand('reveal', 'file.revealInFolder')
bindCommand('close', 'file.close')

const developerStatusNoticeToggle = appRoot.querySelector<HTMLInputElement>(
  '[data-developer-status-notice]',
)
if (developerStatusNoticeToggle) {
  developerStatusNoticeToggle.checked = showDeveloperStatusNotice
  developerStatusNoticeToggle.addEventListener('change', () => {
    showDeveloperStatusNotice = developerStatusNoticeToggle.checked
    globalThis.localStorage?.setItem(
      developerStatusNoticeStorageKey,
      String(showDeveloperStatusNotice),
    )
    renderSession()
  })
}

appRoot.querySelector<HTMLElement>('[data-plugin-manager]')?.addEventListener('click', (event) => {
  const target = event.target
  const button = target instanceof HTMLElement ? target.closest<HTMLButtonElement>('button') : null

  if (!button?.dataset.pluginAction) {
    return
  }

  const pluginId = button.dataset.pluginId

  switch (button.dataset.pluginAction) {
    case 'install':
      runDesktopAction('plugin.installLocal')
      break
    case 'enable':
      runDesktopAction('plugin.enable', { pluginId })
      break
    case 'disable':
      runDesktopAction('plugin.disable', { pluginId })
      break
    case 'reload':
      runDesktopAction('plugin.reload', { pluginId })
      break
    case 'remove':
      runDesktopAction('plugin.remove', { pluginId })
      break
    case 'export':
      runDesktopAction('plugin.export', { pluginId })
      break
    case 'approve':
      runDesktopAction('plugin.approve', { pluginId })
      break
    case 'revoke-approval':
      runDesktopAction('plugin.revokeApproval', { pluginId })
      break
    case 'command':
      if (button.dataset.pluginCommand) {
        runDesktopAction(button.dataset.pluginCommand)
      }
      break
    case 'open-ui':
      if (pluginId && button.dataset.pluginUiId) {
        void desktopPluginUi.open(pluginId, button.dataset.pluginUiId)
      }
      break
  }
})

app.querySelector<HTMLButtonElement>('[data-menu-toggle]')?.addEventListener('click', () => {
  setMenuOpen(!menuOpen)
})

app.querySelector<HTMLButtonElement>('[data-menu-close]')?.addEventListener('click', () => {
  setMenuOpen(false)
})

app.querySelector<HTMLButtonElement>('[data-sidebar-toggle]')?.addEventListener('click', () => {
  setSidebarCollapsed(!sidebarCollapsed)
})

app.querySelector<HTMLButtonElement>('[data-search-close]')?.addEventListener('click', () => {
  setSearchOpen(false)
})

app.querySelector<HTMLButtonElement>('[data-search-previous]')?.addEventListener('click', () => {
  void moveSearchResult(-1)
})

app.querySelector<HTMLButtonElement>('[data-search-next]')?.addEventListener('click', () => {
  void moveSearchResult(1)
})

app.querySelector<HTMLButtonElement>('[data-loading-dismiss]')?.addEventListener('click', () => {
  if (loadingState.phase === 'failed') {
    setDocumentLoadingState({ phase: 'ready' })
    view?.inputDOM.focus({ preventScroll: true })
  }
})

app.querySelector<HTMLInputElement>('[data-search-input]')?.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    event.preventDefault()
    setSearchOpen(false)
    return
  }

  if (event.key === 'Enter') {
    event.preventDefault()
    const input = event.currentTarget

    if (input instanceof HTMLInputElement) {
      void runDocumentSearch(input.value)
    }
    return
  }

  if (
    !event.altKey &&
    !event.isComposing &&
    isPrimaryShortcut(event) &&
    event.key.toLowerCase() === 'f'
  ) {
    event.preventDefault()
    setSearchOpen(false)
  }
})

app.querySelector<HTMLInputElement>('[data-search-input]')?.addEventListener('input', (event) => {
  const input = event.currentTarget

  if (!(input instanceof HTMLInputElement)) {
    return
  }

  const query = input.value

  if (query.trim().length === 0) {
    clearSearchResults()
  }
})

for (const button of Array.from(app.querySelectorAll<HTMLButtonElement>('[data-menu-section]'))) {
  button.addEventListener('click', () => {
    const section = button.dataset.menuSection

    if (section) {
      showMenuSection(section)
    }
  })
}

for (const button of Array.from(app.querySelectorAll<HTMLButtonElement>('[data-window-control]'))) {
  button.addEventListener('click', () => {
    const action = button.dataset.windowControl

    if (action === 'minimize' || action === 'maximize' || action === 'close') {
      runWindowControl(action)
    }
  })
}

for (const button of Array.from(
  app.querySelectorAll<HTMLButtonElement>('[data-close-confirm-action]'),
)) {
  button.addEventListener('click', () => {
    const action = button.dataset.closeConfirmAction

    if (action === 'cancel') {
      closeWindowConfirm()
      return
    }

    if (action === 'save') {
      void saveAndExitWindow()
      return
    }

    if (action === 'discard') {
      void discardAndExitWindow()
    }
  })
}

appRoot.addEventListener('pointerdown', (event) => {
  if (event.button !== 0 || platform !== 'windows') {
    return
  }

  const target = event.target

  if (!(target instanceof HTMLElement) || !target.closest('[data-window-drag-region]')) {
    return
  }

  if (target.closest('button, input, textarea, a, .window-controls')) {
    return
  }

  void startWindowDrag()
})

globalThis.addEventListener(
  'keydown',
  (event) => {
    if (event.key === 'Escape') {
      if (closeConfirmOpen) {
        event.preventDefault()
        closeWindowConfirm()
        return
      }

      if (searchOpen) {
        event.preventDefault()
        setSearchOpen(false)
        return
      }

      if (menuOpen) {
        event.preventDefault()
        setMenuOpen(false)
        return
      }
    }

    if (
      !event.altKey &&
      !event.isComposing &&
      isPrimaryShortcut(event) &&
      event.key.toLowerCase() === 'f'
    ) {
      event.preventDefault()
      setSearchOpen(!searchOpen)
      return
    }

    const action = getDesktopShortcutAction(event)

    if (!action) {
      return
    }

    event.preventDefault()
    runDesktopAction(action.id, action.input)
  },
  { capture: true },
)

bindEditorViewClipboard(view)

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
  if (isDocumentBusy() && !isBusyAllowedAction(id)) {
    notice = '文档正在打开，请稍候。'
    renderSession()
    return
  }

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
    .then(() => {
      if (id.startsWith('plugin.')) {
        renderPluginManager()
        refreshPluginContributionsInViews()
      }
    })
    .catch((error: unknown) => {
      notice = `命令执行失败：${getErrorMessage(error)}`
      if (id.startsWith('plugin.')) {
        renderPluginManager()
        refreshPluginContributionsInViews()
      }
      renderSession()
      view?.inputDOM.focus({ preventScroll: true })
    })
}

function focusActiveView(): void {
  if (view) {
    view.inputDOM.focus({ preventScroll: true })
    return
  }

  sourceView?.dom.focus({ preventScroll: true })
}

function focusEditableView(): void {
  view?.inputDOM.focus({ preventScroll: true })
}

function bindEditorViewClipboard(editorView: EditorView): void {
  editorView.inputDOM.addEventListener('copy', (event) => {
    if (copySelectionToClipboard(event)) {
      event.preventDefault()
    }
  })

  editorView.inputDOM.addEventListener('cut', (event) => {
    if (copySelectionToClipboard(event)) {
      event.preventDefault()
      runDesktopAction('document.cutSelection')
    }
  })
}

function createEditorView(): EditorView {
  sourceView?.destroy()
  sourceView = undefined

  const nextView = new EditorView({
    parent: editorRoot,
    state,
    mode: session.viewMode,
    editable: !session.readonly && !isDocumentBusy(),
    assetProvider,
    controlledRenderers: createDesktopControlledRenderers(),
    markdownSyntax: desktopPluginManager.state().contributions.markdownSyntax,
    ...(currentOpenPolicy.virtualViewport === undefined
      ? {}
      : {
          virtualViewport: {
            ...currentOpenPolicy.virtualViewport,
            lineHeight: desktopVirtualLineHeight,
          },
        }),
    dispatch: (transaction: Transaction) => {
      if (isDocumentBusy()) {
        return
      }

      if (!view) {
        throw new Error('Desktop editor view was not initialized')
      }

      state = state.applyTransaction(transaction)
      session = recordDocumentTransaction(session, transaction)
      view.updateState(state, [transaction])
      renderSession()
    },
  })
  nextView.dom.addEventListener('milkup-plugin-renderer-action', (event) => {
    const detail = (event as CustomEvent<ControlledRendererActionDetail>).detail
    const command = desktopPluginManager.resolveRendererCommand(detail.rendererId, detail.command)

    if (command) {
      runDesktopAction(command, detail.input ?? {})
    }
  })
  nextView.dom.addEventListener('scroll', schedulePluginUiViewportUpdate, { passive: true })
  bindEditorViewClipboard(nextView)
  nextView.setSearchHighlights(searchResultState?.matches ?? [], activeSearchResultIndex)
  return nextView
}

function createDesktopControlledRenderers(): readonly ControlledRenderer[] {
  return Object.freeze(
    desktopPluginManager.state().contributions.renderers.map((renderer) =>
      Object.freeze({
        id: `${renderer.pluginId}:${renderer.id}`,
        nodeType: renderer.nodeType,
        render: (context: ControlledRendererContext): Promise<ControlledRendererOutput> =>
          desktopPluginManager.render(renderer.pluginId, renderer.id, {
            nodeType: context.nodeType,
            source: context.source,
            node: context.node,
          }) as Promise<ControlledRendererOutput>,
      }),
    ),
  )
}

function recreateEditorView(): void {
  view?.destroy()
  view = createEditorView()
}

function refreshPluginContributionsInViews(): void {
  void desktopPluginUi.sync(session.documentId)
  if (view) {
    const restoreEditorFocus = editorRoot.contains(document.activeElement)
    recreateEditorView()
    if (restoreEditorFocus) {
      focusActiveView()
    }
    return
  }

  applyEditorViewState()
}

function applyEditorViewState(): void {
  if (documentPresentation === 'custom-view' && customDocumentOutput !== undefined) {
    view?.destroy()
    view = undefined
    sourceView?.destroy()
    sourceView = undefined
    editorRoot.replaceChildren(
      ...createControlledRendererNodes(
        document,
        `document:${session.documentId}`,
        customDocumentOutput,
      ),
    )
    return
  }

  if (currentOpenPolicy.useMemoryVirtualViewport) {
    applyMemorySourceView()
    return
  }

  if (sourceView) {
    recreateEditorView()
  }

  if (!view) {
    return
  }

  const shouldUseVirtualViewport = currentOpenPolicy.useMemoryVirtualViewport
  const viewHasVirtualViewport = view.contentDOM.dataset.virtualized === 'true'

  if (shouldUseVirtualViewport !== viewHasVirtualViewport) {
    recreateEditorView()
    return
  }

  view.updateState(state)
}

function applyMemorySourceView(): void {
  view?.destroy()
  view = undefined

  const source = createMemoryDocumentSource()

  if (sourceView && !largeDocumentPreview) {
    sourceView.updateSource(source)
    sourceView.setMode(session.viewMode)
    sourceView.setEditable(!session.readonly && !isDocumentBusy())
    sourceView.setSearchHighlights(searchResultState?.matches ?? [], activeSearchResultIndex)
    return
  }

  sourceView?.destroy()
  sourceView = new SourceDocumentView({
    parent: editorRoot,
    source,
    mode: session.viewMode,
    editable: !session.readonly && !isDocumentBusy(),
    onEdit: (edit) => applyMemorySourceEdit(edit),
    markdownContextLines: 24,
    backgroundMarkdownWarmup: true,
    markdownWarmupWindows: 1,
    virtualViewport: {
      enabled: true,
      lineHeight: desktopVirtualLineHeight,
      overscanLines: 24,
    },
  })
  sourceView.dom.addEventListener('scroll', schedulePluginUiViewportUpdate, { passive: true })
  sourceView.setSearchHighlights(searchResultState?.matches ?? [], activeSearchResultIndex)
}

function updateRenderedMemoryDocument(transactions: readonly Transaction[] = []): void {
  if (view) {
    view.updateState(state, transactions)
    return
  }

  if (sourceView && !largeDocumentPreview) {
    sourceView.updateSource(createMemoryDocumentSource())
  }
}

function createMemoryDocumentSource(): MemoryDocumentSource {
  return new MemoryDocumentSource({
    documentId: session.documentId,
    document: state.doc,
    version: session.documentVersion,
  })
}

async function applyLargeSourceView(): Promise<void> {
  if (!largeDocumentPreview) {
    return
  }

  view?.destroy()
  view = undefined
  sourceView?.destroy()
  sourceView = new SourceDocumentView({
    parent: editorRoot,
    source: largeDocumentPreview.source,
    mode: session.viewMode,
    editable: !session.readonly && !isDocumentBusy(),
    onEdit: (edit) => applyLargeSourceEdit(edit),
    markdownContextLines: 24,
    backgroundMarkdownWarmup: true,
    markdownWarmupWindows: 1,
    virtualViewport: {
      enabled: true,
      lineHeight: desktopVirtualLineHeight,
      overscanLines: 24,
    },
  })
  sourceView.dom.addEventListener('scroll', schedulePluginUiViewportUpdate, { passive: true })
  sourceView.setSearchHighlights(searchResultState?.matches ?? [], activeSearchResultIndex)
  await sourceView.renderVisibleWindow()
}

function createNewDocument(): void {
  const action: FileAction = {
    kind: 'new',
    documentId: `desktop-untitled-${Date.now()}`,
  }

  clearSearchResults()
  unwatchCurrentFile()
  clearPluginDocumentPresentation()
  void closeLargeDocumentPreview()
  state = new EditorState({
    doc: new MemoryTextDocument(messages.newDocumentSource),
  })
  currentOpenPolicy = resolveDesktopOpenPolicy({ path: 'untitled.md', sizeBytes: 0 })
  session = createDocumentSession({
    documentId: getRequiredDocumentId(action),
    viewMode: session.viewMode,
  })
  applyEditorViewState()
  notice = messages.notices.newDocumentCreated
  renderSession()
  focusActiveView()
}

async function openDocument(): Promise<void> {
  const tracker = createOpenStageTracker({
    label: 'open-file',
    consoleDiagnostics: isDeveloperDiagnosticsEnabled(),
  })

  await openSelectedDocumentWithPolicy(
    tracker,
    () => fileService.selectOpenFile(desktopPluginManager.supportedDocumentExtensions()),
    {
      cancelledNotice: messages.notices.openCancelled,
      errorPrefix: '打开文件失败',
    },
  )
}

async function openInitialDocument(): Promise<void> {
  const path = await fileService.initialOpenFilePath().catch((error: unknown) => {
    notice = `启动文件读取失败：${getErrorMessage(error)}`
    renderSession()
    return undefined
  })

  if (!path) {
    return
  }

  const tracker = createOpenStageTracker({
    label: path,
    consoleDiagnostics: isDeveloperDiagnosticsEnabled(),
  })

  await openSelectedDocumentWithPolicy(tracker, async () => path, {
    errorPrefix: '启动文件打开失败',
  })
}

async function openSelectedDocumentWithPolicy(
  tracker: OpenStageTracker,
  selectPath: () => Promise<string | undefined>,
  messages: { readonly cancelledNotice?: string; readonly errorPrefix: string },
): Promise<void> {
  setDocumentLoadingState({ phase: 'opening' })

  try {
    const selected = await selectPath()

    if (!selected) {
      setDocumentLoadingState({ phase: 'ready' })
      if (messages.cancelledNotice) {
        notice = messages.cancelledNotice
        renderSession()
        view?.inputDOM.focus({ preventScroll: true })
      }
      return
    }

    tracker.mark('native-dialog-selected', selected)
    const metadata = await fileService.getFileMetadata(selected)
    tracker.mark('file-metadata', `${metadata.sizeBytes} bytes`)
    const openPolicy = resolveDesktopOpenPolicy(metadata)
    const pluginDocumentCandidate = desktopPluginManager
      .supportedDocumentExtensions()
      .some((extension) => selected.toLowerCase().endsWith(`.${extension}`))
    let nativeFallbackNotice = ''

    if (openPolicy.useNativeLargeFile && !pluginDocumentCandidate) {
      setDocumentLoadingState({
        phase: 'indexing',
        path: selected,
        sizeBytes: metadata.sizeBytes,
      })
      try {
        await openNativeLargeDocument(selected, openPolicy, tracker)
        setDocumentLoadingState({
          phase: 'ready',
          path: selected,
          sizeBytes: metadata.sizeBytes,
        })
        return
      } catch (error: unknown) {
        nativeFallbackNotice = `原生行窗口打开失败，已退回内存视口渲染：${getErrorMessage(error)}`
      }
    }

    tracker.mark('file-read-start', selected)
    const result = await fileService.openPath(selected, {
      onProgress: (event) => {
        if (event.phase === 'read-end') {
          tracker.mark('file-read-end', selected)
        }
      },
    })
    const pluginDocument = await desktopPluginManager.openPluginDocument(selected, result.text)

    if (pluginDocument) {
      openPluginDocumentResult(pluginDocument)
      setDocumentLoadingState({
        phase: 'ready',
        path: selected,
        sizeBytes: metadata.sizeBytes,
      })
      return
    }
    openDocumentResult(result, tracker, {
      preResolvedPolicy: openPolicy.useNativeLargeFile
        ? resolveDesktopMemoryViewportFallbackPolicy(metadata)
        : openPolicy,
    })
    if (nativeFallbackNotice) {
      notice = nativeFallbackNotice
      renderSession()
    }
    setDocumentLoadingState({
      phase: 'ready',
      path: selected,
      sizeBytes: metadata.sizeBytes,
    })
  } catch (error) {
    setDocumentLoadingState({
      phase: 'failed',
      message: getErrorMessage(error),
    })
    notice = `${messages.errorPrefix}：${getErrorMessage(error)}`
    renderSession()
    view?.inputDOM.focus({ preventScroll: true })
  }
}

function openDocumentResult(
  result: OpenFileResult,
  tracker: OpenStageTracker,
  options: { readonly preResolvedPolicy?: DesktopOpenPolicy } = {},
): void {
  const nextOpenPolicy =
    options.preResolvedPolicy ?? resolveDesktopOpenPolicy(metadataFromOpenFileResult(result))

  if (nextOpenPolicy.useNativeLargeFile) {
    void openNativeLargeDocument(result.file.path, nextOpenPolicy, tracker)
    return
  }

  unwatchCurrentFile()
  clearPluginDocumentPresentation()
  void closeLargeDocumentPreview()
  clearSearchResults()
  tracker.mark('memory-document-start', result.file.path)
  state = new EditorState({
    doc: new MemoryTextDocument(result.text),
  })
  tracker.mark('memory-document-end', `${state.doc.lineCount} lines`)
  currentOpenPolicy = nextOpenPolicy
  const nextViewMode = session.viewMode
  tracker.mark('markdown-parse-start', nextViewMode)
  session = createDocumentSessionFromOpenResult(result, session.viewMode)
  if (session.viewMode !== nextViewMode) {
    session = recordModeChange(session, nextViewMode)
  }
  recentFiles = recordRecentFile(recentFiles, result.file, Date.now())
  watchCurrentFile()
  applyEditorViewState()
  tracker.mark('markdown-parse-end')
  tracker.mark('first-editor-paint')
  notice = ''
  renderSession()
  focusActiveView()
  tracker.mark('first-interactive-focus')
  lastOpenDiagnostics = tracker.snapshot()
  renderSession()
}

function openPluginDocumentResult(
  result: NonNullable<Awaited<ReturnType<DesktopPluginManager['openPluginDocument']>>>,
): void {
  unwatchCurrentFile()
  void closeLargeDocumentPreview()
  clearSearchResults()
  documentSourcePath = result.sourcePath
  customDocumentTitle = result.title
  currentOpenPolicy = resolveDesktopOpenPolicy({ path: result.sourcePath, sizeBytes: 0 })

  if (result.kind === 'generated-markdown') {
    documentPresentation = 'generated-markdown'
    customDocumentOutput = undefined
    const transaction: Transaction = {
      changes: ChangeSet.of([{ from: 0, to: 0, insert: result.markdown }]),
      origin: { type: 'command', id: `plugin.importer.${result.contributionId}` },
      historyGroup: 'isolate',
    }
    state = new EditorState({ doc: new MemoryTextDocument('') }).applyTransaction(transaction)
    session = recordDocumentTransaction(
      createDocumentSession({
        documentId: `plugin-import:${result.pluginId}:${Date.now()}`,
        viewMode: session.viewMode,
      }),
      transaction,
    )
  } else {
    documentPresentation = 'custom-view'
    customDocumentOutput = result.output as ControlledRendererOutput
    state = new EditorState({ doc: new MemoryTextDocument('') })
    session = createDocumentSession({
      documentId: `plugin-view:${result.pluginId}:${Date.now()}`,
      viewMode: session.viewMode,
      readonly: true,
    })
  }

  applyEditorViewState()
  notice =
    result.kind === 'generated-markdown'
      ? `已从 ${result.sourcePath} 生成 Markdown；保存时将另存为新文件`
      : `正在以只读插件视图显示 ${result.sourcePath}`
  renderSession()
  focusActiveView()
}

function clearPluginDocumentPresentation(): void {
  documentPresentation = 'markdown'
  documentSourcePath = undefined
  customDocumentOutput = undefined
  customDocumentTitle = undefined
}

async function openNativeLargeDocument(
  path: string,
  openPolicy: DesktopOpenPolicy,
  tracker: OpenStageTracker,
): Promise<void> {
  const previousLargeDocumentId = largeDocumentPreview?.documentId
  const documentId = `desktop-large-${Date.now()}`

  tracker.mark('memory-document-start', 'native-large-open')
  const preview = await openLargeDocumentPreview({
    service: largeTextFileService,
    documentId,
    path,
    previewLineCount: largePreviewLineCount,
  })

  if (previousLargeDocumentId) {
    await largeTextFileService.close(previousLargeDocumentId).catch(() => undefined)
  }

  unwatchCurrentFile()
  clearPluginDocumentPresentation()
  clearSearchResults()
  currentOpenPolicy = openPolicy
  largeDocumentPreview = {
    ...preview,
    editSession: new LargeEditSession({
      documentId,
      baseVersion: preview.version,
      savedVersion: preview.version,
    }),
  }
  state = new EditorState({ doc: new MemoryTextDocument('') })
  session = createDocumentSession({
    documentId,
    file: { path: preview.path },
    diskSnapshotHash: largeSnapshotHash(preview.version, preview.sizeBytes),
    readonly: openPolicy.metadata.readonly ?? false,
    viewMode: 'live',
  })
  await applyLargeSourceView()
  tracker.mark('memory-document-end', `${preview.window.lines.length} preview lines`)
  tracker.mark('first-editor-paint', `${openPolicy.featurePolicy.mode} native-line-window`)
  notice = `已用原生大文件路径打开预览：${formatBytes(preview.sizeBytes)}，${preview.lineCount} 行。`
  renderSession()
  focusActiveView()
  tracker.mark('first-interactive-focus')
  lastOpenDiagnostics = tracker.snapshot()
  renderSession()
}

function isDocumentSaving(): boolean {
  return saveState.phase === 'saving'
}

function runDocumentSave(task: () => Promise<boolean>): Promise<boolean> {
  if (saveState.phase === 'saving') {
    return saveState.promise
  }

  const promise = task()
  saveState = Object.freeze({ phase: 'saving', promise })
  renderSession()

  void promise
    .then(async (saved) => {
      saveState = Object.freeze({ phase: 'idle' })
      const shouldClose = closeAfterCurrentSave && saved && !session.dirty
      closeAfterCurrentSave = false
      renderSession()

      if (shouldClose) {
        await invokeWindowClose()
      } else if (closeConfirmOpen) {
        renderCloseConfirmState()
      }
    })
    .catch((error: unknown) => {
      saveState = Object.freeze({ phase: 'idle' })
      closeAfterCurrentSave = false
      notice = `保存失败：${getErrorMessage(error)}`
      renderSession()

      if (closeConfirmOpen) {
        renderCloseConfirmState()
      }
    })

  return promise
}

async function saveDocument(): Promise<boolean> {
  return runDocumentSave(saveDocumentOnce)
}

async function saveDocumentOnce(): Promise<boolean> {
  if (!view) {
    if (largeDocumentPreview) {
      return saveLargeDocument()
    }
    if (sourceView) {
      return saveMemorySourceDocument()
    }
    notice = '当前没有可保存的编辑视图。'
    renderSession()
    focusActiveView()
    return false
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
    focusEditableView()
    return false
  }

  const result = await fileService.saveFile(
    session,
    prepareTextForFileSave(session, state.doc.text),
  )

  if (!result) {
    notice = messages.notices.saveCancelled
    renderSession()
    focusEditableView()
    return false
  }

  session = recordFileSaveResult(session, result)
  recentFiles = recordRecentFile(recentFiles, result.file, Date.now())
  watchCurrentFile()
  notice = messages.notices.saved
  renderSession()
  focusEditableView()
  return true
}

async function saveMemorySourceDocument(): Promise<boolean> {
  const action: FileAction = {
    kind: 'save',
    documentId: session.documentId,
  }

  getRequiredDocumentId(action)
  const safety = getSaveSafety(session)

  if (!safety.canSave) {
    notice = translateSaveSafetyMessage(safety.message)
    renderSession()
    focusActiveView()
    return false
  }

  await sourceView?.flushPendingEdits()
  const result = await fileService.saveFile(
    session,
    prepareTextForFileSave(session, state.doc.text),
  )

  if (!result) {
    notice = messages.notices.saveCancelled
    renderSession()
    focusActiveView()
    return false
  }

  session = recordFileSaveResult(session, result)
  recentFiles = recordRecentFile(recentFiles, result.file, Date.now())
  watchCurrentFile()
  notice = messages.notices.saved
  renderSession()
  focusActiveView()
  return true
}

async function saveLargeDocument(): Promise<boolean> {
  if (!largeDocumentPreview?.editSession) {
    return false
  }

  const safety = getSaveSafety(session)

  if (!safety.canSave) {
    notice = translateSaveSafetyMessage(safety.message)
    renderSession()
    focusActiveView()
    return false
  }

  let saveStage = '提交编辑队列'

  try {
    notice = `正在保存大文件：${saveStage}…`
    renderSession()
    console.info(`Large document save started: ${saveStage}`)
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await sourceView?.flushPendingEdits()
      saveStage = '写入文件'
      notice = `正在保存大文件：${saveStage}…`
      renderSession()
      console.info(`Large document save progressed: ${saveStage}`)
      const editSnapshot = largeDocumentPreview.editSession.snapshot()
      const snapshot = await largeTextFileService.flush(
        largeDocumentPreview.documentId,
        editSnapshot.version,
      )
      largeDocumentPreview.source.applyNativeSnapshot(snapshot)
      largeDocumentPreview.editSession.markFlushed(snapshot.version)
      session = recordFileSaveResult(session, {
        documentId: session.documentId,
        file: { path: snapshot.path },
        diskSnapshotHash: largeSnapshotHash(snapshot.version, snapshot.sizeBytes),
      })

      // An edit can have started immediately before saving disabled the input.
      await sourceView?.flushPendingEdits()
      if (!session.dirty && largeDocumentPreview.editSession.version === snapshot.version) {
        break
      }

      if (attempt === 2) {
        throw new Error('Large document changed repeatedly while saving')
      }
      saveStage = '提交保存期间开始的编辑'
    }
    notice = messages.notices.saved
    renderSession()
    focusActiveView()
    return true
  } catch (error: unknown) {
    console.error(`Large document save failed while ${saveStage}`, error)
    const message = getErrorMessage(error)
    notice = message.includes('os error 32')
      ? '原文件正被其他程序占用，未覆盖。请关闭占用程序后重试，或使用“另存为”。'
      : `大文件保存失败（${saveStage}）：${translateSaveSafetyMessage(message)}`
    renderSession()
    focusActiveView()
    return false
  }
}

async function applyMemorySourceEdit(edit: {
  readonly from: number
  readonly to: number
  readonly insert: string
}): Promise<void> {
  const transaction: Transaction = {
    changes: ChangeSet.replace(edit.from, edit.to, edit.insert),
    selection: Selection.cursor(edit.from + edit.insert.length),
    origin: { type: 'input.type', id: 'memory-source-edit' },
  }

  state = state.applyTransaction(transaction)
  session = recordDocumentTransaction(session, transaction)
  updateRenderedMemoryDocument([transaction])
  renderSession()
}

async function applyLargeSourceEdit(edit: {
  readonly from: number
  readonly to: number
  readonly insert: string
  readonly deletedText: string
}): Promise<void> {
  const preview = largeDocumentPreview
  const editSession = preview?.editSession

  if (!preview || !editSession) {
    return
  }

  const expectedVersion = editSession.version
  const batch = editSession.prepareVisibleEdits(
    ChangeSet.replace(edit.from, edit.to, edit.insert),
    [edit.deletedText],
  )
  let snapshot

  try {
    snapshot = await applyLargeDocumentEditBatch({
      service: largeTextFileService,
      documentId: preview.documentId,
      expectedVersion,
      batch,
    })
  } catch (error: unknown) {
    notice = `大文件编辑失败：${getErrorMessage(error)}`
    await sourceView?.renderVisibleWindow()
    renderSession()
    return
  }

  if (!snapshot) {
    return
  }

  editSession.confirmVisibleEdits(batch, snapshot.version)
  preview.source.applyNativeSnapshot(snapshot)
  session = recordDocumentTransaction(session, {
    changes: ChangeSet.replace(edit.from, edit.to, edit.insert),
    selection: Selection.cursor(edit.from + edit.insert.length),
    origin: { type: 'input.type', id: 'large-source-edit' },
  })
  notice = `已应用大文件可见范围编辑；版本 ${snapshot.version}。`
  renderSession()
}

async function applyLargeEditHistoryBatch(direction: 'undo' | 'redo'): Promise<void> {
  const preview = largeDocumentPreview
  const editSession = preview?.editSession

  if (!preview || !editSession) {
    return
  }

  const expectedVersion = editSession.version
  const batch = direction === 'undo' ? editSession.prepareUndo() : editSession.prepareRedo()

  if (!batch) {
    return
  }

  try {
    const snapshot = await applyLargeDocumentEditBatch({
      service: largeTextFileService,
      documentId: preview.documentId,
      expectedVersion,
      batch,
    })

    if (snapshot) {
      if (direction === 'undo') {
        editSession.confirmUndo(snapshot.version)
      } else {
        editSession.confirmRedo(snapshot.version)
      }
      preview.source.applyNativeSnapshot(snapshot)
    }

    session = recordDocumentTransaction(session, {
      changes: largeTextEditsToChangeSet(batch.edits),
      origin: { type: 'history.undo', id: `large-${direction}` },
    })
    notice = direction === 'undo' ? '已撤销大文件编辑。' : '已重做大文件编辑。'
    await sourceView?.renderVisibleWindow()
    renderSession()
    focusActiveView()
  } catch (error: unknown) {
    notice = `大文件${direction === 'undo' ? '撤销' : '重做'}失败：${getErrorMessage(error)}`
    renderSession()
    focusActiveView()
  }
}

async function reloadExternalDocument(): Promise<void> {
  if (!view) {
    if (largeDocumentPreview) {
      await reloadLargeExternalDocument()
    }
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
  void closeLargeDocumentPreview()
  currentOpenPolicy = resolveDesktopOpenPolicy(metadataFromOpenFileResult(result))
  session = recordFileReloadResult(session, result)
  recentFiles = recordRecentFile(recentFiles, result.file, Date.now())
  watchCurrentFile()
  applyEditorViewState()
  notice = messages.notices.reloadedExternal
  renderSession()
  view.inputDOM.focus({ preventScroll: true })
}

async function reloadLargeExternalDocument(): Promise<void> {
  const path = session.file?.path ?? largeDocumentPreview?.source.path

  if (!path) {
    notice = '当前大文件没有可重新载入的路径。'
    renderSession()
    focusActiveView()
    return
  }

  const reloadDecision = getLargeExternalReloadDecision(session)

  if (reloadDecision.kind === 'blocked') {
    notice = reloadDecision.message
    renderSession()
    focusActiveView()
    return
  }

  if (
    reloadDecision.kind === 'confirm-discard-and-reload' &&
    !globalThis.confirm(reloadDecision.message)
  ) {
    notice = '已取消重新载入；本地大文件编辑仍保留。'
    renderSession()
    focusActiveView()
    return
  }

  const tracker = createOpenStageTracker({
    label: `reload-large:${path}`,
    consoleDiagnostics: isDeveloperDiagnosticsEnabled(),
  })

  try {
    setDocumentLoadingState({ phase: 'indexing', path })
    tracker.mark('native-dialog-selected', path)
    const metadata = await fileService.getFileMetadata(path)
    tracker.mark('file-metadata', `${metadata.sizeBytes} bytes`)
    const openPolicy = resolveDesktopOpenPolicy(metadata)

    if (openPolicy.useNativeLargeFile) {
      await openNativeLargeDocument(path, openPolicy, tracker)
    } else {
      tracker.mark('file-read-start', path)
      const result = await fileService.openPath(path, {
        onProgress: (event) => {
          if (event.phase === 'read-end') {
            tracker.mark('file-read-end', path)
          }
        },
      })
      openDocumentResult(result, tracker, { preResolvedPolicy: openPolicy })
    }

    setDocumentLoadingState({ phase: 'ready', path, sizeBytes: metadata.sizeBytes })
    notice = messages.notices.reloadedExternal
    renderSession()
    focusActiveView()
  } catch (error: unknown) {
    setDocumentLoadingState({
      phase: 'failed',
      path,
      message: getErrorMessage(error),
    })
    notice = `大文件重新载入失败：${getErrorMessage(error)}`
    renderSession()
    focusActiveView()
  }
}

async function saveDocumentAs(): Promise<void> {
  await runDocumentSave(async () => {
    await saveDocumentAsOnce()
    return !session.dirty
  })
}

async function saveDocumentAsOnce(): Promise<void> {
  if (!view) {
    if (largeDocumentPreview) {
      await saveLargeDocumentAs()
      return
    }
    if (sourceView) {
      await saveMemorySourceDocumentAs()
      return
    }
    notice = '当前没有可另存为的编辑视图。'
    renderSession()
    focusActiveView()
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

async function saveMemorySourceDocumentAs(): Promise<void> {
  const action: FileAction = {
    kind: 'saveAs',
    documentId: session.documentId,
    path: session.file?.path ?? 'untitled.md',
  }
  const safety = getSaveSafety(session)

  if (!safety.canSave) {
    notice = translateSaveSafetyMessage(safety.message)
    renderSession()
    focusActiveView()
    return
  }

  getRequiredDocumentId(action)
  await sourceView?.flushPendingEdits()
  const result = await fileService.saveFileAs(
    session,
    prepareTextForFileSave(session, state.doc.text),
  )

  if (!result) {
    notice = messages.notices.saveAsCancelled
    renderSession()
    focusActiveView()
    return
  }

  session = recordFileSaveResult(session, result)
  recentFiles = recordRecentFile(recentFiles, result.file, Date.now())
  watchCurrentFile()
  notice = messages.notices.savedAs
  renderSession()
  focusActiveView()
}

async function saveLargeDocumentAs(): Promise<void> {
  const preview = largeDocumentPreview
  const editSession = preview?.editSession

  if (!preview || !editSession) {
    notice = '当前没有可另存为的大文件。'
    renderSession()
    focusActiveView()
    return
  }

  const selected = await fileService.selectSaveFilePath(session.file?.path ?? preview.source.path)

  if (!selected) {
    notice = messages.notices.saveAsCancelled
    renderSession()
    focusActiveView()
    return
  }

  let saveStage = '提交编辑队列'

  try {
    notice = `正在另存为大文件：${saveStage}…`
    renderSession()
    console.info(`Large document save-as started: ${saveStage}`)
    await sourceView?.flushPendingEdits()
    saveStage = '写入文件'
    notice = `正在另存为大文件：${saveStage}…`
    renderSession()
    console.info(`Large document save-as progressed: ${saveStage}`)
    const snapshot = await largeTextFileService.flushAs(
      preview.documentId,
      editSession.version,
      selected,
    )
    preview.source.applyNativeSnapshot(snapshot)
    editSession.markFlushed(snapshot.version)
    largeDocumentPreview = {
      ...preview,
      path: snapshot.path,
      version: snapshot.version,
      sizeBytes: snapshot.sizeBytes,
      lineCount: snapshot.lineCount,
    }
    session = recordFileSaveResult(session, {
      documentId: session.documentId,
      file: { path: snapshot.path },
      diskSnapshotHash: largeSnapshotHash(snapshot.version, snapshot.sizeBytes),
    })
    recentFiles = recordRecentFile(recentFiles, { path: snapshot.path }, Date.now())
    watchCurrentFile()
    notice = messages.notices.savedAs
    renderSession()
    focusActiveView()
  } catch (error: unknown) {
    console.error(`Large document save-as failed while ${saveStage}`, error)
    notice = `大文件另存为失败（${saveStage}）：${getErrorMessage(error)}`
    renderSession()
    focusActiveView()
  }
}

function largeSnapshotHash(version: number, sizeBytes: number): string {
  return `large:${version}:${sizeBytes}`
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
  focusActiveView()
}

function closeCurrentDocument(): void {
  const decision = evaluateCloseProtection([session], {
    scope: 'tab',
    documentIds: [session.documentId],
  })

  if (!decision.allowClose) {
    applyCloseDecision([session], decision, 'cancel')
    notice = `无法关闭：${decision.blockedDocumentIds.join(', ')} 有未保存更改`
    renderSession()
    focusActiveView()
    return
  }

  unwatchCurrentFile()
  clearPluginDocumentPresentation()
  void closeLargeDocumentPreview()
  clearSearchResults()
  state = new EditorState({
    doc: new MemoryTextDocument(''),
  })
  currentOpenPolicy = resolveDesktopOpenPolicy({ path: 'untitled.md', sizeBytes: 0 })
  session = createDocumentSession({
    documentId: `desktop-untitled-${Date.now()}`,
    viewMode: session.viewMode,
  })
  applyEditorViewState()
  notice = messages.notices.closedDocument
  renderSession()
  focusActiveView()
}

function setViewMode(mode: SessionViewMode): void {
  if (sourceView) {
    sourceView.setMode(mode)
    session = recordModeChange(session, mode)
    updateModeToggle(mode)
    notice = mode === 'live' ? '已切换到窗口化实时渲染；仅解析当前视口附近内容。' : ''
    renderSession()
    focusActiveView()
    return
  }

  if (!view) {
    return
  }

  view.setMode(mode)
  session = recordModeChange(session, mode)
  updateModeToggle(mode)
  renderSession()
  view.inputDOM.focus({ preventScroll: true })
}

function selectWholeDocument(): void {
  if (largeDocumentPreview) {
    notice = '大文件模式暂不支持全选；请在可见窗口内选择和编辑。'
    renderSession()
    focusActiveView()
    return
  }

  desktopPluginEditor.dispatch({
    selection: Selection.range(0, state.doc.length),
    origin: { type: 'command', id: 'document.selectAll' },
    addToHistory: false,
  })
  view?.inputDOM.focus({ preventScroll: true })
}

function cutCurrentSelection(): boolean {
  if (largeDocumentPreview) {
    notice = '大文件模式暂不支持跨窗口剪切；请在可见窗口内删除或替换文本。'
    renderSession()
    focusActiveView()
    return false
  }

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

function bindCommand(command: string, actionId: string): void {
  appRoot
    .querySelector<HTMLButtonElement>(`[data-command="${command}"]`)
    ?.addEventListener('click', () => {
      setMenuOpen(false)
      runDesktopAction(actionId)
    })
}

function renderPluginManager(): void {
  const target = appRoot.querySelector<HTMLElement>('[data-plugin-manager]')

  if (!target) {
    return
  }

  target.innerHTML = renderDesktopPluginManager(desktopPluginManager.state())
}

function createDesktopPluginManifestHost(): {
  readonly selectManifestPath: () => Promise<string | undefined>
  readonly readManifestText: (path: string) => Promise<string>
  readonly prepareModule: (
    manifest: PluginManifest,
    manifestPath: string,
    main: string,
  ) => Promise<{ readonly specifier: string; dispose(): void }>
  readonly selectPackageExportPath: (suggestedName: string) => Promise<string | undefined>
  readonly writeText: (path: string, text: string) => Promise<void>
  readonly installPackage: (archive: import('@milkup/plugin').PluginPackageArchive) => Promise<{
    readonly manifestPath: string
    readonly rootPath: string
    readonly dataRoot: string
    readonly storageRoot: string
  }>
  readonly ensureDataDirectories: (pluginId: string) => Promise<{
    readonly packageRoot: string
    readonly dataRoot: string
    readonly storageRoot: string
  }>
  readonly removeInstalledPackage: (pluginId: string) => Promise<void>
} {
  return {
    async selectManifestPath(): Promise<string | undefined> {
      if (!isTauriRuntime()) {
        return undefined
      }

      const { open } = await import('@tauri-apps/plugin-dialog')
      const selected = await open({
        multiple: false,
        filters: [{ name: 'Milkup Plugin', extensions: ['json', 'milkup-plugin'] }],
      })

      return typeof selected === 'string' ? selected : undefined
    },
    async readManifestText(path: string): Promise<string> {
      if (!isTauriRuntime()) {
        throw new Error('Local plugin install is only available in the desktop runtime')
      }

      const { invoke } = await import('@tauri-apps/api/core')
      return invoke<string>('read_plugin_text_file', { path })
    },
    async prepareModule(manifest: PluginManifest, manifestPath: string, main: string) {
      if (manifest.host === 'sidecar') {
        const executable = /^(?:[A-Za-z]:[\\/]|\/)/.test(main)
          ? main.replace(/\\/g, '/')
          : resolvePluginEntryPath(manifestPath, main)
        return {
          specifier: executable,
          dispose: () => undefined,
        }
      }

      if (/^(?:https?|data|blob|milkup):/i.test(main)) {
        return { specifier: main, dispose: () => undefined }
      }

      const manifestText = await this.readManifestText(manifestPath)
      const manifestValue = JSON.parse(manifestText) as unknown
      const source = isPluginPackageArchive(manifestValue)
        ? readPluginPackageTextFile(parsePluginPackageArchive(manifestValue), main)
        : await this.readManifestText(resolvePluginEntryPath(manifestPath, main))
      const specifier = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }))
      return { specifier, dispose: () => URL.revokeObjectURL(specifier) }
    },
    async selectPackageExportPath(suggestedName: string): Promise<string | undefined> {
      if (!isTauriRuntime()) {
        return undefined
      }

      const { save } = await import('@tauri-apps/plugin-dialog')
      const selected = await save({
        defaultPath: suggestedName,
        filters: [{ name: 'Milkup Plugin Package', extensions: ['milkup-plugin'] }],
      })
      return selected ?? undefined
    },
    async writeText(path: string, text: string): Promise<void> {
      if (!isTauriRuntime()) {
        throw new Error('Plugin package export is only available in the desktop runtime')
      }

      const { invoke } = await import('@tauri-apps/api/core')
      await invoke<boolean>('write_plugin_text_file', { path, text })
    },
    async ensureDataDirectories(pluginId: string) {
      if (!isTauriRuntime()) {
        return {
          packageRoot: `milkup://plugin-packages/${encodeURIComponent(pluginId)}`,
          dataRoot: `milkup://plugin-data/${encodeURIComponent(pluginId)}`,
          storageRoot: `milkup://plugin-storage/${encodeURIComponent(pluginId)}`,
        }
      }
      const { invoke } = await import('@tauri-apps/api/core')
      return invoke('ensure_plugin_directories', { pluginId })
    },
    async installPackage(archive) {
      if (!isTauriRuntime()) {
        throw new Error('Plugin packages can only be installed in the desktop runtime')
      }
      const { invoke } = await import('@tauri-apps/api/core')
      const directories = await this.ensureDataDirectories(archive.manifest.id)
      for (const file of archive.files) {
        const bytes =
          file.encoding === 'utf8'
            ? new TextEncoder().encode(file.content)
            : Uint8Array.from(atob(file.content), (character) => character.charCodeAt(0))
        await invoke<string>('install_plugin_package_file', {
          pluginId: archive.manifest.id,
          relativePath: file.path,
          data: Array.from(bytes),
          executable:
            archive.manifest.host === 'sidecar' &&
            file.path === archive.manifest.main?.replace(/^\.\//, ''),
        })
      }
      const manifestPath = await invoke<string>('install_plugin_package_file', {
        pluginId: archive.manifest.id,
        relativePath: 'plugin.json',
        data: Array.from(
          new TextEncoder().encode(`${JSON.stringify(archive.manifest, null, 2)}\n`),
        ),
        executable: false,
      })
      return {
        manifestPath,
        rootPath: directories.packageRoot,
        dataRoot: directories.dataRoot,
        storageRoot: directories.storageRoot,
      }
    },
    async removeInstalledPackage(pluginId: string): Promise<void> {
      if (!isTauriRuntime()) return
      const { invoke } = await import('@tauri-apps/api/core')
      await invoke<boolean>('remove_installed_plugin_package', { pluginId })
    },
  }
}

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

function setSidebarCollapsed(collapsed: boolean): void {
  sidebarCollapsed = collapsed
  appRoot.dataset.sidebarCollapsed = String(collapsed)
  const toggle = appRoot.querySelector<HTMLButtonElement>('[data-sidebar-toggle]')

  if (toggle) {
    toggle.setAttribute('aria-pressed', String(!collapsed))
    toggle.innerHTML = iconSvg(collapsed ? PanelLeft : PanelLeftClose)
  }

  view?.inputDOM.focus({ preventScroll: true })
}

function setMenuOpen(open: boolean): void {
  menuOpen = open
  const menu = appRoot.querySelector<HTMLElement>('[data-app-menu]')
  const toggle = appRoot.querySelector<HTMLButtonElement>('[data-menu-toggle]')

  if (menu) {
    menu.hidden = !open
  }

  if (toggle) {
    toggle.setAttribute('aria-expanded', String(open))
  }

  if (open) {
    showMenuSection('file')
    for (const panel of Array.from(
      appRoot.querySelectorAll<HTMLDetailsElement>('.developer-panel'),
    )) {
      panel.open = false
    }
    appRoot.querySelector<HTMLButtonElement>('[data-menu-section="file"]')?.focus()
  } else {
    view?.inputDOM.focus({ preventScroll: true })
  }
}

function showMenuSection(section: string): void {
  for (const button of Array.from(
    appRoot.querySelectorAll<HTMLButtonElement>('[data-menu-section]'),
  )) {
    const active = button.dataset.menuSection === section
    button.dataset.active = String(active)
    button.setAttribute('aria-selected', String(active))
  }

  for (const panel of Array.from(appRoot.querySelectorAll<HTMLElement>('[data-menu-panel]'))) {
    panel.hidden = panel.dataset.menuPanel !== section
  }
}

function setSearchOpen(open: boolean): void {
  searchOpen = open
  const search = appRoot.querySelector<HTMLElement>('[data-floating-search]')

  if (search) {
    search.hidden = !open
  }

  if (open) {
    setMenuOpen(false)
    appRoot.querySelector<HTMLInputElement>('[data-search-input]')?.focus()
  } else {
    clearSearchResults()
    focusActiveView()
  }
}

async function runDocumentSearch(query: string): Promise<void> {
  if (isDocumentBusy()) {
    notice = '文档正在打开，请稍候再搜索。'
    renderSession()
    return
  }

  const trimmed = query.trim()

  if (trimmed.length === 0) {
    clearSearchResults()
    return
  }

  const searchRunId = ++documentSearchRunId
  const source = largeDocumentPreview?.source

  try {
    const result = await documentSearchController.run({
      query: trimmed,
      ...(source
        ? { source, windowSizeLines: 512, maxResults: 200 }
        : {
            state,
            documentId: session.documentId,
            version: session.documentVersion,
            windowSizeLines: currentOpenPolicy.useMemoryVirtualViewport ? 512 : 128,
            maxResults: 200,
          }),
      onUpdate: (searchState) => {
        if (searchRunId !== documentSearchRunId) {
          return
        }

        searchResultState = searchState
        activeSearchResultIndex =
          searchState.matches.length > 0 && activeSearchResultIndex < 0
            ? 0
            : activeSearchResultIndex
        notice = formatDesktopSearchNotice(searchState)
        renderSession()
        renderSearchNavigation()
      },
    })

    if (searchRunId !== documentSearchRunId) {
      return
    }

    searchResultState = result
    activeSearchResultIndex = result.matches.length > 0 ? 0 : -1
    renderSearchNavigation()
    await jumpToSearchMatch(result, activeSearchResultIndex)
  } catch (error: unknown) {
    if (searchRunId !== documentSearchRunId) {
      return
    }

    notice = `搜索失败：${getErrorMessage(error)}`
    renderSession()
  }
}

async function jumpToSearchMatch(
  searchState: DesktopSearchState | undefined,
  index: number,
): Promise<void> {
  const match =
    searchState && index >= 0 && index < searchState.matches.length
      ? searchState.matches[index]
      : undefined

  if (!match) {
    return
  }

  if (sourceView) {
    await sourceView.scrollToLine(match.line)
    focusActiveView()
    return
  }

  if (!view) {
    return
  }

  state = new EditorState({
    doc: state.doc,
    selection: Selection.cursor(match.from),
    history: state.history,
    facets: state.facets,
  })
  view.updateState(state)
  view.ensureCursorVisible({ scrollPadding: 0 })
  renderSession()
  focusActiveView()
}

function getPluginUiRenderState(): Readonly<Record<string, unknown>> {
  const editor = sourceView ?? view
  const lineCount = sourceView?.source.lineCount ?? state.doc.lineCount

  if (!editor || lineCount < 1) {
    return Object.freeze({ viewport: Object.freeze({ fromLine: 1, toLine: 1, activeLine: 1 }) })
  }

  const fromLine = Math.min(
    lineCount,
    Math.max(1, Math.floor(editor.dom.scrollTop / desktopVirtualLineHeight) + 1),
  )
  const visibleLineCount = Math.max(
    1,
    Math.ceil(
      (editor.dom.clientHeight || desktopVirtualLineHeight * 24) / desktopVirtualLineHeight,
    ),
  )

  return Object.freeze({
    viewport: Object.freeze({
      fromLine,
      toLine: Math.min(lineCount, fromLine + visibleLineCount - 1),
      activeLine: fromLine,
    }),
  })
}

function schedulePluginUiViewportUpdate(): void {
  if (pluginUiViewportFrame !== undefined) return
  pluginUiViewportFrame = requestAnimationFrame(() => {
    pluginUiViewportFrame = undefined
    void desktopPluginUi.updateViewport()
  })
}

async function revealPluginLine(line: number): Promise<void> {
  if (sourceView) {
    await sourceView.scrollToLine(line)
  } else if (view) {
    const target = state.doc.line(line)
    state = new EditorState({
      doc: state.doc,
      selection: Selection.cursor(target.from),
      history: state.history,
      facets: state.facets,
    })
    view.updateState(state)
    view.ensureCursorVisible({ scrollPadding: 0 })
  } else {
    throw new Error('当前文档视图不可用')
  }

  await desktopPluginUi.updateViewport()
  focusActiveView()
}

async function moveSearchResult(delta: -1 | 1): Promise<void> {
  if (!searchResultState || searchResultState.matches.length === 0) {
    return
  }

  activeSearchResultIndex = moveDesktopSearchNavigationIndex(
    searchResultState,
    activeSearchResultIndex,
    delta,
  )
  renderSearchNavigation()
  notice = formatDesktopSearchNotice(searchResultState)
  renderSession()
  await jumpToSearchMatch(searchResultState, activeSearchResultIndex)
}

function clearSearchResults(): void {
  documentSearchRunId += 1
  documentSearchController.cancel()
  searchResultState = undefined
  activeSearchResultIndex = -1
  notice = messages.ready
  renderSearchNavigation()
  renderSession()
}

function renderSearchNavigation(): void {
  const navigation = createDesktopSearchNavigationState(searchResultState, activeSearchResultIndex)

  activeSearchResultIndex = navigation.activeIndex
  setText('[data-search-result-count]', navigation.label)
  const highlights = searchResultState?.matches ?? []
  view?.setSearchHighlights(highlights, navigation.activeIndex)
  sourceView?.setSearchHighlights(highlights, navigation.activeIndex)
  const loading = appRoot.querySelector<HTMLElement>('[data-search-loading]')
  const idleIcon = appRoot.querySelector<HTMLElement>('[data-search-idle-icon]')
  const searching = searchResultState?.phase === 'searching'

  if (loading) {
    loading.hidden = !searching
    loading.setAttribute(
      'aria-label',
      `正在扫描文档，已扫描 ${searchResultState?.scannedLineCount ?? 0} 行`,
    )
  }

  if (idleIcon) {
    idleIcon.hidden = searching
  }

  for (const selector of ['[data-search-previous]', '[data-search-next]']) {
    const button = appRoot.querySelector<HTMLButtonElement>(selector)

    if (button) {
      button.disabled = !navigation.canNavigate
    }
  }
}

function formatDesktopSearchNotice(searchState: DesktopSearchState): string {
  switch (searchState.phase) {
    case 'idle':
      return messages.ready
    case 'searching':
      return `正在搜索“${searchState.query}”：已找到 ${searchState.matches.length} 处，已扫描 ${searchState.scannedLineCount} 行。`
    case 'done':
      return searchState.complete
        ? `搜索“${searchState.query}”完成：找到 ${searchState.matches.length} 处，扫描 ${searchState.scannedLineCount} 行。`
        : `搜索“${searchState.query}”已截断：显示前 ${searchState.matches.length} 处，扫描 ${searchState.scannedLineCount} 行。`
    case 'cancelled':
      return `已取消搜索“${searchState.query}”。`
    case 'failed':
      return `搜索失败：${searchState.message ?? searchState.query}`
    default:
      return messages.ready
  }
}

function formatCharacterCount(): string {
  if (largeDocumentPreview) {
    return `${formatBytes(largeDocumentPreview.source.sizeBytes)} · ${largeDocumentPreview.source.lineCount} 行`
  }

  return `${state.doc.length} 字符`
}

function getNextViewMode(mode: ViewMode): SessionViewMode {
  return mode === 'source' ? 'live' : 'source'
}

function isPrimaryShortcut(event: KeyboardEvent): boolean {
  const isMac = navigator.platform.toLowerCase().includes('mac')
  return isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey
}

function toolbarButton(command: string, label: string, icon: IconNode): string {
  return [
    `<button type="button" class="tool-button" data-command="${command}" title="${label}">`,
    iconSvg(icon),
    `<span>${label}</span>`,
    '</button>',
  ].join('')
}

function menuNavButton(section: string, label: string, icon: IconNode, active = false): string {
  return [
    `<button type="button" data-menu-section="${section}"${active ? ' data-active="true"' : ''}>`,
    iconSvg(icon),
    `<span>${label}</span>`,
    '</button>',
  ].join('')
}

function getDesktopPlatform(): DesktopPlatform {
  const platformName = navigator.platform.toLowerCase()
  const userAgent = navigator.userAgent.toLowerCase()

  if (platformName.includes('win') || userAgent.includes('windows')) {
    return 'windows'
  }

  if (platformName.includes('mac') || userAgent.includes('mac os')) {
    return 'macos'
  }

  if (platformName.includes('linux') || userAgent.includes('linux')) {
    return 'linux'
  }

  return 'other'
}

function configureWindowChrome(currentPlatform: DesktopPlatform): void {
  appRoot.dataset.customChrome = String(currentPlatform === 'windows')

  if (currentPlatform !== 'windows') {
    return
  }

  void import('@tauri-apps/api/window')
    .then(async ({ getCurrentWindow }) => {
      const window = getCurrentWindow()
      await window.setDecorations(false)
      await syncWindowMaximizedState()
      await window.onCloseRequested((event) => {
        if (!canCloseWindow()) {
          event.preventDefault()
          openWindowConfirm()
          return
        }

        event.preventDefault()
        void invokeWindowClose()
      })
      await window.onResized(() => {
        void syncWindowMaximizedState()
      })
    })
    .catch(() => {
      appRoot.dataset.customChrome = 'false'
    })
}

function runWindowControl(action: WindowControlAction): void {
  if (platform !== 'windows') {
    return
  }

  if (action === 'close' && !canCloseWindow()) {
    openWindowConfirm()
    return
  }

  if (action === 'close') {
    void invokeWindowClose()
    return
  }

  void import('@tauri-apps/api/core')
    .then(async ({ invoke }) => {
      await invoke<boolean>('window_control', { action })
      if (action === 'maximize') {
        await syncWindowMaximizedState()
      }
    })
    .catch((error: unknown) => {
      notice = `窗口操作失败：${getErrorMessage(error)}`
      renderSession()
    })
}

async function syncWindowMaximizedState(): Promise<void> {
  if (platform !== 'windows') {
    return
  }

  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    windowMaximized = await getCurrentWindow().isMaximized()
  } catch {
    windowMaximized = !windowMaximized
  }

  updateWindowMaximizeIcon()
}

function updateWindowMaximizeIcon(): void {
  const button = appRoot.querySelector<HTMLButtonElement>('[data-window-maximize]')
  const glyph = button?.querySelector<HTMLElement>('.window-glyph')

  if (!button || !glyph) {
    return
  }

  glyph.className = `window-glyph ${
    windowMaximized ? 'window-glyph-restore' : 'window-glyph-maximize'
  }`
  const label = windowMaximized ? messages.window.restore : messages.window.maximize
  button.setAttribute('aria-label', label)
  button.title = label
}

function startWindowDrag(): void {
  void import('@tauri-apps/api/window')
    .then(({ getCurrentWindow }) => getCurrentWindow().startDragging())
    .catch(() => undefined)
}

function canCloseWindow(): boolean {
  if (isDocumentSaving()) {
    closeAfterCurrentSave = true
    return false
  }

  const decision = evaluateCloseProtection([session], {
    scope: 'window',
    documentIds: [session.documentId],
  })

  if (decision.allowClose) {
    return true
  }

  applyCloseDecision([session], decision, 'cancel')
  return false
}

function openWindowConfirm(): void {
  closeConfirmOpen = true
  appRoot.dataset.closeConfirmOpen = 'true'
  const overlay = appRoot.querySelector<HTMLElement>('[data-close-confirm]')
  overlay?.removeAttribute('hidden')
  renderCloseConfirmState()
  appRoot.querySelector<HTMLButtonElement>('[data-close-confirm-action="save"]')?.focus()
}

function renderCloseConfirmState(): void {
  const saving = isDocumentSaving() && closeAfterCurrentSave
  const title = saving ? messages.closeConfirm.savingTitle : messages.closeConfirm.title
  const body = saving ? messages.closeConfirm.savingBody : messages.closeConfirm.body

  setText('#close-confirm-title', title)
  setText('#close-confirm-body', body)
  setText(
    '[data-close-save-label]',
    saving ? messages.stateSaving : messages.closeConfirm.saveAndExit,
  )

  const saveButton = appRoot.querySelector<HTMLButtonElement>('[data-close-confirm-action="save"]')
  const discardButton = appRoot.querySelector<HTMLButtonElement>(
    '[data-close-confirm-action="discard"]',
  )
  const saveSpinner = appRoot.querySelector<HTMLElement>('[data-close-save-spinner]')

  if (saveButton) {
    saveButton.disabled = saving
    saveButton.dataset.saving = String(saving)
  }
  if (discardButton) {
    discardButton.disabled = saving
  }
  if (saveSpinner) {
    saveSpinner.hidden = !saving
  }
}

function closeWindowConfirm(): void {
  closeAfterCurrentSave = false
  closeConfirmOpen = false
  appRoot.dataset.closeConfirmOpen = 'false'
  appRoot.querySelector<HTMLElement>('[data-close-confirm]')?.setAttribute('hidden', '')
  view?.inputDOM.focus({ preventScroll: true })
}

async function saveAndExitWindow(): Promise<void> {
  closeAfterCurrentSave = true
  openWindowConfirm()
  const saved = await saveDocument()

  if (!saved || session.dirty) {
    openWindowConfirm()
    return
  }
}

async function discardAndExitWindow(): Promise<void> {
  const decision = evaluateCloseProtection([session], {
    scope: 'window',
    documentIds: [session.documentId],
  })

  applyCloseDecision([session], decision, 'confirm')
  await invokeWindowClose()
}

async function invokeWindowClose(): Promise<void> {
  closeWindowConfirm()
  await closeLargeDocumentPreview()

  if (platform !== 'windows') {
    return
  }

  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    await getCurrentWindow().destroy()
  } catch (error: unknown) {
    notice = `窗口操作失败：${getErrorMessage(error)}`
    renderSession()
  }
}

function getDesktopShortcutAction(
  event: KeyboardEvent,
): { readonly id: string; readonly input?: unknown } | undefined {
  if (event.altKey || event.isComposing) {
    return undefined
  }

  if (!isPrimaryShortcut(event)) {
    return undefined
  }

  switch (event.key.toLowerCase()) {
    case '1':
      return { id: 'view.setMode', input: { mode: 'source' } }
    case '2':
      return { id: 'view.setMode', input: { mode: 'live' } }
    case '/':
      return { id: 'view.setMode', input: { mode: getNextViewMode(session.viewMode) } }
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
      return pluginShortcutAction(event)
  }
}

function pluginShortcutAction(
  event: KeyboardEvent,
): { readonly id: string; readonly input?: unknown } | undefined {
  const action = desktopPluginManager.findKeymapAction(event, {
    editorFocus: editorRoot.contains(document.activeElement),
    documentOpen: true,
    sourceMode: session.viewMode === 'source',
    liveMode: session.viewMode === 'live',
  })
  return action ? { id: action } : undefined
}

function renderSession(): void {
  void desktopPluginUi.sync(session.documentId)
  const titleInfo = customDocumentTitle
    ? { name: customDocumentTitle, directory: documentSourcePath ?? messages.pathUnsaved }
    : getSessionTitleInfo(session.file?.path)
  const saving = isDocumentSaving()
  const saveStateLabel = saving
    ? messages.stateSaving
    : session.dirty
      ? messages.stateDirty
      : messages.stateClean

  setText('[data-title]', titleInfo.name)
  setText('[data-title-path]', titleInfo.directory)
  setText('[data-stat="document-id"]', session.documentId)
  setText('[data-stat="path"]', session.file?.path ?? messages.pathUnsaved)
  setText(
    '[data-document-kind]',
    documentPresentation === 'markdown'
      ? 'Markdown'
      : documentPresentation === 'generated-markdown'
        ? '生成的 Markdown'
        : '只读插件视图',
  )
  setText('[data-stat="version"]', String(session.documentVersion))
  setText('[data-stat="saved"]', String(session.savedVersion))
  setText('[data-stat="external"]', session.externalChangeState)
  setText('[data-stat="line-ending"]', session.lineEnding)
  setText('[data-stat="char-count"]', formatCharacterCount())
  setText('[data-stat="scale-mode"]', currentOpenPolicy.featurePolicy.mode)
  setText('[data-stat="render-strategy"]', currentOpenPolicy.renderStrategy)
  setText('[data-stat="open-timings"]', formatOpenStageDiagnostics(lastOpenDiagnostics))
  setText('[data-save-label]', saveStateLabel)
  setText('[data-notice]', notice)
  appRoot
    .querySelector<HTMLElement>('[data-notice]')
    ?.toggleAttribute('hidden', !showDeveloperStatusNotice || notice.length === 0)

  const dirtyDot = app?.querySelector<HTMLElement>('[data-save-dot]')
  dirtyDot?.classList.toggle('is-dirty', session.dirty && !saving)
  dirtyDot?.toggleAttribute('hidden', saving)
  appRoot.querySelector<HTMLElement>('[data-save-spinner]')?.toggleAttribute('hidden', !saving)
  appRoot.querySelector<HTMLElement>('[data-save-state]')?.classList.toggle('is-saving', saving)
  for (const command of ['save', 'save-as']) {
    const button = appRoot.querySelector<HTMLButtonElement>(`[data-command="${command}"]`)
    if (button) {
      button.disabled = saving
    }
  }
  appRoot.dataset.emptyDocument = String(!largeDocumentPreview && state.doc.length === 0)
  appRoot.dataset.readonly = String(session.readonly)
  appRoot.dataset.loading = loadingState.phase
  appRoot.dataset.saving = String(saving)
  view?.setEditable(!session.readonly && !isDocumentBusy())
  sourceView?.setEditable(
    !session.readonly &&
      !isDocumentBusy() &&
      (!largeDocumentPreview || Boolean(largeDocumentPreview.editSession)),
  )
  renderDocumentLoadingState()
  if (closeConfirmOpen) {
    renderCloseConfirmState()
  }
  updateModeToggle(session.viewMode)
}

function setDocumentLoadingState(nextState: DocumentLoadingState): void {
  loadingState = Object.freeze(nextState)
  renderSession()
}

function renderDocumentLoadingState(): void {
  const loading = appRoot.querySelector<HTMLElement>('[data-document-loading]')
  const dismiss = appRoot.querySelector<HTMLButtonElement>('[data-loading-dismiss]')

  if (!loading) {
    return
  }

  const visible = isDocumentBusy() || loadingState.phase === 'failed'
  loading.hidden = !visible
  if (dismiss) {
    dismiss.hidden = loadingState.phase !== 'failed'
  }
  setText('[data-loading-title]', getDocumentLoadingLabel(loadingState))
  setText('[data-loading-phase]', loadingState.phase === 'failed' ? '未替换当前文档' : '请稍候')
  setText('[data-loading-detail]', getDocumentLoadingDetail(loadingState))
}

function isDocumentBusy(): boolean {
  return loadingState.phase === 'opening' || loadingState.phase === 'indexing'
}

function isBusyAllowedAction(id: string): boolean {
  return false
}

function isDeveloperDiagnosticsEnabled(): boolean {
  return globalThis.localStorage?.getItem('milkup.desktop.openDiagnostics') === 'true'
}

function getSessionTitleInfo(path: string | undefined): {
  readonly name: string
  readonly directory: string
} {
  if (!path) {
    return { name: messages.titleUntitled, directory: messages.pathUnsaved }
  }

  const normalizedPath = path.replace(/\\/g, '/')
  const slashIndex = normalizedPath.lastIndexOf('/')
  const fileName = slashIndex >= 0 ? normalizedPath.slice(slashIndex + 1) : normalizedPath
  const dotIndex = fileName.lastIndexOf('.')
  const name = dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName
  const directory = slashIndex >= 0 ? normalizedPath.slice(0, slashIndex) : messages.pathUnsaved

  return {
    name: name || messages.titleUntitled,
    directory: directory || messages.pathUnsaved,
  }
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

async function closeLargeDocumentPreview(): Promise<void> {
  clearSearchResults()
  const documentId = largeDocumentPreview?.documentId
  largeDocumentPreview = undefined

  if (!documentId) {
    return
  }

  await largeTextFileService.close(documentId).catch(() => undefined)
}

function updateModeToggle(mode: ViewMode): void {
  const button = app?.querySelector<HTMLButtonElement>('[data-mode-toggle]')

  if (!button) {
    return
  }

  const label = mode === 'source' ? messages.buttons.source : messages.buttons.live
  button.setAttribute('aria-label', label)
  button.title = label
  button.dataset.mode = mode
  button.innerHTML = iconSvg(mode === 'source' ? Code2 : Eye)
}

function setText(selector: string, value: string): void {
  const target = app?.querySelector<HTMLElement>(selector)

  if (target) {
    target.textContent = value
  }
}

function isViewMode(value: string | undefined): value is SessionViewMode {
  return value === 'source' || value === 'live'
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
    return '文件已在编辑器外发生变化。请先“另存为”保留本地编辑，或重新载入并丢弃本地编辑后再保存。'
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

async function runDesktopEditorInteractionBenchmark(path: string): Promise<unknown> {
  const timings: Record<string, number> = {}
  const tracker = createOpenStageTracker({
    label: `desktop-editor-benchmark:${path}`,
    consoleDiagnostics: false,
  })

  await measure('openMs', timings, () =>
    openSelectedDocumentWithPolicy(tracker, async () => path, {
      errorPrefix: 'Desktop editor benchmark open failed',
    }),
  )

  if (loadingState.phase === 'failed') {
    throw new Error(getDocumentLoadingDetail(loadingState))
  }

  const afterOpen = summarizeActiveBenchmarkDocument()
  const interactions: Record<string, unknown> = {}

  if (view) {
    interactions.middleSelection = measureSync('middleSelectionMs', timings, () => {
      const middleLine = state.doc.line(Math.max(1, Math.floor(state.doc.lineCount / 2)))
      state = new EditorState({
        doc: state.doc,
        selection: Selection.cursor(middleLine.from),
        history: state.history,
        facets: state.facets,
      })
      view?.updateState(state)
      view?.ensureCursorVisible({ scrollPadding: 0 })
    })

    interactions.tailSelection = measureSync('tailSelectionMs', timings, () => {
      const tailLine = state.doc.line(Math.max(1, state.doc.lineCount - 8))
      state = new EditorState({
        doc: state.doc,
        selection: Selection.cursor(tailLine.from),
        history: state.history,
        facets: state.facets,
      })
      view?.updateState(state)
      view?.ensureCursorVisible({ scrollPadding: 0 })
    })

    interactions.visibleClickToCursor = await measure('clickToCursorMs', timings, async () => {
      const result = await dispatchVisibleLinePointer(view?.dom, 'click')

      return {
        ...result,
        selectionHead: state.selection.main.head,
      }
    })

    interactions.singleCharacterInput = measureSync('singleCharacterInputMs', timings, () => {
      const position = state.selection.main.head
      const next = state.applyTransaction({
        changes: ChangeSet.insert(position, 'x'),
        selection: Selection.cursor(position + 1),
        origin: { type: 'input.type', id: 'desktop-editor-benchmark' },
      })
      state = next
      view?.updateState(state)
    })
  } else if (sourceView && largeDocumentPreview) {
    const middleLine = Math.max(1, Math.floor(largeDocumentPreview.source.lineCount / 2))
    const tailLine = Math.max(1, largeDocumentPreview.source.lineCount - 8)

    interactions.middleScroll = await measure(
      'middleScrollMs',
      timings,
      () => sourceView?.scrollToLine(middleLine) ?? Promise.resolve(),
    )
    interactions.tailScroll = await measure(
      'tailScrollMs',
      timings,
      () => sourceView?.scrollToLine(tailLine) ?? Promise.resolve(),
    )
    interactions.visibleClickToCursor = await measure('clickToCursorMs', timings, () =>
      dispatchVisibleLinePointer(sourceView?.dom, 'pointerdown'),
    )

    const editPosition = await largeDocumentPreview.source.positionAtLineOffset(tailLine, 0)
    interactions.visibleEdit = await measure('visibleEditMs', timings, () =>
      applyLargeSourceEdit({
        from: editPosition,
        to: editPosition,
        insert: '<!-- benchmark-visible-edit -->\n',
        deletedText: '',
      }),
    )
    interactions.flush = await measure('flushMs', timings, () => saveLargeDocument())
  }

  const searchQuery = afterOpen.scaleMode === 'full' ? '#' : 'marker'
  interactions.search = await measure('searchFirstResultMs', timings, () =>
    runDocumentSearch(searchQuery),
  )

  return {
    path,
    afterOpen,
    afterInteractions: summarizeActiveBenchmarkDocument(),
    openDiagnostics: lastOpenDiagnostics,
    timings,
    interactions,
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

function measureSync<T>(name: string, timings: Record<string, number>, run: () => T): T {
  const startedAt = performance.now()

  try {
    return run()
  } finally {
    timings[name] = Math.round((performance.now() - startedAt) * 100) / 100
  }
}

function summarizeActiveBenchmarkDocument(): Record<string, unknown> {
  const renderedView = sourceView ?? view
  const contentDOM = renderedView?.contentDOM

  return {
    documentId: session.documentId,
    path: session.file?.path,
    dirty: session.dirty,
    readonly: session.readonly,
    viewMode: session.viewMode,
    scaleMode: currentOpenPolicy.featurePolicy.mode,
    renderStrategy: currentOpenPolicy.renderStrategy,
    memoryDocLength: state.doc.length,
    memoryDocLineCount: state.doc.lineCount,
    sourceLineCount: largeDocumentPreview?.source.lineCount,
    sourceSizeBytes: largeDocumentPreview?.source.sizeBytes,
    renderedLineCount: contentDOM?.querySelectorAll('.milkup-line').length ?? 0,
    renderedFromLine: contentDOM?.dataset.fromLine,
    renderedToLine: contentDOM?.dataset.toLine,
  }
}

async function dispatchVisibleLinePointer(
  root: HTMLElement | undefined,
  type: 'click' | 'pointerdown',
): Promise<Record<string, unknown>> {
  if (!root) {
    throw new Error('Desktop editor benchmark view root was not available')
  }

  await waitForAnimationFrame()
  await waitForAnimationFrame()

  const lines = Array.from(root.querySelectorAll<HTMLElement>('.milkup-line'))
  const line =
    lines.find((candidate) => candidate.dataset.from === candidate.dataset.to) ?? lines.at(-1)

  if (!line) {
    throw new Error('Desktop editor benchmark could not find a visible line to click')
  }

  const rect = line.getBoundingClientRect()
  const eventInit = {
    bubbles: true,
    cancelable: true,
    button: 0,
    buttons: type === 'pointerdown' ? 1 : 0,
    clientX: rect.left + Math.min(Math.max(rect.width / 2, 1), 24),
    clientY: rect.top + Math.max(rect.height / 2, 1),
  }
  const event =
    type === 'pointerdown'
      ? new PointerEvent(type, { ...eventInit, pointerId: 1, pointerType: 'mouse' })
      : new MouseEvent(type, eventInit)

  line.dispatchEvent(event)
  await waitForAnimationFrame()

  const cursor = root.querySelector<HTMLElement>('.milkup-cursor')

  return {
    clickedLine: Number(line.dataset.line),
    clickedFrom: Number(line.dataset.from),
    clickedTo: Number(line.dataset.to),
    cursorPosition: cursor?.dataset.position ? Number(cursor.dataset.position) : undefined,
  }
}

function waitForAnimationFrame(): Promise<void> {
  return new Promise((resolve) => window.requestAnimationFrame(() => resolve()))
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
    runDesktopEditorInteractionBenchmark,
  }),
})

globalThis.addEventListener('beforeunload', () => {
  disposeFileWatchEvents?.()
  void closeLargeDocumentPreview()
})
