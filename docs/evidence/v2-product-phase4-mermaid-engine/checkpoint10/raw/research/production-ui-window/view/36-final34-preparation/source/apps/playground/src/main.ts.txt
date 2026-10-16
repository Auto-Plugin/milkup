import { ActionRegistry, EditorState, MemoryTextDocument } from '@milkup/core'
import type { Command, Editor, Transaction } from '@milkup/core'
import {
  createBrowserWorkerPluginHost,
  createIsolatedPluginModule,
  createPluginFileBroker,
  createPluginNetworkBroker,
  PluginRuntime,
} from '@milkup/plugin'
import type { BrowserWorkerPluginHost, PluginManifest } from '@milkup/plugin'
import { EditorView } from '@milkup/view-dom'
import type { ViewMode } from '@milkup/view-dom'

import './style.css'

const initialText = [
  '# milkup v2',
  '',
  '这是由 @milkup/view-dom 驱动的浏览器演示页。',
  '',
  '- Markdown 源文档是唯一事实来源。',
  '- 点击一行后即可输入，底层仍通过隐藏 textarea 分发编辑事务。',
  '- Enter、Delete、Backspace、方向键和 IME 组合输入都会进入同一套事务路径。',
  '',
].join('\n')

const app = document.querySelector<HTMLDivElement>('#app')

if (!app) {
  throw new Error('Playground root element was not found')
}

app.innerHTML = `
  <section class="shell">
    <header class="toolbar">
      <div>
        <p class="eyebrow">milkup playground</p>
        <h1>可编辑 DOM 视图演示</h1>
      </div>
      <div class="toolbar-actions">
        <div class="mode-switch" role="group" aria-label="编辑器模式">
          <button type="button" data-mode-button="source">源码</button>
          <button type="button" data-mode-button="live">实时</button>
        </div>
        <button type="button" data-worker-plugin-button disabled>插件</button>
        <button type="button" data-worker-file-button disabled>文件</button>
        <button type="button" data-worker-network-button disabled>拉取</button>
        <dl class="stats" aria-label="文档状态">
          <div>
            <dt>长度</dt>
            <dd data-stat="length">0</dd>
          </div>
          <div>
            <dt>行数</dt>
            <dd data-stat="lines">0</dd>
          </div>
          <div>
            <dt>光标</dt>
            <dd data-stat="cursor">0</dd>
          </div>
          <div>
            <dt>撤销</dt>
            <dd data-stat="can-undo">false</dd>
          </div>
          <div>
            <dt>插件</dt>
            <dd data-stat="worker-plugin">loading</dd>
          </div>
        </dl>
      </div>
    </header>
    <div class="editor-host" data-editor-host></div>
  </section>
`

const editorHost = app.querySelector<HTMLElement>('[data-editor-host]')

if (!editorHost) {
  throw new Error('Playground editor host was not found')
}

let state = new EditorState({
  doc: new MemoryTextDocument(initialText),
})

let view: EditorView | undefined

const dispatchTransaction = (transaction: Transaction): void => {
  if (!view) {
    throw new Error('Playground editor view was not initialized')
  }

  state = state.applyTransaction(transaction)
  view.updateState(state, [transaction])
  updateStats()
}

const editor: Editor = {
  get state() {
    return state
  },
  dispatch: dispatchTransaction,
  command: (command: Command) => command.run(editor),
  undo: () => {
    if (!state.history.canUndo || !view) {
      return false
    }

    state = state.undo()
    view.updateState(state)
    updateStats()
    return true
  },
  redo: () => {
    if (!state.history.canRedo || !view) {
      return false
    }

    state = state.redo()
    view.updateState(state)
    updateStats()
    return true
  },
}

const updateStats = (): void => {
  const length = app.querySelector<HTMLElement>('[data-stat="length"]')
  const lines = app.querySelector<HTMLElement>('[data-stat="lines"]')
  const cursor = app.querySelector<HTMLElement>('[data-stat="cursor"]')
  const canUndo = app.querySelector<HTMLElement>('[data-stat="can-undo"]')

  if (length) {
    length.textContent = String(state.doc.length)
  }

  if (lines) {
    lines.textContent = String(state.doc.lineCount)
  }

  if (cursor) {
    cursor.textContent = String(state.selection.main.head)
  }

  if (canUndo) {
    canUndo.textContent = String(state.history.canUndo)
  }
}

const updateModeButtons = (mode: ViewMode): void => {
  for (const button of Array.from(app.querySelectorAll<HTMLButtonElement>('[data-mode-button]'))) {
    const active = button.dataset.modeButton === mode
    button.dataset.active = String(active)
    button.setAttribute('aria-pressed', String(active))
  }
}

view = new EditorView({
  parent: editorHost,
  state,
  dispatch: dispatchTransaction,
})

updateStats()
updateModeButtons(view.viewMode)
view.inputDOM.focus({ preventScroll: true })

for (const button of Array.from(app.querySelectorAll<HTMLButtonElement>('[data-mode-button]'))) {
  button.addEventListener('click', () => {
    const mode = button.dataset.modeButton

    if (mode === 'source' || mode === 'live') {
      view.setMode(mode)
      updateModeButtons(mode)
      view.inputDOM.focus({ preventScroll: true })
    }
  })
}

