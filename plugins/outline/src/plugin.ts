type ControlledOutput =
  | string
  | number
  | boolean
  | {
      type: 'element'
      tag: 'span' | 'strong' | 'em' | 'code' | 'a' | 'button'
      text?: string
      children?: readonly ControlledOutput[]
      attributes?: Record<string, string>
      action?: { command: string; input?: unknown }
    }

interface RendererContext {
  node?: {
    phase?: string
    documentId?: string
    viewport?: { fromLine?: unknown; toLine?: unknown; activeLine?: unknown }
    virtualViewport?: {
      id?: unknown
      fromIndex?: unknown
      toIndex?: unknown
      userInitiated?: unknown
      edge?: unknown
      requestId?: unknown
    }
  }
}

interface DocumentScanHeading {
  id: string
  kind: 'heading'
  from: number
  to: number
  line: number
  lineOffset: number
  level: number
  label: string
}

interface DocumentScanEvent {
  type: 'batch' | 'progress' | 'done'
  scannedLineCount: number
  totalLineCount: number
  resultCount: number
  items?: readonly DocumentScanHeading[]
  complete?: boolean
  reason?: 'complete' | 'cancelled' | 'invalidated' | 'truncated'
}

interface DocumentScanner extends AsyncIterable<DocumentScanEvent> {
  cancel(): Promise<void>
}

interface ActivationContext {
  host: {
    document?: { scan(request: unknown): DocumentScanner }
    ui?: {
      requestUpdate(viewId?: string): Promise<void>
      revealLine(line: number): Promise<void>
    }
  }
}

interface OutlineItem {
  key: string
  title: string
  level: number
  line: number
}

type ScanStatus = 'idle' | 'scanning' | 'ready' | 'truncated' | 'failed'

const initialVirtualItemCount = 160
const maxVirtualItemCount = 500
const virtualItemHeight = 28
const outlineScanEdgeWindowLines = 8192
const outlineInitialWindowLines = outlineScanEdgeWindowLines
const outlineMaximumBufferedLines = outlineScanEdgeWindowLines * 2
let host: ActivationContext['host'] | undefined
let outlineItems: OutlineItem[] = []
let activeScanner: DocumentScanner | undefined
let activeDocumentId = ''
let scanGeneration = 0
let scanStatus: ScanStatus = 'idle'
let scannedFromLine = 1
let scannedToLine = 0
let totalLineCount = 1
let lastEdgeRequestId = 0
let edgeLoadingDirection: 'before' | 'after' | undefined
let selectedHeadingLine: number | undefined
let scanAnchorLine = 1
let virtualRevision = 0
let virtualScrollAdjustment = 0
let pendingVirtualIndexShift = 0
let panelUpdateTimer: ReturnType<typeof setTimeout> | undefined
let panelUpdateInFlight = false
let panelUpdatePending = false

const plugin = {
  commands: {
    'outline.gotoHeading': async (_context: unknown, input: unknown) => {
      const line = readHeadingLine(input)
      if (!host?.ui) throw new Error('大纲导航暂时不可用')
      await host.ui.revealLine(line)
      selectedHeadingLine = line
      await requestPanelUpdate()
    },
  },
  renderers: {
    'outline-panel': (context: RendererContext) => renderPanel(context),
  },
  activate(context: ActivationContext) {
    host = context.host
    return { dispose: () => stopOutlineScan(true) }
  },
  deactivate() {
    host = undefined
    void stopOutlineScan(true)
  },
}

export default plugin

