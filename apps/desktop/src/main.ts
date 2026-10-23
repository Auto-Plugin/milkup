import { formatDisplayPath } from './display-path'
import { recoveryStatusText } from './recovery-status-presentation'
import { LargeDocumentSource } from './large-document-source'
import { moveDesktopFocus, restoreDesktopFocus } from './desktop-focus'
import { locateDocumentPresentationTarget } from './document-navigation'
import { createDesktopDocumentPresentationService } from './document-presentation-service'
import { createDesktopOutputService } from './output-service'
import {
  renderDesktopPluginManagerElement,
  revealDesktopPluginDetails,
} from './desktop-plugin-manager-ui'
import { createDesktopPluginCatalog } from './desktop-plugin-catalog'
import { validateClosedWorkerBundle } from './closed-worker-bundle'
import { createDesktopPluginWorker } from './plugin-worker-factory'
import { loadDesktopPluginIcon } from './plugin-icon'
import { zoomLevels, type ThemePreference } from './appearance'
import { createDesktopSettingsService } from './settings-service'
import { createDesktopEditingService, type DesktopEditingCurrent } from './editing-service'
import { createKeymapService } from './keymap-service'
import { applyEditorSettings, applyPresentationToCurrentViews } from './apply-editor-settings'
import { bundledPluginPaths, readBundledPlugin } from './bundled-plugin-catalog'
import { createRecoveryController, type RecoveryRecord, type RecoveryStatus } from './recovery'
import { createRecoveryUi } from './recovery-ui'
import { createMarkdownClipboardPayload } from '@milkup/export'
import { createDesktopReleaseAdapter, nativeReleaseTransport } from './plugin-release-service'
import { createApplicationUpdatesController } from './application-updates'
import { renderApplicationUpdates } from './application-updates-ui'
import {
  createDesktopWorkspaceAdapter,
  type WorkspaceOpenRequest,
} from './plugin-workspace-service'
import { createProtectedInstallGate } from './protected-install'
import { reconcileSaveWatchEvents } from './save-watch-reconciliation'
import {
  createDocumentTransitionController,
  type DocumentTransitionPrompt,
} from './document-transition'
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
  markTrustedPluginCommand,
  PluginRuntime,
  PluginEditingError,
} from '@milkup/plugin'
import {
  isPluginPackageArchive,
  parsePluginPackageArchive,
  readPluginPackageTextFile,
} from '@milkup/plugin'
import type {
  BrowserWorkerPluginHost,
  PluginManifest,
  PluginSettingsValues,
  PluginUiRevealLocationRequest,
  PluginUiOperationContext,
} from '@milkup/plugin'
import {
  applyFileWatchEvent,
  createDocumentSession,
  createDocumentSessionFromOpenResult,
  getFileActionDocumentId,
  getRevealTarget,
  getSaveSafety,
  prepareTextForFileSave,
  recordRecentFile,
  recordDocumentTransaction,
  recordNativeDocumentMutation,
  recordFileReloadResult,
  recordFileSaveResult,
  recordModeChange,
} from '@milkup/tauri-bridge'
import type {
  FileAction,
  FileWatchEvent,
  OpenFileResult,
  RecentFileEntry,
  SessionViewMode,
} from '@milkup/tauri-bridge'
import {
  createControlledRendererNodes,
  EditorView,
  prepareTableEdit,
  prepareTableInsertion,
} from '@milkup/view-dom'
import { SourceDocumentView } from '@milkup/view-dom'
import type {
  EditorPresentation,
  ControlledRenderer,
  ControlledRendererActionDetail,
  ControlledRendererContext,
  ControlledRendererOutput,
  ViewMode,
  DocumentPresentationConfig,
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
  LoaderCircle,
  Menu,
  PanelLeft,
  PanelLeftClose,
  Plug,
  RotateCcw,
  RefreshCw,
  Save,
  SaveAll,
  Search,
  X,
} from 'lucide'
import type { IconNode } from 'lucide'

import { EditorContextMenu } from './editor-context-menu'
import {
  createHostContextActions,
  HostContextActionError,
  type HostContextSnapshot,
} from './host-context-actions'
import { normalizePluginContextMenuNodes, reconcilePluginContextMenu } from './context-menu-plugins'
import { readEditorFloatingToolbarGeometry } from './editor-floating-toolbar-geometry'
import { createDesktopResourceService } from './resource-service'
import { saveWithResources } from './resource-save'
import { scanResourceReferences, scanDocumentResourceReferences } from './resource-reference-scan'
import {
  metadataFromOpenFileResult,
  resolveDesktopMemoryViewportFallbackPolicy,
  resolveDesktopOpenPolicy,
  type DesktopOpenPolicy,
} from './desktop-open-policy'
import { DesktopDocumentSearchController, type DesktopSearchState } from './desktop-document-search'
import { LargeDocumentSearchController, prepareLargeReplacement } from './large-document-search'
import { createLargeSearchService, type LargeReplaceProgress } from './large-search-service'
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
import { createDocumentLoadingVisibilityController } from './document-loading-visibility'
import { createDesktopFileService } from './file-service'
import { resolvePluginContributionViewRefreshAction } from './editor-view-refresh'
import { iconSvg } from './icons'
import { createDesktopLargeTextFileService } from './large-file-service'
import {
  createDesktopPluginActions,
  DesktopPluginManager,
  resolvePluginEntryPath,
  type DesktopPluginManifestHost,
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
import { loadDesktopPluginDomModule, prepareDesktopPluginDomModule } from './plugin-dom'
import './style.css'
import './editor-context-menu.css'
import './floating-document-toolbar.css'

let desktopStorage: Storage | undefined
try {
  desktopStorage = globalThis.localStorage
} catch {
  /* Settings saves report unavailable; basic editing remains usable. */
}
function readOptionalPreference(key: string): string | null {
  try {
    return desktopStorage?.getItem(key) ?? null
  } catch {
    return null
  }
}
markStartupStage('module-evaluated')

const initialText = ''
let editorPresentation: EditorPresentation = Object.freeze({
  fontFamily: 'monospace',
  fontSize: 14,
  lineHeight: 1.5,
  contentWidth: 0,
  indentation: 'spaces-2',
})
let appliedTheme: ThemePreference = 'system'
let appliedZoom = 1
const largePreviewLineCount = 80
const appProductName = 'milkup'
const appVersion = __MILKUP_VERSION__
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

const pendingPluginToggles = new Set<string>()
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
      readonly watchEvents: FileWatchEvent[]
      readonly allowEditing: boolean
    }

const app = document.querySelector<HTMLDivElement>('#app')

if (!app) {
  throw new Error('Desktop root element was not found')
}

const appRoot = app
const sidebarWidthStorageKey = 'milkup.desktop.sidebar.width'
const defaultSidebarWidth = 240
const minimumSidebarWidth = 160
const maximumSidebarWidth = 520
const initialSidebarWidth = readStoredSidebarWidth()

