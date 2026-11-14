// Explicit test-only Vite server for normal CLI + XTest runs. It only observes;
// there is no action, evaluation, input, or filesystem API exposed to clients.
import { createServer } from 'vite'
import { appendFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
const output = process.env.MILKUP_NATIVE_EVIDENCE_DIR
if (!output) throw Error('Set a dedicated MILKUP_NATIVE_EVIDENCE_DIR')
mkdirSync(output, { recursive: true })
let latest = null
const events = []
const route = '/__milkup_native_observation'
const observer = `
if (import.meta.env.DEV) {
  let observerEvents = [], observerSending = false;
  const rect = e => e ? {x:e.getBoundingClientRect().x,y:e.getBoundingClientRect().y,width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height} : undefined;
  const observe = (detailed=true) => ({
    at: performance.now(), wall: Date.now(), path: session.file?.path,
    backend: largeDocumentPreview ? "native" : sourceView ? "memory-window" : "editor",
    dirty: session.dirty, version: session.documentVersion, savedVersion: session.savedVersion,
    saving: isDocumentSaving(), loading: loadingState.phase, mode: session.viewMode,
    selection: {anchor:(sourceView?.selection ?? state.selection).main.anchor, head:(sourceView?.selection ?? state.selection).main.head},
    pending: sourceView?.activeVisibleEditTasks.size ?? 0,
    sourceVersion:sourceView?.source.version, sourceLines:sourceView?.renderedSourceWindow?.lines.slice(0,3).map(l=>({...l,text:l.text.slice(0,90)})),
    editable: !(sourceView?.inputDOM ?? view?.inputDOM)?.readOnly,
    cursor: document.querySelector('.milkup-cursor')?.getAttribute('data-position'),
    lines: Array.from(document.querySelectorAll('.milkup-line')).slice(0,3).map(e=>e.textContent?.slice(0,100)),
    renderedLines: document.querySelectorAll('.milkup-line').length,
    fromLine: document.querySelector('.milkup-editor-content')?.getAttribute('data-from-line'),
    scrollTop: sourceView?.dom.scrollTop, notice,
    ...(detailed ? {
      viewport:rect(sourceView?.dom),scrollHeight:sourceView?.dom.scrollHeight,
      lineCount:sourceView?.source.lineCount,toLine:document.querySelector('.milkup-editor-content')?.getAttribute('data-to-line'),
      lineRects:Array.from(document.querySelectorAll('.milkup-line')).map(e=>({number:Number(e.dataset.line),from:Number(e.dataset.from),to:Number(e.dataset.to),text:e.textContent?.slice(0,80),...rect(e)})),
      cursorRect:rect(document.querySelector('.milkup-cursor')),
      search:searchResultState,
      searchCount:document.querySelector('[data-search-result-count]')?.textContent,
      searchMessage:document.querySelector('[data-search-message]')?.textContent
    } : {}),
    focused: document.activeElement?.className
  });
  for (const type of ['keydown','input','compositionstart','compositionupdate','compositionend','pointerdown','pointerup'])
    globalThis.addEventListener(type, event => observerEvents.push({type, key:event.key, data:event.data, clientX:event.clientX, clientY:event.clientY, targetClass:event.target?.className, ctrl:event.ctrlKey, shift:event.shiftKey, trusted:event.isTrusted, ...observe(false)}), true);
  setInterval(async () => {
    if(observerSending) return;
    observerSending = true;
    const captured = observerEvents; observerEvents=[];
    try { await fetch('${route}',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({state:observe(),events:captured})}); }
    finally { observerSending=false; }
  },40);
}
`
const server = await createServer({
  configFile: path.resolve('apps/desktop/vite.config.ts'),
  root: path.resolve('apps/desktop'),
  plugins: [
    {
      name: 'native-read-only-observer',
      apply: 'serve',
      transform(code, id) {
        if (id.split('?')[0] === path.resolve('apps/desktop/src/main.ts')) return code + observer
      },
      configureServer(server) {
        server.middlewares.use(route, (request, response) => {
          if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress)) {
            response.writeHead(403).end()
            return
          }
          if (request.method === 'GET') {
            response.setHeader('content-type', 'application/json')
            response.end(JSON.stringify({ state: latest, events: events.slice(-100) }))
            return
          }
          if (request.method !== 'POST') {
            response.writeHead(405).end()
            return
          }
          let body = ''
          request.on('data', (chunk) => {
            body += chunk
            if (body.length > 65536) request.destroy()
          })
          request.on('end', () => {
            try {
              const data = JSON.parse(body)
              latest = data.state
              events.push(...data.events)
              if (events.length > 100) events.splice(0, events.length - 100)
              if (data.events.length)
                appendFileSync(
                  path.join(output, 'native-events.ndjson'),
                  JSON.stringify(data) + '\n',
                )
              response.end('ok')
            } catch {
              response.writeHead(400).end()
            }
          })
        })
      },
    },
  ],
})
await server.listen()
console.log('Read-only native observer listening on 127.0.0.1:1420')
for (const signal of ['SIGTERM', 'SIGINT'])
  process.on(signal, async () => {
    await server.close()
    process.exit(0)
  })
