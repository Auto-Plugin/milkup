import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import path from 'node:path'
const root = '/workspace/milkup-mermaid-stability'
const require = createRequire(root + '/package.json')
const { build } = require('esbuild')
const { chromium } = require('@playwright/test')
const output = '/workspace/mermaid-stability-evidence/beta9-original-analysis'
const scrollbar = process.env.CLASSIC_SCROLLBAR === '1'
const kind = process.env.VIEW_KIND || 'source'
const original = '/workspace/milkup-mermaid-rebuild'
const raw = '/workspace/mermaid-rebuild-evidence/windows-installed-41713129442/extracted/installed/pure-standard'
const markdown = await readFile(raw + '/fixture-wide.md.log', 'utf8')
const png = await readFile(raw + '/07-wide-diagram.png')
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, ignoreDefaultArgs: ['--hide-scrollbars'], args: ['--no-sandbox'] })
try {
for (const [label, repo] of [['before', original], ['after', root]]) {
 const artifactLabel = label === 'after' ? (process.env.AFTER_LABEL || label) : label
 if (process.env.AFTER_ONLY === '1' && label === 'before') continue
 const aliases = Object.fromEntries(['core', 'assets', 'input', 'markdown', 'view-dom'].map(name => ['@milkup/' + name, repo + '/packages/' + name + '/src/index.ts']))
 aliases['@milkup/core/internal/document-png-image'] = repo + '/packages/core/src/document-png-image.ts'
 const js = await build({ stdin: { contents: `
import { MemoryDocumentSource, MemoryTextDocument, EditorState, Selection } from '@milkup/core';
import { SourceDocumentView, EditorView } from '@milkup/view-dom';
import { DocumentPresentation } from '${repo}/packages/view-dom/src/document-presentation.ts';
import { createDocumentPngImage, documentPngResourceStats } from '@milkup/core/internal/document-png-image';
import { createDesktopDocumentPresentationService } from '${repo}/apps/desktop/src/document-presentation-service.ts';
const doc = new MemoryTextDocument(${JSON.stringify(markdown)});
const source = new MemoryDocumentSource({ documentId: 'wide-probe', document: doc });
const bytes = Uint8Array.from(atob('${png.toString('base64')}'), c => c.charCodeAt(0));
const events = []; let calls = 0; let released = 0; let stopped = false;
const originalSync = DocumentPresentation.prototype.sync;
DocumentPresentation.prototype.sync = function () {
 const s = this.snapshot(), w = this.window(s);
 if (events.length < 500) events.push({ phase: 'sync', at: performance.now(), width: w?.width, from: w?.from, to: w?.to, visibleFrom: w?.visibleFrom, visibleTo: w?.visibleTo, sourceVersion: s.sourceVersion, selection: s.selection, children: this.content.children.length, contentWidth: this.content.clientWidth });
 return originalSync.call(this);
};
const service = createDesktopDocumentPresentationService({
 current: () => ({ source, identity: ${kind === 'source' ? 'source' : 'doc'} }), theme: () => 'light',
 renderers: () => [{ id: 'mermaid', pluginId: 'probe', contexts: ['fence'], fenceLanguages: ['mermaid'] }],
 rendererGeneration: () => 1, cacheableFence: () => true,
 render: async (_p, _r, input, options) => {
   calls++; events.push({ phase: 'render', at: performance.now(), call: calls, width: input.width, from: input.from, to: input.to, selection: input.selection });
   await new Promise(resolve => setTimeout(resolve, 200));
   if (options.signal.aborted || stopped) throw new Error('aborted');
   return { complete: true, fragments: [{ from: input.from, to: input.to, layout: 'block', accessibleText: 'wide', content: createDocumentPngImage({ bytes, width: 3528, height: 126, release: () => released++ }) }] };
 }
});
const view = ${kind === 'source' ? 'new SourceDocumentView({ source,' : 'new EditorView({ state: new EditorState({ doc, selection: Selection.cursor(0) }),'} parent: document.getElementById('root'), mode: 'live', documentPresentation: { provide: service.provide } });
window.probe = { snapshot: () => ({ calls, released, events, images: [...view.contentDOM.querySelectorAll('img')].map(img => ({ naturalWidth: img.naturalWidth, width: img.getBoundingClientRect().width, height: img.getBoundingClientRect().height })), stats: documentPngResourceStats() }), stop: () => { stopped = true; view.destroy(); service.clear(); } };
`, resolveDir: repo, loader: 'ts' }, alias: aliases, bundle: true, write: false, format: 'esm', platform: 'browser' })
 const css = await readFile(repo + '/apps/desktop/src/style.css', 'utf8') + (label === 'after' && process.env.GUTTER_TEST === '1' ? '\n.milkup-editor { scrollbar-gutter: stable; }' : '')
 const html = `<html><head><style>${css}\nhtml,body { margin:0; height:100%; } #root { width:1028px; height:693px; } ${scrollbar ? '.milkup-editor { scrollbar-width:auto; } .milkup-editor::-webkit-scrollbar { width:17px; height:17px; }' : ''} </style></head><body><main id="root"></main><script type="module">${js.outputFiles[0].text}</script></body></html>`
 const server = createServer((_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end(html) })
 await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
 const page = await browser.newPage({ viewport: { width: 1100, height: 800 } })
 const errors = []; page.on('pageerror', e => errors.push(String(e)))
 await page.goto('http://127.0.0.1:' + server.address().port)
 await page.waitForTimeout(label === 'after' ? Number(process.env.DURATION_MS || 6000) : 6000)
 const result = await page.evaluate(() => window.probe.snapshot())
 const resizeSnapshots = []
 if (label === 'after' && process.env.RESIZE_LOOPS === '1') {
  for (const width of [720,1028,720,1028,720,1028]) {
   await page.evaluate(width => { document.getElementById('root').style.width = width + 'px' }, width)
   await page.waitForTimeout(500)
   const snapshot = await page.evaluate(() => window.probe.snapshot())
   resizeSnapshots.push({ width, calls: snapshot.calls, images: snapshot.images })
  }
  await page.evaluate(() => { document.getElementById('root').style.width = '850px' })
  await page.waitForTimeout(50)
 }
 await page.screenshot({ path: path.join(output, 'layout-' + kind + (scrollbar ? '-scrollbar' : '') + '-' + artifactLabel + '.png') })
 await page.evaluate(() => window.probe.stop())
 await page.waitForTimeout(300)
 const stopped = await page.evaluate(() => window.probe.snapshot())
 await writeFile(path.join(output, 'layout-' + kind + (scrollbar ? '-scrollbar' : '') + '-' + artifactLabel + '.json'), JSON.stringify({ mode: kind + ' view with real browser layout, recorded wide PNG and simulated 200 ms provider; not a native Windows execution', durationMs: label === 'after' ? Number(process.env.DURATION_MS || 6000) : 6000, injectedGutter: process.env.GUTTER_TEST === '1', repo, errors, result, resizeSnapshots, stopped: { calls: stopped.calls, released: stopped.released, stats: stopped.stats } }, null, 2))
 if (artifactLabel.startsWith('final')) {
  assert.equal(errors.length, 0); assert.equal(result.calls, 1); assert.equal(result.images.length, 1);
  assert(result.images[0].width < 1028 && result.images[0].width > 100);
  assert(result.events.filter(e => e.phase === 'sync').length <= 6);
  assert(resizeSnapshots.every(s => s.images.length === 1 && s.images[0].width < s.width && s.calls <= 2));
  assert.deepEqual(stopped.stats, { bytes: 0, images: 0, decodedOwners: 0 });
 }
 console.log(kind, artifactLabel, JSON.stringify({ calls: result.calls, images: result.images, errors, resizeSnapshots, syncCount: result.events.filter(e => e.phase === 'sync').length, windows: [...new Set(result.events.filter(e => e.phase === 'sync').map(e => JSON.stringify([e.from,e.to,e.width,e.visibleFrom,e.visibleTo,e.children])))], stopped: stopped.stats }))
 await page.close(); await new Promise(resolve => server.close(resolve))
}
} finally { await browser.close() }
