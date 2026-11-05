import assert from 'node:assert/strict'
import { test } from 'node:test'
import { build } from 'vite'
import { chromium } from '@playwright/test'
import { createServer } from 'node:http'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { syntaxCases } from '../windows/mermaid-product-e2e.mjs'
const root = fileURLToPath(new URL('../../', import.meta.url))
test(
  'packaged frontend owner loads its fixed scripts and renders without a native renderer',
  { timeout: 120000 },
  async (t) => {
    const output = await mkdtemp(join(tmpdir(), 'milkup-frontend-browser-'))
    let browser, server
    try {
      await build({
        configFile: join(root, 'apps/desktop/vite.config.ts'),
        root: join(root, 'apps/desktop'),
        logLevel: 'error',
        build: {
          outDir: output,
          emptyOutDir: true,
          rollupOptions: {
            input: join(root, 'tests/browser/frontend-mermaid-fixture.ts'),
            output: { entryFileNames: 'fixture.js' },
          },
        },
      })
      server = createServer(async (req, res) => {
        const pathname = new URL(req.url, 'http://localhost').pathname
        if (pathname === '/') {
          res.writeHead(200, {
            'Content-Type': 'text/html',
            'Content-Security-Policy': "script-src 'self' blob:; object-src 'none'",
          })
          res.end(
            '<!doctype html><html><body><script type="module" src="/fixture.js"></script></body></html>',
          )
          return
        }
        const file = resolve(output, '.' + pathname)
        if (!file.startsWith(output + '/')) {
          res.writeHead(404)
          res.end()
          return
        }
        try {
          res.writeHead(200, {
            'Content-Type':
              extname(file) === '.js' ? 'application/javascript' : 'application/octet-stream',
          })
          res.end(await readFile(file))
        } catch {
          res.writeHead(404)
          res.end()
        }
      })
      await new Promise((r) => server.listen(0, '127.0.0.1', r))
      const origin = `http://127.0.0.1:${server.address().port}`
      browser = await chromium.launch({
        executablePath: process.env.MILKUP_TEST_CHROMIUM || '/usr/bin/chromium',
        headless: true,
        args: ['--no-sandbox'],
      })
      const page = await browser.newPage()
      const external = []
      page.on('console', (m) => {
        if (m.type() === 'error') console.log('browser error:', m.text().slice(0, 500))
      })
      page.on('pageerror', (e) => console.log('page error:', e.message.slice(0, 500)))
      await page.route('**/*', (route) => {
        const url = route.request().url()
        if (!url.startsWith(origin + '/') && !url.startsWith('blob:') && !url.startsWith('data:')) {
          external.push(url)
          return route.abort()
        }
        return route.continue()
      })
      await page.goto(origin)
      await page.waitForFunction(() => !!window.frontendMermaidFixture)
      const render = (source) =>
        page.evaluate((source) => window.frontendMermaidFixture.render(source), source)
      await t.test('ordinary and twelve official syntax fixtures', async (st) => {
        for (const item of [
          { id: 'flow', source: 'flowchart LR\nA[Hello] --> B[World]' },
          ...syntaxCases,
        ]) {
          await st.test(item.id, async () => {
            try {
              const result = await render(item.source)
              assert.ok(result.bytes > 100, item.id)
              assert.ok(result.width > 0 && result.height > 0, item.id)
              console.log(JSON.stringify({ case: item.id, ...result }))
            } catch (error) {
              console.log(
                'config',
                item.id,
                await page
                  .frames()
                  .find((f) => f !== page.mainFrame())
                  .evaluate(() => ({ journey: mermaid.mermaidAPI.getConfig().journey })),
              )
              throw error
            }
          })
        }
      })
      await t.test('opaque script-only frame and source/result message forgery', async () => {
        const element = page.locator('iframe[data-milkup-mermaid-renderer]')
        assert.equal(await element.getAttribute('sandbox'), 'allow-scripts')
        const child = page.frames().find((f) => f !== page.mainFrame())
        const boundary = await child.evaluate(() => {
          let parentReadable = false
          try {
            void parent.document.body
            parentReadable = true
          } catch {}
          return {
            parentReadable,
            internals: '__TAURI_INTERNALS__' in window,
            ipc: 'ipc' in window,
          }
        })
        assert.deepEqual(boundary, { parentReadable: false, internals: false, ipc: false })
        await page.evaluate(() => {
          const frame = document.querySelector('iframe[data-milkup-mermaid-renderer]')
          const nonce = frame.name.slice('milkup-mermaid-'.length)
          window.postMessage({ kind: 'milkup-mermaid-ready', nonce }, '*')
          window.postMessage({ kind: 'result', nonce, bytes: new ArrayBuffer(0) }, '*')
          frame.contentWindow.postMessage(
            {
              kind: 'render',
              nonce,
              requestId: 'f'.repeat(32),
              source: 'invalid forged window request',
              width: 640,
            },
            '*',
          )
        })
        assert.ok((await render('flowchart TD\nA-->B')).bytes > 100)
      })
      await t.test(
        'malicious labels/config cannot execute or fetch and errors recover',
        async () => {
          await render(
            'flowchart LR\nA["<img src=https://invalid.example/probe onerror=alert(1)>"] --> B',
          )
          await render(
            '%%{init: {"securityLevel":"loose","htmlLabels":true}}%%\nflowchart LR\nA-->B\nclick A "https://invalid.example/probe"',
          )
          await assert.rejects(render('this is not a diagram'))
          assert.ok((await render('sequenceDiagram\nA->>B: Recovered')).bytes > 100)
          assert.deepEqual(external, [])
        },
      )
      await t.test(
        'queued cancellation and deadline do not interrupt the active renderer or publish stale output',
        async () => {
          const child = page.frames().find((f) => f !== page.mainFrame())
          await child.evaluate(() => {
            const original = mermaid.render
            window.testRenderCalls = 0
            mermaid.render = async (...args) => {
              window.testRenderCalls++
              if (window.testRenderCalls === 1)
                await new Promise((resolve) => (window.releaseTestRender = resolve))
              return original(...args)
            }
          })
          const start = (id, timeout = 10000) =>
            page.evaluate(
              ({ id, timeout }) =>
                window.frontendMermaidFixture.start(id, 'flowchart LR\nA-->B', timeout),
              { id, timeout },
            )
          await start('active')
          await child.waitForFunction(() => window.testRenderCalls === 1)
          await start('cancelled')
          await page.evaluate(() => window.frontendMermaidFixture.cancel('cancelled'))
          assert.equal(
            (await page.evaluate(() => window.frontendMermaidFixture.result('cancelled'))).code,
            'aborted',
          )
          await start('expired', 50)
          assert.equal(
            (await page.evaluate(() => window.frontendMermaidFixture.result('expired'))).code,
            'timeout',
          )
          await page.evaluate(() => window.frontendMermaidFixture.cancel('active'))
          assert.equal(
            (await page.evaluate(() => window.frontendMermaidFixture.result('active'))).code,
            'aborted',
          )
          await start('latest')
          await child.evaluate(() => window.releaseTestRender())
          assert.equal(
            (await page.evaluate(() => window.frontendMermaidFixture.result('latest'))).status,
            'ready',
          )
          assert.equal(await child.evaluate(() => window.testRenderCalls), 2)
        },
      )
      await t.test(
        'bounded admission and repeated retirement revoke all queued results',
        async () => {
          const child = page.frames().find((f) => f !== page.mainFrame())
          await child.evaluate(() => {
            mermaid.render = () => new Promise(() => {})
          })
          await page.evaluate(() => {
            for (let i = 0; i < 10; i++)
              window.frontendMermaidFixture.start('bound' + i, 'flowchart LR\nA-->B')
          })
          const overflow = await page.evaluate(() => window.frontendMermaidFixture.result('bound9'))
          assert.equal(overflow.status, 'rejected')
          assert.match(overflow.message, /budget/)
          await page.evaluate(() =>
            Promise.all([
              window.frontendMermaidFixture.close(),
              window.frontendMermaidFixture.close(),
            ]),
          )
          for (let i = 0; i < 9; i++)
            assert.equal(
              (await page.evaluate((i) => window.frontendMermaidFixture.result('bound' + i), i))
                .status,
              'rejected',
            )
        },
      )
      const cleanup = await page.evaluate(() => window.frontendMermaidFixture.close())
      assert.deepEqual(cleanup, { frames: 0, resources: { bytes: 0, images: 0, decodedOwners: 0 } })
    } finally {
      await browser?.close()
      if (server) await new Promise((r) => server.close(r))
      await rm(output, { recursive: true, force: true })
    }
  },
)