function renderPanel(context: RendererContext): ControlledOutput {
  const phase = context.node?.phase
  const documentId = context.node?.documentId ?? ''
  const activeLine = readPositiveInteger(context.node?.viewport?.activeLine) ?? 1

  if (phase === 'dispose') {
    void stopOutlineScan(true)
    return ''
  }

  if (phase === 'mount' || documentId !== activeDocumentId) {
    void startCenteredOutlineScan(documentId, activeLine)
  }

  const activeIndex = findHeadingIndex(outlineItems, selectedHeadingLine)
  const children: ControlledOutput[] = []
  const virtualViewport = readVirtualViewport(context.node?.virtualViewport)
  if (virtualViewport?.edge && virtualViewport.requestId > lastEdgeRequestId) {
    lastEdgeRequestId = virtualViewport.requestId
    if (!activeScanner && !edgeLoadingDirection) {
      edgeLoadingDirection = virtualViewport.edge
      void extendOutlineWindow(virtualViewport.edge)
    }
  }

  if (scanStatus === 'failed') {
    children.push(
      stateBlock(
        'error',
        'circle-alert',
        '大纲加载失败',
        '暂时无法生成大纲，请重新打开文档后再试。',
      ),
    )
  } else if (outlineItems.length === 0) {
    if (scanStatus === 'scanning') {
      children.push(stateBlock('loading', 'loader-circle', '正在加载', '正在读取当前区域的标题。'))
    } else {
      if (edgeLoadingDirection === 'before') children.push(edgeLoadingIndicator())
      children.push(
        span(
          [stateBlock('empty', 'list-tree', '当前区域无标题', '滚动到顶部或底部可继续查找。')],
          'plugin-virtual-list',
          virtualListAttributes(0, 0, 0, -1),
        ),
      )
      if (edgeLoadingDirection === 'after') children.push(edgeLoadingIndicator())
    }
  } else {
    const renderViewport =
      pendingVirtualIndexShift !== 0 && virtualViewport
        ? {
            ...virtualViewport,
            fromIndex: Math.max(0, virtualViewport.fromIndex + pendingVirtualIndexShift),
            toIndex: Math.max(0, virtualViewport.toIndex + pendingVirtualIndexShift),
          }
        : virtualViewport
    const visible = selectVirtualItems(outlineItems, renderViewport)
    const list = visible.items.map(({ item, index }) =>
      button(item.title || `第 ${item.line} 行`, item.line, item.level, index === activeIndex),
    )
    if (edgeLoadingDirection === 'before') children.push(edgeLoadingIndicator())
    children.push(
      span(
        list,
        'plugin-virtual-list',
        virtualListAttributes(outlineItems.length, visible.start, visible.end, activeIndex),
      ),
    )
    if (edgeLoadingDirection === 'after') children.push(edgeLoadingIndicator())
    pendingVirtualIndexShift = 0
    if (scanStatus === 'truncated') {
      children.push(span(['文档标题过多，已达到扫描上限。'], 'plugin-list-progress'))
    }
  }

  return span(children, 'plugin-list-panel')
}

async function startCenteredOutlineScan(documentId: string, activeLine: number): Promise<void> {
  const generation = ++scanGeneration
  const scanner = activeScanner
  activeScanner = undefined
  outlineItems = []
  activeDocumentId = documentId
  scanAnchorLine = activeLine
  selectedHeadingLine = undefined
  scanStatus = 'scanning'
  scannedFromLine = Math.max(1, activeLine - Math.floor(outlineInitialWindowLines / 2))
  scannedToLine = scannedFromLine - 1
  totalLineCount = Math.max(totalLineCount, activeLine)
  edgeLoadingDirection = undefined
  virtualRevision += 1
  virtualScrollAdjustment = 0
  pendingVirtualIndexShift = 0
  await scanner?.cancel().catch(() => undefined)
  if (generation !== scanGeneration) return

  await scanOutlineRange(
    generation,
    'center',
    scannedFromLine,
    scannedFromLine + outlineInitialWindowLines - 1,
  )
}

