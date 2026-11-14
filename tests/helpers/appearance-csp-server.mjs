// Opt-in static production server reproducing locked Tauri's style nonce and
// inline script hash policy. It does not transform application JavaScript.
import { createServer } from 'node:http'
import { createHash, randomBytes } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { resolve, extname, sep } from 'node:path'

const root = resolve(process.env.MILKUP_APPEARANCE_CSP_DIST ?? 'apps/desktop/dist')
const port = Number(process.env.MILKUP_APPEARANCE_CSP_PORT ?? '1453')
await stat(resolve(root, 'index.html'))
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.wasm': 'application/wasm',
}
const server = createServer(async (request, response) => {
  try {
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(405).end()
      return
    }
    const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname)
    const file = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`)
    if (!file.startsWith(root + sep)) {
      response.writeHead(403).end()
      return
    }
    let body = await readFile(file)
    const headers = {
      'Content-Type': types[extname(file)] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    }
    if (extname(file) === '.html') {
      const nonces = []
      let html = body.toString('utf8').replace(/<style\b([^>]*)>/gi, (tag, attrs) => {
        if (/\bnonce\s*=/i.test(attrs)) return tag
        const nonce = randomBytes(8).readBigUInt64LE().toString()
        nonces.push(`'nonce-${nonce}'`)
        return `<style${attrs} nonce="${nonce}">`
      })
      const hashes = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)]
        .filter(([, attrs]) => !/\bsrc\s*=/i.test(attrs))
        .map(
          ([, , source]) =>
            `'sha256-${createHash('sha256').update(source.replace(/\r\n?/g, '\n')).digest('base64')}'`,
        )
      headers['Content-Security-Policy'] =
        `script-src 'self' blob: ${hashes.join(' ')}; style-src 'self' ${nonces.join(' ')}`
      body = Buffer.from(html)
    }
    response.writeHead(200, headers)
    response.end(request.method === 'HEAD' ? undefined : body)
  } catch (error) {
    response.writeHead(error.code === 'ENOENT' ? 404 : 500).end()
  }
})
server.listen(port, '127.0.0.1', () => {
  console.log(JSON.stringify({ root, url: `http://127.0.0.1:${port}`, productionCsp: true }))
})
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close())
