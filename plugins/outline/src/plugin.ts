import { definePlugin } from '@milkup/plugin-sdk'
import type {
  SdkDocumentScanner,
  SdkDocumentScanHeading,
  SdkPluginActivationContext,
  SdkPluginRendererContext,
  SdkRendererOutput,
  SdkTemporaryStore,
} from '@milkup/plugin-sdk'

const scanLines = 4096
// Eight records keep worst-case JSON-escaped 4096-character labels below 256 KiB.
const recordPageSize = 8
const projectionPageSize = 256
const cachedPages = 8
const maximumRows = 500
const defaultRows = 160
const rowHeight = 28

/** Direct ordinal addressing: neither the page directory nor the title tree lives in RAM. */
class PagedArray<T> {
  length = 0
  private readonly pages = new Map<number, { values: T[]; dirty: boolean }>()

  constructor(
    private readonly store: SdkTemporaryStore,
    private readonly prefix: string,
    private readonly pageSize: number,
  ) {}

  async get(index: number): Promise<T | undefined> {
    if (index < 0 || index >= this.length) return undefined
    return (await this.page(Math.floor(index / this.pageSize))).values[index % this.pageSize]
  }

  async set(index: number, value: T): Promise<void> {
    const page = await this.page(Math.floor(index / this.pageSize))
    page.values[index % this.pageSize] = value
    page.dirty = true
    this.length = Math.max(this.length, index + 1)
  }

  async append(value: T): Promise<number> {
    const index = this.length
    await this.set(index, value)
    return index
  }

  async flush(): Promise<void> {
    let entries: { key: string; value: string }[] = []
    let dirty: { values: T[]; dirty: boolean }[] = []
    let bytes = 0
    const send = async () => {
      if (!entries.length) return
      await this.store.setMany(entries)
      for (const page of dirty) page.dirty = false
      entries = []
      dirty = []
      bytes = 0
    }
    for (const [index, page] of this.pages) {
      if (!page.dirty) continue
      const value = JSON.stringify(page.values)
      const size = new TextEncoder().encode(value).length
      if (bytes + size > 256 * 1024) await send()
      entries.push({ key: `${this.prefix}-${index}`, value })
      dirty.push(page)
      bytes += size
    }
    await send()
  }

  async clear(): Promise<void> {
    await this.flush()
    this.pages.clear()
    this.length = 0
  }

  private async page(index: number): Promise<{ values: T[]; dirty: boolean }> {
    const cached = this.pages.get(index)
    if (cached) {
      this.pages.delete(index)
      this.pages.set(index, cached)
      return cached
    }
    // Missing logical pages are new writes, even if an older projection used the same key.
    if (index * this.pageSize >= this.length) {
      await this.makeRoom()
      const empty = { values: [] as T[], dirty: false }
      this.pages.set(index, empty)
      return empty
    }
    const indices: number[] = []
    for (
      let next = index;
      next < Math.min(index + 4, Math.ceil(this.length / this.pageSize));
      next++
    ) {
      if (!this.pages.has(next)) indices.push(next)
    }
    const values = await this.readPages(indices)
    for (let offset = 0; offset < indices.length; offset++) {
      await this.makeRoom()
      const json = values[offset]
      if (json === null || json === undefined) throw new Error('大纲索引页缺失，请重试全文扫描')
      this.pages.set(indices[offset]!, { values: JSON.parse(json) as T[], dirty: false })
    }
    return this.pages.get(index)!
  }

  private async readPages(indices: readonly number[]): Promise<readonly (string | null)[]> {
    try {
      return await this.store.getMany(indices.map((index) => `${this.prefix}-${index}`))
    } catch (error) {
      // Long labels can exceed the response budget even for four pages; split bounded requests.
      if (indices.length <= 1) throw error
      const middle = Math.floor(indices.length / 2)
      return [
        ...(await this.readPages(indices.slice(0, middle))),
        ...(await this.readPages(indices.slice(middle))),
      ]
    }
  }

  private async makeRoom(): Promise<void> {
    if (this.pages.size < cachedPages) return
    await this.flush()
    // Evict a bounded group after a batched flush, so sequential writes do not
    // turn every new eight-record page into a separate storage transaction.
    for (let count = 0; count < cachedPages / 2; count++) {
      const oldest = this.pages.keys().next().value
      if (oldest !== undefined) this.pages.delete(oldest)
    }
  }
}

interface Heading {
  ordinal: number
  id: string
  from: number
  line: number
  level: number
  title: string
  parent?: number
  ancestors: number[]
  subtreeEnd?: number
  hasChildren: boolean
  collapsed: boolean
  visibleIndex?: number
}

