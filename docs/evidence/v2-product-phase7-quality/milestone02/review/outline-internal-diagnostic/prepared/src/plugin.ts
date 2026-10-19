import { Diagnostics, diagnosticStore, diagnosticScanner } from './diagnostics'
import { definePlugin } from '@milkup/plugin-sdk'
import type {
  SdkDocumentScanner,
  SdkPluginActivationContext,
  SdkPluginRendererContext,
  SdkRendererOutput,
  SdkTemporaryStore,
} from '@milkup/plugin-sdk'

import { OutlineIndex, type Heading, type HeadingMetadata } from './outline-index'

const scanLines = 4096
const maximumRows = 500
const defaultRows = 160
const rowHeight = 28

type Status = 'starting' | 'scanning' | 'complete' | 'cancelled' | 'invalidated' | 'failed'
interface Session {
  diagnostics: Diagnostics
  documentId: string
  version: number
  generation: number
  alive: boolean
  status: Status
  store?: SdkTemporaryStore
  storeReady?: Promise<SdkTemporaryStore>
  startTimer?: ReturnType<typeof setTimeout>
  records?: OutlineIndex
  scanner?: SdkDocumentScanner
  queue: Promise<unknown>
  scannedLines: number
  totalLines: number
  activeLine: number
  activeOrdinal: number
  activeVisible: number
  followActive: boolean
  preparedFollow: boolean
  fromIndex: number
  rowCount: number
  rows: Heading[]
  rowsDirty: boolean
  rowStart: number
  rowEnd: number
  returnedStart: number
  returnedEnd: number
  revision: number
  renderRequest: number
  refreshTimer?: ReturnType<typeof setTimeout>
  rebuilding: boolean
  error: string
}

let host: SdkPluginActivationContext['host'] | undefined
let session: Session | undefined
let generation = 0
let cleanupQueue: Promise<void> = Promise.resolve()

const plugin = definePlugin({
  activate(context: SdkPluginActivationContext) {
    host = context.host
    return {
      dispose: () => {
        host = undefined
        return stopSession()
      },
    }
  },
  deactivate() {
    host = undefined
    return stopSession()
  },
  commands: {
    'outline.diagnosticSnapshot': async () => {
      const current = session
      if (!current) throw new Error('No diagnostic outline session')
      // Invoke only after measurement. Capture excludes this dump's own UI work.
      await current.queue
      assertCurrent(current)
      const snapshot = current.diagnostics.capture(current.status, current.records?.size ?? 0, current.scannedLines)
      await host?.ui?.requestUpdate('outline-panel')
      return snapshot
    },
    'outline.gotoHeading': async (_context: unknown, input: unknown) => {
      const current = requireSession(input)
      await enqueue(current, async () => {
        const item = await requireHeading(current, input)
        if (!host?.ui) throw new Error('大纲导航暂时不可用')
        const foldedAncestors: number[] = []
        for (const ordinal of item.ancestors) {
          if ((await current.records!.get(ordinal))!.collapsed) foldedAncestors.push(ordinal)
        }
        if (foldedAncestors.length)
          await changeFold(current, async () => {
            for (const ordinal of foldedAncestors)
              await current.records!.setCollapsed(ordinal, false)
          })
        await host.ui.revealLine(item.line)
        assertCurrent(current)
        current.activeLine = item.line
        current.followActive = true
        scheduleRefresh(current)
      })
    },
    'outline.toggleHeading': async (_context: unknown, input: unknown) => {
      const current = requireSession(input)
      await enqueue(current, async () => {
        const item = await requireHeading(current, input)
        if (!item.hasChildren) return
        await changeFold(current, () =>
          current.records!.setCollapsed(item.ordinal, !item.collapsed),
        )
      })
    },
    'outline.collapseAll': async () => {
      const current = session
      if (!current?.records) return
      await enqueue(current, () =>
        changeFold(current, async () => current.records!.resetCollapsed(true), false),
      )
    },
    'outline.expandAll': async () => {
      const current = session
      if (!current?.records) return
      await enqueue(current, () =>
        changeFold(current, async () => current.records!.resetCollapsed(false), false),
      )
    },
    'outline.cancel': async () => {
      const current = session
      if (!current || (current.status !== 'starting' && current.status !== 'scanning')) return
      current.status = 'cancelled'
      await current.scanner?.cancel().catch(() => undefined)
      try {
        await enqueue(current, async () => {
          await current.records?.flush()
        })
      } catch (error) {
        if (isCurrent(current)) {
          current.status = 'failed'
          current.error = error instanceof Error ? error.message : '临时索引写入失败'
        }
      }
      scheduleRefresh(current)
    },
    'outline.retry': async () => {
      const current = session
      if (current)
        beginSession(current.documentId, current.version, current.activeLine, current.totalLines)
    },
  },
  renderers: { 'outline-panel': (context: SdkPluginRendererContext) => renderPanel(context) },
})
export default plugin

