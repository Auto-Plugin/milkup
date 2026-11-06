import { EditorState, MemoryTextDocument, Selection } from '../../packages/core/src/index'
import { EditorView } from '../../packages/view-dom/src/index'
import { createFrontendMermaidOwner } from '../../apps/desktop/src/frontend-mermaid-service'
import {
  acquireDocumentPngImage,
  createDocumentPngImage,
  disposeDocumentPngImages,
  documentPngResourceStats,
} from '../../packages/core/src/document-png-image'
let owner = createFrontendMermaidOwner()
const requests = new Map<string, { controller: AbortController; result: Promise<unknown> }>()
Object.assign(window, {
  frontendMermaidFixture: {
    async cursorScroll() {
      const firstLine = 'diagram source',
        text = firstLine + '\nuntouched tail'
      const canvas = document.createElement('canvas')
      canvas.width = 2100
      canvas.height = 126
      canvas.getContext('2d')!.fillRect(0, 0, 2100, 126)
      const blob = await new Promise<Blob>((resolve) => canvas.toBlob((value) => resolve(value!)))
      const bytes = new Uint8Array(await blob.arrayBuffer())
      const parent = document.createElement('main')
      parent.style.cssText = 'position:fixed;inset:20px;width:600px;height:600px;background:white'
      document.body.append(parent)
      let calls = 0
      const view = new EditorView({
        parent,
        mode: 'live',
        state: new EditorState({
          doc: new MemoryTextDocument(text),
          selection: Selection.cursor(text.length),
        }),
        documentPresentation: {
          selectionIndependent: () => true,
          provide: ({
            sourceIdentity,
            sourceVersion,
            documentVersion,
            visibleFrom,
            visibleTo,
            ...window
          }) => {
            calls++
            return {
              declarations: [{ id: 'host-image', contexts: ['text'] }],
              request: {
                ...window,
                documentId: 'image-test',
                version: documentVersion ?? 0,
                contextKnown: true,
                protectedRanges: [],
                blocks: [],
                theme: 'light',
                target: 'screen',
              },
              result: {
                complete: true,
                fragments: [
                  {
                    from: 0,
                    to: firstLine.length,
                    layout: 'block',
                    accessibleText: 'image',
                    content: createDocumentPngImage({
                      bytes,
                      width: 2100,
                      height: 126,
                      title: 'image',
                      release() {},
                    }),
                  },
                ],
              },
            }
          },
        },
      })
      view.dom.style.cssText = 'width:600px;height:600px;overflow:auto'
      const settle = () => new Promise((resolve) => setTimeout(resolve, 100))
      try {
        for (let i = 0; i < 30 && !view.contentDOM.querySelector('img')?.complete; i++)
          await settle()
        const image = view.contentDOM.querySelector('img')!
        const viewport = image.parentElement!,
          outer = viewport.parentElement!
        document.querySelector<HTMLButtonElement>('[data-document-png-scale]')!.click()
        await settle()
        viewport.scrollLeft = 640
        const rows = [
          {
            offset: text.length,
            left: viewport.scrollLeft,
            connected: image.isConnected,
            mode: outer.dataset.documentPngView,
            calls,
            same: true,
          },
        ]
        view.inputDOM.focus()
        for (const offset of [text.length - 1, 2, 3, text.length]) {
          view.updateState(view.state.applyTransaction({ selection: Selection.cursor(offset) }))
          await settle()
          rows.push({
            offset,
            left: viewport.scrollLeft,
            connected: image.isConnected,
            mode: outer.dataset.documentPngView,
            calls,
            same: view.contentDOM.querySelector('img') === image,
          })
        }
        return rows
      } finally {
        view.destroy()
        parent.remove()
      }
    },
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
