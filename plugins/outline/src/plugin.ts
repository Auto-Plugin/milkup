import { definePlugin } from '@milkup/plugin-sdk'
import type {
  SdkDocumentScanner as DocumentScanner,
  SdkDocumentScanHeading as DocumentScanHeading,
  SdkPluginActivationContext as ActivationContext,
  SdkPluginRendererContext as RendererContext,
  SdkRendererOutput as ControlledOutput,
} from '@milkup/plugin-sdk'

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
let activeDocumentVersion: number | undefined
let lastActiveLine = 1
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
let collapsedLines = new Set<number>()
let followActive = false
let panelUpdateTimer: ReturnType<typeof setTimeout> | undefined
let panelUpdateInFlight = false
let panelUpdatePending = false

const plugin = definePlugin({
  commands: {
    'outline.gotoHeading': async (_context: unknown, input: unknown) => {
      const line = readHeadingLine(input)
      if (!host?.ui) throw new Error('大纲导航暂时不可用')
      const generation = scanGeneration
      await host.ui.revealLine(line)
      if (generation !== scanGeneration) return
      selectedHeadingLine = line
      lastActiveLine = line
      revealAncestors(line)
      followActive = true
      await requestPanelUpdate()
    },
    'outline.toggleHeading': async (_context: unknown, input: unknown) => {
      const line = readHeadingLine(input)
      if (!hasChildren(line)) return
      if (collapsedLines.has(line)) collapsedLines.delete(line)
      else collapsedLines.add(line)
      virtualRevision += 1
      followActive = true
      await requestPanelUpdate()
    },
    'outline.collapseAll': async () => {
      collapsedLines = new Set(
        outlineItems
          .filter((item, index) => (outlineItems[index + 1]?.level ?? 0) > item.level)
          .map((item) => item.line),
      )
      virtualRevision += 1
      followActive = true
      await requestPanelUpdate()
    },
    'outline.expandAll': async () => {
      collapsedLines.clear()
      virtualRevision += 1
      followActive = true
      await requestPanelUpdate()
    },
  },
  renderers: {
    'outline-panel': (context: RendererContext) => renderPanel(context),
  },
  activate(context: ActivationContext) {
    host = context.host
    return {
      dispose: () => {
        host = undefined
        return stopOutlineScan(true)
      },
    }
  },
  deactivate() {
    host = undefined
    void stopOutlineScan(true)
  },
})

export default plugin