function renderPanel(context: SdkPluginRendererContext): SdkRendererOutput {
  const node = context.node
  if (node?.phase === 'dispose') {
    void stopSession()
    return ''
  }
  const documentId = node?.documentId ?? session?.documentId ?? ''
  const sameDocument = documentId === session?.documentId
  const version = node?.documentVersion ?? (sameDocument ? (session?.version ?? 0) : 0)
  const activeLine =
    positiveInteger(node?.viewport?.activeLine) ?? (sameDocument ? (session?.activeLine ?? 1) : 1)
  if (!session || session.documentId !== documentId || session.version !== version) {
    beginSession(documentId, version, activeLine, positiveInteger(node?.documentLineCount) ?? 1)
  }
  const current = session!
  if (activeLine !== current.activeLine) {
    current.activeLine = activeLine
    current.followActive = true
    scheduleRefresh(current)
  }
  const viewport = node?.virtualViewport
  if (
    viewport?.id === 'outline' &&
    viewport.userInitiated === true &&
    // The host echoes the rendered slice after mounting. It is not a new scroll request.
    (viewport.fromIndex !== current.returnedStart || viewport.toIndex !== current.returnedEnd) &&
    Number.isInteger(viewport.fromIndex) &&
    Number.isInteger(viewport.toIndex)
  ) {
    const from = Math.max(0, viewport.fromIndex)
    const count = Math.min(maximumRows, Math.max(1, viewport.toIndex - from))
    if (from !== current.fromIndex || count !== current.rowCount) {
      current.fromIndex = from
      current.rowCount = count
      if (viewport.userInitiated) {
        current.followActive = false
        // The synchronous response still contains the previous slice. It must
        // not replay that slice's active-heading scroll while new pages load.
        current.preparedFollow = false
      }
      scheduleRefresh(current)
    }
  }
  const output = panel(current)
  // Async preparation can already have advanced rowStart/rowEnd while the host
  // still echoes our previous response. Compare against what was actually returned.
  current.returnedStart = current.rowStart
  current.returnedEnd = current.rowEnd
  return output
}

function beginSession(
  documentId: string,
  version: number,
  activeLine: number,
  totalLines: number,
): void {
  const cleaned = stopSession()
  const current: Session = {
    documentId,
    version,
    generation: ++generation,
    diagnostics: new Diagnostics(generation, version),
    alive: true,
    status: 'starting',
    queue: Promise.resolve(),
    scannedLines: 0,
    totalLines,
    activeLine,
    activeOrdinal: -1,
    activeVisible: -1,
    followActive: true,
    preparedFollow: false,
    fromIndex: 0,
    rowCount: defaultRows,
    rows: [],
    rowsDirty: true,
    rowStart: 0,
    rowEnd: 0,
    returnedStart: 0,
    returnedEnd: 0,
    revision: 0,
    renderRequest: 0,
    rebuilding: false,
    error: '',
  }
  session = current
  current.startTimer = setTimeout(() => {
    delete current.startTimer
    void cleaned.then(() => {
      if (isCurrent(current) && current.status !== 'cancelled') return buildIndex(current)
    })
  }, 120)
}

function stopSession(): Promise<void> {
  const current = session
  session = undefined
  if (!current) return cleanupQueue
  current.alive = false
  if (current.startTimer !== undefined) clearTimeout(current.startTimer)
  if (current.refreshTimer !== undefined) clearTimeout(current.refreshTimer)
  const clean = async () => {
    await current.scanner?.cancel().catch(() => undefined)
    const store = await current.storeReady?.catch(() => undefined)
    await current.queue.catch(() => undefined)
    await store?.dispose().catch(() => undefined)
  }
  cleanupQueue = cleanupQueue.then(clean, clean)
  return cleanupQueue
}

