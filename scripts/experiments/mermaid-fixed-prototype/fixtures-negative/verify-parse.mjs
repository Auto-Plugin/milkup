import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { runInThisContext } from 'node:vm'

const folder = dirname(fileURLToPath(import.meta.url))
const root = dirname(folder)
const [mermaidEntry, jsdomEntry] = process.argv.slice(2)
assert.ok(mermaidEntry && jsdomEntry, 'Pass existing fixed UMD and jsdom entry paths')
const manifest = JSON.parse(await readFile(resolve(root, 'negative-fixtures-manifest.json'), 'utf8'))
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')
const bundle = await readFile(mermaidEntry)
assert.equal(digest(bundle), manifest.engine.browserDistribution.sha256)
const metadata = JSON.parse(await readFile(resolve(dirname(jsdomEntry), '..', 'package.json'), 'utf8'))
assert.equal(metadata.name, 'jsdom')
assert.equal(metadata.version, '27.4.0')
const { JSDOM } = await import(pathToFileURL(resolve(jsdomEntry)).href)
// Default jsdom configuration: no resource loading or document-script execution.
const dom = new JSDOM('<!doctype html><html><body></body></html>')
for (const key of ['window', 'document', 'DOMParser', 'Node', 'Element', 'HTMLElement', 'SVGElement']) {
  globalThis[key] = dom.window[key]
}
// Only the hash-checked official engine is evaluated; source strings are data.
runInThisContext(bundle.toString('utf8'), { filename: mermaidEntry, timeout: 10000 })
const mermaid = globalThis.mermaid
const secure = [...new Set(['secure', ...Object.keys(mermaid.mermaidAPI.defaultConfig)])]
const results = []
try {
  for (const fixture of manifest.fixtures) {
    const bytes = await readFile(resolve(root, fixture.path))
    assert.equal(digest(bytes), fixture.sha256)
    const source = bytes.toString('utf8')
    assert.ok(source.length <= 50000 && source.split('\n').length <= 256)
    mermaid.initialize({ ...manifest.baseInitialize, look: 'classic', secure })
    let actualRegistrationId = null
    let parseError = null
    try {
      const result = await mermaid.parse(source, { suppressErrors: false })
      assert.ok(result && typeof result === 'object')
      actualRegistrationId = result.diagramType
    } catch (error) {
      parseError = { name: error.name, message: String(error.message).slice(0, 1600) }
    }
    const accepted = !parseError
    const expectationMatched = fixture.expectedParse === 'accept'
      ? accepted && actualRegistrationId === fixture.expectedRegistrationId
      : !accepted && typeof fixture.expectedErrorContains === 'string' && parseError.message.includes(fixture.expectedErrorContains)
    results.push({
      id: fixture.id,
      expectedParse: fixture.expectedParse,
      accepted,
      actualRegistrationId,
      parseError,
      expectationMatched,
      renderOutcomeVerified: false,
      navigationOrResourceAttemptExercised: false,
      networkBlockingVerified: false,
    })
  }
  const report = {
    schemaVersion: 1,
    engine: manifest.engine,
    environment: { node: process.version, dom: 'Existing jsdom 27.4.0; no layout engine' },
    initialization: { ...manifest.baseInitialize, look: 'classic', secure },
    scope: 'Official UMD mermaid.parse only. No renderer, browser, Windows, plugin, click, image load, network operation, capture, PNG validation or OS isolation test.',
    fixtureCount: results.length,
    matchedExpectations: results.filter((result) => result.expectationMatched).length,
    results,
  }
  await writeFile(resolve(folder, 'parser-validation.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify({ count: results.length, matched: report.matchedExpectations, results }))
  if (report.matchedExpectations !== results.length) process.exitCode = 1
} finally {
  dom.window.close()
}