type Status = 'starting' | 'scanning' | 'complete' | 'cancelled' | 'invalidated' | 'failed'
interface Session {
  documentId: string
  version: number
  generation: number
  alive: boolean
  status: Status
  store?: SdkTemporaryStore
  storeReady?: Promise<SdkTemporaryStore>
  startTimer?: ReturnType<typeof setTimeout>
  records?: PagedArray<Heading>
  projection?: PagedArray<number>
  scanner?: SdkDocumentScanner
  queue: Promise<unknown>
  stack: { ordinal: number; level: number }[]
  lastSourceFrom: number
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
  revision: number
  renderRequest: number
  refreshTimer?: ReturnType<typeof setTimeout>
  rebuilding: boolean
  rebuiltCount: number
  defaultCollapsed: boolean
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
    'outline.gotoHeading': async (_context: unknown, input: unknown) => {
      const current = requireSession(input)
      await enqueue(current, async () => {
        const item = await requireHeading(current, input)
        if (!host?.ui) throw new Error('大纲导航暂时不可用')
        let unfold = false
        for (const ordinal of item.ancestors) {
          const ancestor = (await current.records!.get(ordinal))!
          if (ancestor.collapsed) {
            ancestor.collapsed = false
            await current.records!.set(ordinal, ancestor)
            unfold = true
          }
        }
        if (unfold) await rebuildProjection(current)
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
        item.collapsed = !item.collapsed
        await current.records!.set(item.ordinal, item)
        await rebuildProjection(current)
      })
    },
    'outline.collapseAll': async () => {
      const current = session
      if (!current?.records) return
      await enqueue(current, () => rebuildProjection(current, true))
    },
    'outline.expandAll': async () => {
      const current = session
      if (!current?.records) return
      await enqueue(current, () => rebuildProjection(current, false))
    },
    'outline.cancel': async () => {
      const current = session
      if (!current || (current.status !== 'starting' && current.status !== 'scanning')) return
      current.status = 'cancelled'
      await current.scanner?.cancel().catch(() => undefined)
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
    (viewport.fromIndex !== current.rowStart || viewport.toIndex !== current.rowEnd) &&
    Number.isInteger(viewport.fromIndex) &&
    Number.isInteger(viewport.toIndex)
  ) {
    const from = Math.max(0, viewport.fromIndex)
    const count = Math.min(maximumRows, Math.max(1, viewport.toIndex - from))
    if (from !== current.fromIndex || count !== current.rowCount) {
      current.fromIndex = from
      current.rowCount = count
      if (viewport.userInitiated) current.followActive = false
      scheduleRefresh(current)
    }
  }
  return panel(current)
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
    alive: true,
    status: 'starting',
    queue: Promise.resolve(),
    stack: [],
    lastSourceFrom: -1,
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
    revision: 0,
    renderRequest: 0,
    rebuilding: false,
    rebuiltCount: 0,
    defaultCollapsed: false,
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
    current.records = new PagedArray(store, 'headings', recordPageSize)
    current.projection = new PagedArray(store, 'visible', projectionPageSize)
    if (current.status === 'cancelled') {
      scheduleRefresh(current)
      return
    }
    current.status = 'scanning'
    let fromLine = 1
    while (isCurrent(current) && current.status === 'scanning') {
      const toLine = fromLine + scanLines - 1
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
      for await (const event of scanner) {
        if (!isCurrent(current) || current.status !== 'scanning') return
        current.totalLines = event.totalLineCount
        if (event.type === 'batch') {
          await enqueue(current, async () => {
            for (const item of event.items) {
              assertCurrent(current)
              if (item.kind === 'heading') await appendHeading(current, item)
            }
            await current.records!.flush()
            await current.projection!.flush()
          })
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
          while (current.stack.length) await closeBranch(current, current.stack.pop()!.ordinal)
          await current.records!.flush()
          if (current.status === 'scanning') current.status = 'complete'
          current.followActive = true
        })
        scheduleRefresh(current)
        return
      }
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

async function appendHeading(current: Session, item: SdkDocumentScanHeading): Promise<void> {
  // A Setext heading may start before this scan range; source offsets deduplicate range overlap.
  if (item.from <= current.lastSourceFrom) return
  while (current.stack.length && current.stack[current.stack.length - 1]!.level >= item.level) {
    await closeBranch(current, current.stack.pop()!.ordinal)
  }
  const records = current.records!
  const projection = current.projection!
  const ancestors = current.stack.map((entry) => entry.ordinal)
  const parent = ancestors[ancestors.length - 1]
  let visible = true
  for (const ancestor of ancestors) {
    const record = (await records.get(ancestor))!
    if (record.collapsed) visible = false
    if (ancestor === parent && !record.hasChildren) {
      record.hasChildren = true
      if (current.rows.some((row) => row.ordinal === ancestor)) current.rowsDirty = true
      await records.set(ancestor, record)
    }
  }
  const ordinal = records.length
  const record: Heading = {
    ordinal,
    id: `${current.version}:${item.from}`,
    from: item.from,
    line: item.line,
    level: Math.max(1, Math.min(6, item.level)),
    title: item.label.slice(0, 4096).replace(/\s+/gu, ' ').trim(),
    ...(parent === undefined ? {} : { parent }),
    ancestors,
    hasChildren: false,
    collapsed: current.defaultCollapsed,
    ...(visible ? { visibleIndex: projection.length } : {}),
  }
  await records.append(record)
  if (visible) await projection.append(ordinal)
  current.stack.push({ ordinal, level: record.level })
  current.lastSourceFrom = item.from
}

async function closeBranch(current: Session, ordinal: number): Promise<void> {
  const record = (await current.records!.get(ordinal))!
  record.subtreeEnd = current.records!.length
  await current.records!.set(ordinal, record)
}

async function rebuildProjection(current: Session, collapseAll?: boolean): Promise<void> {
  assertCurrent(current)
  current.rebuilding = true
  current.rowsDirty = true
  current.rebuiltCount = 0
  if (collapseAll !== undefined) current.defaultCollapsed = collapseAll
  await updatePanel(current)
  try {
    const records = current.records!
    const projection = current.projection!
    await projection.clear()
    let hiddenBelow: number | undefined
    for (let ordinal = 0; ordinal < records.length; ordinal++) {
      assertCurrent(current)
      const record = (await records.get(ordinal))!
      if (collapseAll !== undefined) record.collapsed = collapseAll
      const visible = hiddenBelow === undefined || record.level <= hiddenBelow
      if (visible) {
        record.visibleIndex = await projection.append(ordinal)
        hiddenBelow = record.collapsed ? record.level : undefined
      } else delete record.visibleIndex
      await records.set(ordinal, record)
      current.rebuiltCount = ordinal + 1
      if (ordinal % projectionPageSize === projectionPageSize - 1) {
        await records.flush()
        await projection.flush()
        await updatePanel(current)
        await yieldTask()
      }
    }
    await records.flush()
    await projection.flush()
    current.revision += 1
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
  if (!isCurrent(current) || current.refreshTimer !== undefined) return
  current.refreshTimer = setTimeout(() => {
    delete current.refreshTimer
    const request = ++current.renderRequest
    void enqueue(current, async () => {
      if (request !== current.renderRequest) return
      await prepareRows(current)
      await updatePanel(current)
    }).catch((error) => {
      if (!isCurrent(current)) return
      current.status = 'failed'
      current.error = error instanceof Error ? error.message : '大纲读取失败'
      void updatePanel(current)
    })
  }, 0)
}

async function prepareRows(current: Session): Promise<void> {
  if (!current.records || !current.projection) return
  const records = current.records
  const projection = current.projection
  let low = 0
  let high = records.length
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if ((await records.get(middle))!.line <= current.activeLine) low = middle + 1
    else high = middle
  }
  current.activeOrdinal =
    current.status !== 'complete' && current.activeLine > current.scannedLines ? -1 : low - 1
  const active = await records.get(current.activeOrdinal)
  current.activeVisible = active?.visibleIndex ?? -1
  if (active && current.activeVisible < 0) {
    for (const ancestor of active.ancestors) {
      const record = (await records.get(ancestor))!
      if (record.visibleIndex !== undefined && record.collapsed) {
        current.activeVisible = record.visibleIndex
        break
      }
    }
  }
  const count = Math.min(maximumRows, current.rowCount)
  let start = Math.min(current.fromIndex, Math.max(0, projection.length - count))
  if (current.followActive && current.activeVisible >= 0)
    start = Math.max(0, current.activeVisible - Math.floor(count / 2))
  const end = Math.min(projection.length, start + count)
  let rows = current.rows
  if (current.rowsDirty || start !== current.rowStart || end !== current.rowEnd) {
    rows = []
    for (let index = start; index < end; index++) {
      assertCurrent(current)
      const ordinal = (await projection.get(index))!
      rows.push({ ...(await records.get(ordinal))! })
    }
    current.rowsDirty = false
  }
  current.preparedFollow = current.followActive
  current.followActive = false
  current.rows = rows
  current.rowStart = start
  current.rowEnd = end
  current.fromIndex = start
  current.revision += 1
}

function panel(current: Session): SdkRendererOutput {
  const count = current.records?.length ?? 0
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
  if (current.rebuilding)
    children.push(
      span([`正在更新折叠视图 ${current.rebuiltCount} / ${count}`], 'plugin-list-summary'),
    )
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
        'data-virtual-total': String(current.projection?.length ?? 0),
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
  return span(children, 'plugin-list-panel')
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

async function requireHeading(current: Session, input: unknown): Promise<Heading> {
  assertCurrent(current)
  const value = input as { ordinal?: unknown; id?: unknown }
  if (!Number.isInteger(value.ordinal) || Number(value.ordinal) < 0) throw new Error('标题标识无效')
  const item = await current.records?.get(Number(value.ordinal))
  assertCurrent(current)
  if (!item || item.id !== value.id) throw new Error('大纲条目已过期')
  return item
}

function enqueue<T>(current: Session, task: () => Promise<T>): Promise<T> {
  const pending = current.queue.then(() => {
    assertCurrent(current)
    return task()
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
  if (isCurrent(current)) await host?.ui?.requestUpdate('outline-panel').catch(() => undefined)
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
