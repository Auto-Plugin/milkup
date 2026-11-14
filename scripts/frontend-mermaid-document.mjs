import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const directory = new URL('../apps/desktop/src/frontend-mermaid/', import.meta.url)
export function fixedFrameDocument(source) {
  if (/<\/script/i.test(source)) throw new Error('Fixed bootstrap contains a script terminator')
  const bootstrap = createHash('sha256').update(source).digest('base64')
  const engine = 'qKam+AWwdKgmGiglyG+ZyAVKyzs19Qu34kpPnyw8O58='
  const policy = `default-src 'none'; script-src 'sha256-${bootstrap}' 'sha256-${engine}'; script-src-attr 'none'; style-src 'unsafe-inline'; img-src blob: data:; font-src 'none'; connect-src 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`
  return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${policy}"><style>html,body{margin:0}#target{display:flow-root}</style></head><body><div id="target"></div><script>${source}</script></body></html>\n`
}
export function verifyFixedFrameDocument() {
  const expected = fixedFrameDocument(readFileSync(new URL('frame.js', directory), 'utf8'))
  if (readFileSync(new URL('frame.html', directory), 'utf8') !== expected)
    throw new Error(
      'Fixed Mermaid document is stale; regenerate with scripts/frontend-mermaid-document.mjs',
    )
  return expected
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--write'))
    writeFileSync(
      new URL('frame.html', directory),
      fixedFrameDocument(readFileSync(new URL('frame.js', directory), 'utf8')),
    )
  else verifyFixedFrameDocument()
}
