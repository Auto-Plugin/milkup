import { createFrontendMermaidOwner } from '../../apps/desktop/src/frontend-mermaid-service'
import {
  acquireDocumentPngImage,
  disposeDocumentPngImages,
  documentPngResourceStats,
} from '../../packages/core/src/document-png-image'
let owner = createFrontendMermaidOwner()
const requests = new Map<string, { controller: AbortController; result: Promise<unknown> }>()
Object.assign(window, {
  frontendMermaidFixture: {
    async prepare() {
      await owner.prepare!()
      return documentPngResourceStats()
    },
    async render(
      body: string,
      theme = 'light',
      settings: { signal?: AbortSignal; deadline?: number } = {},
    ) {
      const source = '```mermaid\n' + body + '\n```\n'
      const result = await owner.render(
        {
          documentId: 'frontend-browser-fixture',
          version: 1,
          source,
          from: 0,
          to: source.length,
          fromLine: 1,
          toLine: source.split('\n').length,
          completeStart: true,
          completeEnd: true,
          contextKnown: true,
          protectedRanges: [{ from: 0, to: source.length }],
          blocks: [
            {
              kind: 'fence',
              from: 0,
              to: source.length,
              complete: true,
              info: 'mermaid',
              contentRanges: [{ from: 11, to: source.lastIndexOf('```') }],
            },
          ],
          selection: { anchor: source.length, head: source.length },
          theme,
          target: 'screen',
          width: 640,
        },
        settings,
      )
      const content = result.fragments[0].content
      const lease = acquireDocumentPngImage(content)
      try {
        const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', lease.bytes)))
          .map((x) => x.toString(16).padStart(2, '0'))
          .join('')
        return {
          width: content.width,
          height: content.height,
          bytes: lease.bytes.length,
          sha256: hash,
        }
      } finally {
        lease.dispose()
        disposeDocumentPngImages(result)
      }
    },
    start(id: string, body: string, timeoutMs = 10000) {
      const controller = new AbortController()
      const result = this.render(body, 'light', {
        signal: controller.signal,
        deadline: performance.now() + timeoutMs,
      }).then(
        (value) => ({ status: 'ready', value }),
        (error) => ({ status: 'rejected', code: error.code ?? null, message: String(error) }),
      )
      requests.set(id, { controller, result })
    },
    cancel(id: string) {
      requests.get(id)!.controller.abort()
    },
    result(id: string) {
      return requests.get(id)!.result
    },
    async reset() {
      await owner.retire()
      owner = createFrontendMermaidOwner()
      return documentPngResourceStats()
    },
    async close() {
      await owner.retire()
      return {
        resources: documentPngResourceStats(),
        frames: document.querySelectorAll('iframe[data-milkup-mermaid-renderer]').length,
      }
    },
  },
})