appRoot.dataset.platform = platform
appRoot.dataset.sidebarCollapsed = 'true'
appRoot.style.setProperty('--sidebar-width', `${initialSidebarWidth}px`)
app.innerHTML = `
  <main class="desktop-shell">
    <header class="titlebar" data-window-drag-region>
      <button type="button" class="titlebar-menu-button" data-menu-toggle aria-haspopup="dialog" aria-expanded="false" aria-label="${messages.buttons.menu}" title="${messages.buttons.menu}">
        ${iconSvg(Menu)}
      </button>
      <div class="document-title" data-window-drag-region>
        <h1 data-title>${messages.titleUntitled}</h1>
        <p data-title-path>${messages.pathUnsaved}</p>
      </div>
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
            ${menuNavButton('plugins', messages.menu.plugins, Plug)}
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
              <button type="button" class="tool-button" data-open-recovery ${isTauriRuntime() ? '' : 'hidden'}>恢复记录（含已归档）</button>
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
          <section class="app-menu-section" data-menu-panel="plugins" hidden>
            <h3>${messages.menu.plugins}</h3>
            <div data-plugin-manager></div>
            <div data-plugin-slot="menu-page"></div>
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
                <dd class="application-version"><span data-app-version>${appVersion}</span><button type="button" class="dialog-button secondary" data-application-update-action="check" aria-disabled="true">${iconSvg(RefreshCw)}<span>检查更新</span></button></dd>
              </div>
              <div>
                <dt>版权信息</dt>
                <dd>${appCopyright}</dd>
              </div>
            </dl>
            <div class="application-updates" data-application-updates aria-live="polite"></div>
          </section>
        </div>
      </div>
    </section>
    <aside class="recovery-warning" data-recovery-warning role="alert" hidden>
      <span data-recovery-warning-text></span>
      <button type="button" class="dialog-button secondary" data-recovery-retry>重试</button>
      <button type="button" class="dialog-button secondary" data-recovery-storage-details>存储详情</button>
    </aside>
    <section class="workspace">
      <button type="button" class="sidebar-backdrop" data-sidebar-dismiss aria-label="关闭侧栏" tabindex="-1"></button>
      <aside class="sidebar" aria-label="工作区"><button type="button" class="sidebar-close icon-button" data-sidebar-close aria-label="关闭侧栏">${iconSvg(X)}</button><div data-plugin-slot="sidebar-panel"></div></aside>
      <div class="sidebar-resize-handle" data-sidebar-resize role="separator" aria-label="调整侧栏宽度" aria-orientation="vertical" tabindex="0"></div>
      <section class="editor-panel">
        <div class="floating-search" data-floating-search role="search" aria-label="当前文档查找和替换" hidden>
          <div class="search-query-row">
          <span class="search-status-icon" data-search-status-icon>
            <span data-search-idle-icon>${iconSvg(Search)}</span>
            <span data-search-loading hidden>${iconSvg(LoaderCircle)}</span>
          </span>
          <input type="search" aria-label="${messages.buttons.search}" placeholder="搜索文档" data-search-input />
          <button type="button" class="search-text-button" data-search-case aria-label="区分大小写" aria-pressed="false" title="区分大小写">Aa</button>
          <span class="search-result-count" data-search-result-count aria-live="polite">0/0</span>
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
          <div class="search-replace-row">
            <input type="text" aria-label="替换为" placeholder="替换为" data-replace-input />
            <button type="button" class="search-text-button" data-replace-one disabled>替换</button>
            <button type="button" class="search-text-button" data-replace-all disabled>全部替换</button>
            <button type="button" class="search-text-button" data-replace-cancel hidden>取消替换</button>
          </div>
          <div class="search-message" data-search-message role="status">字面匹配 · 忽略大小写 · 忽略查询首尾空白</div>
        </div>
        <div class="editor-host" data-editor-host></div>
        <div class="plugin-bottom-slot" data-plugin-slot="bottom-panel"></div>
        <div class="document-loading" data-document-loading hidden>
          <div>
            <button type="button" class="icon-button loading-dismiss" data-loading-dismiss aria-label="关闭" title="关闭" hidden>
              ${iconSvg(X)}
            </button>
            <p data-loading-title id="document-loading-title">${messages.loading.title}</p>
            <span data-loading-phase>${messages.loading.body}</span>
            <span data-loading-detail role="status" aria-live="polite"></span>
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
          <p data-transition-error role="alert" hidden></p>
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
    <div class="plugin-toolbar-slot" data-plugin-slot="document-toolbar" hidden></div>
    <div class="editor-context-menu" data-editor-context-menu hidden>
      <div data-plugin-slot="context-menu" hidden></div>
    </div>
    <section class="plugin-modal-slot" data-plugin-slot="modal"></section>
    <footer class="statusbar">
      <div class="statusbar-left">
        <button type="button" class="statusbar-button" data-sidebar-toggle aria-label="${messages.buttons.sidebar}" title="${messages.buttons.sidebar}">
          ${iconSvg(PanelLeft)}
        </button>
        <button type="button" class="statusbar-button mode-toggle" data-mode-toggle aria-label="${messages.buttons.live}" title="${messages.buttons.live}"></button>
      </div>
      <span class="statusbar-notice" data-notice role="status" aria-live="polite" hidden></span>
      <span class="recovery-status" data-recovery-status role="status" hidden></span>
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
markStartupStage('shell-created')

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
markStartupStage('initial-path-requested')
const initialOpenFilePathPromise = fileService.initialOpenFilePath().then(
  (path) => {
    markStartupStage('initial-path-resolved')
    return path
  },
  (error: unknown) => {
    markStartupStage('initial-path-failed')
    throw error
  },
)
const largeTextFileService = createDesktopLargeTextFileService()
const documentSearchController = new DesktopDocumentSearchController()
const largeSearchService = createLargeSearchService()
const largeSearchController = new LargeDocumentSearchController(largeSearchService)
let nativeReplacement:
  | { abort: AbortController; preparing: boolean; progress?: LargeReplaceProgress | undefined }
  | undefined

let session = createDocumentSession({
  documentId: 'desktop-untitled-1',
  viewMode: 'live',
})
let notice: string = messages.ready
const developerStatusNoticeStorageKey = 'milkup.desktop.developer.showStatusNotice'
let showDeveloperStatusNotice = readOptionalPreference(developerStatusNoticeStorageKey) === 'true'
let recentFiles: readonly RecentFileEntry[] = []
let disposeFileWatchEvents: (() => void) | undefined
let sidebarCollapsed = true
let sidebarWidth = initialSidebarWidth
let menuOpen = false
let menuReturnFocus: HTMLElement | null = null
let searchOpen = false
let searchResultState: DesktopSearchState | undefined
let activeSearchResultIndex = -1
let documentSearchRunId = 0
let searchCaseSensitive = false
let searchSignature = ''
let searchRenderFrame: number | undefined
let searchRefreshTimer: ReturnType<typeof setTimeout> | undefined
let lastNavigationSignature = ''
let documentPresentation: 'markdown' | 'generated-markdown' | 'custom-view' = 'markdown'
let documentSourcePath: string | undefined
let customDocumentOutput: ControlledRendererOutput | undefined
let customDocumentTitle: string | undefined
let windowMaximized = false
let closeConfirmOpen = false
let applicationUpdateInstalling = false
let recoveryDialogOpen = false
let restoringResourceCopy = false
let loadingState: DocumentLoadingState = Object.freeze({ phase: 'idle' })
const loadingVisibility = createDocumentLoadingVisibilityController({
  onChange: () => {
    renderSession()
    if (loadingVisibility.visible) {
      void showStartupWindow()
    }
  },
})
let importantNotice = false
let resourceSaveWarning: string | undefined
let saveState: DocumentSaveState = Object.freeze({ phase: 'idle' })
let transitionPrompt: DocumentTransitionPrompt | undefined
const documentTransitions = createDocumentTransitionController({
  session: () => session,
  busy: () => isDocumentBusy() || isDocumentSaving(),
  flushEdits: async () => {
    await sourceView?.flushPendingEdits()
  },
  save: () => saveDocument(),
  saveFailureMessage: () => notice,
  show: (prompt) => {
    transitionPrompt = prompt
    openWindowConfirm()
  },
  hide: () => {
    transitionPrompt = undefined
    closeWindowConfirm()
  },
  onError: (error) => {
    protectedInstallGate?.fail(error)
    importantNotice = true
    notice = `文档操作失败：${getErrorMessage(error)}`
    renderSession()
  },
})
let lastOpenDiagnostics: OpenStageDiagnostics | undefined
let currentOpenPolicy: DesktopOpenPolicy = resolveDesktopOpenPolicy({
  path: 'untitled.md',
  sizeBytes: 0,
})
let largeDocumentPreview: LargeDocumentPreviewState | undefined

let view: EditorView | undefined
let sourceView: SourceDocumentView | undefined
let controlledEditingCommit = false
let editingDocumentIdentity: object = {}
let editingDocumentId = session.documentId
let editingSavedPath = session.file?.path
let saveLocationGeneration = 0
let currentSelectionRevision = 0
let editingObservedView: EditorView | SourceDocumentView | undefined
let editingObservedSelectionRevision = -1
let editingMemorySource: MemoryDocumentSource | undefined
let editingMemoryDocument: EditorState['doc'] | undefined

/** Call after each successful Save As location change, including A -> B -> A. */
function invalidateDesktopSaveLocation(): void {
  saveLocationGeneration++
  editingSavedPath = session.file?.path
}

function getDesktopEditingCurrent(): DesktopEditingCurrent | undefined {
  const editor = sourceView ?? view
  if (!editor || documentPresentation === 'custom-view') return undefined
  if (editingDocumentId !== session.documentId) {
    editingDocumentId = session.documentId
    editingDocumentIdentity = {}
    editingMemorySource = undefined
    saveLocationGeneration++
  }
  if (editingSavedPath !== session.file?.path) invalidateDesktopSaveLocation()
  if (editingObservedView !== editor) editingDocumentIdentity = {}
  if (
    editingObservedView !== editor ||
    editingObservedSelectionRevision !== editor.selectionRevision
  ) {
    currentSelectionRevision++
    editingObservedView = editor
    editingObservedSelectionRevision = editor.selectionRevision
  }
  const version = largeDocumentPreview?.source.version ?? session.documentVersion
  if (
    !editingMemorySource ||
    editingMemoryDocument !== state.doc ||
    editingMemorySource.version !== version
  ) {
    editingMemorySource = new MemoryDocumentSource({
      documentId: session.documentId,
      document: state.doc,
      version,
    })
    editingMemoryDocument = state.doc
  }
  return {
    identity: editingDocumentIdentity,
    source: largeDocumentPreview?.source ?? sourceView?.source ?? editingMemorySource,
    documentId: session.documentId,
    version,
    selection: sourceView?.selection ?? state.selection,
    selectionRevision: currentSelectionRevision,
    saveLocationGeneration,
    readonly: session.readonly,
    busy:
      isDocumentBusy() ||
      isDocumentSaving() ||
      closeConfirmOpen ||
      recoveryDialogOpen ||
      editor.isComposing,
    mode: sourceView ? 'windowed' : 'memory',
  }
}

function captureHostContextSnapshot(): HostContextSnapshot | undefined {
  const current = getDesktopEditingCurrent()
  if (!current) return undefined
  const history = largeDocumentPreview?.editSession ?? state.history
  return { ...current, canUndo: history.canUndo, canRedo: history.canRedo }
}

function isHostContextSnapshotCurrent(expected: HostContextSnapshot): boolean {
  const current = getDesktopEditingCurrent()
  return Boolean(
    current &&
    current.identity === expected.identity &&
    current.source === expected.source &&
    current.documentId === expected.documentId &&
    current.version === expected.version &&
    current.source.version === expected.version &&
    current.selectionRevision === expected.selectionRevision &&
    current.saveLocationGeneration === expected.saveLocationGeneration &&
    current.selection.mainIndex === expected.selection.mainIndex &&
    current.selection.ranges.length === expected.selection.ranges.length &&
    current.selection.ranges.every((range, index) => {
      const old = expected.selection.ranges[index]!
      return (
        range.anchor === old.anchor && range.head === old.head && range.affinity === old.affinity
      )
    }),
  )
}

function assertHostContextCurrent(
  expected: HostContextSnapshot,
  signal: AbortSignal,
  write = false,
): void {
  if (signal.aborted) throw new HostContextActionError('aborted')
  if (!isHostContextSnapshotCurrent(expected)) throw new HostContextActionError('stale')
  const current = getDesktopEditingCurrent()!
  if (current.busy) throw new HostContextActionError('busy')
  if (write && (expected.readonly || current.readonly)) throw new HostContextActionError('readonly')
}

async function selectAllFromHostContext(
  expected: HostContextSnapshot,
  signal: AbortSignal,
): Promise<void> {
  const active = sourceView
  const select = async () => {
    assertHostContextCurrent(expected, signal)
    let length = expected.source.length
    if (length === undefined) {
      // Native file size is bytes, never a UTF-16 selection coordinate. Read
      // only the final bounded line instead of materializing the whole file.
      try {
        const last = await expected.source.readLineWindow(
          expected.source.lineCount,
          expected.source.lineCount,
          65_536,
        )
        length = last.to
      } catch (error) {
        assertHostContextCurrent(expected, signal)
        throw new HostContextActionError(
          error instanceof RangeError ? 'too-large' : 'unavailable',
          { cause: error },
        )
      }
    }
    assertHostContextCurrent(expected, signal)
    if (!Number.isSafeInteger(length) || length < 0) throw new HostContextActionError('unavailable')
    const selection = Selection.range(0, length)
    if (active) {
      if (sourceView !== active) throw new HostContextActionError('stale')
      active.setSelection(selection)
    } else {
      state = state.applyTransaction({
        selection,
        addToHistory: false,
        origin: { type: 'command', id: 'host.select-all' },
      })
      updateRenderedMemoryDocument()
    }
    renderSession()
  }
  if (active) await active.runAfterPendingEdits(select)
  else await select()
}

async function applyHostContextHistory(
  direction: 'undo' | 'redo',
  expected: HostContextSnapshot,
  signal: AbortSignal,
): Promise<void> {
  const active = sourceView
  const apply = async () => {
    assertHostContextCurrent(expected, signal, true)
    if (active !== sourceView) throw new HostContextActionError('stale')
    const history = largeDocumentPreview?.editSession ?? state.history
    if (!(direction === 'undo' ? history.canUndo : history.canRedo))
      throw new HostContextActionError('unavailable')
    controlledEditingCommit = true
    try {
      if (largeDocumentPreview?.editSession) await applyLargeEditHistoryBatch(direction, true)
      else {
        applyMemoryEditHistory(direction)
        // History already committed. Its view refresh must not turn it into an
        // apparent cancelled edit or mutate another document after navigation.
        if (active && active === sourceView) {
          try {
            await active.revealSelection(
              state.doc.lineAt(state.selection.main.head).number,
              state.selection,
            )
          } catch (error) {
            importantNotice = true
            notice = `历史操作已提交，视图更新失败：${getErrorMessage(error)}`
          }
        }
      }
    } finally {
      controlledEditingCommit = false
      renderSession()
    }
  }
  if (active) await active.runAfterPendingEdits(apply)
  else await apply()
}
let pluginUiViewportTimer: ReturnType<typeof setTimeout> | undefined
let pluginUiViewportIdleCallback: number | undefined

async function recoveryInvoke<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<T>(command, args)
}

let lastRecoveryError: string | undefined
function renderRecoveryStatus(status: RecoveryStatus): void {
  if (status.phase === 'error') lastRecoveryError = status.error
  else if (status.phase === 'ready' || status.phase === 'idle') lastRecoveryError = undefined
  const warning = appRoot.querySelector<HTMLElement>('[data-recovery-warning]')!
  warning.hidden = !lastRecoveryError
  const warningText = appRoot.querySelector<HTMLElement>('[data-recovery-warning-text]')!
  warningText.textContent = lastRecoveryError
    ? `恢复点未更新：${lastRecoveryError.split('。')[0]}。${status.version === undefined ? '尚无成功恢复备份，请手动保存文档。' : '已有恢复备份保留，新编辑可能尚未备份。'}`
    : ''
  warningText.title = lastRecoveryError ?? ''
  appRoot.querySelector<HTMLButtonElement>('[data-recovery-retry]')!.disabled =
    status.phase === 'writing'

  const element = appRoot.querySelector<HTMLElement>('[data-recovery-status]')!
  appRoot.dataset.recoveryPhase = status.phase
  appRoot.dataset.recoveryVersion = String(status.version ?? -1)
  element.hidden = status.phase === 'idle' || status.phase === 'ready'
  element.dataset.error = String(status.phase === 'error')
  element.textContent = recoveryStatusText(status)
  element.title =
    status.error ??
    (status.at
      ? `最近恢复点：${new Date(status.at).toLocaleString()}。之后输入可能尚未保留；恢复点不等于保存原文件。`
      : '检查点完成前异常退出可能丢失输入；恢复点不等于保存原文件。')
}

const systemTheme = window.matchMedia('(prefers-color-scheme: dark)')
function refreshSystemTheme(): void {
  document.documentElement.dataset.theme =
    appliedTheme === 'system' ? (systemTheme.matches ? 'dark' : 'light') : appliedTheme
  view?.invalidateDocumentPresentation()
  sourceView?.invalidateDocumentPresentation()
}
function reportSettingsError(error: unknown): void {
  importantNotice = true
  notice = `设置未保存或应用失败：${getErrorMessage(error)}`
  renderSession()
}
const desktopSettings = createDesktopSettingsService({
  ...(desktopStorage ? { storage: desktopStorage } : {}),
  applyView: (values: PluginSettingsValues, signal?: AbortSignal) =>
    applyEditorSettings(
      values,
      {
        theme: async (theme) => {
          if (isTauriRuntime()) {
            const { getCurrentWindow } = await import('@tauri-apps/api/window')
            await getCurrentWindow().setTheme(theme === 'system' ? null : theme)
          }
        },
        zoom: async (zoom) => {
          if (isTauriRuntime()) {
            const { getCurrentWebview } = await import('@tauri-apps/api/webview')
            await getCurrentWebview().setZoom(zoom)
          } else if (zoom !== 1) throw new Error('浏览器预览请使用浏览器自身缩放')
        },
        editor: (presentation) =>
          applyPresentationToCurrentViews(() => [view, sourceView], presentation, signal),
        applied: ({ theme, zoom, presentation }) => {
          editorPresentation = Object.freeze(presentation)
          appliedTheme = theme
          appliedZoom = zoom
          refreshSystemTheme()
          appRoot.dataset.appearanceZoom = String(zoom)
        },
      },
      signal,
    ),
  onError: reportSettingsError,
})
const settingsReady = desktopSettings.ready.catch(reportSettingsError)
systemTheme.addEventListener('change', refreshSystemTheme)
refreshSystemTheme()
async function changeNativeZoom(direction: -1 | 0 | 1): Promise<void> {
  const index = zoomLevels.findIndex((value) => value === appliedZoom)
  const zoom =
    direction === 0
      ? 1
      : zoomLevels[Math.max(0, Math.min(zoomLevels.length - 1, index + direction))]!
  await desktopSettings.changeApplication({ 'appearance.zoom': zoom })
}

const recovery = isTauriRuntime()
  ? createRecoveryController({
      read: (includeText) => ({
        documentId: session.documentId,
        ...(session.file ? { originalPath: session.file.path } : {}),
        version: session.documentVersion,
        dirty: session.dirty,
        ...(largeDocumentPreview
          ? { nativeVersion: largeDocumentPreview.source.version }
          : includeText
            ? { text: prepareTextForFileSave(session, state.doc.text) }
            : {}),
      }),
      service: {
        checkpoint: (input) => recoveryInvoke<RecoveryRecord>('checkpoint_recovery', { input }),
        settle: (key, disposition) => recoveryInvoke<void>('settle_recovery', { key, disposition }),
      },
      onStatus: renderRecoveryStatus,
    })
  : undefined
const recoveryUi = createRecoveryUi(appRoot, {
  list: async (includeArchived) => {
    const result = await recoveryInvoke<{
      records: readonly RecoveryRecord[]
      warnings: readonly string[]
      storage: import('./recovery').RecoveryStorageStatus | null
    }>('list_recovery_records', { includeArchived })
    return {
      ...result,
      warnings: lastRecoveryError ? [lastRecoveryError, ...result.warnings] : result.warnings,
    }
  },
  exportRecord: async (record) => {
    const destination = await fileService.selectSaveFilePath(`recovered-${record.createdAt}.md`)
    if (!destination) return undefined
    return recoveryInvoke<string>('materialize_recovery', { id: record.id, destination })
  },
  dismiss: (record) =>
    recoveryInvoke('archive_recovery', { id: record.id, disposition: 'dismissed' }),
  restore: async (record) => {
    recoveryUi.hide()
    let recoveryError: unknown
    await documentTransitions.request('open', async () => {
      restoringResourceCopy = true
      try {
        const path = await recoveryInvoke<string>('materialize_recovery', { id: record.id })
        await openSelectedDocumentAfterConfirmation(
          createOpenStageTracker({ label: 'recovery-copy', consoleDiagnostics: false }),
          async () => path,
          { cancelledNotice: '恢复已取消；记录仍保留', errorPrefix: '恢复副本打开失败' },
        )
        if (session.file?.path !== path || loadingState.phase !== 'ready')
          throw new Error('恢复副本未打开；原恢复记录仍保留')
        const references = largeDocumentPreview
          ? (
              await scanDocumentResourceReferences(largeDocumentPreview.source, {
                chunks: readNativeResourceChunks(largeDocumentPreview),
              })
            ).references
          : scanResourceReferences(state.doc.text)
        if (references.length) {
          await resourceService.restoreRecovery(record.id, session.documentId, references)
          view?.refreshResourceImages()
          sourceView?.refreshResourceImages()
        }
        await recoveryInvoke('archive_recovery', { id: record.id, disposition: 'restored' })
        notice = '已打开恢复副本，原文件未改动。请另存为到需要的位置。'
        importantNotice = true
        renderSession()
      } catch (error) {
        recoveryError = error
        throw error
      } finally {
        restoringResourceCopy = false
        renderSession()
      }
    })
    if (recoveryError) throw recoveryError
  },
  changed: (open) => {
    recoveryDialogOpen = open
    appRoot.querySelector<HTMLElement>('.desktop-shell')!.inert = open
    if (!open) focusActiveView()
  },
})
appRoot.querySelector('[data-open-recovery]')?.addEventListener('click', () => {
  setMenuOpen(false)
  void recoveryUi.open(true)
})

appRoot.querySelector('[data-recovery-retry]')?.addEventListener('click', () => {
  void recovery?.flush()
})
appRoot.querySelector('[data-recovery-storage-details]')?.addEventListener('click', () => {
  void recoveryUi.open(true)
})

const resourceService = createDesktopResourceService({
  currentDocument: () => {
    const current = getDesktopEditingCurrent()
    return {
      documentId: session.documentId,
      version: current?.version ?? session.documentVersion,
      selectionRevision: current?.selectionRevision ?? 0,
      saveLocationGeneration: current?.saveLocationGeneration ?? 0,
      ...(session.file ? { path: session.file.path } : {}),
      editable: !!current && !current.readonly && !current.busy,
    }
  },
  ensureDocumentSaved: async () => Boolean(session.file) || (await saveDocumentAs()),
  onError: (error) => {
    importantNotice = true
    notice = `图片资源操作未完成：${getErrorMessage(error)}`
    renderSession()
  },
})

let resourceDocumentId = session.documentId

const desktopEditing = createDesktopEditingService({
  current: getDesktopEditingCurrent,
  async runExclusive<T>(action: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const active = sourceView
    if (!active) return action()
    let result!: T
    await active.runAfterPendingEdits(async () => {
      if (sourceView !== active) throw new PluginEditingError('stale')
      signal?.throwIfAborted()
      result = await action()
    })
    return result
  },
  context: async (window, _current, signal) => {
    const editor = sourceView ?? view
    if (!editor) throw new PluginEditingError('unavailable')
    const context = await editor.readEditingContext(window.selection.main, signal)
    const table = context.table
    return {
      kind: context.kind,
      complete:
        context.complete && (!table || (table.from >= window.from && table.to <= window.to)),
      ...(table
        ? {
            table: {
              row: table.row,
              column: table.column,
              rowCount: table.rowCount,
              columnCount: table.columnCount,
              alignment: table.alignment,
              withinCell: table.withinCell,
            },
          }
        : {}),
    }
  },
  table: async (snapshot, request, _current, signal) => {
    const editor = sourceView ?? view
    if (!editor) throw new PluginEditingError('unavailable')
    const selection = {
      anchor: snapshot.from + snapshot.selection.anchor,
      head: snapshot.from + snapshot.selection.head,
    }
    const context = await editor.readEditingContext(selection, signal)
    if (!context.complete || context.kind === 'unknown' || context.kind === 'code')
      throw new PluginEditingError('unsupported')
    let plan
    if (request.operation === 'insert-table') {
      if (context.kind !== 'text') throw new PluginEditingError('unsupported')
      plan = prepareTableInsertion(
        { from: snapshot.from, text: snapshot.text, selection, lineEnding: snapshot.lineEnding },
        request.rows,
        request.columns,
      )
    } else {
      const table = context.table
      if (!table || table.from < snapshot.from || table.to > snapshot.to)
        throw new PluginEditingError('unsupported')
      plan = prepareTableEdit(table, request, snapshot.text.slice(table.to - snapshot.from))
    }
    if (!plan) throw new PluginEditingError('unsupported')
    return {
      changes: plan.changes.map((change) => ({
        from: change.from - snapshot.from,
        to: change.to - snapshot.from,
        insert: change.insert,
      })),
      selection: {
        anchor: plan.selectionAfter.anchor - snapshot.from,
        head: plan.selectionAfter.head - snapshot.from,
      },
    }
  },
  supportsAssets: true,
  commit: async (batch, guard, signal) => {
    if (batch.assetIds?.length) await resourceService.assertAssets(batch.snapshot, batch.assetIds)
    guard()
    signal?.throwIfAborted()
    const activeSourceView = sourceView
    const preview = largeDocumentPreview
    let version: number
    let committed = false
    const assetIds = batch.assetIds ?? []
    resourceService.pinAssets(assetIds)
    controlledEditingCommit = true
    try {
      renderSession()
      if (preview) {
        const edits = preview.editSession
        if (!edits) throw new PluginEditingError('unsupported')
        const pending = edits.prepareVisibleEdits(batch.changes, batch.deletedTextByChange, {
          historyGroup: batch.historyGroup,
          selectionBefore: batch.selectionBefore,
          selectionAfter: batch.selectionAfter,
        })
        const snapshot = await applyLargeDocumentEditBatch({
          service: largeTextFileService,
          documentId: preview.documentId,
          expectedVersion: edits.version,
          batch: pending,
        })
        committed = true
        resourceService.acceptAssets(assetIds)
        if (snapshot) {
          edits.confirmVisibleEdits(pending, snapshot.version)
          preview.source.applyNativeSnapshot(snapshot)
        }
        version = preview.source.version
        session = recordDocumentTransaction(session, batch)
      } else {
        const before = new EditorState({
          doc: state.doc,
          selection: batch.selectionBefore,
          history: state.history,
          facets: state.facets,
        })
        state = before.applyTransaction(batch)
        committed = true
        resourceService.acceptAssets(assetIds)
        session = recordDocumentTransaction(session, batch)
        version = session.documentVersion
      }
      // Document/history have committed. Rendering errors are reported without
      // turning the accepted edit into an apparent cancellable failure.
      try {
        if (!preview) updateRenderedMemoryDocument([batch])
        if (activeSourceView && activeSourceView === sourceView) {
          await activeSourceView.revealSelection(batch.selectionAfterLine, batch.selectionAfter)
        }
        notice = ''
      } catch (error) {
        importantNotice = true
        notice = `编辑已提交，视图更新失败：${getErrorMessage(error)}`
      }
      return { documentId: batch.snapshot.documentId, version }
    } finally {
      if (!committed) {
        try {
          await resourceService.releasePins(assetIds)
        } catch (error) {
          console.error('Uncommitted asset cleanup failed', error)
        }
      }
      controlledEditingCommit = false
      try {
        renderSession()
      } catch (error) {
        console.error('Editing status render failed', error)
      }
    }
  },
})

const desktopPluginEditor: Editor = {
  get state() {
    return state
  },
  dispatch(transaction: Transaction): void {
    if (session.readonly) throw new PluginEditingError('readonly')
    if (isDocumentBusy() || isDocumentSaving() || closeConfirmOpen || view?.isComposing)
      throw new PluginEditingError('busy')
    // Legacy serialized transactions have no native CAS or source-view queue.
    // Windowed writers must use the bounded editing host instead.
    if (sourceView) throw new PluginEditingError('unsupported')

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
    return applyEditHistory('undo')
  },
  redo(): boolean {
    return applyEditHistory('redo')
  },
}

/** Bind legacy command writes to the document and save destination at invocation. */
function createDesktopLegacyCommandEditor(): Editor {
  const expected = getDesktopEditingCurrent()
  const assertCurrent = (): void => {
    const current = getDesktopEditingCurrent()
    if (!current || !expected) throw new PluginEditingError('stale')
    if (current.readonly) throw new PluginEditingError('readonly')
    if (current.busy) throw new PluginEditingError('busy')
    if (
      current.identity !== expected.identity ||
      current.source !== expected.source ||
      current.documentId !== expected.documentId ||
      current.version !== expected.version ||
      current.selectionRevision !== expected.selectionRevision ||
      current.saveLocationGeneration !== expected.saveLocationGeneration
    )
      throw new PluginEditingError('stale')
    if (current.mode === 'windowed') throw new PluginEditingError('unsupported')
  }
  const facade: Editor = {
    get state() {
      return desktopPluginEditor.state
    },
    dispatch(transaction) {
      assertCurrent()
      desktopPluginEditor.dispatch(transaction)
    },
    command(command) {
      return command.run(facade)
    },
    undo() {
      assertCurrent()
      return desktopPluginEditor.undo()
    },
    redo() {
      assertCurrent()
      return desktopPluginEditor.redo()
    },
  }
  return facade
}

function applyEditHistory(direction: 'undo' | 'redo'): boolean {
  const activeSourceView = sourceView
  if (activeSourceView) {
    const documentId = session.documentId
    void activeSourceView
      .runAfterPendingEdits(async () => {
        if (sourceView !== activeSourceView || session.documentId !== documentId) return
        if (largeDocumentPreview?.editSession) {
          await applyLargeEditHistoryBatch(direction)
        } else {
          applyMemoryEditHistory(direction)
          await activeSourceView.revealSelection(
            state.doc.lineAt(state.selection.main.head).number,
            state.selection,
          )
        }
      })
      .catch((error: unknown) => {
        if (sourceView !== activeSourceView || session.documentId !== documentId) return
        importantNotice = true
        notice = `历史操作失败：${getErrorMessage(error)}`
        renderSession()
      })
    return true
  }
  return applyMemoryEditHistory(direction)
}

function applyMemoryEditHistory(direction: 'undo' | 'redo'): boolean {
  if (!(direction === 'undo' ? state.history.canUndo : state.history.canRedo)) return false
  state = direction === 'undo' ? state.undo() : state.redo()
  session = recordDocumentTransaction(session, {
    changes: ChangeSet.insert(state.selection.main.head, ''),
    origin: { type: direction === 'undo' ? 'history.undo' : 'history.redo' },
  })
  try {
    updateRenderedMemoryDocument()
  } catch (error) {
    importantNotice = true
    notice = `历史操作已提交，视图更新失败：${getErrorMessage(error)}`
  }
  renderSession()
  return true
}

void fileService
  .listenToFileWatchEvents((event) => {
    if (event.documentId !== session.documentId) {
      return
    }

    try {
      session = applyFileWatchEvent(session, event)
      if (saveState.phase === 'saving') saveState.watchEvents.push(event)
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

const protectedInstallGate = createProtectedInstallGate({
  busy: () => isDocumentBusy() || isDocumentSaving() || closeConfirmOpen,
  requestTransition: (proceed) => documentTransitions.request('update', proceed),
  cancelTransition: () => documentTransitions.cancel(),
  prepareDocument: async () => {
    await sourceView?.flushPendingEdits()
    await recovery?.flush()
    if (session.dirty || session.externalChangeState !== 'none' || isDocumentSaving())
      throw Error('文档尚未安全保存。请处理未保存内容或外部修改冲突后重试。')
  },
  setInstalling: (value) => {
    applicationUpdateInstalling = value
    renderSession()
  },
  // Built-in About restores focus after its controller has rendered the settled state.
  // Keep the generic release capability's existing modal focus behavior.
  returnFocus: () => appRoot.querySelector<HTMLElement>('.plugin-ui-modal')?.focus(),
})

const desktopActionRegistry = new ActionRegistry(createDesktopActions())
const desktopActionPermissions = Object.freeze([
  'app:plugins',
  'app:control',
  'app:updates',
  'workspace:read',
  'settings:write',
  'app:keymap',
  'images:import',
  'document:read',
  'document:output',
  'document:write',
  'file:read',
  'file:write',
  'file:delete',
  'network:access',
  'view:write',
]) satisfies readonly ActionPermission[]
let invalidatePluginUi: (pluginId: string, viewId?: string) => Promise<void> = async () => undefined
const desktopKeymap = createKeymapService({
  ...(desktopStorage ? { storage: desktopStorage } : {}),
  commands: () => {
    const bindings = desktopPluginManager.state().contributions.keymaps
    return desktopActionRegistry.list().map((action) => ({
      id: action.id,
      title: action.title,
      category: action.category,
      available: !action.id.startsWith('appearance.') || isTauriRuntime(),
      bindable: !action.inputSchema,
      ...(action.inputSchema
        ? { input: `需要参数：${Object.keys(action.inputSchema.properties ?? {}).join('、')}` }
        : {}),
      ...(bindings.some((binding) => binding.command === action.id && binding.status !== 'invalid')
        ? {
            defaultKeys: bindings
              .filter((binding) => binding.command === action.id && binding.status === 'active')
              .map(({ key }) => key),
            // A shadowed default still constrains a user's replacement key.
            defaultBindings: bindings
              .filter((binding) => binding.command === action.id && binding.status !== 'invalid')
              .map(({ key, when }) => ({ key, ...(when ? { when } : {}) })),
          }
        : {}),
    }))
  },
})
const desktopOutput = createDesktopOutputService({
  current: () => {
    const current = getDesktopEditingCurrent()
    if (!current || current.busy) return undefined
    return {
      source: current.source,
      ...(current.source instanceof LargeDocumentSource
        ? {
            readLengthUtf16: async () => {
              const source = current.source as LargeDocumentSource
              // An empty EOF chunk resolves indexed UTF-16 length without reading a line.
              return (
                await largeTextFileService.readChunk(
                  source.documentId,
                  source.sizeBytes,
                  source.sizeBytes,
                )
              ).toUtf16
            },
          }
        : {}),
      identity: current.identity,
      selection: { anchor: current.selection.main.anchor, head: current.selection.main.head },
      ...(session.file?.path ? { sourcePath: session.file.path } : {}),
      title: getSessionTitleInfo(session.file?.path).name,
      saveLocationGeneration: current.saveLocationGeneration,
    }
  },
  invoke: recoveryInvoke,
  renderers: () => desktopPluginManager.state().contributions.documentRenderers ?? [],
  rendererGeneration: (pluginId) => desktopPluginManager.documentRendererGeneration(pluginId),
  render: (pluginId, rendererId, request, options) =>
    desktopPluginManager.renderDocument(pluginId, rendererId, request, options),
})
const desktopPluginManager: DesktopPluginManager = new DesktopPluginManager({
  reservedPluginIds: ['milkup.updates'],
  bundledUpgradeSources: {
    'milkup.diagrams': ['bundled:milkup.diagrams-1.1.1.milkup-plugin'],
    'milkup.formatting': ['bundled:milkup.formatting-1.0.0.milkup-plugin'],
  },
  executionUnavailableReason: (manifest) =>
    manifest.host === 'dom' && platform !== 'linux'
      ? '当前平台不支持此插件的独立 DOM 执行环境'
      : undefined,
  ...(isTauriRuntime() ? { catalog: createDesktopPluginCatalog(recoveryInvoke) } : {}),
  actionRegistry: desktopActionRegistry,
  manifestHost: createDesktopPluginManifestHost(),
  permissions: desktopActionPermissions,
  milkupVersion: appVersion,
  pluginSdkVersion: __MILKUP_PLUGIN_SDK_VERSION__,
  keymapAdapter: () => desktopKeymap,
  editingAdapter: (manifest) => desktopEditing.adapterForPlugin(manifest.id),
  resourcesAdapter: (manifest) => resourceService.adapterForPlugin(manifest.id),
  outputAdapter: (manifest) => desktopOutput.adapterForPlugin(manifest.id),
  openUi: (pluginId, viewId) => desktopPluginUi.open(pluginId, viewId),
  requestManagementHostView: async (input, context) => {
    context.assertActive()
    const target = appRoot.querySelector<HTMLElement>('[data-plugin-manager]')
    if (!target) return { status: 'cancelled' }
    // Navigate from a controlled modal to the trusted safety shell. This does
    // not approve, install, change settings, or invoke lifecycle actions.
    const modals = Array.from(appRoot.querySelectorAll<HTMLElement>('.plugin-ui-modal')).flatMap(
      (modal) => {
        const contribution = desktopPluginManager
          .state()
          .contributions.ui.find((item) => `${item.pluginId}:${item.id}` === modal.dataset.pluginUi)
        return contribution ? [contribution] : []
      },
    )
    setMenuOpen(true)
    showMenuSection('plugins')
    renderPluginManager()
    if (!revealDesktopPluginDetails(target, input.pluginId, input.view))
      return { status: 'cancelled' }
    // Deliver the successful navigation response before disposing its source
    // view, whose cancellation would otherwise abort its own navigation RPC.
    setTimeout(() => {
      void Promise.allSettled(modals.map((item) => desktopPluginUi.close(item.pluginId, item.id)))
    }, 0)
    return { status: 'opened' }
  },
  notifyUi: (_pluginId, notification) => {
    importantNotice = true
    notice = notification.message
    renderSession()
  },
  settingsAdapter: (manifest) => desktopSettings.adapterForPlugin(manifest.id, manifest.settings),
  workspaceAdapter: (pluginId) =>
    createDesktopWorkspaceAdapter({ pluginId, openDocument: openWorkspaceDocument }),
  releasesAdapter: () =>
    createDesktopReleaseAdapter({
      transport: nativeReleaseTransport(),
      currentVersion: appVersion,
      confirmInstall: (request) => protectedInstallGate.request(request),
    }),
  ...(desktopStorage ? { storage: desktopStorage } : {}),
  bundledPackagePaths: async () => (isTauriRuntime() ? bundledPluginPaths() : []),
  documentSource: () => {
    if (documentPresentation === 'custom-view') return undefined
    return largeDocumentPreview?.source ?? createMemoryDocumentSource()
  },
  invalidateUi: (pluginId, viewId) => invalidatePluginUi(pluginId, viewId),
  revealLine: (line) => revealPluginLine(line),
  revealLocation: revealPluginLocation,
  invalidatePresentation: () => {
    desktopDocumentPresentation.invalidate()
    view?.refreshDocumentPresentation()
    sourceView?.refreshDocumentPresentation()
  },
  onDocumentRenderFailure: (pluginId, kind) => {
    importantNotice = true
    notice =
      kind === 'execution-host'
        ? `插件 ${pluginId} 执行环境失败，已停用；可在插件管理中手动重新启用。`
        : `插件 ${pluginId} 渲染超时，已停用；可在插件管理中手动重新启用。`
    refreshPluginContributionsInViews()
    renderPluginManager()
    renderSession()
  },
  loadSidecarModule: async (manifest, executable, capabilities) => ({
    module: createSidecarPluginModule({
      manifest,
      process: createDesktopPluginSidecarProcess({ executable }),
      ...(capabilities?.documentBroker ? { documentBroker: capabilities.documentBroker } : {}),
      ...(capabilities?.uiBroker ? { uiBroker: capabilities.uiBroker } : {}),
      ...(capabilities?.releasesBroker ? { releasesBroker: capabilities.releasesBroker } : {}),
      ...(capabilities?.workspaceBroker ? { workspaceBroker: capabilities.workspaceBroker } : {}),
      ...(capabilities?.settingsBroker ? { settingsBroker: capabilities.settingsBroker } : {}),
      ...(capabilities?.keymapBroker ? { keymapBroker: capabilities.keymapBroker } : {}),
      ...(capabilities?.editingBroker ? { editingBroker: capabilities.editingBroker } : {}),
      ...(capabilities?.resourcesBroker ? { resourcesBroker: capabilities.resourcesBroker } : {}),
      ...(capabilities?.outputBroker ? { outputBroker: capabilities.outputBroker } : {}),
      ...(capabilities?.onDocumentRenderTimeout
        ? { onDocumentRenderTimeout: capabilities.onDocumentRenderTimeout }
        : {}),
      ...(capabilities?.onIsolationError
        ? { onIsolationError: capabilities.onIsolationError }
        : {}),
      timeoutMs: 10_000,
    }),
    dispose: () => undefined,
  }),
  loadDomModule: loadDesktopPluginDomModule,
})
// One controller for the application lifetime, started only after legacy plugin retirement.
let applicationUpdatesReady = false
let applicationUpdatesMigrationError: string | undefined
const applicationUpdates = createApplicationUpdatesController({
  service: createDesktopReleaseAdapter({
    transport: nativeReleaseTransport(),
    currentVersion: appVersion,
    confirmInstall: (request) => protectedInstallGate.request(request),
  }),
  currentVersion: appVersion,
  changed: renderApplicationUpdateStatus,
})
let presentationMemorySource: MemoryDocumentSource | undefined
let presentationMemoryDocument: object | undefined
function currentPresentationDocument() {
  if (documentPresentation === 'custom-view') return undefined
  if (sourceView) return { source: sourceView.source, identity: sourceView.source }
  if (
    !presentationMemorySource ||
    presentationMemoryDocument !== state.doc ||
    presentationMemorySource.documentId !== session.documentId ||
    presentationMemorySource.version !== session.documentVersion
  ) {
    presentationMemoryDocument = state.doc
    presentationMemorySource = createMemoryDocumentSource()
  }
  return { source: presentationMemorySource, identity: state.doc }
}
const desktopDocumentPresentation = createDesktopDocumentPresentationService({
  current: currentPresentationDocument,
  theme: () => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'),
  renderers: () => desktopPluginManager.state().contributions.documentRenderers ?? [],
  rendererGeneration: (pluginId) => desktopPluginManager.documentRendererGeneration(pluginId),
  render: (pluginId, rendererId, request, options) =>
    desktopPluginManager.renderDocument(pluginId, rendererId, request, options),
})
function createDesktopDocumentPresentation(): DocumentPresentationConfig | undefined {
  if (!desktopPluginManager.state().contributions.documentRenderers?.length) return undefined
  return {
    provide: desktopDocumentPresentation.provide,
    onNavigate: (target) =>
      revealPluginLocation(target, {
        signal: new AbortController().signal,
        assertActive: () => undefined,
      }),
  }
}
function desktopDocumentPresentationOptions(): {
  documentPresentation?: DocumentPresentationConfig
} {
  const config = createDesktopDocumentPresentation()
  return config ? { documentPresentation: config } : {}
}
let pluginUiReady = false
const pluginContextMenuSlot = appRoot.querySelector<HTMLElement>(
  '[data-plugin-slot="context-menu"]',
)!
const hostContextEditing = desktopEditing.adapterForHost()
const hostContextActions = createHostContextActions({
  editing: hostContextEditing.adapter,
  captureSnapshot: captureHostContextSnapshot,
  isCurrent: isHostContextSnapshotCurrent,
  clipboard: {
    readText: () => navigator.clipboard.readText(),
    writeText: (text) => navigator.clipboard.writeText(text),
    ...(typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write
      ? {
          writeTextDeferred: (text: Promise<string>) =>
            navigator.clipboard.write([
              new ClipboardItem({
                'text/plain': text.then((value) => new Blob([value], { type: 'text/plain' })),
              }),
            ]),
        }
      : {}),
  },
  selectAll: selectAllFromHostContext,
  history: applyHostContextHistory,
})
const desktopPluginUi: DesktopPluginUiController = new DesktopPluginUiController(
  appRoot,
  {
    contributions: () => {
      const contributions = desktopPluginManager.state().contributions
      return pluginUiReady ? contributions : { ...contributions, ui: [] }
    },
    generation: (pluginId) => desktopPluginManager.documentRendererGeneration(pluginId),
    renderUi: (pluginId, viewId, phase, uiState) =>
      desktopPluginManager.renderUi(pluginId, viewId, phase, uiState),
    resolveCommand: (rendererId, command) =>
      desktopPluginManager.resolveRendererCommand(rendererId, command),
    runCommand: (command, input, originalEvent) => runDesktopAction(command, input, originalEvent),
  },
  getPluginUiRenderState,
  {
    documentToolbar: {
      geometry: () => {
        const current = getDesktopEditingCurrent()
        return readEditorFloatingToolbarGeometry({
          editorRoot,
          view: sourceView ?? view,
          documentId: session.documentId,
          selectionHead: current?.selection.main.head ?? 0,
          ...(current ? { selectionAnchor: current.selection.main.anchor } : {}),
          visible:
            Boolean(current) &&
            !menuOpen &&
            !closeConfirmOpen &&
            !recoveryDialogOpen &&
            !isDocumentBusy(),
        })
      },
      observe: [editorRoot],
      restoreEditorFocus: focusActiveView,
    },
    contextMenu: {
      normalize: (nodes, rendererId) =>
        normalizePluginContextMenuNodes(nodes, rendererId, (owner, command) =>
          Boolean(desktopPluginManager.resolveRendererCommand(owner, command)),
        ),
      updated: () => {
        reconcilePluginContextMenu(pluginContextMenuSlot)
        editorContextMenu.reconcileLayout()
      },
    },
  },
)
desktopPluginUi.setSlotVisible('sidebar-panel', !sidebarCollapsed)
desktopPluginUi.setSlotVisible('context-menu', false)
const editorContextMenu = new EditorContextMenu(
  editorRoot,
  appRoot.querySelector<HTMLElement>('[data-editor-context-menu]')!,
  {
    available: () => !menuOpen && !isDocumentBusy() && !closeConfirmOpen && !recoveryDialogOpen,
    host: {
      capture: captureHostContextSnapshot,
      items: (snapshot) => hostContextActions.items(snapshot),
      isCurrent: isHostContextSnapshotCurrent,
      execute: (id, snapshot, event, signal) => {
        const menu = appRoot.querySelector<HTMLElement>('[data-editor-context-menu]')!
        const ownedFocus = menu.contains(document.activeElement)
        return hostContextActions.run(id, snapshot, event, signal ? { signal } : {}).then(() => {
          if (
            ownedFocus &&
            snapshot.documentId === session.documentId &&
            (menu.contains(document.activeElement) || document.activeElement === document.body)
          )
            focusActiveView()
        })
      },
    },
    pluginContainer: pluginContextMenuSlot,
    identity: () => getDesktopEditingCurrent()?.identity,
    refresh: () => desktopPluginUi.refreshSlot('context-menu'),
    visible: (value) => desktopPluginUi.setSlotVisible('context-menu', value),
    onError: (error) => {
      importantNotice = true
      notice = getErrorMessage(error)
      renderSession()
    },
  },
)
invalidatePluginUi = (pluginId, viewId) => desktopPluginUi.invalidate(pluginId, viewId)

for (const action of createDesktopPluginActions(desktopPluginManager)) {
  desktopActionRegistry.register(action)
}

renderPluginManager()

view = createEditorView()

renderSession()
updateModeToggle(view.viewMode)
focusActiveView()
void waitForNextPaint().then(() => {
  markStartupStage('shell-painted')
  focusActiveView()
})

const initialDocumentOpenPromise = openInitialDocument(initialOpenFilePathPromise)
void initialDocumentOpenPromise.finally(async () => {
  await settingsReady
  void showStartupWindow()
  if (recovery) void recoveryUi.open(false, true)
})
void desktopPluginManager.ready.then(
  async () => {
    applicationUpdatesReady = true
    void applicationUpdates.start()
    try {
      await initialDocumentOpenPromise
      pluginUiReady = true
      renderPluginManager()
      refreshPluginContributionsInViews()
      await desktopPluginUi.sync(session.documentId)
    } catch (error) {
      importantNotice = true
      notice = `文档或插件界面初始化失败：${getErrorMessage(error)}`
      renderSession()
    }
  },
  (error: unknown) => {
    // Only manager initialization failures block the new updater from starting.
    applicationUpdatesMigrationError = `更新功能暂不可用：插件初始化失败。请重启后重试。${getErrorMessage(error)}`
    importantNotice = true
    notice = applicationUpdatesMigrationError
    renderApplicationUpdateStatus()
    renderSession()
  },
)
renderApplicationUpdateStatus()
appRoot.querySelector('[data-menu-panel="about"]')?.addEventListener('click', (event) => {
  const button =
    event.target instanceof Element
      ? event.target.closest<HTMLButtonElement>('[data-application-update-action]')
      : null
  if (!applicationUpdatesReady || !button || button.getAttribute('aria-disabled') === 'true') return
  const action = button.dataset.applicationUpdateAction
  if (action === 'check') void applicationUpdates.check()
  else if (action === 'download') void applicationUpdates.download()
  else if (action === 'cancel') void applicationUpdates.cancel()
  else if (action === 'install') void installApplicationUpdate()
})

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
    desktopStorage?.setItem(developerStatusNoticeStorageKey, String(showDeveloperStatusNotice))
    renderSession()
  })
}

async function toggleDesktopPlugin(pluginId: string): Promise<void> {
  if (pendingPluginToggles.has(pluginId) || closeConfirmOpen || isDocumentSaving()) return
  if (isDocumentBusy()) {
    notice = '文档正在打开，请稍候。'
    renderSession()
    return
  }
  const record = desktopPluginManager.state().records.find((item) => item.manifest.id === pluginId)
  if (!record) return
  pendingPluginToggles.add(pluginId)
  renderPluginManager()
  try {
    if (record.enabled) await desktopPluginManager.disable(pluginId)
    else await desktopPluginManager.enableFromUserIntent(pluginId)
    refreshPluginContributionsInViews()
  } catch (error) {
    importantNotice = true
    notice = `插件切换失败：${getErrorMessage(error)}`
    renderSession()
  } finally {
    pendingPluginToggles.delete(pluginId)
    renderPluginManager()
  }
}

appRoot.querySelector<HTMLElement>('[data-plugin-manager]')?.addEventListener('click', (event) => {
  const target = event.target
  const button = target instanceof Element ? target.closest<HTMLButtonElement>('button') : null

  if (!button?.dataset.pluginAction) {
    return
  }

  const pluginId = button.dataset.pluginId

  switch (button.dataset.pluginAction) {
    case 'toggle':
      if (pluginId && !button.disabled) void toggleDesktopPlugin(pluginId)
      break
    case 'install':
      runDesktopAction('plugin.installLocal')
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
    case 'command':
      if (button.dataset.pluginCommand) {
        runDesktopAction(button.dataset.pluginCommand, {}, event)
      }
      break
    case 'open-ui':
      if (pluginId && button.dataset.pluginUiId) {
        void desktopPluginUi.open(pluginId, button.dataset.pluginUiId)
      }
      break
  }
})

function cancelDocumentTransition(): void {
  if (transitionPrompt?.kind === 'update') protectedInstallGate.cancel()
  else documentTransitions.cancel()
}

app.querySelector<HTMLButtonElement>('[data-menu-toggle]')?.addEventListener('click', () => {
  setMenuOpen(!menuOpen)
})

app.querySelector<HTMLButtonElement>('[data-menu-close]')?.addEventListener('click', () => {
  setMenuOpen(false)
})

appRoot
  .querySelector('[data-sidebar-close]')
  ?.addEventListener('click', () => setSidebarCollapsed(true))
appRoot
  .querySelector('[data-sidebar-dismiss]')
  ?.addEventListener('click', () => setSidebarCollapsed(true))
window.matchMedia('(max-width: 760px)').addEventListener('change', () => {
  const focused = document.activeElement
  updateSidebarPresentation()
  // A responsive sidebar can hide its resize/close control or make the editor
  // inert. Preserve all other focus, including modal fields during native zoom.
  if (
    focused instanceof HTMLElement &&
    (focused === document.body ||
      focused === document.documentElement ||
      focused.closest('[inert]') ||
      focused.getClientRects().length === 0 ||
      getComputedStyle(focused).visibility === 'hidden')
  ) {
    focusActiveView()
  }
})

app.querySelector<HTMLButtonElement>('[data-sidebar-toggle]')?.addEventListener('click', () => {
  setSidebarCollapsed(!sidebarCollapsed)
})

app
  .querySelector<HTMLElement>('[data-sidebar-resize]')
  ?.addEventListener('pointerdown', (event) => {
    startSidebarWidthResize(event)
  })

app.querySelector<HTMLElement>('[data-sidebar-resize]')?.addEventListener('keydown', (event) => {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
  event.preventDefault()
  setSidebarWidth(sidebarWidth + (event.key === 'ArrowLeft' ? -16 : 16))
})

app.querySelector<HTMLElement>('[data-sidebar-resize]')?.addEventListener('dblclick', () => {
  setSidebarWidth(defaultSidebarWidth)
})

globalThis.addEventListener('resize', () => setSidebarWidth(sidebarWidth, false))

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
    focusActiveView()
  }
})

const searchInput = appRoot.querySelector<HTMLInputElement>('[data-search-input]')!
searchInput.addEventListener('keydown', (event) => {
  if (event.isComposing || event.keyCode === 229) return
  if (event.key === 'Enter') {
    event.preventDefault()
    void navigateSearch(event.shiftKey ? -1 : 1)
  }
})
searchInput.addEventListener('input', (event) => {
  if (!(event as InputEvent).isComposing) scheduleDocumentSearch(true)
})
searchInput.addEventListener('compositionend', () => scheduleDocumentSearch(true))
appRoot.querySelector<HTMLButtonElement>('[data-search-case]')?.addEventListener('click', () => {
  searchCaseSensitive = !searchCaseSensitive
  appRoot
    .querySelector('[data-search-case]')
    ?.setAttribute('aria-pressed', String(searchCaseSensitive))
  scheduleDocumentSearch(true)
})
appRoot
  .querySelector<HTMLButtonElement>('[data-replace-one]')
  ?.addEventListener('click', () => replaceSearchMatches(false))
appRoot
  .querySelector<HTMLButtonElement>('[data-replace-all]')
  ?.addEventListener('click', () => replaceSearchMatches(true))
appRoot
  .querySelector('[data-replace-cancel]')
  ?.addEventListener('click', () => nativeReplacement?.abort.abort())
document.addEventListener(
  'keydown',
  (event) => {
    if (nativeReplacement && event.key === 'Escape') {
      event.preventDefault()
      nativeReplacement.abort.abort()
    }
  },
  true,
)
appRoot
  .querySelector<HTMLInputElement>('[data-replace-input]')
  ?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.isComposing && event.keyCode !== 229) {
      event.preventDefault()
      replaceSearchMatches(false)
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
      cancelDocumentTransition()
      return
    }

    if (action === 'save') {
      void documentTransitions.save()
      return
    }

    if (action === 'discard') {
      void documentTransitions.discard()
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

  if (
    target.closest(
      'button, input, textarea, a, .window-controls, [data-plugin-slot="document-toolbar"]',
    )
  ) {
    return
  }

  void startWindowDrag()
})

globalThis.addEventListener(
  'keydown',
  (event) => {
    if (closeConfirmOpen) {
      if (event.isComposing) return
      if (event.key === 'Escape') {
        event.preventDefault()
        cancelDocumentTransition()
      } else if (event.key === 'Tab' || event.code === 'Tab') {
        const buttons = Array.from(
          appRoot.querySelectorAll<HTMLButtonElement>(
            '[data-close-confirm] button:not(:disabled):not([hidden])',
          ),
        )
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
        const next = (index + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length
        event.preventDefault()
        buttons[next]?.focus()
      } else if (isPrimaryShortcut(event)) {
        event.preventDefault()
      }
      event.stopPropagation()
      return
    }
    if (event.isComposing || event.keyCode === 229) return
    if (event.target instanceof HTMLElement && event.target.closest('.plugin-ui-modal')) return
    if (menuOpen && (event.key === 'Tab' || event.code === 'Tab')) {
      const controls = visibleFocusTargets(appRoot.querySelector('[data-app-menu]')!)
      const index = controls.indexOf(document.activeElement as HTMLElement)
      const next = (index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length
      event.preventDefault()
      controls[next]?.focus()
      return
    }
    if (event.key === 'Escape') {
      const more =
        document.activeElement instanceof Element
          ? document.activeElement.closest<HTMLDetailsElement>('[data-plugin-card-more][open]')
          : null
      if (more) {
        event.preventDefault()
        event.stopPropagation()
        more.open = false
        more.querySelector<HTMLElement>('summary')?.focus()
        return
      }
      if (menuOpen) {
        event.preventDefault()
        setMenuOpen(false)
        return
      }
      if (!sidebarCollapsed && window.matchMedia('(max-width: 760px)').matches) {
        event.preventDefault()
        setSidebarCollapsed(true)
        return
      }
      if (searchOpen) {
        event.preventDefault()
        setSearchOpen(false)
        return
      }
      if (loadingState.phase === 'failed') {
        event.preventDefault()
        setDocumentLoadingState({ phase: 'ready' })
        focusActiveView()
        return
      }
    }
    if (event.key === 'F6' && !event.altKey && !isPrimaryShortcut(event)) {
      event.preventDefault()
      if (!menuOpen) cycleWorkspaceFocus(event.shiftKey)
      return
    }

    const action = getDesktopShortcutAction(event)

    if (!action) {
      return
    }

    event.preventDefault()
    if (menuOpen) setMenuOpen(false)
    runDesktopAction(action.id, {}, event)
  },
  { capture: true },
)

bindEditorViewClipboard(view)
editorRoot.addEventListener('keyup', schedulePluginUiViewportUpdate)
editorRoot.addEventListener('pointerup', schedulePluginUiViewportUpdate)

function createDesktopActions(): readonly ActionDefinition[] {
  return Object.freeze([
    {
      id: 'file.new',
      title: 'New Document',
      category: 'file',
      permissions: ['app:control'],
      risk: 'safe',
      run: () => documentTransitions.request('new', createNewDocument),
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
      run: () => documentTransitions.request('close', closeCurrentDocument),
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
    ...(['source', 'live', 'toggle'] as const).map((mode): ActionDefinition => ({
      id: `view.${mode}`,
      title: mode === 'source' ? '源码模式' : mode === 'live' ? '实时模式' : '切换编辑模式',
      category: 'view',
      permissions: ['view:write'],
      risk: 'safe',
      run: () => setViewMode(mode === 'toggle' ? getNextViewMode(session.viewMode) : mode),
    })),
    ...(['find', 'replace', 'next', 'previous'] as const).map((operation): ActionDefinition => ({
      id: `search.${operation}`,
      title: { find: '查找', replace: '替换', next: '下一个匹配', previous: '上一个匹配' }[
        operation
      ],
      category: 'view',
      permissions: ['view:write'],
      risk: 'safe',
      run: () => {
        if (!searchOpen || operation === 'find' || operation === 'replace') setSearchOpen(true)
        if (operation === 'replace')
          appRoot.querySelector<HTMLInputElement>('[data-replace-input]')?.focus()
        if (operation === 'next' || operation === 'previous')
          return navigateSearch(operation === 'next' ? 1 : -1)
      },
    })),
    ...(['zoomIn', 'zoomOut', 'zoomReset'] as const).map((operation): ActionDefinition => ({
      id: `appearance.${operation}`,
      title: { zoomIn: '放大界面', zoomOut: '缩小界面', zoomReset: '界面缩放恢复100%' }[operation],
      category: 'view',
      permissions: ['view:write'],
      risk: 'safe',
      run: () => changeNativeZoom(operation === 'zoomIn' ? 1 : operation === 'zoomOut' ? -1 : 0),
    })),
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

function runDesktopAction(
  id: string,
  input: unknown = {},
  originalEvent?: Event,
  onFailure?: () => void,
): Promise<void> {
  if (closeConfirmOpen) {
    onFailure?.()
    return Promise.resolve()
  }
  if (
    isDocumentSaving() &&
    (isDocumentInputLocked() || !['core.undo', 'core.redo', 'file.save'].includes(id))
  ) {
    onFailure?.()
    return Promise.resolve()
  }
  importantNotice = false
  if (isDocumentBusy() && !isBusyAllowedAction(id)) {
    onFailure?.()
    notice = '文档正在打开，请稍候。'
    renderSession()
    return Promise.resolve()
  }

  const context = {
    editor: createDesktopLegacyCommandEditor(),
    permissions: desktopActionPermissions,
    confirm: () => true,
  }
  if (originalEvent) markTrustedPluginCommand(context, originalEvent)
  return desktopActionRegistry
    .run(id, context, input)
    .then(() => {
      if (id.startsWith('plugin.')) {
        renderPluginManager()
        refreshPluginContributionsInViews()
      }
    })
    .catch((error: unknown) => {
      onFailure?.()
      importantNotice = true
      notice = `命令执行失败：${getErrorMessage(error)}`
      if (id.startsWith('plugin.')) {
        renderPluginManager()
        refreshPluginContributionsInViews()
      }
      renderSession()
      if (!id.startsWith('plugin.')) view?.inputDOM.focus({ preventScroll: true })
    })
}

function focusActiveView(): void {
  if (closeConfirmOpen || recoveryDialogOpen) return
  if (!sidebarCollapsed && window.matchMedia('(max-width: 760px)').matches) {
    appRoot.querySelector<HTMLButtonElement>('[data-sidebar-close]')?.focus()
    return
  }
  if (loadingState.phase === 'failed') {
    appRoot.querySelector<HTMLButtonElement>('[data-loading-dismiss]')?.focus()
    return
  }
  if (view) {
    view.inputDOM.focus({ preventScroll: true })
    return
  }

  sourceView?.inputDOM.focus({ preventScroll: true })
}

function focusEditableView(): void {
  if (closeConfirmOpen) return
  view?.inputDOM.focus({ preventScroll: true })
}

appRoot.addEventListener('milkup-selection-change', schedulePluginUiViewportUpdate, true)
editorRoot.addEventListener(
  'milkup-input-error',
  (event) => {
    if (event.target !== (sourceView ?? view)?.dom) return
    importantNotice = true
    notice = `图片粘贴未完成：${getErrorMessage((event as CustomEvent<unknown>).detail)}`
    renderSession()
  },
  true,
)

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

function desktopImagePaste(
  ...[files, context]: Parameters<import('@milkup/view-dom').ImagePasteHandler>
): void {
  if (files.length !== 1) throw new Error('请一次粘贴一张 PNG、JPEG 或 WebP 图片。')
  const handler = desktopPluginManager.resolveImagePasteHandler()
  if (!handler) throw new Error('请先启用并授权图片插件。')
  const pasteId = resourceService.grantPaste(files[0]!, context.event, handler.pluginId)
  context.signal.addEventListener(
    'abort',
    () => {
      void resourceService.abort(pasteId)
    },
    { once: true },
  )
  try {
    desktopPluginManager.grantImagePaste(handler.pluginId, pasteId)
    runDesktopAction(handler.command, { grantId: pasteId }, context.event, () => {
      void resourceService.abort(pasteId)
    })
  } catch (error) {
    void resourceService.abort(pasteId)
    throw error
  }
}
function desktopEmptyPaste(context: {
  readonly event: ClipboardEvent
  readonly signal: AbortSignal
}): boolean {
  const handler = desktopPluginManager.resolveImagePasteHandler()
  if (!handler || !navigator.clipboard?.read) return false
  const pasteId = resourceService.grantClipboardPaste(context.event, {
    signal: context.signal,
    pluginId: handler.pluginId,
  })
  context.signal.addEventListener(
    'abort',
    () => {
      void resourceService.abort(pasteId)
    },
    { once: true },
  )
  try {
    desktopPluginManager.grantImagePaste(handler.pluginId, pasteId)
    runDesktopAction(handler.command, { grantId: pasteId }, context.event, () => {
      void resourceService.abort(pasteId)
    })
    return true
  } catch (error) {
    void resourceService.abort(pasteId)
    throw error
  }
}
function desktopImageResolver(
  ...[url, context]: Parameters<import('@milkup/view-dom').ImageResolver>
) {
  return resourceService.resolveImage(session.documentId, url, context)
}

function createEditorView(): EditorView {
  sourceView?.destroy()
  sourceView = undefined

  const nextView = new EditorView({
    parent: editorRoot,
    onImagePaste: desktopImagePaste,
    onEmptyPaste: desktopEmptyPaste,
    imageResolver: desktopImageResolver,
    ...desktopDocumentPresentationOptions(),
    presentation: editorPresentation,
    state,
    mode: session.viewMode,
    editable:
      !session.readonly && !isDocumentBusy() && !isDocumentInputLocked() && !closeConfirmOpen,
    controlledRenderers: createDesktopControlledRenderers(),
    markdownSyntax: desktopPluginManager.state().contributions.markdownSyntax,
    ...(currentOpenPolicy.virtualViewport === undefined
      ? {}
      : {
          virtualViewport: {
            ...currentOpenPolicy.virtualViewport,
            lineHeight: editorPresentation.fontSize * editorPresentation.lineHeight,
          },
        }),
    dispatch: (transaction: Transaction) => {
      if (view !== nextView || isDocumentBusy() || isDocumentInputLocked() || closeConfirmOpen) {
        return
      }

      if (!view) {
        throw new Error('Desktop editor view was not initialized')
      }

      state = state.applyTransaction(transaction)
      session = recordDocumentTransaction(session, transaction)
      view.updateState(state, [transaction])
      renderSession()
      if (
        (!transaction.changes || transaction.changes.empty) &&
        transaction.origin?.type === 'command' &&
        (transaction.origin.id === 'view.documentStart' ||
          transaction.origin.id === 'view.documentEnd')
      )
        refreshPluginUiAfterDocumentNavigation()
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
  desktopDocumentPresentation.clear()
  sourceView?.setDocumentPresentation(createDesktopDocumentPresentation())
  view?.setDocumentPresentation(createDesktopDocumentPresentation())
  void desktopPluginUi.sync(session.documentId)
  const action = resolvePluginContributionViewRefreshAction({
    hasEditorView: view !== undefined,
    hasSourceView: sourceView !== undefined,
    hasLargeDocumentPreview: largeDocumentPreview !== undefined,
  })

  if (action === 'preserve-large-source') {
    sourceView?.setMode(session.viewMode)
    sourceView?.setEditable(
      !session.readonly && !isDocumentBusy() && !isDocumentInputLocked() && !closeConfirmOpen,
    )
    sourceView?.setSearchHighlights(searchResultState?.matches ?? [], activeSearchResultIndex)
    return
  }

  if (action === 'restore-large-source') {
    void applyLargeSourceView().catch((error: unknown) => {
      notice = `刷新大文件视图失败：${getErrorMessage(error)}`
      renderSession()
    })
    return
  }

  if (action === 'recreate-editor') {
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
    sourceView.setEditable(
      !session.readonly && !isDocumentBusy() && !isDocumentInputLocked() && !closeConfirmOpen,
    )
    sourceView.setSearchHighlights(searchResultState?.matches ?? [], activeSearchResultIndex)
    return
  }

  sourceView?.destroy()
  sourceView = new SourceDocumentView({
    parent: editorRoot,
    onDocumentNavigation: refreshPluginUiAfterDocumentNavigation,
    onFocusNavigation: ({ backward }) => {
      const focused = document.activeElement
      if (focused instanceof HTMLElement && editorRoot.contains(focused))
        moveDesktopFocus(focused, backward)
    },
    onImagePaste: desktopImagePaste,
    onEmptyPaste: desktopEmptyPaste,
    imageResolver: desktopImageResolver,
    ...desktopDocumentPresentationOptions(),
    presentation: editorPresentation,
    source,
    mode: session.viewMode,
    editable:
      !session.readonly && !isDocumentBusy() && !isDocumentInputLocked() && !closeConfirmOpen,
    onEdit: (edit) => applyMemorySourceEdit(edit),
    markdownContextLines: 24,
    backgroundMarkdownWarmup: true,
    markdownWarmupWindows: 1,
    virtualViewport: {
      enabled: true,
      lineHeight: editorPresentation.fontSize * editorPresentation.lineHeight,
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
    onDocumentNavigation: refreshPluginUiAfterDocumentNavigation,
    onFocusNavigation: ({ backward }) => {
      const focused = document.activeElement
      if (focused instanceof HTMLElement && editorRoot.contains(focused))
        moveDesktopFocus(focused, backward)
    },
    onImagePaste: desktopImagePaste,
    onEmptyPaste: desktopEmptyPaste,
    imageResolver: desktopImageResolver,
    ...desktopDocumentPresentationOptions(),
    presentation: editorPresentation,
    source: largeDocumentPreview.source,
    mode: session.viewMode,
    editable:
      !session.readonly && !isDocumentBusy() && !isDocumentInputLocked() && !closeConfirmOpen,
    onEdit: (edit) => applyLargeSourceEdit(edit),
    markdownContextLines: 24,
    backgroundMarkdownWarmup: true,
    markdownWarmupWindows: 1,
    virtualViewport: {
      enabled: true,
      lineHeight: editorPresentation.fontSize * editorPresentation.lineHeight,
      overscanLines: 24,
    },
  })
  sourceView.dom.addEventListener('scroll', schedulePluginUiViewportUpdate, { passive: true })
  sourceView.setSearchHighlights(searchResultState?.matches ?? [], activeSearchResultIndex)
  await sourceView.renderVisibleWindow()
}

function createNewDocument(): void {
  recovery?.endDocument()
  const action: FileAction = {
    kind: 'new',
    documentId: `desktop-untitled-${Date.now()}`,
  }

  clearSearchResults()
  unwatchCurrentFile()
  clearPluginDocumentPresentation()
  scheduleLargeDocumentPreviewClose()
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

/** Plugin files enter the same dirty/save/conflict transition as the host Open command.
 * Native descriptor leases keep preparation inside the selected directory; no plugin path is used.
 */
async function openWorkspaceDocument(
  request: WorkspaceOpenRequest,
): Promise<{ status: 'opened' | 'cancelled' }> {
  const outcome = await documentTransitions.requestAndWait(
    'open',
    async (signal, commit) => {
      const before = {
        id: session.documentId,
        version: session.documentVersion,
        external: session.externalChangeState,
      }
      const assertCurrent = () => {
        if (
          signal.aborted ||
          request.signal.aborted ||
          session.documentId !== before.id ||
          session.documentVersion !== before.version ||
          session.externalChangeState !== before.external
        )
          throw new DOMException('文档切换已取消或当前文档发生变化', 'AbortError')
      }
      let preview: LargeDocumentPreviewState | undefined
      let committed = false
      setDocumentLoadingState({ phase: 'opening' })
      try {
        await recovery?.flush()
        assertCurrent()
        const lease = await request.prepare()
        assertCurrent()
        const policy = resolveDesktopOpenPolicy(lease.metadata)
        const tracker = createOpenStageTracker({
          label: 'workspace-open',
          consoleDiagnostics: isDeveloperDiagnosticsEnabled(),
        })
        if (policy.useNativeLargeFile) {
          setDocumentLoadingState({
            phase: 'indexing',
            path: lease.metadata.path,
            sizeBytes: lease.metadata.sizeBytes,
          })
          preview = await openLargeDocumentPreview({
            service: { ...largeTextFileService, open: (id) => lease.openLarge(id) },
            documentId: `desktop-workspace-${crypto.randomUUID()}`,
            path: lease.metadata.path,
            previewLineCount: largePreviewLineCount,
          })
          await lease.validate()
          assertCurrent()
          await lease.accept()
          assertCurrent()
          // All fallible preparation precedes replacement. The old preview stays usable until here.
          scheduleLargeDocumentPreviewClose()
          committed = true
          await commitLargeDocumentPreview(preview, policy, tracker, commit)
        } else {
          const result = await lease.read(`file:${lease.metadata.path}`)
          await lease.validate()
          assertCurrent()
          await lease.accept()
          assertCurrent()
          committed = true
          await openDocumentResult(result, tracker, { preResolvedPolicy: policy, onCommit: commit })
        }
        setDocumentLoadingState({
          phase: 'ready',
          path: lease.metadata.path,
          sizeBytes: lease.metadata.sizeBytes,
        })
      } catch (error) {
        if (!committed && preview)
          await largeTextFileService.close(preview.documentId).catch(() => undefined)
        setDocumentLoadingState({ phase: 'ready' })
        throw error
      }
    },
    { signal: request.signal },
  )
  return { status: outcome.status === 'completed' ? 'opened' : 'cancelled' }
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

async function openInitialDocument(
  initialPath: Promise<string | undefined> = fileService.initialOpenFilePath(),
): Promise<void> {
  const path = await initialPath.catch((error: unknown) => {
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
    preferBuiltinDocument: true,
    startup: true,
  })
  if (loadingState.phase === 'ready') {
    markStartupStage('initial-document-ready')
    await showStartupWindow()
    await waitForNextPaint()
    markStartupStage('initial-document-painted')
  }
}

async function openSelectedDocumentWithPolicy(
  tracker: OpenStageTracker,
  selectPath: () => Promise<string | undefined>,
  messages: {
    readonly cancelledNotice?: string
    readonly errorPrefix: string
    readonly preferBuiltinDocument?: boolean
    readonly startup?: boolean
  },
): Promise<void> {
  return documentTransitions.request('open', async () => {
    await openSelectedDocumentAfterConfirmation(tracker, selectPath, messages)
  })
}

async function openSelectedDocumentAfterConfirmation(
  tracker: OpenStageTracker,
  selectPath: () => Promise<string | undefined>,
  messages: {
    readonly cancelledNotice?: string
    readonly errorPrefix: string
    readonly preferBuiltinDocument?: boolean
    readonly startup?: boolean
  },
): Promise<void> {
  setDocumentLoadingState({ phase: 'opening' })
  if (messages.startup) {
    loadingVisibility.reveal()
  }

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
      metadata,
      onProgress: (event) => {
        if (event.phase === 'read-end') {
          tracker.mark('file-read-end', selected)
        }
      },
    })
    tracker.mark(
      'plugin-check-start',
      messages.preferBuiltinDocument ? 'skipped for startup Markdown' : selected,
    )
    const pluginDocument = messages.preferBuiltinDocument
      ? undefined
      : await desktopPluginManager.openPluginDocument(selected, result.text)
    tracker.mark('plugin-check-end', pluginDocument?.kind ?? 'built-in Markdown')

    if (pluginDocument) {
      openPluginDocumentResult(pluginDocument)
      setDocumentLoadingState({
        phase: 'ready',
        path: selected,
        sizeBytes: metadata.sizeBytes,
      })
      return
    }
    await openDocumentResult(result, tracker, {
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
    focusActiveView()
  }
}

async function openDocumentResult(
  result: OpenFileResult,
  tracker: OpenStageTracker,
  options: { readonly preResolvedPolicy?: DesktopOpenPolicy; readonly onCommit?: () => void } = {},
): Promise<void> {
  const nextOpenPolicy =
    options.preResolvedPolicy ?? resolveDesktopOpenPolicy(metadataFromOpenFileResult(result))

  if (nextOpenPolicy.useNativeLargeFile) {
    await openNativeLargeDocument(result.file.path, nextOpenPolicy, tracker)
    return
  }

  unwatchCurrentFile()
  clearPluginDocumentPresentation()
  scheduleLargeDocumentPreviewClose()
  clearSearchResults()
  recovery?.endDocument()
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
  tracker.mark('editor-dom-commit')
  options.onCommit?.()
  notice = ''
  renderSession()
  await waitForNextPaint()
  tracker.mark('first-editor-paint')
  focusActiveView()
  tracker.mark('first-interactive-focus')
  lastOpenDiagnostics = tracker.snapshot()
  renderSession()
}

function openPluginDocumentResult(
  result: NonNullable<Awaited<ReturnType<DesktopPluginManager['openPluginDocument']>>>,
): void {
  void recovery?.endDocument()
  unwatchCurrentFile()
  scheduleLargeDocumentPreviewClose()
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
    try {
      await largeTextFileService.close(previousLargeDocumentId)
    } catch (error) {
      await largeTextFileService.close(preview.documentId).catch(() => undefined)
      throw error
    }
  }

  await commitLargeDocumentPreview(preview, openPolicy, tracker)
}

async function commitLargeDocumentPreview(
  preview: LargeDocumentPreviewState,
  openPolicy: DesktopOpenPolicy,
  tracker: OpenStageTracker,
  onCommit?: () => void,
): Promise<void> {
  const documentId = preview.documentId
  unwatchCurrentFile()
  clearPluginDocumentPresentation()
  clearSearchResults()
  currentOpenPolicy = openPolicy
  recovery?.endDocument()
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
  onCommit?.()
  await applyLargeSourceView()
  tracker.mark('memory-document-end', `${preview.window.lines.length} preview lines`)
  tracker.mark('editor-dom-commit', `${openPolicy.featurePolicy.mode} native-line-window`)
  notice = `已用原生大文件路径打开预览：${formatBytes(preview.sizeBytes)}，${preview.lineCount} 行。`
  renderSession()
  await waitForNextPaint()
  tracker.mark('first-editor-paint', `${openPolicy.featurePolicy.mode} native-line-window`)
  focusActiveView()
  tracker.mark('first-interactive-focus')
  lastOpenDiagnostics = tracker.snapshot()
  renderSession()
}

function isDocumentSaving(): boolean {
  return saveState.phase === 'saving'
}

function isDocumentInputLocked(): boolean {
  return saveState.phase === 'saving' && !saveState.allowEditing
}

function runDocumentSave(task: () => Promise<boolean>, allowEditing = false): Promise<boolean> {
  if (saveState.phase === 'saving') return saveState.promise
  importantNotice = false
  const watchEvents: FileWatchEvent[] = []
  resourceSaveWarning = undefined
  // Establish the lock before invoking the async operation, including Save As dialogs.
  const promise = Promise.resolve()
    .then(async () => {
      await recovery?.flush()
      return task()
    })
    .then(
      (saved) => {
        if (saved) {
          session = reconcileSaveWatchEvents(session, watchEvents)
          if (session.externalChangeState !== 'none') {
            importantNotice = true
            notice = '保存期间检测到外部文件更改，已保留当前文档。请核对磁盘内容后再继续。'
            saved = false
          }
        }
        saveState = Object.freeze({ phase: 'idle' })
        renderSession()
        return saved
      },
      (error: unknown) => {
        saveState = Object.freeze({ phase: 'idle' })
        importantNotice = true
        notice = `保存失败：${getErrorMessage(error)}`
        renderSession()
        throw error
      },
    )
  saveState = Object.freeze({ phase: 'saving', promise, watchEvents, allowEditing })
  renderSession()
  return promise
}

async function saveDocument(): Promise<boolean> {
  // Existing-file saves are ordered with windowed edits/history. Later keys
  // remain accepted and run after the write; they must not be silently dropped
  // by a readonly input proxy or absorbed into the saved revision.
  const allowEditing = Boolean(session.file) && !closeConfirmOpen
  const activeSourceView = sourceView
  if (allowEditing && activeSourceView) {
    const documentId = session.documentId
    let saved = false
    await activeSourceView.runAfterPendingEdits(async () => {
      if (sourceView !== activeSourceView || session.documentId !== documentId) return
      saved = await runDocumentSave(
        () => (largeDocumentPreview ? saveLargeDocument(true) : saveMemorySourceDocument(true)),
        true,
      )
    })
    return saved
  }
  if (allowEditing && saveState.phase === 'saving' && saveState.allowEditing) {
    const documentId = session.documentId
    await saveState.promise
    if (session.documentId !== documentId) return false
    return saveDocument()
  }
  return runDocumentSave(saveDocumentOnce, allowEditing)
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
    importantNotice = true
    notice = translateSaveSafetyMessage(safety.message)
    renderSession()
    focusEditableView()
    return false
  }

  const savedVersion = session.documentVersion
  const result = session.file
    ? await fileService.saveFile(session, prepareTextForFileSave(session, state.doc.text))
    : await saveMemoryWithResourceRelocation()

  if (!result) {
    importantNotice = true
    notice = messages.notices.saveCancelled
    renderSession()
    focusEditableView()
    return false
  }

  session = recordFileSaveResult(session, result, savedVersion)
  invalidateDesktopSaveLocation()
  recentFiles = recordRecentFile(recentFiles, result.file, Date.now())
  watchCurrentFile()
  notice = resourceSaveWarning ?? messages.notices.saved
  renderSession()
  focusEditableView()
  return true
}

async function saveMemorySourceDocument(inEditQueue = false): Promise<boolean> {
  const action: FileAction = {
    kind: 'save',
    documentId: session.documentId,
  }

  getRequiredDocumentId(action)
  if (!inEditQueue) await sourceView?.flushPendingEdits()
  const safety = getSaveSafety(session)

  if (!safety.canSave) {
    importantNotice = true
    notice = translateSaveSafetyMessage(safety.message)
    renderSession()
    focusActiveView()
    return false
  }

  const savedVersion = session.documentVersion
  const result = session.file
    ? await fileService.saveFile(session, prepareTextForFileSave(session, state.doc.text))
    : await saveMemoryWithResourceRelocation()

  if (!result) {
    importantNotice = true
    notice = messages.notices.saveCancelled
    renderSession()
    focusActiveView()
    return false
  }

  session = recordFileSaveResult(session, result, savedVersion)
  invalidateDesktopSaveLocation()
  recentFiles = recordRecentFile(recentFiles, result.file, Date.now())
  watchCurrentFile()
  notice = resourceSaveWarning ?? messages.notices.saved
  renderSession()
  focusActiveView()
  return true
}

async function saveLargeDocument(inEditQueue = false): Promise<boolean> {
  if (!largeDocumentPreview?.editSession) {
    return false
  }

  const safety = getSaveSafety(session)

  if (!safety.canSave) {
    importantNotice = true
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
      if (!inEditQueue) await sourceView?.flushPendingEdits()
      saveStage = '写入文件'
      notice = `正在保存大文件：${saveStage}…`
      renderSession()
      console.info(`Large document save progressed: ${saveStage}`)
      const savedVersion = session.documentVersion
      const editSnapshot = largeDocumentPreview.editSession.snapshot()
      const snapshot = await largeTextFileService.flush(
        largeDocumentPreview.documentId,
        editSnapshot.version,
      )
      largeDocumentPreview.source.applyNativeSnapshot(snapshot)
      largeDocumentPreview.editSession.markFlushed(snapshot.version)
      session = recordFileSaveResult(
        session,
        {
          documentId: session.documentId,
          file: { path: snapshot.path },
          diskSnapshotHash: largeSnapshotHash(snapshot.version, snapshot.sizeBytes),
        },
        savedVersion,
      )

      // Queued saves have already flushed earlier edits and hold later edits
      // behind this write. Awaiting their own queue here would deadlock.
      if (inEditQueue) break
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
    notice = resourceSaveWarning ?? messages.notices.saved
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
  readonly historyGroup?: 'isolate'
  readonly from: number
  readonly to: number
  readonly insert: string
  readonly selectionBefore?: Selection | undefined
  readonly selectionAfter?: Selection | undefined
}): Promise<void> {
  if (edit.selectionBefore)
    state = new EditorState({
      doc: state.doc,
      selection: edit.selectionBefore,
      history: state.history,
      facets: state.facets,
    })
  const transaction: Transaction = {
    changes: ChangeSet.replace(edit.from, edit.to, edit.insert),
    selection: edit.selectionAfter ?? Selection.cursor(edit.from + edit.insert.length),
    origin: {
      type: edit.insert.length === 0 ? 'input.delete' : 'input.type',
      id: 'memory-source-edit',
    },
    ...(edit.historyGroup ? { historyGroup: edit.historyGroup } : {}),
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
  readonly historyGroup?: 'isolate'
  readonly selectionBefore?: Selection | undefined
  readonly selectionAfter?: Selection | undefined
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
    {
      selectionBefore: edit.selectionBefore,
      selectionAfter: edit.selectionAfter,
      ...(!edit.historyGroup && edit.insert && !/[\r\n]/.test(edit.insert)
        ? { historyGroup: 'typing' as const }
        : {}),
    },
  )
  let snapshot

  try {
    snapshot = await applyLargeDocumentEditBatch({
      service: largeTextFileService,
      documentId: preview.documentId,
      expectedVersion,
      batch,
      restoreNativeHistory: (token, direction) =>
        largeSearchService.restore(preview.documentId, expectedVersion, token, direction),
    })
  } catch (error: unknown) {
    notice = `大文件编辑失败：${getErrorMessage(error)}`
    renderSession()
    throw error
  }

  if (!snapshot) {
    return
  }

  editSession.confirmVisibleEdits(batch, snapshot.version)
  preview.source.applyNativeSnapshot(snapshot)
  session = recordDocumentTransaction(session, {
    changes: ChangeSet.replace(edit.from, edit.to, edit.insert),
    selection: edit.selectionAfter ?? Selection.cursor(edit.from + edit.insert.length),
    origin: { type: 'input.type', id: 'large-source-edit' },
  })
  notice = `已应用大文件可见范围编辑；版本 ${snapshot.version}。`
  renderSession()
}

async function applyLargeEditHistoryBatch(
  direction: 'undo' | 'redo',
  reportFailure = false,
): Promise<void> {
  const preview = largeDocumentPreview
  const editSession = preview?.editSession
  const activeSourceView = sourceView

  if (!preview || !editSession) {
    return
  }

  const expectedVersion = editSession.version
  const batch = direction === 'undo' ? editSession.prepareUndo() : editSession.prepareRedo()

  if (!batch) {
    return
  }

  let committed = false
  try {
    const snapshot = await applyLargeDocumentEditBatch({
      service: largeTextFileService,
      documentId: preview.documentId,
      expectedVersion,
      batch,
      restoreNativeHistory: (token, direction) =>
        largeSearchService.restore(preview.documentId, expectedVersion, token, direction),
    })

    committed = true

    if (snapshot) {
      if (direction === 'undo') {
        editSession.confirmUndo(snapshot.version)
      } else {
        editSession.confirmRedo(snapshot.version)
      }
      preview.source.applyNativeSnapshot(snapshot)
    }

    session = batch.nativeHistory
      ? recordNativeDocumentMutation(session)
      : recordDocumentTransaction(session, {
          changes: largeTextEditsToChangeSet(batch.edits),
          origin: { type: 'history.undo', id: `large-${direction}` },
        })
    notice = direction === 'undo' ? '已撤销大文件编辑。' : '已重做大文件编辑。'
    if (sourceView === activeSourceView) await activeSourceView?.renderVisibleWindow()
    if (activeSourceView && sourceView === activeSourceView && batch.selectionAfter) {
      const line = await preview.source.lineAtPosition(batch.selectionAfter.main.head)
      if (sourceView === activeSourceView)
        await activeSourceView.revealSelection(line.number, batch.selectionAfter)
    }
    renderSession()
    if (sourceView === activeSourceView) focusActiveView()
  } catch (error: unknown) {
    if (reportFailure && !committed) throw error
    importantNotice = true
    notice = committed
      ? `历史操作已提交，视图更新失败：${getErrorMessage(error)}`
      : `大文件${direction === 'undo' ? '撤销' : '重做'}失败：${getErrorMessage(error)}`
    renderSession()
    if (sourceView === activeSourceView) focusActiveView()
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
  scheduleLargeDocumentPreviewClose()
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
      await openDocumentResult(result, tracker, { preResolvedPolicy: openPolicy })
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

async function* readNativeResourceChunks(
  preview: LargeDocumentPreviewState,
): AsyncGenerator<string> {
  const version = preview.source.version
  let fromByte = 0
  while (fromByte < preview.source.sizeBytes) {
    if (largeDocumentPreview !== preview || preview.source.version !== version)
      throw new Error('扫描图片资源期间文档已改变。')
    const chunk = await resourceService.readDocumentChunk(preview.documentId, version, fromByte)
    if (
      chunk.nextByte <= fromByte ||
      chunk.nextByte > chunk.totalBytes ||
      chunk.totalBytes !== preview.source.sizeBytes
    )
      throw new Error('图片资源扫描返回无效范围。')
    yield chunk.text
    fromByte = chunk.nextByte
  }
  if (preview.source.version !== version) throw new Error('扫描图片资源期间文档已改变。')
}

/** The save lock is held by runDocumentSave through chooser, copy and write. */
async function saveMemoryWithResourceRelocation() {
  const text = prepareTextForFileSave(session, state.doc.text)
  if (!isTauriRuntime()) return fileService.saveFileAs(session, text)
  const target = await resourceService.selectSaveTarget(session.file?.path ?? 'untitled.md')
  if (!target) return undefined
  const references = scanResourceReferences(state.doc.text)
  if (!session.file && references.length)
    throw new Error(
      '未命名文档中的已有相对图片无法确定来源，请先移除该引用或保存文档后重新导入图片。',
    )
  return saveWithResources({
    prepare: () =>
      session.file
        ? resourceService.prepareRelocation(session.documentId, target.id, references)
        : Promise.resolve(undefined),
    write: () => fileService.saveToSelectedPath(session, text, target.path),
    accept: (id) => resourceService.commitRelocation(id),
    abort: (id) => resourceService.abort(id),
    report: (error) => {
      importantNotice = true
      notice = resourceSaveWarning = `文件已保存，资源确认未完成：${getErrorMessage(error)}`
    },
  })
}

async function saveDocumentAs(): Promise<boolean> {
  return runDocumentSave(saveDocumentAsOnce)
}

async function saveDocumentAsOnce(): Promise<boolean> {
  if (!view) {
    if (largeDocumentPreview) {
      return saveLargeDocumentAs()
    }
    if (sourceView) {
      return saveMemorySourceDocumentAs()
    }
    notice = '当前没有可另存为的编辑视图。'
    renderSession()
    focusActiveView()
    return false
  }

  const action: FileAction = {
    kind: 'saveAs',
    documentId: session.documentId,
    path: session.file?.path ?? 'untitled.md',
  }
  const safety = getSaveSafety(session)

  if (!safety.canSave) {
    importantNotice = true
    notice = translateSaveSafetyMessage(safety.message)
    renderSession()
    view.inputDOM.focus({ preventScroll: true })
    return false
  }

  getRequiredDocumentId(action)
  const savedVersion = session.documentVersion
  const result = await saveMemoryWithResourceRelocation()

  if (!result) {
    importantNotice = true
    notice = messages.notices.saveAsCancelled
    renderSession()
    view.inputDOM.focus({ preventScroll: true })
    return false
  }

  session = recordFileSaveResult(session, result, savedVersion)
  invalidateDesktopSaveLocation()
  recentFiles = recordRecentFile(recentFiles, result.file, Date.now())
  watchCurrentFile()
  notice = resourceSaveWarning ?? messages.notices.savedAs
  renderSession()
  view.inputDOM.focus({ preventScroll: true })
  return true
}

async function saveMemorySourceDocumentAs(): Promise<boolean> {
  const action: FileAction = {
    kind: 'saveAs',
    documentId: session.documentId,
    path: session.file?.path ?? 'untitled.md',
  }
  const safety = getSaveSafety(session)

  if (!safety.canSave) {
    importantNotice = true
    notice = translateSaveSafetyMessage(safety.message)
    renderSession()
    focusActiveView()
    return false
  }

  getRequiredDocumentId(action)
  await sourceView?.flushPendingEdits()
  const savedVersion = session.documentVersion
  const result = await saveMemoryWithResourceRelocation()

  if (!result) {
    importantNotice = true
    notice = messages.notices.saveAsCancelled
    renderSession()
    focusActiveView()
    return false
  }

  session = recordFileSaveResult(session, result, savedVersion)
  invalidateDesktopSaveLocation()
  recentFiles = recordRecentFile(recentFiles, result.file, Date.now())
  watchCurrentFile()
  notice = resourceSaveWarning ?? messages.notices.savedAs
  renderSession()
  focusActiveView()
  return true
}

async function saveLargeDocumentAs(): Promise<boolean> {
  const preview = largeDocumentPreview
  const editSession = preview?.editSession

  if (!preview || !editSession) {
    notice = '当前没有可另存为的大文件。'
    renderSession()
    focusActiveView()
    return false
  }

  const target = isTauriRuntime()
    ? await resourceService.selectSaveTarget(session.file?.path ?? preview.source.path)
    : undefined
  const selected = isTauriRuntime()
    ? target?.path
    : await fileService.selectSaveFilePath(session.file?.path ?? preview.source.path)

  if (!selected) {
    importantNotice = true
    notice = messages.notices.saveAsCancelled
    renderSession()
    focusActiveView()
    return false
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
    const savedVersion = session.documentVersion
    const references = target
      ? (
          await scanDocumentResourceReferences(preview.source, {
            chunks: readNativeResourceChunks(preview),
          })
        ).references
      : []
    const snapshot = await saveWithResources({
      prepare: () =>
        target
          ? resourceService.prepareRelocation(session.documentId, target.id, references)
          : Promise.resolve(undefined),
      write: () => largeTextFileService.flushAs(preview.documentId, editSession.version, selected),
      accept: (id) => resourceService.commitRelocation(id),
      abort: (id) => resourceService.abort(id),
      report: (error) => {
        importantNotice = true
        notice = resourceSaveWarning = `文件已保存，资源确认未完成：${getErrorMessage(error)}`
      },
    })
    preview.source.applyNativeSnapshot(snapshot)
    editSession.markFlushed(snapshot.version)
    largeDocumentPreview = {
      ...preview,
      path: snapshot.path,
      version: snapshot.version,
      sizeBytes: snapshot.sizeBytes,
      lineCount: snapshot.lineCount,
    }
    session = recordFileSaveResult(
      session,
      {
        documentId: session.documentId,
        file: { path: snapshot.path },
        diskSnapshotHash: largeSnapshotHash(snapshot.version, snapshot.sizeBytes),
      },
      savedVersion,
    )
    invalidateDesktopSaveLocation()
    recentFiles = recordRecentFile(recentFiles, { path: snapshot.path }, Date.now())
    watchCurrentFile()
    notice = resourceSaveWarning ?? messages.notices.savedAs
    renderSession()
    focusActiveView()
    return true
  } catch (error: unknown) {
    console.error(`Large document save-as failed while ${saveStage}`, error)
    importantNotice = true
    notice = `大文件另存为失败（${saveStage}）：${getErrorMessage(error)}`
    renderSession()
    focusActiveView()
    return false
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
  void recovery?.endDocument()
  unwatchCurrentFile()
  clearPluginDocumentPresentation()
  scheduleLargeDocumentPreviewClose()
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

  const payload = createMarkdownClipboardPayload(
    state.doc.slice(range.from, range.to),
    session.viewMode === 'live',
  )
  event.clipboardData.setData('text/plain', payload.text)
  if (payload.html) event.clipboardData.setData('text/html', payload.html)
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

async function installApplicationUpdate(): Promise<void> {
  await applicationUpdates.install()
  // Cancel/failure settles the protected prompt before the controller rebuilds its actions.
  // Restore focus after both steps, and never bring a closed About page back into focus.
  const about = appRoot.querySelector<HTMLElement>('[data-menu-panel="about"]')
  if (
    !about?.getClientRects().length ||
    closeConfirmOpen ||
    appRoot.querySelector('.plugin-ui-modal')
  )
    return
  if (!['ready', 'error'].includes(applicationUpdates.state.phase)) return
  const actions = Array.from(
    about.querySelectorAll<HTMLButtonElement>('[data-application-update-action]'),
  )
  const next =
    actions.find((button) =>
      ['install', 'download'].includes(button.dataset.applicationUpdateAction ?? ''),
    ) ?? actions.find((button) => button.getAttribute('aria-disabled') !== 'true')
  next?.focus({ preventScroll: true })
}

function renderApplicationUpdateStatus(): void {
  const target = appRoot.querySelector<HTMLElement>('[data-application-updates]')
  if (!target) return
  const focused = document.activeElement
  const previousAction =
    focused instanceof HTMLElement && target.contains(focused)
      ? focused.dataset.applicationUpdateAction
      : undefined
  const state = applicationUpdates.state
  if (applicationUpdatesMigrationError) target.textContent = applicationUpdatesMigrationError
  else target.innerHTML = renderApplicationUpdates(state)
  const check = appRoot
    .querySelector<HTMLButtonElement>('[data-app-version]')
    ?.parentElement?.querySelector<HTMLButtonElement>('[data-application-update-action="check"]')
  const checkingBlocked =
    !applicationUpdatesReady ||
    [
      'checking',
      'downloading',
      'verifying',
      'ready',
      'cancelling',
      'confirming',
      'installing',
    ].includes(state.phase) ||
    (state.phase === 'error' && state.retry === 'cancel')
  check?.setAttribute('aria-disabled', String(checkingBlocked))
  check?.setAttribute('aria-busy', String(state.phase === 'checking'))
  const hasUpdate = applicationUpdatesReady && state.hasUpdate
  const dot = appRoot.querySelector<HTMLElement>('[data-application-update-dot]')
  if (dot) dot.hidden = !hasUpdate
  appRoot
    .querySelector('[data-menu-section="about"]')
    ?.setAttribute('aria-label', hasUpdate ? '关于，有可用更新' : '关于')
  if (previousAction) {
    const replacement = Array.from(
      target.querySelectorAll<HTMLButtonElement>('[data-application-update-action]'),
    ).find((button) => button.dataset.applicationUpdateAction === previousAction)
    ;(replacement ?? check)?.focus({ preventScroll: true })
  }
}

function renderPluginManager(): void {
  const target = appRoot.querySelector<HTMLElement>('[data-plugin-manager]')

  if (!target) {
    return
  }

  renderDesktopPluginManagerElement(target, desktopPluginManager.state(), loadDesktopPluginIcon)
  for (const button of Array.from(
    target.querySelectorAll<HTMLButtonElement>('[data-plugin-action="toggle"]'),
  )) {
    if (pendingPluginToggles.has(button.dataset.pluginId ?? '')) {
      // Keep keyboard focus while the operation lock rejects further activation.
      button.setAttribute('aria-disabled', 'true')
      button.setAttribute('aria-busy', 'true')
    }
  }
}

function createDesktopPluginManifestHost(): DesktopPluginManifestHost {
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
      const bundled = readBundledPlugin(path)
      if (bundled !== undefined) return bundled
      if (!isTauriRuntime()) {
        throw new Error('Local plugin install is only available in the desktop runtime')
      }

      const { invoke } = await import('@tauri-apps/api/core')
      return invoke<string>('read_plugin_text_file', { path })
    },
    async readPackageIcon(pluginId: string): Promise<Uint8Array> {
      if (!isTauriRuntime())
        throw new Error('Installed plugin icon export requires the desktop runtime')
      const { invoke } = await import('@tauri-apps/api/core')
      return new Uint8Array(await invoke<number[]>('read_plugin_icon', { pluginId }))
    },
    async prepareModule(manifest, manifestPath, main, generation) {
      if (manifest.host === 'dom') {
        if (!generation) throw new Error('DOM module requires a native catalog generation')
        // Native validates the renderer-only profile and snapshots the exact
        // authorized generation; no host capabilities are sent to this helper.
        return prepareDesktopPluginDomModule(manifest, isTauriRuntime())
      }
      if (manifest.host && manifest.host !== 'worker')
        throw new Error('Restricted catalog activation currently supports Worker bundles only')
      let source: string
      if (isTauriRuntime()) {
        if (!generation) throw new Error('Plugin module requires a native catalog generation')
        const { invoke } = await import('@tauri-apps/api/core')
        source = await invoke<string>('plugin_catalog_read_worker_module', {
          pluginId: manifest.id,
          generation: generation.generationId,
        })
      } else {
        if (/^(?:[a-z][a-z0-9+.-]*:|[\\/])/i.test(main))
          throw new Error('Plugin Worker entry must belong to its sealed package')
        const manifestValue = JSON.parse(await this.readManifestText(manifestPath)) as unknown
        source = isPluginPackageArchive(manifestValue)
          ? readPluginPackageTextFile(parsePluginPackageArchive(manifestValue), main)
          : await this.readManifestText(resolvePluginEntryPath(manifestPath, main))
      }
      validateClosedWorkerBundle(source)
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
  }
}

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

function setSidebarCollapsed(collapsed: boolean): void {
  sidebarCollapsed = collapsed
  desktopPluginUi.setSlotVisible('sidebar-panel', !collapsed)
  appRoot.dataset.sidebarCollapsed = String(collapsed)
  const toggle = appRoot.querySelector<HTMLButtonElement>('[data-sidebar-toggle]')

  if (toggle) {
    toggle.setAttribute('aria-pressed', String(!collapsed))
    toggle.innerHTML = iconSvg(collapsed ? PanelLeft : PanelLeftClose)
  }

  updateSidebarPresentation()
  if (!collapsed && window.matchMedia('(max-width: 760px)').matches)
    appRoot.querySelector<HTMLButtonElement>('[data-sidebar-close]')?.focus()
  else focusActiveView()
}

function updateSidebarPresentation(): void {
  appRoot.querySelector<HTMLElement>('.editor-panel')!.inert =
    !sidebarCollapsed && window.matchMedia('(max-width: 760px)').matches
}

function startSidebarWidthResize(event: PointerEvent): void {
  if (event.button !== 0 || sidebarCollapsed) return
  event.preventDefault()
  const startX = event.clientX
  const startWidth = sidebarWidth
  const handleMove = (moveEvent: PointerEvent): void => {
    setSidebarWidth(startWidth + moveEvent.clientX - startX, false)
  }
  const handleUp = (): void => {
    document.removeEventListener('pointermove', handleMove)
    document.removeEventListener('pointerup', handleUp)
    document.documentElement.dataset.sidebarResizing = 'false'
    setSidebarWidth(sidebarWidth)
  }

  document.documentElement.dataset.sidebarResizing = 'true'
  document.addEventListener('pointermove', handleMove)
  document.addEventListener('pointerup', handleUp)
}

function setSidebarWidth(width: number, persist = true): void {
  const viewportMaximum = Math.max(
    minimumSidebarWidth,
    Math.min(maximumSidebarWidth, Math.floor(globalThis.innerWidth * 0.55)),
  )
  sidebarWidth = Math.round(Math.min(viewportMaximum, Math.max(minimumSidebarWidth, width)))
  appRoot.style.setProperty('--sidebar-width', `${sidebarWidth}px`)

  if (persist) {
    desktopStorage?.setItem(sidebarWidthStorageKey, String(sidebarWidth))
  }
}

function readStoredSidebarWidth(): number {
  const stored = Number(readOptionalPreference(sidebarWidthStorageKey))
  const width = Number.isFinite(stored) && stored > 0 ? stored : defaultSidebarWidth
  const viewportMaximum = Math.max(
    minimumSidebarWidth,
    Math.min(maximumSidebarWidth, Math.floor(globalThis.innerWidth * 0.55)),
  )
  return Math.round(Math.min(viewportMaximum, Math.max(minimumSidebarWidth, width)))
}

function visibleFocusTargets(root: Element): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      'button, input, textarea, select, summary, a[href], [tabindex]',
    ),
  ).filter(
    (element) =>
      element.tabIndex >= 0 &&
      !element.matches(':disabled') &&
      !element.closest('[inert]') &&
      element.getClientRects().length > 0 &&
      getComputedStyle(element).visibility !== 'hidden',
  )
}

function cycleWorkspaceFocus(backward: boolean): void {
  const regions = [
    '.titlebar',
    '[data-floating-search]',
    '.sidebar',
    '[data-editor-host]',
    '.statusbar',
  ]
    .map((selector) => appRoot.querySelector<HTMLElement>(selector))
    .filter((root): root is HTMLElement => root !== null)
    .map((root) => ({
      root,
      target: root.matches('[data-editor-host]')
        ? root.querySelector<HTMLElement>('.milkup-input-proxy')
        : visibleFocusTargets(root)[0],
    }))
    .filter(
      (region) =>
        region.target &&
        region.target.getClientRects().length > 0 &&
        !region.target.closest('[inert]'),
    )
  const index = regions.findIndex((region) => region.root.contains(document.activeElement))
  regions[(index + (backward ? -1 : 1) + regions.length) % regions.length]?.target?.focus()
}

function setMenuOpen(open: boolean): void {
  const wasOpen = menuOpen
  if (open && !wasOpen)
    menuReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  menuOpen = open
  setTransitionBackgroundInert(closeConfirmOpen)
  desktopPluginUi.reconcileDocumentToolbar()
  editorContextMenu.reconcile()
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
  } else if (wasOpen) {
    const target = menuReturnFocus
    menuReturnFocus = null
    restoreDesktopFocus(target, focusActiveView)
  }
}

function showMenuSection(section: string): void {
  for (const button of Array.from(
    appRoot.querySelectorAll<HTMLButtonElement>('[data-menu-section]'),
  )) {
    const active = button.dataset.menuSection === section
    button.dataset.active = String(active)
    button.setAttribute('aria-current', String(active))
  }

  for (const panel of Array.from(appRoot.querySelectorAll<HTMLElement>('[data-menu-panel]'))) {
    panel.hidden = panel.dataset.menuPanel !== section
  }
}

function setSearchOpen(open: boolean): void {
  if (open && !sidebarCollapsed && window.matchMedia('(max-width: 760px)').matches)
    setSidebarCollapsed(true)
  searchOpen = open
  appRoot.querySelector<HTMLElement>('[data-floating-search]')!.hidden = !open
  if (open) {
    setMenuOpen(false)
    const input = appRoot.querySelector<HTMLInputElement>('[data-search-input]')!
    input.focus()
    input.select()
    if (searchSignature !== currentSearchSignature()) scheduleDocumentSearch(false)
  } else {
    clearSearchResults()
    focusActiveView()
    view?.ensureCursorVisible()
  }
}

function currentSearchQuery(): string {
  return appRoot.querySelector<HTMLInputElement>('[data-search-input]')!.value.trim()
}

function currentSearchSignature(): string {
  return JSON.stringify([
    session.documentId,
    session.documentVersion,
    currentSearchQuery(),
    searchCaseSensitive,
  ])
}

function scheduleDocumentSearch(navigate: boolean): void {
  if (searchRefreshTimer !== undefined) clearTimeout(searchRefreshTimer)
  documentSearchRunId += 1
  documentSearchController.cancel()
  largeSearchController.cancel()
  searchSignature = currentSearchSignature()
  searchResultState = undefined
  activeSearchResultIndex = -1
  renderSearchNavigation()
  if (!searchOpen || !currentSearchQuery() || isDocumentBusy()) return
  searchRefreshTimer = setTimeout(() => {
    searchRefreshTimer = undefined
    void runDocumentSearch(currentSearchQuery(), navigate)
  }, 150)
}

async function navigateSearch(delta: -1 | 1): Promise<void> {
  if (searchSignature === currentSearchSignature() && searchResultState?.phase === 'done') {
    await moveSearchResult(delta)
  } else {
    await runDocumentSearch(currentSearchQuery(), true)
  }
}

async function runDocumentSearch(query: string, navigate = true): Promise<void> {
  if (searchRefreshTimer !== undefined) clearTimeout(searchRefreshTimer)
  searchRefreshTimer = undefined
  if (isDocumentBusy() || !searchOpen) return
  if (!query.trim()) {
    clearSearchResults()
    return
  }
  const startingView = sourceView
  const startingDocument = session.documentId
  try {
    await startingView?.flushPendingEdits()
  } catch (error) {
    if (startingDocument !== session.documentId || currentSearchQuery() !== query.trim()) return
    searchResultState = {
      phase: 'failed',
      query,
      matches: [],
      scannedLineCount: 0,
      complete: false,
      message: getErrorMessage(error),
    }
    renderSearchNavigation()
    return
  }
  if (
    !searchOpen ||
    isDocumentBusy() ||
    startingDocument !== session.documentId ||
    currentSearchQuery() !== query.trim()
  )
    return
  const searchRunId = ++documentSearchRunId
  searchSignature = currentSearchSignature()
  const signature = searchSignature
  const source = largeDocumentPreview?.source
  const current = () =>
    searchOpen && searchRunId === documentSearchRunId && signature === currentSearchSignature()
  try {
    const options = {
      query,
      caseSensitive: searchCaseSensitive,
      ...(source
        ? { source, windowSizeLines: 512, maxResults: 200 }
        : {
            state,
            documentId: session.documentId,
            version: session.documentVersion,
            windowSizeLines: currentOpenPolicy.useMemoryVirtualViewport ? 512 : 128,
            maxResults: 200,
          }),
      onUpdate: (searchState: DesktopSearchState) => {
        if (!current()) return
        searchResultState = searchState
        activeSearchResultIndex = searchState.matches.length ? 0 : -1
        if (searchRenderFrame === undefined)
          searchRenderFrame = requestAnimationFrame(() => renderSearchNavigation())
      },
    }
    const result = source
      ? await largeSearchController.run({ ...options, source })
      : await documentSearchController.run(options)
    if (!current()) return
    searchResultState = result
    activeSearchResultIndex = result.matches.length ? 0 : -1
    renderSearchNavigation()
    if (navigate) await jumpToSearchMatch(result, activeSearchResultIndex)
  } catch (error: unknown) {
    if (!current()) return
    searchResultState = {
      phase: 'failed',
      query,
      matches: [],
      scannedLineCount: 0,
      complete: false,
      message: getErrorMessage(error),
    }
    renderSearchNavigation()
  }
}

async function jumpToSearchMatch(
  searchState: DesktopSearchState | undefined,
  index: number,
): Promise<void> {
  if (searchSignature !== currentSearchSignature() || searchState !== searchResultState) return
  if (
    searchState?.nativeSearchId &&
    (index < (searchState.matchOffset ?? 0) ||
      index >= (searchState.matchOffset ?? 0) + searchState.matches.length)
  ) {
    try {
      const page = await largeSearchController.page(index)
      if (searchSignature !== currentSearchSignature() || searchState !== searchResultState) return
      searchResultState = page
      searchState = page
      renderSearchNavigation()
    } catch (error) {
      notice = getErrorMessage(error)
      renderSession()
      return
    }
  }
  const match = searchState?.matches[index - (searchState.matchOffset ?? 0)]
  if (!match) return
  const selection = Selection.range(match.from, match.to)
  if (sourceView) {
    await sourceView.revealSelection(match.line, selection)
  } else if (view) {
    state = new EditorState({
      doc: state.doc,
      selection,
      history: state.history,
      facets: state.facets,
    })
    view.updateState(state)
    view.ensureCursorVisible({ scrollPadding: 0 })
    renderSession()
  }
  // Keep the invoking search control focused. Escape returns to the selected result.
}

function replaceSearchMatches(all: boolean): void {
  const result = searchResultState
  if (!canReplaceSearch() || !result || (all && !result.complete)) return
  if (largeDocumentPreview) {
    void replaceLargeSearchMatches(all, result)
    return
  }
  const matches = all
    ? result.matches
    : result.matches.slice(activeSearchResultIndex, activeSearchResultIndex + 1)
  if (!matches.length) return
  // Recheck original source slices before building a single isolated undo transaction.
  if (matches.some((match) => state.doc.slice(match.from, match.to) !== match.text)) {
    scheduleDocumentSearch(false)
    return
  }
  const insert = appRoot.querySelector<HTMLInputElement>('[data-replace-input]')!.value
  const changes = ChangeSet.of(matches.map(({ from, to }) => ({ from, to, insert })))
  const transaction: Transaction = {
    changes,
    selection: Selection.cursor(matches[0]!.from + insert.length),
    origin: { type: 'input.type', id: 'search-replace' },
    historyGroup: 'isolate',
  }
  state = state.applyTransaction(transaction)
  session = recordDocumentTransaction(session, transaction)
  updateRenderedMemoryDocument([transaction])
  if (sourceView)
    void sourceView.revealSelection(
      state.doc.lineAt(state.selection.main.head).number,
      state.selection,
    )
  renderSession()
}

async function replaceLargeSearchMatches(all: boolean, result: DesktopSearchState): Promise<void> {
  const preview = largeDocumentPreview
  const editor = sourceView
  if (!preview || !preview.editSession || !editor || !result.nativeSearchId) return
  const editSession = preview.editSession
  const signature = currentSearchSignature()
  const operation = {
    abort: new AbortController(),
    preparing: false,
    progress: undefined as LargeReplaceProgress | undefined,
  }
  nativeReplacement = operation
  const replacementId = crypto.randomUUID()
  const insert = appRoot.querySelector<HTMLInputElement>('[data-replace-input]')!.value
  const index = all ? 0 : activeSearchResultIndex
  let committedSuccessfully = false
  try {
    renderSearchNavigation()
    await editor.flushPendingEdits()
    if (
      preview !== largeDocumentPreview ||
      signature !== currentSearchSignature() ||
      operation.abort.signal.aborted
    )
      throw new Error('文档或搜索已改变，替换已取消')
    const page =
      index >= (result.matchOffset ?? 0) &&
      index < (result.matchOffset ?? 0) + result.matches.length
        ? result
        : await largeSearchController.page(index)
    const first = page.matches[index - (page.matchOffset ?? 0)]
    if (!first || signature !== currentSearchSignature() || operation.abort.signal.aborted)
      throw new Error('替换已取消')
    const selectionBefore = editor.selection
    const selectionAfter = Selection.cursor(first.from + insert.length)
    operation.preparing = true
    renderSession()
    await recovery?.flush()
    await prepareLargeReplacement(
      largeSearchService,
      {
        documentId: preview.documentId,
        expectedVersion: preview.source.version,
        searchId: result.nativeSearchId,
        replacementId,
        insert,
        selectedIndex: all ? null : index,
      },
      operation.abort.signal,
      (progress) => {
        operation.progress = progress
        renderSearchNavigation()
      },
    )
    await editor.runAfterPendingEdits(async () => {
      if (operation.abort.signal.aborted) throw new Error('替换已取消')
      const committed = await largeSearchService.commitReplacement(replacementId)
      committedSuccessfully = true
      editSession.confirmNativeHistory(committed.historyId, committed.snapshot.version, {
        selectionBefore,
        selectionAfter,
      })
      preview.source.applyNativeSnapshot(committed.snapshot)
      session = recordNativeDocumentMutation(session)
      notice = all
        ? `已替换 ${result.matchCount ?? result.matches.length} 处，可整笔撤销。`
        : '已替换，可撤销。'
      await editor.renderVisibleWindow()
      const line = await preview.source.lineAtPosition(selectionAfter.main.head)
      await editor.revealSelection(line.number, selectionAfter)
    })
  } catch (error) {
    await largeSearchService.cancelReplacement(replacementId).catch(() => {})
    notice = committedSuccessfully
      ? `替换已提交；视图更新失败：${getErrorMessage(error)}`
      : operation.abort.signal.aborted
        ? '替换已取消，文档未修改。'
        : `替换失败：${getErrorMessage(error)}`
  } finally {
    nativeReplacement = undefined
    renderSession()
    renderSearchNavigation()
    focusActiveView()
  }
}

function canReplaceSearch(): boolean {
  return (
    searchOpen &&
    !nativeReplacement &&
    !session.readonly &&
    !isDocumentBusy() &&
    !isDocumentSaving() &&
    !closeConfirmOpen &&
    searchSignature === currentSearchSignature() &&
    searchResultState?.phase === 'done' &&
    !!searchResultState.matches.length
  )
}

function getPluginUiRenderState(): Readonly<Record<string, unknown>> {
  const editingCurrent = getDesktopEditingCurrent()
  const editor = sourceView ?? view
  const lineCount = sourceView?.source.lineCount ?? state.doc.lineCount
  const activePosition = sourceView?.selection.main.head ?? state.selection.main.head
  const activeLine = sourceView
    ? Number(sourceView.cursorLayerDOM.querySelector<HTMLElement>('[data-line]')?.dataset.line ?? 1)
    : state.doc.lineAt(activePosition).number

  if (!editor || lineCount < 1) {
    return Object.freeze({ viewport: Object.freeze({ fromLine: 1, toLine: 1, activeLine: 1 }) })
  }

  const desktopVirtualLineHeight = editor.lineHeight
  const sourceRange = sourceView?.visibleLineRange
  const fromLine =
    sourceRange?.fromLine ??
    Math.min(
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
    documentVersion: session.documentVersion,
    selectionRevision: editingCurrent?.selectionRevision ?? currentSelectionRevision,
    documentEditable: !!editingCurrent && !editingCurrent.readonly && !editingCurrent.busy,
    saveLocationGeneration: editingCurrent?.saveLocationGeneration ?? saveLocationGeneration,
    documentLineCount: lineCount,
    viewMode: session.viewMode,
    viewport: Object.freeze({
      fromLine,
      toLine: sourceRange?.toLine ?? Math.min(lineCount, fromLine + visibleLineCount - 1),
      activeLine,
    }),
  })
}

function refreshPluginUiAfterDocumentNavigation(): void {
  // Explicit document-edge navigation has completed. Its current-location UI
  // should follow now; ordinary typing and scrolling retain the idle debounce.
  cancelScheduledPluginUiViewportUpdate()
  void desktopPluginUi.updateViewport()
}

function schedulePluginUiViewportUpdate(): void {
  desktopPluginUi.reconcileDocumentToolbar()
  editorContextMenu.reconcile()
  cancelScheduledPluginUiViewportUpdate()
  pluginUiViewportTimer = setTimeout(() => {
    pluginUiViewportTimer = undefined
    if (typeof window.requestIdleCallback === 'function') {
      pluginUiViewportIdleCallback = window.requestIdleCallback(
        () => {
          pluginUiViewportIdleCallback = undefined
          void desktopPluginUi.updateViewport()
        },
        { timeout: 500 },
      )
    } else {
      pluginUiViewportTimer = setTimeout(() => {
        pluginUiViewportTimer = undefined
        void desktopPluginUi.updateViewport()
      }, 0)
    }
  }, 240)
}

function cancelScheduledPluginUiViewportUpdate(): void {
  if (pluginUiViewportTimer !== undefined) {
    clearTimeout(pluginUiViewportTimer)
    pluginUiViewportTimer = undefined
  }
  if (pluginUiViewportIdleCallback !== undefined) {
    window.cancelIdleCallback?.(pluginUiViewportIdleCallback)
    pluginUiViewportIdleCallback = undefined
  }
}

async function revealPluginLocation(
  request: PluginUiRevealLocationRequest,
  context: PluginUiOperationContext,
): Promise<void> {
  const initial = currentPresentationDocument()
  const editor = sourceView ?? view
  const assertCurrent = () => {
    context.assertActive()
    context.signal.throwIfAborted()
    const current = currentPresentationDocument()
    if (
      !initial ||
      !editor ||
      editor !== (sourceView ?? view) ||
      !current ||
      current.identity !== initial.identity ||
      current.source.documentId !== request.documentId ||
      current.source.version !== request.version ||
      !Number.isSafeInteger(request.from) ||
      request.from < 0 ||
      (request.to ?? request.from) < request.from ||
      (current.source.length !== undefined && (request.to ?? request.from) > current.source.length)
    )
      throw new Error('文档位置已失效')
  }
  assertCurrent()
  const selection = Selection.range(request.from, request.to ?? request.from)
  if (sourceView) {
    const target = sourceView
    const location = await locateDocumentPresentationTarget(target.source, request, {
      signal: context.signal,
      assertCurrent,
    })
    assertCurrent()
    await target.revealSelection(location.fromLine, selection, {
      signal: context.signal,
      assertCurrent,
    })
  } else if (view) {
    state = new EditorState({
      doc: state.doc,
      selection,
      history: state.history,
      facets: state.facets,
    })
    view.updateState(state)
    view.ensureCursorVisible({ scrollPadding: 0 })
  }
  assertCurrent()
  focusActiveView()
}

async function revealPluginLine(line: number): Promise<void> {
  if (!sidebarCollapsed && window.matchMedia('(max-width: 760px)').matches)
    setSidebarCollapsed(true)
  cancelScheduledPluginUiViewportUpdate()
  if (sourceView) {
    await sourceView.revealSelection(line)
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
  renderSession()
  await jumpToSearchMatch(searchResultState, activeSearchResultIndex)
}

function clearSearchResults(): void {
  if (searchRefreshTimer !== undefined) clearTimeout(searchRefreshTimer)
  searchRefreshTimer = undefined
  searchSignature = currentSearchSignature()
  documentSearchRunId += 1
  documentSearchController.cancel()
  largeSearchController.cancel()
  searchResultState = undefined
  activeSearchResultIndex = -1
  notice = messages.ready
  renderSearchNavigation()
  renderSession()
}

function renderSearchNavigation(): void {
  if (searchRenderFrame !== undefined) cancelAnimationFrame(searchRenderFrame)
  searchRenderFrame = undefined
  const navigation = createDesktopSearchNavigationState(searchResultState, activeSearchResultIndex)

  activeSearchResultIndex = navigation.activeIndex
  const truncated = searchResultState?.phase === 'done' && !searchResultState.complete
  setText('[data-search-result-count]', navigation.label + (truncated ? '+' : ''))
  const hint = `字面匹配 · ${searchCaseSensitive ? '区分大小写' : '忽略大小写'} · 忽略查询首尾空白`
  const status =
    searchResultState?.phase === 'failed'
      ? `搜索失败：${searchResultState.message}`
      : searchResultState?.phase === 'searching'
        ? '正在搜索…'
        : truncated
          ? '仅显示前 200 处；请缩小查询后使用全部替换'
          : searchResultState?.phase === 'done' && !navigation.canNavigate
            ? '没有匹配结果'
            : hint
  setText(
    '[data-search-message]',
    nativeReplacement
      ? `正在准备替换 ${Math.round((100 * (nativeReplacement.progress?.copiedBytes ?? 0)) / Math.max(1, nativeReplacement.progress?.totalBytes ?? 1))}% · 提交前可取消`
      : status,
  )
  appRoot.querySelector<HTMLButtonElement>('[data-replace-one]')!.disabled = !canReplaceSearch()
  appRoot.querySelector<HTMLButtonElement>('[data-replace-all]')!.disabled =
    !canReplaceSearch() || !searchResultState?.complete
  for (const selector of [
    '[data-search-input]',
    '[data-replace-input]',
    '[data-search-case]',
    '[data-search-close]',
  ]) {
    appRoot.querySelector<HTMLInputElement>(selector)!.disabled = !!nativeReplacement
  }
  appRoot.querySelector<HTMLButtonElement>('[data-replace-cancel]')!.hidden = !nativeReplacement
  const highlights = searchResultState?.matches ?? []
  const localActiveIndex = navigation.activeIndex - (searchResultState?.matchOffset ?? 0)
  view?.setSearchHighlights(highlights, localActiveIndex)
  sourceView?.setSearchHighlights(highlights, localActiveIndex)
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
    section === 'about'
      ? '<span class="application-update-dot" data-application-update-dot hidden aria-hidden="true"></span>'
      : '',
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

  if (!isTauriRuntime()) return

  void import('@tauri-apps/api/window')
    .then(async ({ getCurrentWindow }) => {
      const window = getCurrentWindow()
      if (currentPlatform === 'windows') {
        await window.setDecorations(false)
        await syncWindowMaximizedState()
      }
      await window.onCloseRequested((event) => {
        event.preventDefault()
        void documentTransitions.request('window', invokeWindowClose)
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

  if (action === 'close') {
    void documentTransitions.request('window', invokeWindowClose)
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
  if (!isTauriRuntime()) {
    setDocumentLoadingState({ phase: 'ready' })
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

function openWindowConfirm(): void {
  const wasOpen = closeConfirmOpen
  closeConfirmOpen = true
  appRoot.dataset.closeConfirmOpen = 'true'
  const overlay = appRoot.querySelector<HTMLElement>('[data-close-confirm]')
  overlay?.removeAttribute('hidden')
  setTransitionBackgroundInert(true)
  renderSession()
  if (!wasOpen)
    appRoot
      .querySelector<HTMLButtonElement>('.dialog-button[data-close-confirm-action="cancel"]')
      ?.focus()
}

function renderCloseConfirmState(): void {
  const saving = transitionPrompt?.phase === 'saving'
  const protectedRestart = transitionPrompt?.kind === 'update'
  const title = saving
    ? messages.closeConfirm.savingTitle
    : protectedRestart
      ? '确认安装已验证的应用版本'
      : messages.closeConfirm.title
  const actionLabel = {
    new: '新建文档',
    open: '打开另一份文档',
    close: '关闭文档',
    window: '退出',
    update: '安装更新并重启',
  }[transitionPrompt?.kind ?? 'window']
  const body = saving
    ? '正在保存当前文档。取消可停止后续操作，已开始的保存仍会完成。'
    : protectedRestart
      ? `安装已验证版本 ${protectedInstallGate.version ?? ''} 将关闭并重新启动 Milkup。${session.dirty ? '继续前必须保存当前文档。' : '请确认继续安装。'}`
      : `“${getSessionTitleInfo(session.file?.path).name}”有未保存的更改。${actionLabel}前是否保存？`
  setText('[data-close-confirm-action="discard"]', `不保存并${actionLabel}`)
  setText('[data-transition-error]', transitionPrompt?.error ?? '')
  appRoot
    .querySelector<HTMLElement>('[data-transition-error]')
    ?.toggleAttribute('hidden', !transitionPrompt?.error)

  setText('#close-confirm-title', title)
  setText('#close-confirm-body', body)
  setText(
    '[data-close-save-label]',
    saving
      ? messages.stateSaving
      : protectedRestart && !session.dirty
        ? actionLabel
        : `保存并${actionLabel}`,
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
    discardButton.hidden = transitionPrompt?.kind === 'update'
  }
  if (saveSpinner) {
    saveSpinner.hidden = !saving
  }
}

function closeWindowConfirm(): void {
  closeConfirmOpen = false
  appRoot.dataset.closeConfirmOpen = 'false'
  appRoot.querySelector<HTMLElement>('[data-close-confirm]')?.setAttribute('hidden', '')
  setTransitionBackgroundInert(false)
  renderSession()
  focusActiveView()
}

function setTransitionBackgroundInert(inert: boolean): void {
  for (const child of Array.from(appRoot.querySelector('.desktop-shell')!.children)) {
    if (child instanceof HTMLElement && !child.matches('[data-close-confirm]'))
      child.inert =
        inert || (menuOpen && !child.matches('[data-app-menu], [data-plugin-slot="modal"]'))
  }
}

async function invokeWindowClose(): Promise<void> {
  closeWindowConfirm()
  const preview = largeDocumentPreview
  setDocumentLoadingState({
    phase: 'closing',
    ...(preview === undefined ? {} : { path: preview.path, sizeBytes: preview.sizeBytes }),
  })

  try {
    await closeLargeDocumentPreview()
  } catch (error: unknown) {
    setDocumentLoadingState({ phase: 'ready' })
    notice = `退出前清理大文件临时文件失败：${getErrorMessage(error)}`
    renderSession()
    return
  }

  await recovery?.endDocument()

  if (!isTauriRuntime()) {
    setDocumentLoadingState({ phase: 'ready' })
    return
  }

  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    await desktopPluginManager.disposeTemporaryStorage()
    await getCurrentWindow().destroy()
  } catch (error: unknown) {
    setDocumentLoadingState({ phase: 'ready' })
    notice = `窗口操作失败：${getErrorMessage(error)}`
    renderSession()
  }
}

function getDesktopShortcutAction(event: KeyboardEvent): { readonly id: string } | undefined {
  const target = event.target
  const inputFocus =
    target instanceof HTMLElement &&
    !target.closest('.milkup-input-proxy') &&
    (target.matches('input,textarea,select') || target.isContentEditable)
  return desktopKeymap.match(event, {
    platform: platform === 'other' ? 'linux' : platform,
    editorFocus: editorRoot.contains(document.activeElement),
    documentOpen: true,
    sourceMode: session.viewMode === 'source',
    liveMode: session.viewMode === 'live',
    inputFocus,
    searchFocus: target instanceof HTMLElement && Boolean(target.closest('[data-floating-search]')),
  })
}

function renderSession(): void {
  if (resourceDocumentId !== session.documentId) {
    const previous = resourceDocumentId
    resourceDocumentId = session.documentId
    void resourceService.releaseDocument(previous).catch((error) => {
      console.error('Previous document resource cleanup failed', error)
    })
  }
  recovery?.observe()
  if (searchOpen && !isDocumentBusy() && searchSignature !== currentSearchSignature())
    scheduleDocumentSearch(false)
  const navigationSignature = JSON.stringify([
    session.documentId,
    session.documentVersion,
    sourceView?.selection.main.head ?? state.selection.main.head,
    session.viewMode,
  ])
  if (lastNavigationSignature !== navigationSignature) {
    lastNavigationSignature = navigationSignature
    schedulePluginUiViewportUpdate()
  }
  editorContextMenu.reconcile()
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
    ?.toggleAttribute(
      'hidden',
      (!showDeveloperStatusNotice && !importantNotice) || notice.length === 0,
    )

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
  view?.setEditable(
    !session.readonly && !isDocumentBusy() && !isDocumentInputLocked() && !closeConfirmOpen,
  )
  sourceView?.setEditable(
    !session.readonly &&
      !isDocumentBusy() &&
      !isDocumentInputLocked() &&
      !closeConfirmOpen &&
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
  loadingVisibility.update(nextState)
  renderSession()
}

let startupWindowShowPromise: Promise<void> | undefined

function showStartupWindow(): Promise<void> {
  if (startupWindowShowPromise) {
    return startupWindowShowPromise
  }

  if (!('isTauri' in globalThis)) {
    return Promise.resolve()
  }

  markStartupStage('window-show-requested')
  startupWindowShowPromise = import('@tauri-apps/api/window')
    .then(async ({ getCurrentWindow }) => {
      await getCurrentWindow().show()
      markStartupStage('window-shown')
      focusActiveView()
    })
    .catch((error: unknown) => {
      startupWindowShowPromise = undefined
      console.error('Failed to show the startup window', error)
    })

  return startupWindowShowPromise
}

function renderDocumentLoadingState(): void {
  const loading = appRoot.querySelector<HTMLElement>('[data-document-loading]')
  const dismiss = appRoot.querySelector<HTMLButtonElement>('[data-loading-dismiss]')

  if (!loading) {
    return
  }

  const wasFailed = loading.dataset.failed === 'true'
  loading.dataset.failed = String(loadingState.phase === 'failed')
  editorHost?.setAttribute('aria-busy', String(isDocumentBusy()))
  const visible = loadingVisibility.visible
  loading.hidden = !visible
  if (dismiss) {
    dismiss.hidden = loadingState.phase !== 'failed'
    if (visible && !wasFailed && !dismiss.hidden && !closeConfirmOpen && !menuOpen) dismiss.focus()
  }
  setText('[data-loading-title]', getDocumentLoadingLabel(loadingState))
  setText(
    '[data-loading-phase]',
    loadingState.phase === 'failed'
      ? '未替换当前文档'
      : loadingState.phase === 'closing'
        ? '正在清理临时文件'
        : '请稍候',
  )
  setText('[data-loading-detail]', getDocumentLoadingDetail(loadingState))
}

function isDocumentBusy(): boolean {
  return (
    controlledEditingCommit ||
    restoringResourceCopy ||
    applicationUpdateInstalling ||
    recoveryDialogOpen ||
    nativeReplacement?.preparing === true ||
    loadingState.phase === 'opening' ||
    loadingState.phase === 'indexing' ||
    loadingState.phase === 'closing'
  )
}

function isBusyAllowedAction(id: string): boolean {
  return false
}

function isDeveloperDiagnosticsEnabled(): boolean {
  return readOptionalPreference('milkup.desktop.openDiagnostics') === 'true'
}

function getSessionTitleInfo(path: string | undefined): {
  readonly name: string
  readonly directory: string
} {
  if (!path) {
    return { name: messages.titleUntitled, directory: messages.pathUnsaved }
  }

  const normalizedPath = formatDisplayPath(path)
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
  const preview = largeDocumentPreview
  const documentId = preview?.documentId

  if (!documentId) {
    return
  }

  await largeTextFileService.close(documentId)
  if (largeDocumentPreview === preview) {
    largeDocumentPreview = undefined
  }
}

function scheduleLargeDocumentPreviewClose(): void {
  void closeLargeDocumentPreview().catch((error: unknown) => {
    notice = `清理大文件临时文件失败：${getErrorMessage(error)}`
    renderSession()
  })
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

function markStartupStage(stage: string): void {
  const name = `milkup:startup:${stage}`
  performance.mark(name)

  if (isDeveloperDiagnosticsEnabled()) {
    console.debug(`[milkup:startup] ${stage} ${Math.round(performance.now() * 10) / 10}ms`)
  }
}

function getStartupDiagnostics(): readonly {
  readonly stage: string
  readonly startTimeMs: number
}[] {
  return Object.freeze(
    performance
      .getEntriesByType('mark')
      .filter((entry) => entry.name.startsWith('milkup:startup:'))
      .map((entry) =>
        Object.freeze({
          stage: entry.name.slice('milkup:startup:'.length),
          startTimeMs: Math.round(entry.startTime * 10) / 10,
        }),
      ),
  )
}

async function waitForNextPaint(): Promise<void> {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve())
    })
  })
}

async function runDesktopWorkerFilePluginFixture(path: string): Promise<unknown> {
  const manifest = createDesktopWorkerFilePluginManifest()
  const fileBroker = createDesktopPluginFileBroker({
    manifest,
    roots: [{ id: 'fixture', path: getDirectoryPath(path) }],
  })
  let workerHost: BrowserWorkerPluginHost | undefined

  try {
    const worker = createDesktopPluginWorker('desktop-file-fixture', false)
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
        disposeIsolation: () => workerHost!.dispose(),
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
    await workerHost?.dispose()
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
    getStartupDiagnostics,
    runDesktopWorkerFilePluginFixture,
    runDesktopSidecarPluginFixture,
    runDesktopLargeTextFileBenchmark,
    runDesktopEditorInteractionBenchmark,
  }),
})

globalThis.addEventListener('beforeunload', (event) => {
  if (session.dirty || session.externalChangeState === 'conflict' || isDocumentSaving()) {
    event.preventDefault()
    event.returnValue = ''
  }
})

globalThis.addEventListener('unload', () => {
  applicationUpdates.dispose()
  loadingVisibility.dispose()
  editorContextMenu.dispose()
  hostContextActions.dispose()
  hostContextEditing.dispose()
  void desktopPluginUi.dispose()
  disposeFileWatchEvents?.()
  scheduleLargeDocumentPreviewClose()
})