async function extendOutlineWindow(direction: 'before' | 'after'): Promise<void> {
  if (activeScanner) return

  const range =
    direction === 'before'
      ? {
          fromLine: Math.max(1, scannedFromLine - outlineScanEdgeWindowLines),
          toLine: scannedFromLine - 1,
        }
      : {
          fromLine: scannedToLine + 1,
          toLine: Math.min(totalLineCount, scannedToLine + outlineScanEdgeWindowLines),
        }

  if (range.fromLine > range.toLine) {
    edgeLoadingDirection = undefined
    schedulePanelUpdate(0)
    return
  }
  await scanOutlineRange(scanGeneration, direction, range.fromLine, range.toLine)
}

async function scanOutlineRange(
  generation: number,
  mode: 'center' | 'before' | 'after',
  fromLine: number,
  toLine: number,
): Promise<void> {
  const scanner = host?.document?.scan({
    query: { kind: 'markdownHeadings' },
    fromLine,
    toLine,
    windowSizeLines: 512,
    batchSize: 128,
    maxResults: 50_000,
  })

  if (!scanner) {
    if (mode === 'center') scanStatus = 'failed'
    edgeLoadingDirection = undefined
    schedulePanelUpdate(0)
    return
  }
  activeScanner = scanner
  const collected: OutlineItem[] = []

  try {
    let eventCount = 0
    for await (const event of scanner) {
      if (generation !== scanGeneration) return

      if (event.type === 'batch') {
        collected.push(...(event.items ?? []).map(toOutlineItem))
      } else if (event.type === 'done') {
        activeScanner = undefined
        totalLineCount = event.totalLineCount

        if (event.reason === 'invalidated' && generation === scanGeneration) {
          edgeLoadingDirection = undefined
          void startCenteredOutlineScan(activeDocumentId, scanAnchorLine)
          return
        }

        const actualToLine = Math.min(toLine, fromLine + event.scannedLineCount - 1)
        applyScannedOutlineRange(mode, fromLine, actualToLine, collected)
        scanStatus = event.reason === 'truncated' ? 'truncated' : 'ready'
        edgeLoadingDirection = undefined
        schedulePanelUpdate(0)
      }

      eventCount += 1
      if (event.type !== 'done' && eventCount % 8 === 0) {
        await yieldBackgroundScan()
      }
    }
  } catch {
    if (generation !== scanGeneration) return
    activeScanner = undefined
    if (mode === 'center') scanStatus = 'failed'
    edgeLoadingDirection = undefined
    schedulePanelUpdate(0)
  }
}

function applyScannedOutlineRange(
  mode: 'center' | 'before' | 'after',
  fromLine: number,
  toLine: number,
  incoming: readonly OutlineItem[],
): void {
  const existingLines = new Set(outlineItems.map((item) => item.line))
  const addedItems = incoming.filter((item) => !existingLines.has(item.line))

  if (mode === 'center') {
    outlineItems = [...incoming].sort((left, right) => left.line - right.line)
    scannedFromLine = fromLine
    scannedToLine = toLine
    virtualScrollAdjustment = 0
  } else {
    outlineItems = [...outlineItems, ...addedItems].sort((left, right) => left.line - right.line)
    if (mode === 'before') {
      scannedFromLine = fromLine
      virtualScrollAdjustment = addedItems.length * virtualItemHeight
      pendingVirtualIndexShift = addedItems.length
    } else {
      scannedToLine = toLine
      virtualScrollAdjustment = 0
      pendingVirtualIndexShift = 0
    }
  }
  trimOutlineBuffer(mode)
  virtualRevision += 1
}

function trimOutlineBuffer(mode: 'center' | 'before' | 'after'): void {
  if (scannedToLine - scannedFromLine + 1 <= outlineMaximumBufferedLines) return

  if (mode === 'before') {
    const nextToLine = scannedFromLine + outlineMaximumBufferedLines - 1
    outlineItems = outlineItems.filter((item) => item.line <= nextToLine)
    scannedToLine = nextToLine
    return
  }

  const nextFromLine = scannedToLine - outlineMaximumBufferedLines + 1
  const removedBefore = outlineItems.filter((item) => item.line < nextFromLine).length
  outlineItems = outlineItems.filter((item) => item.line >= nextFromLine)
  scannedFromLine = nextFromLine
  if (mode === 'after' && removedBefore > 0) {
    virtualScrollAdjustment -= removedBefore * virtualItemHeight
    pendingVirtualIndexShift -= removedBefore
  }
}

