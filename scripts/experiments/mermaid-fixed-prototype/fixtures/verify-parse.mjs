import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { runInThisContext } from 'node:vm'

// Parser-only verification. jsdom supplies DOMPurify's DOM APIs; it does not
// supply SVG geometry, browser fonts, a renderer or an image capture engine.
const fixtureRoot = dirname(fileURLToPath(import.meta.url))
const root = dirname(fixtureRoot)
const [mermaidEntry, jsdomEntry] = process.argv.slice(2)
assert.ok(mermaidEntry && jsdomEntry, 'Pass existing Mermaid and jsdom ESM entry paths')
const manifest = JSON.parse(await readFile(resolve(root, 'fixtures-manifest.json'), 'utf8'))
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')
const engineBytes = await readFile(mermaidEntry)
const distribution = mermaidEntry.endsWith('mermaid.min.js') ? 'browser-umd' : 'esm'
const expectedHash = distribution === 'browser-umd'
  ? manifest.engine.browserDistribution.sha256
  : manifest.engine.entrySha256
assert.equal(digest(engineBytes), expectedHash, 'Unexpected Mermaid entry')
const jsdomMetadata = JSON.parse(await readFile(resolve(dirname(jsdomEntry), '..', 'package.json'), 'utf8'))
assert.equal(jsdomMetadata.name, 'jsdom')
assert.equal(jsdomMetadata.version, '27.4.0', 'Parser evidence uses the existing jsdom version')
const { JSDOM } = await import(pathToFileURL(resolve(jsdomEntry)).href)
// No resources option and no runScripts option: no subresource loading or
// document script execution. Only the fixed, locally imported parser executes.
const dom = new JSDOM('<!doctype html><html><body></body></html>')
for (const key of ['window', 'document', 'DOMParser', 'Node', 'Element', 'HTMLElement', 'SVGElement']) {
  globalThis[key] = dom.window[key]
}
let mermaid
if (distribution === 'browser-umd') {
  // Execute only the above hash-checked official bundle, never fixture text as
  // JavaScript. This is a Node parser test, not browser/layout verification.
  runInThisContext(engineBytes.toString('utf8'), { filename: mermaidEntry, timeout: 10000 })
  mermaid = globalThis.mermaid
} else {
  ;({ default: mermaid } = await import(pathToFileURL(resolve(mermaidEntry)).href))
}
const secure = [...new Set(['secure', ...Object.keys(mermaid.mermaidAPI.defaultConfig)])]
const results = []
try {
  for (const fixture of manifest.fixtures) {
    const sourceBytes = await readFile(resolve(root, fixture.path))
    assert.equal(digest(sourceBytes), fixture.sha256, `Fixture changed: ${fixture.id}`)
    mermaid.initialize({ ...manifest.baseInitialize, ...fixture.initializeOverrides, secure })
    try {
      const parsed = await mermaid.parse(sourceBytes.toString('utf8'), { suppressErrors: false })
      assert.ok(parsed && typeof parsed === 'object', 'Parser did not return a result')
      assert.equal(parsed.diagramType, fixture.expectedRegistrationId)
      results.push({ id: fixture.id, passed: true, actualRegistrationId: parsed.diagramType })
    } catch (error) {
      results.push({ id: fixture.id, passed: false, error: String(error).slice(0, 3000) })
    }
  }
  mermaid.initialize({ ...manifest.baseInitialize, secure })
  let invalidSyntaxRejected = false
  try {
    await mermaid.parse('flowchart LR\nA[unfinished', { suppressErrors: false })
  } catch {
    invalidSyntaxRejected = true
  }
  const report = {
    schemaVersion: 1,
    engine: manifest.engine,
    distribution,
    actualEntrySha256: digest(engineBytes),
    environment: { node: process.version, dom: 'Existing jsdom 27.4.0; no layout engine' },
    scope: 'Actual official mermaid.parse calls only. No mermaid.render, browser, Windows, helper, plugin code, screenshot or isolation tests.',
    initialization: manifest.baseInitialize,
    secure,
    invalidSyntaxRejected,
    fixtureCount: results.length,
    passed: results.filter((result) => result.passed).length,
    failed: results.filter((result) => !result.passed).length,
    results,
  }
  await writeFile(resolve(fixtureRoot, 'parser-validation.json'), JSON.stringify(report, null, 2) + '\n')
  await writeFile(resolve(fixtureRoot, `parser-validation-${distribution}.json`), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify({ fixtureCount: report.fixtureCount, passed: report.passed, failed: report.failed, invalidSyntaxRejected }))
  for (const result of results.filter((result) => !result.passed)) console.log(JSON.stringify(result))
  if (report.failed || !invalidSyntaxRejected) process.exitCode = 1
} finally {
  dom.window.close()
}