async function buildIndex(current: Session): Promise<void> {
  try {
    if (!host?.storage?.createTemporaryStore || !host.document)
      throw new Error('宿主不支持大纲所需的临时索引存储')
    const document = host.document
    current.storeReady = host.storage.createTemporaryStore()
    const store = await current.storeReady
    if (!isCurrent(current)) return
    current.store = store
    current.records = new OutlineIndex(diagnosticStore(store, current.diagnostics), current.version, current.diagnostics)
    if (current.status === 'cancelled') {
      scheduleRefresh(current)
      return
    }
    current.status = 'scanning'
    let fromLine = 1
    while (isCurrent(current) && current.status === 'scanning') {
      const toLine = fromLine + scanLines - 1
      current.diagnostics.add('scan.ranges')
      const scanner = document.scan({
        query: { kind: 'markdownHeadings' },
        fromLine,
        toLine,
        windowSizeLines: 512,
        batchSize: 128,
        maxResults: scanLines + 1,
      })
      current.scanner = scanner
      let done = false
      for await (const event of diagnosticScanner(scanner, current.diagnostics)) {
        if (!isCurrent(current) || current.status !== 'scanning') return
        current.totalLines = event.totalLineCount
        if (event.type === 'batch') {
          await enqueue(current, async () => {
            for (const item of event.items) {
              assertCurrent(current)
              if (item.kind === 'heading') {
                const changedParent = await current.records!.append(item)
                if (
                  changedParent !== undefined &&
                  current.rows.some((row) => row.ordinal === changedParent)
                )
                  current.rowsDirty = true
              }
            }
          }, 'append')
        }
        current.scannedLines = Math.min(
          current.totalLines,
          Math.max(current.scannedLines, fromLine + event.scannedLineCount - 1),
        )
        scheduleRefresh(current)
        if (event.type === 'done') {
          done = true
          delete current.scanner
          if (event.reason === 'invalidated') {
            current.status = 'invalidated'
            scheduleRefresh(current)
            return
          }
          if (event.reason === 'cancelled') {
            current.status = 'cancelled'
            scheduleRefresh(current)
            return
          }
          if (event.reason === 'truncated')
            throw new Error('标题扫描达到宿主限制，全文索引尚未完成')
          if (event.scannedLineCount <= 0 && fromLine <= event.totalLineCount)
            throw new Error('扫描未取得进展，全文索引尚未完成')
          break
        }
      }
      if (!isCurrent(current) || current.status !== 'scanning') return
      if (!done) throw new Error('扫描被中断，全文索引尚未完成')
      if (current.scannedLines >= current.totalLines) {
        await enqueue(current, async () => {
          await current.records!.finish()
          if (current.status === 'scanning') current.status = 'complete'
          current.followActive = true
        }, 'finish')
        scheduleRefresh(current)
        return
      }
      await enqueue(current, () => current.records!.flush(), 'rangeFlush')
      fromLine = current.scannedLines + 1
      await yieldTask()
    }
  } catch (error) {
    if (!isCurrent(current) || current.status === 'cancelled') return
    current.status = 'failed'
    current.error = error instanceof Error ? error.message : '临时索引写入失败'
    await current.scanner?.cancel().catch(() => undefined)
    delete current.scanner
    scheduleRefresh(current)
  }
}

async function changeFold(
  current: Session,
  action: () => Promise<void>,
  persist = true,
): Promise<void> {
  assertCurrent(current)
  current.rebuilding = true
  current.rowsDirty = true
  try {
    await action()
    if (persist) await current.records!.flush()
    current.revision++
    current.followActive = true
  } catch (error) {
    if (isCurrent(current)) {
      current.status = 'failed'
      current.error = `折叠视图更新失败：${error instanceof Error ? error.message : '临时索引不可用'}`
    }
    throw error
  } finally {
    current.rebuilding = false
    scheduleRefresh(current)
  }
}

function scheduleRefresh(current: Session): void {
  if (!isCurrent(current)) return
  current.renderRequest++
  if (current.refreshTimer !== undefined) return
  current.refreshTimer = setTimeout(() => {
    delete current.refreshTimer
    const request = current.renderRequest
    void enqueue(current, async () => {
      if (request !== current.renderRequest) return
      await prepareRows(current, request)
      if (request !== current.renderRequest) return
      await updatePanel(current)
    }, 'refresh').catch((error) => {
      if (!isCurrent(current)) return
      current.status = 'failed'
      current.error = error instanceof Error ? error.message : '大纲读取失败'
      void updatePanel(current)
    })
  }, 0)
}