async function stopOutlineScan(clear: boolean): Promise<void> {
  scanGeneration += 1
  const scanner = activeScanner
  activeScanner = undefined
  await scanner?.cancel().catch(() => undefined)

  if (clear) {
    clearPanelUpdate()
    outlineItems = []
    activeDocumentId = ''
    scanStatus = 'idle'
    scannedFromLine = 1
    scannedToLine = 0
    totalLineCount = 1
    lastEdgeRequestId = 0
    edgeLoadingDirection = undefined
    selectedHeadingLine = undefined
    scanAnchorLine = 1
    virtualScrollAdjustment = 0
    pendingVirtualIndexShift = 0
  }
}

function toOutlineItem(heading: DocumentScanHeading): OutlineItem {
  return {
    key: String(heading.line),
    title: heading.label.replace(/\s+/gu, ' ').trim(),
    level: heading.level,
    line: heading.line,
  }
}

function findHeadingIndex(items: readonly OutlineItem[], line: number | undefined): number {
  if (line === undefined) return -1
  let low = 0
  let high = items.length

  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if ((items[middle]?.line ?? 0) < line) low = middle + 1
    else high = middle
  }

  return items[low]?.line === line ? low : -1
}

interface VirtualViewportRequest {
  readonly id: string
  readonly fromIndex: number
  readonly toIndex: number
  readonly userInitiated: boolean
  readonly edge?: 'before' | 'after'
  readonly requestId: number
}

interface VirtualOutlineSlice {
  readonly start: number
  readonly end: number
  readonly items: readonly { item: OutlineItem; index: number }[]
}

function selectVirtualItems(
  items: readonly OutlineItem[],
  requested: VirtualViewportRequest | undefined,
): VirtualOutlineSlice {
  let start: number
  let end: number

  if (requested?.id === 'outline') {
    start = Math.min(items.length, requested.fromIndex)
    end = Math.min(items.length, Math.max(start, requested.toIndex))
    if (end - start > maxVirtualItemCount) {
      const middle = Math.floor((start + end) / 2)
      start = Math.max(0, middle - Math.floor(maxVirtualItemCount / 2))
      end = Math.min(items.length, start + maxVirtualItemCount)
      start = Math.max(0, end - maxVirtualItemCount)
    }
  } else {
    start = 0
    end = Math.min(items.length, start + initialVirtualItemCount)
  }

  return {
    start,
    end,
    items: items.slice(start, end).map((item, offset) => ({ item, index: start + offset })),
  }
}

function readVirtualViewport(
  value:
    | {
        id?: unknown
        fromIndex?: unknown
        toIndex?: unknown
        userInitiated?: unknown
        edge?: unknown
        requestId?: unknown
      }
    | undefined,
): VirtualViewportRequest | undefined {
  const id = typeof value?.id === 'string' ? value.id : undefined
  const fromIndex = readNonNegativeInteger(value?.fromIndex)
  const toIndex = readNonNegativeInteger(value?.toIndex)
  const edge = value?.edge === 'before' || value?.edge === 'after' ? value.edge : undefined
  const requestId = readNonNegativeInteger(value?.requestId) ?? 0
  return id && fromIndex !== undefined && toIndex !== undefined && fromIndex <= toIndex
    ? {
        id,
        fromIndex,
        toIndex,
        userInitiated: value?.userInitiated === true,
        ...(edge ? { edge } : {}),
        requestId,
      }
    : undefined
}