function renderPanel(context: RendererContext): ControlledOutput {
  const phase = context.node?.phase
  const documentId = context.node?.documentId ?? ''
  const requestedActiveLine = readPositiveInteger(context.node?.viewport?.activeLine)
  const documentChanged = documentId !== activeDocumentId
  const activeLine = requestedActiveLine ?? (documentChanged ? 1 : lastActiveLine)
  const activeChanged = requestedActiveLine !== undefined && activeLine !== lastActiveLine

  if (phase === 'dispose') {
    void stopOutlineScan(true)
    return ''
  }

  const version =
    context.node?.documentVersion ?? (documentChanged ? undefined : activeDocumentVersion)
  const outsideWindow =
    activeLine !== lastActiveLine && (activeLine < scannedFromLine || activeLine > scannedToLine)
  if (
    (phase === 'mount' && scanStatus === 'idle') ||
    documentId !== activeDocumentId ||
    version !== activeDocumentVersion ||
    outsideWindow
  ) {
    if (documentChanged || version !== activeDocumentVersion) collapsedLines.clear()
    activeDocumentVersion = version
    void startCenteredOutlineScan(documentId, activeLine)
  }
  if (context.node?.viewport?.activeLine !== undefined) selectedHeadingLine = activeLine
  lastActiveLine = activeLine

  const visibleItems = unfoldedItems()
  const activeIndex = findHeadingIndex(visibleItems, selectedHeadingLine)
  const shouldFollowActive = followActive || activeChanged
  followActive = false
  const children: ControlledOutput[] = []
  const virtualViewport = readVirtualViewport(context.node?.virtualViewport)
  if (virtualViewport?.edge && virtualViewport.requestId > lastEdgeRequestId) {
    lastEdgeRequestId = virtualViewport.requestId
    if (!activeScanner && !edgeLoadingDirection) {
      edgeLoadingDirection = virtualViewport.edge
      void extendOutlineWindow(virtualViewport.edge)
    }
  }

  if (outlineItems.length > 0) {
    children.push(
      span(
        [
          commandButton('全部展开', 'outline.expandAll'),
          commandButton('全部折叠', 'outline.collapseAll'),
        ],
        'plugin-tree-toolbar',
      ),
    )
  }
  if (scanStatus !== 'scanning' && scanStatus !== 'idle' && scanStatus !== 'failed') {
    children.push(
      span(
        [
          scannedFromLine <= 1 && scannedToLine >= totalLineCount
            ? `已加载全文 · ${outlineItems.length} 个标题`
            : `已加载第 ${scannedFromLine}–${Math.max(scannedFromLine, scannedToLine)} 行 / 共 ${totalLineCount} 行；上下滚动继续加载`,
        ],
        'plugin-list-summary',
      ),
    )
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
          [
            stateBlock(
              'empty',
              'list-tree',
              scannedFromLine <= 1 && scannedToLine >= totalLineCount
                ? '文档无标题'
                : '当前区域无标题',
              scannedFromLine <= 1 && scannedToLine >= totalLineCount
                ? '添加 H1–H6 标题后将在此显示。'
                : '滚动到顶部或底部可继续查找。',
            ),
          ],
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
    const visible = selectVirtualItems(
      visibleItems,
      renderViewport,
      shouldFollowActive ? activeIndex : undefined,
    )
    const list = visible.items.map(({ item, index }) => treeRow(item, index === activeIndex))
    if (edgeLoadingDirection === 'before') children.push(edgeLoadingIndicator())
    children.push(
      span(
        list,
        'plugin-virtual-list',
        virtualListAttributes(
          visibleItems.length,
          visible.start,
          visible.end,
          activeIndex,
          shouldFollowActive,
        ),
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
  if (activeDocumentId !== documentId) {
    totalLineCount = 1
    lastEdgeRequestId = 0
  }
  activeDocumentId = documentId
  scanAnchorLine = activeLine
  selectedHeadingLine = activeLine
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
  let scanner: DocumentScanner | undefined
  try {
    scanner = host?.document?.scan({
      query: { kind: 'markdownHeadings' },
      fromLine,
      toLine,
      windowSizeLines: 512,
      batchSize: 128,
      maxResults: outlineScanEdgeWindowLines,
    })
  } catch {
    scanStatus = 'failed'
    edgeLoadingDirection = undefined
    schedulePanelUpdate(0)
    return
  }

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
        collected.push(
          ...event.items
            .filter(
              (item): item is DocumentScanHeading =>
                item.kind === 'heading' && item.line >= fromLine && item.line <= toLine,
            )
            .slice(0, outlineScanEdgeWindowLines - collected.length)
            .map(toOutlineItem),
        )
      } else if (event.type === 'done') {
        activeScanner = undefined
        totalLineCount = event.totalLineCount

        if (event.reason === 'invalidated' && generation === scanGeneration) {
          edgeLoadingDirection = undefined
          void startCenteredOutlineScan(activeDocumentId, scanAnchorLine)
          return
        }

        if (event.reason === 'cancelled') {
          scanStatus = mode === 'center' ? 'failed' : 'ready'
          edgeLoadingDirection = undefined
          schedulePanelUpdate(0)
          return
        }

        const actualToLine = Math.min(toLine, fromLine + event.scannedLineCount - 1)
        applyScannedOutlineRange(mode, fromLine, actualToLine, collected)
        scanStatus = event.reason === 'truncated' ? 'truncated' : 'ready'
        edgeLoadingDirection = undefined
        schedulePanelUpdate(0)
        return
      }

      eventCount += 1
      if (eventCount % 8 === 0) {
        await yieldBackgroundScan()
      }
    }
    if (generation === scanGeneration) {
      activeScanner = undefined
      if (mode === 'center') scanStatus = 'failed'
      edgeLoadingDirection = undefined
      schedulePanelUpdate(0)
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
  const previousVisible = unfoldedItems()
  const existingLines = new Set(outlineItems.map((item) => item.line))
  const addedItems = incoming.filter((item) => !existingLines.has(item.line))

  if (mode === 'center') {
    followActive = true
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
  const retainedLines = new Set(outlineItems.map((item) => item.line))
  collapsedLines = new Set([...collapsedLines].filter((line) => retainedLines.has(line)))
  if (mode !== 'center') {
    const nextVisible = unfoldedItems()
    const nextVisibleLines = new Set(nextVisible.map((item) => item.line))
    const common = previousVisible.find((item) => nextVisibleLines.has(item.line))
    const shift = common
      ? nextVisible.findIndex((item) => item.line === common.line) - previousVisible.indexOf(common)
      : 0
    virtualScrollAdjustment = shift * virtualItemHeight
    pendingVirtualIndexShift = shift
  }
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
  if (clear) {
    clearPanelUpdate()
    outlineItems = []
    activeDocumentId = ''
    activeDocumentVersion = undefined
    lastActiveLine = 1
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
    collapsedLines.clear()
    followActive = false
  }
  await scanner?.cancel().catch(() => undefined)
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
    if ((items[middle]?.line ?? 0) <= line) low = middle + 1
    else high = middle
  }

  return low - 1
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
  activeIndex?: number,
): VirtualOutlineSlice {
  let start: number
  let end: number

  if (activeIndex !== undefined && activeIndex >= 0) {
    start = Math.max(0, activeIndex - Math.floor(initialVirtualItemCount / 2))
    end = Math.min(items.length, start + initialVirtualItemCount)
  } else if (requested?.id === 'outline') {
    start = Math.min(Math.max(0, items.length - initialVirtualItemCount), requested.fromIndex)
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
  follow = false,
): Record<string, string> {
  return {
    'data-virtual-list': 'outline',
    'data-virtual-total': String(total),
    'data-virtual-start': String(start),
    'data-virtual-end': String(end),
    'data-virtual-item-height': String(virtualItemHeight),
    'data-virtual-active': String(active),
    'data-virtual-follow-active': String(follow),
    role: 'tree',
    'aria-label': '文档大纲',
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

function hasChildren(line: number): boolean {
  const index = findHeadingIndex(outlineItems, line)
  const item = outlineItems[index]
  return item?.line === line && (outlineItems[index + 1]?.level ?? 0) > item.level
}

function unfoldedItems(): OutlineItem[] {
  let hiddenBelow: number | undefined
  return outlineItems.filter((item) => {
    if (hiddenBelow !== undefined && item.level > hiddenBelow) return false
    hiddenBelow = collapsedLines.has(item.line) ? item.level : undefined
    return true
  })
}

function revealAncestors(line: number): void {
  const ancestors: OutlineItem[] = []
  for (const item of outlineItems) {
    if (item.line >= line) break
    while (ancestors.length && ancestors[ancestors.length - 1]!.level >= item.level) ancestors.pop()
    ancestors.push(item)
  }
  for (const ancestor of ancestors) collapsedLines.delete(ancestor.line)
}

function commandButton(text: string, command: string, input?: unknown): ControlledOutput {
  return {
    type: 'element',
    tag: 'button',
    text,
    attributes: { 'aria-label': text },
    action: { command, ...(input === undefined ? {} : { input }) },
  }
}

function treeRow(item: OutlineItem, active: boolean): ControlledOutput {
  const text = item.title || `第 ${item.line} 行`
  const children = hasChildren(item.line)
  const expanded = !collapsedLines.has(item.line)
  return span(
    [
      children
        ? {
            type: 'element',
            tag: 'button',
            text: expanded ? '▾' : '▸',
            attributes: {
              class: 'plugin-tree-toggle',
              'aria-label': `${expanded ? '折叠' : '展开'} ${text}`,
              'aria-expanded': String(expanded),
            },
            action: { command: 'outline.toggleHeading', input: { line: item.line } },
          }
        : span([], 'plugin-tree-toggle'),
      {
        type: 'element',
        tag: 'button',
        text,
        attributes: {
          class: `plugin-list-item${active ? ' is-active' : ''}`,
          title: `${text}（第 ${item.line} 行）`,
          'aria-label': `跳转到 ${text}，第 ${item.line} 行`,
          'aria-current': active ? 'location' : 'false',
        },
        action: { command: 'outline.gotoHeading', input: { line: item.line } },
      },
    ],
    `plugin-tree-row plugin-list-level-${Math.max(1, Math.min(6, item.level))}${active ? ' is-active' : ''}`,
    {
      role: 'treeitem',
      'aria-level': String(item.level),
      ...(children ? { 'aria-expanded': String(expanded) } : {}),
    },
  )
}
