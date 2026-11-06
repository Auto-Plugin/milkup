import assert from 'node:assert/strict'
import { test } from 'node:test'
import { build } from 'vite'
import { chromium } from '@playwright/test'
import { createServer } from 'node:http'
import { readFile, readdir, mkdtemp, rm } from 'node:fs/promises'
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
    let browser, server, documentServer
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
      // Model the production dedicated local protocol with a distinct origin.
      // The exact built HTML bytes still execute, with the real opaque sandbox.
      documentServer = createServer(async (req, res) => {
        const pathname = new URL(req.url, 'http://localhost').pathname
        if (!/^\/assets\/frame-[A-Za-z0-9_-]+\.html$/.test(pathname)) {
          res.writeHead(404)
          res.end()
          return
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(await readFile(resolve(output, '.' + pathname)))
      })
      await new Promise((r) => documentServer.listen(0, '127.0.0.1', r))
      const documentOrigin = `http://127.0.0.1:${documentServer.address().port}`
      server = createServer(async (req, res) => {
        const pathname = new URL(req.url, 'http://localhost').pathname
        if (pathname === '/') {
          res.writeHead(200, {
            'Content-Type': 'text/html',
            'Content-Security-Policy':
              "script-src 'self' blob:; style-src 'self' 'nonce-test'; object-src 'none'",
          })
          res.end(
            '<!doctype html><html><body><script type="module" src="/fixture.js"></script></body></html>',
          )
          return
        }
        if (/^\/assets\/frame-[A-Za-z0-9_-]+\.html$/.test(pathname)) {
          res.writeHead(302, { Location: documentOrigin + pathname })
          res.end()
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
              extname(file) === '.js'
                ? 'application/javascript'
                : extname(file) === '.html'
                  ? 'text/html; charset=utf-8'
                  : 'application/octet-stream',
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
      const cspErrors = []
      let tamperEngine = false
      let forbidChildAssetRequests = false
      let childAssetRequests = 0
      page.on('console', (m) => {
        if (m.type() === 'error') {
          if (/content security policy/i.test(m.text())) cspErrors.push(m.text().slice(0, 500))
          console.log('browser error:', m.text().slice(0, 500))
        }
      })
      page.on('pageerror', (e) => console.log('page error:', e.message.slice(0, 500)))
      await page.route('**/*', async (route) => {
        const url = route.request().url()
        if (url.startsWith(origin + '/assets/') && url.endsWith('.js')) {
          if (
            url.includes('/mermaid-12.2.0.min-') &&
            route.request().frame() !== page.mainFrame()
          ) {
            childAssetRequests++
            if (forbidChildAssetRequests) return route.abort()
          }
          if (tamperEngine && url.includes('/mermaid-12.2.0.min-')) {
            const response = await route.fetch()
            const body = Buffer.from(await response.body())
            body[0] ^= 1
            return route.fulfill({ response, body })
          }
        }
        const fixedDocument =
          url.startsWith(documentOrigin + '/assets/frame-') &&
          new URL(url).pathname.endsWith('.html')
        if (
          !fixedDocument &&
          !url.startsWith(origin + '/') &&
          !url.startsWith('blob:') &&
          !url.startsWith('data:')
        ) {
          external.push(url)
          return route.abort()
        }
        return route.continue()
      })
      await page.goto(origin)
      await page.waitForFunction(() => !!window.frontendMermaidFixture)
      const render = (source) =>
        page.evaluate((source) => window.frontendMermaidFixture.render(source), source)
      await t.test(
        'fixed engine tampering is rejected before frame creation; child engine protocol loads are unnecessary',
        async () => {
          tamperEngine = true
          await assert.rejects(render('flowchart LR\nA-->B'), /Fixed script bytes differ/)
          assert.equal(await page.locator('iframe[data-milkup-mermaid-renderer]').count(), 0)
          tamperEngine = false
          await page.evaluate(() => window.frontendMermaidFixture.reset())
          await page.evaluate(() => {
            const send = MessagePort.prototype.postMessage
            MessagePort.prototype.postMessage = function (data, transfer) {
              if (data?.kind === 'initialize-engine') {
                MessagePort.prototype.postMessage = send
                new Uint8Array(data.bytes)[0] ^= 1
              }
              return send.call(this, data, transfer)
            }
          })
          await assert.rejects(
            render('flowchart LR\nA-->B'),
            /Pinned Mermaid engine did not initialize/,
          )
          assert.equal(await page.locator('iframe[data-milkup-mermaid-renderer]').count(), 0)
          await page.evaluate(() => window.frontendMermaidFixture.reset())
          forbidChildAssetRequests = true
          assert.ok((await render('flowchart LR\nA-->B')).bytes > 100)
          const child = page.frames().find((f) => f !== page.mainFrame())
          assert.equal(await child.evaluate(() => typeof globalThis.mermaid?.render), 'function')
          assert.equal(childAssetRequests, 0)
          forbidChildAssetRequests = false
        },
      )
      await t.test(
        'fixed-engine preparation creates no PNG and the first render reuses its frame',
        async () => {
          await page.evaluate(() => window.frontendMermaidFixture.reset())
          assert.deepEqual(await page.evaluate(() => window.frontendMermaidFixture.prepare()), {
            bytes: 0,
            images: 0,
            decodedOwners: 0,
          })
          assert.equal(await page.locator('iframe[data-milkup-mermaid-renderer]').count(), 1)
          const preparedFrame = page.frames().find((frame) => frame !== page.mainFrame())
          assert.ok((await render('flowchart LR\nA[Prepared]-->B[Ready]')).bytes > 100)
          assert.equal(
            page.frames().find((frame) => frame !== page.mainFrame()),
            preparedFrame,
          )
          await page.evaluate(() => window.frontendMermaidFixture.reset())
          assert.equal(await page.locator('iframe[data-milkup-mermaid-renderer]').count(), 0)
        },
      )
      await t.test(
        'native DOM detachment retains natural scroll and the decoded owner across caret movement',
        async () => {
          const rows = await page.evaluate(() => window.frontendMermaidFixture.cursorScroll())
          assert.equal(rows.length, 5)
          assert(rows.every((row) => row.calls === 1 && row.mode === 'natural'))
          assert(rows.filter((row) => row.connected).every((row) => row.left === 640 && row.same))
          assert.equal(rows.filter((row) => !row.connected).length, 2)
        },
      )
      await t.test(
        'selection-dependent refresh also preserves the native PNG owner and scrolling',
        async () => {
          const rows = await page.evaluate(() => window.frontendMermaidFixture.cursorScroll(true))
          assert(rows.at(-1).calls > rows[0].calls)
          assert(rows.every((row) => row.mode === 'natural'))
          assert(rows.filter((row) => row.connected).every((row) => row.left === 640 && row.same))
          assert.equal(rows.filter((row) => !row.connected).length, 2)
        },
      )
      await t.test('ordinary and twelve official syntax fixtures', async (st) => {
        cspErrors.length = 0
        for (const item of [
          { id: 'flow', source: 'flowchart LR\nA[Hello] --> B[World]' },
          ...syntaxCases,
        ]) {
          await st.test(item.id, async () => {
            try {
              const result = await render(item.source)
              assert.deepEqual(cspErrors, [], 'Fixed document styles and scripts must satisfy CSP')
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
      if (process.env.MILKUP_FRONTEND_CORPUS === '1') {
        await page
          .frames()
          .find((f) => f !== page.mainFrame())
          .evaluate(() => {
            const original = mermaid.render
            mermaid.render = async (...args) => {
              const result = await original(...args)
              window.testLastSvg = result.svg
              return result
            }
          })
        await t.test('existing fifty self-authored syntax and layout fixtures', async (st) => {
          const dir = join(root, 'docs/evidence/mermaid-rebuild-2026-11-03/fixtures')
          for (const name of (await readdir(dir))
            .filter(
              (n) =>
                n.endsWith('.mmd') &&
                (!process.env.MILKUP_FRONTEND_CORPUS_FILTER ||
                  n.startsWith(process.env.MILKUP_FRONTEND_CORPUS_FILTER)),
            )
            .sort()) {
            await st.test(name, async () => {
              try {
                const result = await render(await readFile(join(dir, name), 'utf8'))
                assert(result.bytes > 100)
                console.log(JSON.stringify({ corpus: name, ...result }))
              } catch (error) {
                console.log(
                  'self-authored-corpus-output-diagnostic',
                  name,
                  await page
                    .frames()
                    .find((f) => f !== page.mainFrame())
                    .evaluate(() => window.testLastSvg?.slice(0, 16000)),
                )
                await page.evaluate(() => window.frontendMermaidFixture.reset())
                throw error
              }
            })
          }
        })
        await render('flowchart LR\nA-->B')
      }
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
        'foreignObject permits inert text only and keeps privileged or interactive content rejected',
        async () => {
          const child = page.frames().find((f) => f !== page.mainFrame())
          for (const markup of [
            '<input autofocus=""/>',
            '<div contenteditable="true">bad</div>',
            '<a href="https://invalid.example/probe">bad</a>',
            '<iframe src="about:blank"></iframe>',
            '<img src="https://invalid.example/probe"/>',
          ]) {
            await child.evaluate((markup) => {
              window.originalForPolicyTest = mermaid.render
              mermaid.render = async () => ({
                svg:
                  '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="60" viewBox="0 0 100 60"><foreignObject width="100" height="60"><div xmlns="http://www.w3.org/1999/xhtml">' +
                  markup +
                  '</div></foreignObject></svg>',
              })
            }, markup)
            try {
              await assert.rejects(render('flowchart LR\nA-->B'), /unsafe-output/)
            } finally {
              await child.evaluate(() => {
                mermaid.render = window.originalForPolicyTest
                delete window.originalForPolicyTest
              })
            }
          }
          assert.deepEqual(external, [])
          assert(
            (
              await render(
                'eventmodeling\ntf 01 ui Editor\ntf 02 cmd SaveNote\ntf 03 evt NoteSaved',
              )
            ).bytes > 100,
          )
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
      if (documentServer) await new Promise((r) => documentServer.close(r))
      await rm(output, { recursive: true, force: true })
    }
  },
)
