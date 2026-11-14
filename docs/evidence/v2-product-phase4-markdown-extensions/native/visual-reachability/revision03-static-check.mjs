// Static-only evidence: do not import or execute the production/supplemental runner.
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import vm from 'node:vm'
const dir = new URL('./', import.meta.url)
const read = (name) => readFile(new URL(name, dir), 'utf8')
const sha = (text) => createHash('sha256').update(text).digest('hex')
const formalPath = '/workspace/milkup/tests/native/tauri-markdown-extensions.mjs'
const formal = await readFile(formalPath, 'utf8')
const runner = await read('run-reachability.mjs'),
  main = await read('supplement-main.mjs.txt')
const prior = await read('revision02/run-reachability.mjs'),
  oldMain = await read('revision02/supplement-main.mjs.txt')
assert.equal(sha(prior), 'f8878b34d5726bc6d9b07fd0f6c906d7e28e12b516d87d7be9c6074f76069d9e')
const prefix = formal
  .slice(0, formal.lastIndexOf('\ntry {') + 1)
  .replaceAll("from '../helpers/", "from '/workspace/milkup/tests/helpers/")
assert.equal(runner, prefix + main)
assert.equal(prior, prefix + oldMain)
const check = spawnSync(
  process.execPath,
  ['--check', new URL('run-reachability.mjs', dir).pathname],
  { encoding: 'utf8' },
)
assert.equal(check.status, 0, check.stderr)
const common = /const reachabilityClientGeometry = `([\s\S]*?)`/.exec(main)[1]
new Function(common)
const scripts = [...main.matchAll(/app\.execute\(reachabilityClientGeometry \+ `([\s\S]*?)`/g)]
assert.equal(scripts.length, 2)
for (const [, body] of scripts) new Function(common + body)
// Only constant fixture data and boundary expressions are evaluated; no runner functions are invoked.
const prefixExpression = /const prefix = ([\s\S]*?\.join\('\\r\\n'\))/.exec(formal)[1]
const text = vm.runInNewContext(prefixExpression, Object.create(null), { timeout: 100 })
const actualFixture = await readFile(
  '/workspace/milkup-markdown-extensions-phase4-evidence/native/run-candidate10-namespace-run01/ordinary.md',
  'utf8',
)
assert.equal(text, actualFixture)
const originalBounds = oldMain.slice(
  oldMain.indexOf('      const lineFrom ='),
  oldMain.indexOf("      await app.key('Right')"),
)
const bounds = vm.runInNewContext(
  originalBounds + ';({lineFrom,lineTo})',
  { text },
  { timeout: 100 },
)
assert(bounds.lineFrom >= 0 && bounds.lineTo > bounds.lineFrom)
assert(text.slice(bounds.lineFrom, bounds.lineTo).includes('\\frac'))
const newBounds = main.slice(
  main.indexOf('      const markerFrom ='),
  main.indexOf("      await app.key('Right')"),
)
const current = vm.runInNewContext(
  newBounds + ';({lineFrom,lineTo})',
  { text, assert },
  { timeout: 100 },
)
assert.equal(current.lineFrom, bounds.lineFrom)
assert.equal(current.lineTo, bounds.lineTo)
for (const guard of [
  'assert.deepEqual(await readFile(activeFile), Buffer.from(text))',
  'assert.equal(after.version, initial.version)',
  'assert.equal(after.dirty, false)',
  'assert.equal((await app.probe()).version, initial.version)',
  'assert.equal((await app.probe()).dirty, false)',
]) {
  assert.equal(main.split(guard).length, oldMain.split(guard).length, guard)
}
const expected = {
  wheelDelayMs: 160,
  edgeWheelLimit: 30,
  legendWheelLimit: 40,
  hostStartupWaitMs: 10000,
}
assert(main.includes('await app.delay(160)'))
assert(main.includes('i <= 30') && main.includes('i<=40'))
assert(main.includes("actual activation', 10000)"))
const backups = {}
for (const name of [
  'run-reachability.mjs',
  'supplement-main.mjs.txt',
  'preparation.json',
  'formal-to-supplement.diff',
])
  backups[name] = sha(await read('revision02/' + name))
const proof = {
  revision: 3,
  preparedNotRun: true,
  uiExecuted: false,
  testsRun: false,
  buildRun: false,
  runnerSHA: sha(runner),
  mainSHA: sha(main),
  formalSHA: sha(formal),
  formalPath,
  inheritedPrefixEqualAfterOnlyAbsoluteImports: true,
  inheritedPrefixBytes: Buffer.byteLength(prefix),
  syntax: {
    runnerNodeCheck: check.status,
    embeddedBrowserScriptsParsed: scripts.length,
    commonBrowserScriptParsed: true,
  },
  originalRevision2SnapshotSHA: backups,
  crlf: {
    originalCorrect: true,
    initialMisreadingCorrected: true,
    fixClaim: false,
    addedBoundaryGuards: true,
    actualFixtureByteEquivalentToFormalConstant: true,
    fixtureSHA: sha(actualFixture),
    lineFrom: bounds.lineFrom,
    lineTo: bounds.lineTo,
  },
  preserved: { ...expected, fullFileBytesVersionDirtyGuards: true, formalPrefixAndBudgets: true },
  checks: [
    'Client rectangles exclude border/scrollbar and clip to window viewport',
    'Positive caret/clip/SVG/legend geometry; SVG horizontal overlap before edge success',
    'Fresh target preview lookup plus elementFromPoint before XTest wheel; observed hit and native coordinates recorded',
    'End and Home both validate horizontal/vertical caret visibility and source offset',
    'Actual preferences and three renderer activation states awaited within existing startup budget',
  ],
  limits: [
    'Static preparation only; no native reachability or rendering acceptance claimed',
    'The inherited seek and rendering wait behavior is unchanged',
    'Time between browser hit observation and native input is unavoidable; each wheel step is rechecked rather than using stale prior-step geometry',
  ],
}
await writeFile(new URL('revision03-static-proof.json', dir), JSON.stringify(proof, null, 2) + '\n')
console.log(JSON.stringify(proof, null, 2))