async function prepareRows(current: Session, request: number): Promise<void> {
  const diagnosticEnd = current.diagnostics.start('prepareRows')
  try {
  const records = current.records
  if (!records) return
  const { activeLine, followActive, rowCount, fromIndex } = current
  const activeOrdinal =
    current.status !== 'complete' && activeLine > current.scannedLines
      ? -1
      : await records.atLine(activeLine)
  const active = await records.get(activeOrdinal)
  let activeVisible = active ? await records.rank(active.ordinal) : -1
  if (active && activeVisible < 0) {
    for (const ordinal of active.ancestors) {
      const ancestor = (await records.get(ordinal))!
      const rank = await records.rank(ordinal)
      if (rank >= 0 && ancestor.collapsed) {
        activeVisible = rank
        break
      }
    }
  }
  const count = Math.min(maximumRows, rowCount)
  let start = Math.min(fromIndex, Math.max(0, records.visibleSize - count))
  if (followActive && activeVisible >= 0) start = Math.max(0, activeVisible - Math.floor(count / 2))
  const end = Math.min(records.visibleSize, start + count)
  const rows =
    current.rowsDirty || start !== current.rowStart || end !== current.rowEnd
      ? await records.rows(start, end)
      : current.rows
  // A user can request another range while storage is awaited. Commit only the
  // newest request; the cache work is reusable, but its viewport is obsolete.
  if (!isCurrent(current) || request !== current.renderRequest) return
  current.activeOrdinal = activeOrdinal
  current.activeVisible = activeVisible
  current.rows = rows
  current.rowsDirty = false
  current.preparedFollow = followActive
  current.followActive = false
  current.rowStart = start
  current.rowEnd = end
  current.fromIndex = start
  current.revision++
  } finally { diagnosticEnd() }
}

function panel(current: Session): SdkRendererOutput {
  const count = current.records?.size ?? 0
  const state = current.status
  const progress =
    state === 'complete'
      ? `全文索引完成 · ${count} 个标题 · ${current.totalLines} 行`
      : `全文索引尚未完成 · 已扫描 ${current.scannedLines} / ${current.totalLines} 行 · ${count} 个标题`
  const children: SdkRendererOutput[] = [span([progress], 'plugin-list-summary')]
  const controls: SdkRendererOutput[] = []
  if (state === 'starting' || state === 'scanning')
    controls.push(commandButton('取消扫描', 'outline.cancel'))
  else if (state !== 'complete') controls.push(commandButton('重试全文扫描', 'outline.retry'))
  if (controls.length) children.push(span(controls, 'plugin-tree-toolbar'))
  if (count)
    children.push(
      span(
        [
          commandButton('全部展开', 'outline.expandAll'),
          commandButton('全部折叠', 'outline.collapseAll'),
        ],
        'plugin-tree-toolbar',
      ),
    )
  if (current.rebuilding) children.push(span(['正在更新折叠视图'], 'plugin-list-summary'))
  if (state === 'failed')
    children.push(span([`大纲加载失败：${current.error}`], 'plugin-ui-state plugin-ui-state-error'))
  if (state === 'cancelled')
    children.push(span(['扫描已取消；当前显示已索引部分，可重试。'], 'plugin-list-summary'))
  if (state === 'invalidated')
    children.push(span(['文档已变化；旧索引不可导航，请重试。'], 'plugin-list-summary'))
  if (!count && state === 'complete')
    children.push(
      span(
        ['文档无标题。添加 H1–H6 或 Setext 标题后将在此显示。'],
        'plugin-ui-state plugin-ui-state-empty',
      ),
    )
  children.push(
    span(
      current.rows.map((item) => treeRow(current, item)),
      'plugin-virtual-list',
      {
        role: 'tree',
        'aria-label': '文档大纲',
        'data-virtual-list': 'outline',
        'data-virtual-total': String(current.records?.visibleSize ?? 0),
        'data-virtual-start': String(current.rowStart),
        'data-virtual-end': String(current.rowEnd),
        'data-virtual-item-height': String(rowHeight),
        'data-virtual-active': String(current.activeVisible),
        'data-virtual-follow-active': String(current.preparedFollow),
        'data-virtual-has-before': 'false',
        'data-virtual-has-after': 'false',
        'data-virtual-scroll-adjust': '0',
        'data-virtual-revision': String(current.revision),
      },
    ),
  )
  current.preparedFollow = false
  return span(children, 'plugin-list-panel', { title: current.diagnostics.title(current.status, count, current.scannedLines) })
}