function virtualListAttributes(
  total: number,
  start: number,
  end: number,
  active: number,
): Record<string, string> {
  return {
    'data-virtual-list': 'outline',
    'data-virtual-total': String(total),
    'data-virtual-start': String(start),
    'data-virtual-end': String(end),
    'data-virtual-item-height': String(virtualItemHeight),
    'data-virtual-active': String(active),
    'data-virtual-follow-active': 'false',
    'data-virtual-has-before': String(scannedFromLine > 1),
    'data-virtual-has-after': String(scannedToLine < totalLineCount),
    'data-virtual-scroll-adjust': String(virtualScrollAdjustment),
    'data-virtual-revision': String(virtualRevision),
  }
}

function edgeLoadingIndicator(): ControlledOutput {
  return span([''], 'plugin-list-progress plugin-ui-loading-icon', {
    'data-host-icon': 'loader-circle',
  })
}

function stateBlock(
  state: 'empty' | 'error' | 'loading',
  icon: 'list-tree' | 'circle-alert' | 'loader-circle',
  title: string,
  message: string,
): ControlledOutput {
  return span(
    [
      span([''], `plugin-ui-state-icon${state === 'loading' ? ' plugin-ui-loading-icon' : ''}`, {
        'data-host-icon': icon,
      }),
      strong(title),
      span([message], 'plugin-ui-state-message'),
    ],
    `plugin-ui-state plugin-ui-state-${state}`,
  )
}

function requestPanelUpdate(): Promise<void> {
  return host?.ui?.requestUpdate('outline-panel') ?? Promise.resolve()
}

function schedulePanelUpdate(delay = 0): void {
  panelUpdatePending = true
  if (panelUpdateInFlight || panelUpdateTimer !== undefined) return

  panelUpdateTimer = setTimeout(() => {
    panelUpdateTimer = undefined
    void flushPanelUpdate()
  }, delay)
}

async function flushPanelUpdate(): Promise<void> {
  if (panelUpdateInFlight || !panelUpdatePending) return
  panelUpdatePending = false
  panelUpdateInFlight = true

  try {
    await requestPanelUpdate()
  } catch {
    // UI refresh failures must not stop the document scan.
  } finally {
    panelUpdateInFlight = false
    if (panelUpdatePending) schedulePanelUpdate(0)
  }
}

function clearPanelUpdate(): void {
  if (panelUpdateTimer !== undefined) clearTimeout(panelUpdateTimer)
  panelUpdateTimer = undefined
  panelUpdatePending = false
}

function yieldBackgroundScan(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function readHeadingLine(input: unknown): number {
  const line = input && typeof input === 'object' ? (input as { line?: unknown }).line : undefined
  const value = readPositiveInteger(line)
  if (value === undefined) throw new Error('标题行号无效')
  return value
}

function readPositiveInteger(value: unknown): number | undefined {
  return Number.isInteger(value) && Number(value) >= 1 ? Number(value) : undefined
}

function readNonNegativeInteger(value: unknown): number | undefined {
  return Number.isInteger(value) && Number(value) >= 0 ? Number(value) : undefined
}

function span(
  children: readonly ControlledOutput[],
  className?: string,
  attributes?: Record<string, string>,
): ControlledOutput {
  return {
    type: 'element',
    tag: 'span',
    children,
    ...(className || attributes
      ? { attributes: { ...(className ? { class: className } : {}), ...attributes } }
      : {}),
  }
}

function strong(text: string): ControlledOutput {
  return { type: 'element', tag: 'strong', text }
}

function button(text: string, line: number, level: number, active: boolean): ControlledOutput {
  return {
    type: 'element',
    tag: 'button',
    text,
    attributes: {
      class: `plugin-list-item plugin-list-level-${Math.max(1, Math.min(6, level))}${active ? ' is-active' : ''}`,
      title: `${text}（第 ${line} 行）`,
      'aria-label': `跳转到 ${text}，第 ${line} 行`,
    },
    action: { command: 'outline.gotoHeading', input: { line } },
  }
}
