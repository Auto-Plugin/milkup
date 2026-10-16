import mermaid from 'mermaid'
import type {
  SdkDocumentRenderer,
  SdkDocumentPresentationFragment,
  SdkDocumentPresentationResult,
} from '@milkup/plugin-sdk'
import { convertSvgElement, ConversionError } from './svg-converter'

// Preparation waits for installed fonts but never parses a document. The
// independent native host owns activation and execution deadlines.
export async function prepareRenderer(): Promise<void> {
  await document.fonts.ready
}

const messages = {
  'unsupported-animation': '动态图表暂不支持，已保留完整 Markdown 源码。',
  'unsafe-output': '图表包含不支持的链接或外部内容，已保留完整 Markdown 源码。',
  'unsupported-feature': '图表包含暂不支持的呈现效果，已保留完整 Markdown 源码。',
  'limit-exceeded': '图表超过解析或呈现预算，已保留完整 Markdown 源码。',
  'font-unavailable': '图表所需的本地字体不可用，已保留完整 Markdown 源码。',
  'invalid-output': '图表无法完整呈现，请检查语法；已保留完整 Markdown 源码。',
} as const
const encoder = new TextEncoder()
let sequence = 0
let rendering = false

function cancelled(signal: AbortSignal): void {
  if (signal.aborted) throw new Error('Diagram rendering cancelled')
}

function errorFragment(
  from: number,
  to: number,
  source: string,
  message: string,
): SdkDocumentPresentationFragment {
  return {
    from,
    to,
    layout: 'block',
    status: 'error',
    message,
    accessibleText: message,
    content: { type: 'code', children: [{ type: 'text', text: source }] },
  }
}

/** Only complete host-supplied fences can replace source. All DOM lives in the
 * isolated native plugin process; only closed typed image data crosses back. */
export const renderDocuments: SdkDocumentRenderer = async (request, { signal }) => {
  cancelled(signal)
  if (!request.contextKnown) return { fragments: [], complete: false }
  if (rendering) throw new Error('Diagram renderer is already executing')
  if (
    request.source.length > 65_536 ||
    request.source.split('\n').length > 256 ||
    !Number.isFinite(request.width) ||
    request.width <= 0 ||
    request.width > 8192
  )
    return { fragments: [], complete: false }
  rendering = true
  const fragments: SdkDocumentPresentationFragment[] = []
  let container: HTMLDivElement | undefined
  try {
    for (const block of request.blocks) {
      cancelled(signal)
      if (
        block.kind !== 'fence' ||
        !block.complete ||
        block.info?.trim().split(/\s/u)[0] !== 'mermaid' ||
        !Number.isSafeInteger(block.from) ||
        !Number.isSafeInteger(block.to) ||
        block.from < request.from ||
        block.to > request.to ||
        block.to <= block.from ||
        block.contentRanges.length !== 1
      )
        continue
      const body = block.contentRanges[0]!
      if (
        !Number.isSafeInteger(body.from) ||
        !Number.isSafeInteger(body.to) ||
        body.from < block.from ||
        body.to > block.to ||
        body.to < body.from
      )
        continue
      const source = request.source.slice(block.from - request.from, block.to - request.from)
      const input = request.source.slice(body.from - request.from, body.to - request.from)
      let fragment: SdkDocumentPresentationFragment
      try {
        if (block.info.trim() !== 'mermaid') {
          fragment = errorFragment(
            block.from,
            block.to,
            source,
            '图表围栏参数暂不支持，已保留完整 Markdown 源码。',
          )
        } else if (input.length > 50_000) {
          fragment = errorFragment(block.from, block.to, source, messages['limit-exceeded'])
        } else {
          container = document.createElement('div')
          container.style.width = `${request.width}px`
          document.body.append(container)
          // Keep the audited baseline appearance, including ordinary shadows.
          // Theme is supplied by the host, not by document directives.
          mermaid.initialize({
            startOnLoad: false,
            securityLevel: 'strict',
            htmlLabels: false,
            suppressErrorRendering: true,
            maxTextSize: 50_000,
            maxEdges: 500,
            deterministicIds: true,
            deterministicIDSeed: 'milkup-offline',
            arrowMarkerAbsolute: false,
            fontFamily: 'Arial, sans-serif',
            legacyMathML: false,
            forceLegacyMathML: false,
            theme: request.theme === 'dark' ? 'dark' : 'default',
            darkMode: request.theme === 'dark',
            secure: [
              'secure',
              'securityLevel',
              'startOnLoad',
              'maxTextSize',
              'maxEdges',
              'suppressErrorRendering',
              'htmlLabels',
              'fontFamily',
              'themeCSS',
              'legacyMathML',
              'forceLegacyMathML',
              'look',
              'textPlacement',
              'theme',
              'darkMode',
              'dompurifyConfig',
              'arrowMarkerAbsolute',
              'deterministicIds',
              'deterministicIDSeed',
            ],
          })
          sequence = (sequence + 1) % 0x1_0000_0000
          const rendered = await mermaid.render(`milkup_graph_${sequence}`, input, container)
          cancelled(signal)
          // Markup is inspected only inside the isolated helper. It never
          // becomes editor markup, and bindFunctions is never invoked.
          container.innerHTML = rendered.svg
          const root = container.querySelector('svg')
          if (!(root instanceof SVGSVGElement)) throw new Error('Missing diagram root')
          const content = convertSvgElement(root)
          cancelled(signal)
          fragment = {
            from: block.from,
            to: block.to,
            layout: 'block',
            status: 'ready',
            content,
            accessibleText:
              content.description ??
              content.title ??
              'Mermaid 图表；进入围栏可编辑完整 Markdown 源码。',
          }
        }
      } catch (error) {
        cancelled(signal)
        const message =
          error instanceof ConversionError ? messages[error.code] : messages['invalid-output']
        fragment = errorFragment(block.from, block.to, source, message)
      } finally {
        container?.remove()
        container = undefined
      }
      // Budget the full result envelope including fallback text. The host
      // independently checks canonical bytes, expanded shared node costs and
      // raster work; converter diagnostics never authorize output.
      const next: SdkDocumentPresentationResult = {
        fragments: [...fragments, fragment],
        complete: true,
      }
      if (next.fragments.length > 128 || encoder.encode(JSON.stringify(next)).length > 262_144)
        return { fragments, complete: false }
      fragments.push(fragment)
    }
    return { fragments, complete: true }
  } finally {
    container?.remove()
    rendering = false
  }
}
