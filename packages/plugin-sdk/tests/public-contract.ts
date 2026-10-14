import {
  definePlugin,
  type SdkDocumentScanHeading,
  type SdkDocumentScanner,
  type SdkPluginModule,
  type SdkPluginRendererContext,
  type SdkRendererOutput,
} from '../src/index.js'

let scan: SdkDocumentScanner | undefined
const module: SdkPluginModule = definePlugin({
  activate(context) {
    scan = context.host.document?.scan({ query: { kind: 'markdownHeadings' } })
    return {
      async dispose() {
        await scan?.cancel()
      },
    }
  },
  renderers: {
    panel(context) {
      const node = context.node
      if (node?.phase === 'dispose') return ''
      const label = `${node?.documentId}:${node?.documentVersion}:${node?.viewMode}`
      return {
        type: 'element',
        tag: 'button',
        text: label,
        attributes: { role: 'treeitem', 'aria-level': '1', 'aria-expanded': 'false' },
        action: { command: 'example.toggle', input: { line: node?.viewport?.activeLine } },
      }
    },
  },
})
void module

async function headings(scanner: SdkDocumentScanner): Promise<SdkDocumentScanHeading[]> {
  const result: SdkDocumentScanHeading[] = []
  for await (const event of scanner) {
    if (event.type !== 'batch') continue
    for (const item of event.items) if (item.kind === 'heading') result.push(item)
  }
  return result
}
void headings

const dispose: SdkPluginRendererContext = { node: { phase: 'dispose', documentId: 'opaque' } }
void dispose

// @ts-expect-error Plugins cannot use arbitrary HTML tags.
const script: SdkRendererOutput = { type: 'element', tag: 'script', text: 'alert(1)' }
// @ts-expect-error Inline event attributes are not part of the public UI contract.
const handler: SdkRendererOutput = { type: 'element', tag: 'span', attributes: { onclick: 'x' } }
const style: SdkRendererOutput = {
  type: 'element',
  tag: 'span',
  // @ts-expect-error Inline styles are not a plugin UI capability.
  attributes: { style: 'color:red' },
}
void [script, handler, style]