function treeRow(current: Session, item: Heading): SdkRendererOutput {
  const title = item.title || `第 ${item.line} 行`
  const active = item.visibleIndex === current.activeVisible
  const input = {
    documentId: current.documentId,
    version: current.version,
    generation: current.generation,
    ordinal: item.ordinal,
    id: item.id,
    line: item.line,
  }
  const toggle: SdkRendererOutput = item.hasChildren
    ? {
        type: 'element',
        tag: 'button',
        text: item.collapsed ? '▸' : '▾',
        attributes: {
          class: 'plugin-tree-toggle',
          'aria-label': `${item.collapsed ? '展开' : '折叠'} ${title}`,
          'aria-expanded': String(!item.collapsed),
        },
        action: { command: 'outline.toggleHeading', input },
      }
    : span([], 'plugin-tree-toggle')
  return span(
    [
      toggle,
      {
        type: 'element',
        tag: 'button',
        text: title,
        attributes: {
          class: `plugin-list-item${active ? ' is-active' : ''}`,
          title: `${title}（第 ${item.line} 行）`,
          'aria-label': `跳转到 ${title}，第 ${item.line} 行`,
          'aria-current': active ? 'location' : 'false',
        },
        action: { command: 'outline.gotoHeading', input },
      },
    ],
    `plugin-tree-row plugin-list-level-${item.level}${active ? ' is-active' : ''}`,
    {
      role: 'treeitem',
      'aria-level': String(item.level),
      ...(item.hasChildren ? { 'aria-expanded': String(!item.collapsed) } : {}),
    },
  )
}

function requireSession(input: unknown): Session {
  const value = input as
    Partial<{ documentId: string; version: number; generation: number }> | undefined
  const current = session
  if (
    !current ||
    !value ||
    value.documentId !== current.documentId ||
    value.version !== current.version ||
    value.generation !== current.generation ||
    current.status === 'invalidated'
  )
    throw new Error('大纲条目已过期，请使用当前文档的大纲')
  assertCurrent(current)
  return current
}

async function requireHeading(current: Session, input: unknown): Promise<HeadingMetadata> {
  assertCurrent(current)
  const value = input as { ordinal?: unknown; id?: unknown }
  if (!Number.isInteger(value.ordinal) || Number(value.ordinal) < 0) throw new Error('标题标识无效')
  const item = await current.records?.get(Number(value.ordinal))
  assertCurrent(current)
  if (!item || item.id !== value.id) throw new Error('大纲条目已过期')
  return item
}

function enqueue<T>(current: Session, task: () => Promise<T>, kind: 'command' | 'append' | 'finish' | 'rangeFlush' | 'refresh' = 'command'): Promise<T> {
  const queued = performance.now()
  const pending = current.queue.then(async () => {
    current.diagnostics.duration('queue.wait.' + kind, performance.now() - queued)
    assertCurrent(current)
    const end = current.diagnostics.start('queue.work.' + kind)
    try { return await task() } finally { end() }
  })
  current.queue = pending.catch(() => undefined)
  return pending
}
function isCurrent(current: Session): boolean {
  return current.alive && session === current
}
function assertCurrent(current: Session): void {
  if (!isCurrent(current)) throw new Error('大纲文档版本已过期')
}
async function updatePanel(current: Session): Promise<void> {
  const diagnosticEnd = current.diagnostics.start('updatePanel')
  try {
  if (isCurrent(current)) await host?.ui?.requestUpdate('outline-panel').catch(() => undefined)
  } finally { diagnosticEnd() }
}
function positiveInteger(value: unknown): number | undefined {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : undefined
}
function yieldTask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}
function commandButton(text: string, command: string): SdkRendererOutput {
  return {
    type: 'element',
    tag: 'button',
    text,
    attributes: { 'aria-label': text },
    action: { command },
  }
}
function span(
  children: readonly SdkRendererOutput[],
  className: string,
  attributes: Record<string, string> = {},
): SdkRendererOutput {
  return { type: 'element', tag: 'span', children, attributes: { class: className, ...attributes } }
}
