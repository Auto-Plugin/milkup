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

type ScanStatus = 'idle' | 'scanning' | 'done' | 'truncated' | 'failed'

const maxVisibleOutlineItems = 500
let host: ActivationContext['host'] | undefined
let outlineItems: readonly OutlineItem[] = []
let activeScanner: DocumentScanner | undefined
let activeDocumentId = ''
let scanGeneration = 0
let scanStatus: ScanStatus = 'idle'

const plugin = {
  commands: {
    'outline.gotoHeading': async (_context: unknown, input: unknown) => {
      const line = readHeadingLine(input)
      if (!host?.ui) throw new Error('大纲导航暂时不可用')
      await host.ui.revealLine(line)
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

  if (phase === 'dispose') {
    void stopOutlineScan(true)
    return ''
  }

  if (phase === 'mount' || documentId !== activeDocumentId) {
    void startOutlineScan(documentId)
  }

  const activeLine = readPositiveInteger(context.node?.viewport?.activeLine) ?? 1
  const activeIndex = findActiveHeadingIndex(outlineItems, activeLine)
  const visible = selectNearbyItems(outlineItems, activeIndex)
  const children: ControlledOutput[] = [span([strong('大纲')], 'outline-panel-title')]

  if (scanStatus === 'failed') {
    children.push(
      stateBlock('outline-error', '大纲加载失败', '暂时无法生成大纲，请重新打开文档后再试。'),
    )
  } else if (scanStatus === 'done' && outlineItems.length === 0) {
    children.push(stateBlock('outline-empty', '空大纲', '此文档中没有 Markdown 标题。'))
  } else if (outlineItems.length === 0) {
    children.push(stateBlock('outline-loading', '正在加载', '正在读取文档标题。'))
  } else {
    const list = visible.map(({ item, index }) =>
      button(item.title || `第 ${item.line} 行`, item.line, item.level, index === activeIndex),
    )
    children.push(span(list, 'outline-list'))
    if (scanStatus === 'scanning') {
      children.push(span(['正在继续扫描文档…'], 'outline-scan-progress'))
    } else if (scanStatus === 'truncated') {
      children.push(span(['文档标题过多，已达到扫描上限。'], 'outline-scan-progress'))
    }
  }

  return span(children, 'outline-panel')
}

async function startOutlineScan(documentId: string): Promise<void> {
  const generation = ++scanGeneration
  await activeScanner?.cancel().catch(() => undefined)
  outlineItems = []
  activeDocumentId = documentId
  scanStatus = 'scanning'
  activeScanner = host?.document?.scan({
    query: { kind: 'markdownHeadings' },
    windowSizeLines: 512,
    batchSize: 128,
    maxResults: 50_000,
  })

  if (!activeScanner) {
    scanStatus = 'failed'
    await requestPanelUpdate()
    return
  }

  try {
    for await (const event of activeScanner) {
      if (generation !== scanGeneration) return

      if (event.type === 'batch') {
        outlineItems = [...outlineItems, ...(event.items ?? []).map(toOutlineItem)]
        await requestPanelUpdate()
      } else if (event.type === 'done') {
        scanStatus = event.complete ? 'done' : event.reason === 'truncated' ? 'truncated' : 'idle'
        await requestPanelUpdate()

        if (event.reason === 'invalidated' && generation === scanGeneration) {
          void startOutlineScan(documentId)
        }
      }
    }
  } catch {
    if (generation !== scanGeneration) return
    scanStatus = 'failed'
    await requestPanelUpdate()
  }
}

async function stopOutlineScan(clear: boolean): Promise<void> {
  scanGeneration += 1
  const scanner = activeScanner
  activeScanner = undefined
  await scanner?.cancel().catch(() => undefined)

  if (clear) {
    outlineItems = []
    activeDocumentId = ''
    scanStatus = 'idle'
  }
}

function toOutlineItem(heading: DocumentScanHeading): OutlineItem {
  return {
    key: heading.id,
    title: heading.label.replace(/\s+/gu, ' ').trim(),
    level: heading.level,
    line: heading.line,
  }
}

function findActiveHeadingIndex(items: readonly OutlineItem[], activeLine: number): number {
  let low = 0
  let high = items.length

  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if ((items[middle]?.line ?? 0) <= activeLine) low = middle + 1
    else high = middle
  }

  return low - 1
}

function selectNearbyItems(
  items: readonly OutlineItem[],
  activeIndex: number,
): readonly { item: OutlineItem; index: number }[] {
  if (items.length <= maxVisibleOutlineItems) {
    return items.map((item, index) => ({ item, index }))
  }

  const anchor = Math.max(0, activeIndex)
  const start = Math.min(
    items.length - maxVisibleOutlineItems,
    Math.max(0, anchor - Math.floor(maxVisibleOutlineItems / 2)),
  )
  return items
    .slice(start, start + maxVisibleOutlineItems)
    .map((item, offset) => ({ item, index: start + offset }))
}

function stateBlock(className: string, title: string, message: string): ControlledOutput {
  return span(
    [span([''], `${className}-icon`), strong(title), span([message], `${className}-message`)],
    `outline-state ${className}`,
  )
}

function requestPanelUpdate(): Promise<void> {
  return host?.ui?.requestUpdate('outline-panel') ?? Promise.resolve()
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

function span(children: readonly ControlledOutput[], className?: string): ControlledOutput {
  return {
    type: 'element',
    tag: 'span',
    children,
    ...(className ? { attributes: { class: className } } : {}),
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
      class: `outline-item outline-level-${Math.max(1, Math.min(6, level))}${active ? ' is-active' : ''}`,
      title: `${text}（第 ${line} 行）`,
      'aria-label': `跳转到 ${text}，第 ${line} 行`,
    },
    action: { command: 'outline.gotoHeading', input: { line } },
  }
}