const workerPluginStatus = app.querySelector<HTMLElement>('[data-stat="worker-plugin"]')
const workerPluginButton = app.querySelector<HTMLButtonElement>('[data-worker-plugin-button]')
const workerFileButton = app.querySelector<HTMLButtonElement>('[data-worker-file-button]')
const workerNetworkButton = app.querySelector<HTMLButtonElement>('[data-worker-network-button]')

void initializeWorkerPlugin()

async function initializeWorkerPlugin(): Promise<void> {
  if (!workerPluginButton || !workerFileButton || !workerNetworkButton) {
    return
  }

  const actionRegistry = new ActionRegistry()
  const manifest = createWorkerPluginManifest()
  const fileBroker = createPluginFileBroker({
    manifest,
    roots: [{ id: 'playground', path: '/playground' }],
    adapter: createPlaygroundFileAdapter({
      '/playground/worker-file.md': ' worker-file',
    }),
  })
  const networkBroker = createPluginNetworkBroker({
    manifest,
    allowedOrigins: ['https://playground.local'],
    adapter: {
      fetch: (_url: string, _init?: unknown) => ({
        text: ' worker-network',
      }),
    },
  })
  const runtime = new PluginRuntime({
    actionRegistry,
    allowedPermissions: ['document:write', 'file:read', 'network:access'],
    fileBroker,
    networkBroker,
  })
  let workerHost: BrowserWorkerPluginHost | undefined

  try {
    const worker = new Worker(new URL('./plugin-worker.ts', import.meta.url), {
      type: 'module',
      name: 'milkup-plugin-worker-demo',
    })

    workerHost = createBrowserWorkerPluginHost({
      worker,
      manifest,
      moduleSpecifier: 'milkup://playground/worker-demo-plugin',
      fileBroker,
      networkBroker,
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

    setWorkerPluginStatus('ready')
    workerPluginButton.disabled = false
    workerFileButton.disabled = false
    workerNetworkButton.disabled = false
    workerPluginButton.addEventListener('click', () => {
      void actionRegistry
        .run(
          'workerDemo.insert',
          {
            editor,
            permissions: ['document:write'],
          },
          { text: ' worker-plugin' },
        )
        .then((result) => {
          setWorkerPluginStatus(readPluginRunStatus(result))
        })
        .catch((error: unknown) => {
          setWorkerPluginStatus(error instanceof Error ? error.message : String(error))
        })
    })
    workerFileButton.addEventListener('click', () => {
      void actionRegistry
        .run(
          'workerDemo.readFile',
          {
            editor,
            permissions: ['document:write', 'file:read'],
          },
          { path: '/playground/worker-file.md' },
        )
        .then((result) => {
          setWorkerPluginStatus(readPluginRunStatus(result, 'filed'))
        })
        .catch((error: unknown) => {
          setWorkerPluginStatus(error instanceof Error ? error.message : String(error))
        })
    })
    workerNetworkButton.addEventListener('click', () => {
      void actionRegistry
        .run(
          'workerDemo.fetch',
          {
            editor,
            permissions: ['document:write', 'network:access'],
          },
          { url: 'https://playground.local/worker-network' },
        )
        .then((result) => {
          setWorkerPluginStatus(readPluginRunStatus(result, 'fetched'))
        })
        .catch((error: unknown) => {
          setWorkerPluginStatus(error instanceof Error ? error.message : String(error))
        })
    })
    window.addEventListener('beforeunload', () => workerHost?.dispose(), { once: true })
  } catch (error) {
    workerHost?.dispose()
    workerPluginButton.disabled = true
    workerFileButton.disabled = true
    workerNetworkButton.disabled = true
    setWorkerPluginStatus(error instanceof Error ? error.message : String(error))
  }
}

function createWorkerPluginManifest(): PluginManifest {
  return {
    id: 'worker-demo',
    name: 'Worker Demo',
    version: '1.0.0',
    permissions: ['document:write', 'file:read', 'network:access'],
    contributes: {
      commands: [
        {
          id: 'workerDemo.insert',
          title: 'Insert Worker Text',
          action: 'workerDemo.insert',
          permissions: ['document:write'],
        },
        {
          id: 'workerDemo.readFile',
          title: 'Read Worker File',
          action: 'workerDemo.readFile',
          permissions: ['document:write', 'file:read'],
        },
        {
          id: 'workerDemo.fetch',
          title: 'Fetch Worker Text',
          action: 'workerDemo.fetch',
          permissions: ['document:write', 'network:access'],
        },
      ],
    },
  }
}

function createPlaygroundFileAdapter(files: Readonly<Record<string, string>>) {
  const store = new Map(Object.entries(files))

  return {
    resolvePath: (path: string) => path.replaceAll('\\', '/').replace(/\/+/g, '/'),
    readText: (path: string) => store.get(path) ?? '',
    writeText: (path: string, text: string) => {
      store.set(path, text)
    },
    deleteFile: (path: string) => {
      store.delete(path)
    },
  }
}

function setWorkerPluginStatus(status: string): void {
  if (workerPluginStatus) {
    workerPluginStatus.textContent = status
  }
}

function readPluginRunStatus(result: unknown, successStatus = 'ran'): string {
  if (typeof result === 'object' && result !== null && 'ok' in result && result.ok === true) {
    return successStatus
  }

  return 'failed'
}
