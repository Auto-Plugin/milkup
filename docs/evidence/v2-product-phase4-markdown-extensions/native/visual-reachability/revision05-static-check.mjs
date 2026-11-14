// Static only: read existing evidence and compile strings; never import the runner.
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
const dir = new URL('./', import.meta.url)
const sha = (x) => createHash('sha256').update(x).digest('hex')
const read = (n) => readFile(new URL(n, dir), 'utf8')
const main = await read('supplement-main.mjs.txt'),
  runner = await read('run-reachability.mjs')
const previous = await read('revision04/run-reachability.mjs')
assert.equal(sha(previous), '89e5a40b65c383200107cd044cbb685a1e1c5ab1bd1dad3a6441fc932a3d4568')
const check = spawnSync(
  process.execPath,
  ['--check', new URL('run-reachability.mjs', dir).pathname],
  { encoding: 'utf8' },
)
assert.equal(check.status, 0, check.stderr)
const common = /const reachabilityClientGeometry = `([\s\S]*?)`/.exec(main)[1]
new Function(common)
for (const [, script] of main.matchAll(/app\.execute\(reachabilityClientGeometry \+ `([\s\S]*?)`/g))
  new Function(common + script)
const activation = /return app\.execute\(`([\s\S]*?)`, requiredActive\)/.exec(main)[1]
new Function(activation)
const formal = await readFile(
  '/workspace/milkup/tests/native/tauri-markdown-extensions.mjs',
  'utf8',
)
const prefix = formal
  .slice(0, formal.lastIndexOf('\ntry {') + 1)
  .replaceAll("from '../helpers/", "from '/workspace/milkup/tests/helpers/")
  .replaceAll("new URL('../helpers/", "new URL('/workspace/milkup/tests/helpers/")
  .replace(
    "  await app.focus(action('details', id))",
    "  await ui.ready(action('details', id))\n  await app.focus(action('details', id))",
  )
assert.equal(runner, prefix + main)
const managerPath = '/workspace/milkup/apps/desktop/src/desktop-plugin-manager.ts'
const registryPath = '/workspace/milkup/packages/plugin/src/registry.ts'
const manager = await readFile(managerPath, 'utf8'),
  registry = await readFile(registryPath, 'utf8')
assert(registry.includes("PluginInstallState = 'installed' | 'enabled' | 'disabled' | 'failed'"))
const mark = registry.slice(registry.indexOf('  markEnabled('), registry.indexOf('  markDisabled('))
assert(mark.includes("state: 'enabled'") && mark.includes("this.recordAudit(pluginId, 'enable')"))
const enable = manager.slice(
  manager.indexOf('  private async enablePluginInstance('),
  manager.indexOf('  private async enablePluginInstance(') + 6500,
)
assert(
  enable.indexOf('await this.runtime.enablePlugin(pluginId)') <
    enable.indexOf('this.registry.markEnabled(pluginId)'),
)
const base =
  '/workspace/milkup-markdown-extensions-phase4-evidence/native/run-candidate10-namespace-run01/'
const raw = await readFile(base + 'results.json', 'utf8'),
  results = JSON.parse(raw)
const ids = ['milkup.preferences', 'milkup.math', 'milkup.diagrams', 'milkup.footnotes']
const enabledRecord = results.find((r) =>
  ids.every((id) =>
    r.registry?.some(
      (p) => p.id === id && p.enabled && p.state === 'enabled' && p.errors.length === 0,
    ),
  ),
)
assert(enabledRecord)
const legends = ['1. 甲：2 (66.7%)', '2. 乙：1 (33.3%)']
const observed = []
for (const name of ['ordinary', 'windowed']) {
  const cases = results.filter(
    (r) => r.sample === 'pie' && r.combination?.name === name && r.combination?.mode === 'live',
  )
  assert(cases.length > 0)
  for (const r of cases) {
    const texts = r.preview.svg.flatMap((s) => s.texts.map((t) => t.text))
    for (const label of legends) assert.equal(texts.filter((t) => t === label).length, 1)
    assert(!texts.some((t) => t.startsWith('甲') || t.startsWith('乙')))
  }
  const fixture = await readFile(base + name + '.md', 'utf8')
  const block = fixture.slice(fixture.indexOf('SAMPLE-PIE'), fixture.indexOf('SAMPLE-FOOTNOTES'))
  assert(block.includes('"甲": 2') && block.includes('"乙": 1'))
  observed.push({
    name,
    recordCount: cases.length,
    records: cases.map((r) => r.name),
    fixtureSHA: sha(fixture),
    legendStrings: legends,
  })
}
for (const guard of [
  'assert.deepEqual(await readFile(activeFile), Buffer.from(text))',
  'assert.equal(after.version, initial.version)',
  'assert.equal(after.dirty, false)',
  'assert.equal((await app.probe()).version, initial.version)',
  'assert.equal((await app.probe()).dirty, false)',
  'sourceCaretCases:4, sourceCaretChecks:8, vectorCases:12, vectorEdgeChecks:24, pieLegendCases:8',
])
  assert.equal(runner.split(guard).length, previous.split(guard).length)
const helperRefs = [...runner.matchAll(/(?:from |new URL\()'([^']+\/helpers\/[^']+)'/g)].map(
  (m) => m[1],
)
assert.equal(helperRefs.length, 8)
const helpers = await Promise.all(
  helperRefs.map(async (path) => ({ path, sha: sha(await readFile(path)) })),
)
assert.equal(new Set(helpers.map((h) => h.path)).size, 4)
const archivePaths = [
  '/workspace/milkup-markdown-extensions-phase4-evidence/math/external-crlf-final/dist/milkup.math-1.0.0.milkup-plugin',
  '/workspace/milkup-markdown-extensions-phase4-evidence/diagrams/external/dist/milkup.diagrams-1.0.0.milkup-plugin',
  '/workspace/milkup-markdown-extensions-phase4-evidence/footnotes/external-format-final/dist/milkup.footnotes-1.0.0.milkup-plugin',
]
const archiveInputs = await Promise.all(
  archivePaths.map(async (path) => {
    const bytes = await readFile(path)
    const b = JSON.parse(bytes)
    assert.equal(b.format, 'milkup-plugin')
    return { path, sha: sha(bytes), id: b.manifest.id }
  }),
)
const proof = {
  revision: 5,
  preparedNotRun: true,
  uiExecuted: false,
  testsRun: false,
  buildRun: false,
  runnerSHA: sha(runner),
  mainSHA: sha(main),
  previousRunnerSHA: sha(previous),
  syntaxExit: check.status,
  embeddedScriptsParsed: 4,
  inheritedPrefixMatchesExplicitThreeChanges: true,
  inheritedPrefixChanges: [
    'Four absolute static imports',
    'Four absolute harnessSources URLs',
    'details control ui.ready before focus',
  ],
  initializationPaths: {
    helperRefs: helpers,
    defaultArchiveInputs: archiveInputs,
    dynamicInputs:
      'Runtime output, TAURI_APP_PATH, candidate SHA and recovery profile remain required gates; not executed or bypassed',
    runnerImportMetaURL: 'Existing external run-reachability.mjs',
  },
  staticCheckCorrection:
    'First static checker assumed spaces before fixture pie colons; actual fixtures have no such spaces. Checker corrected after reading both files; no product or runner change resulted from this checker failure.',
  evidence: {
    resultsPath: base + 'results.json',
    resultsSHA: sha(raw),
    managerPath,
    managerSHA: sha(manager),
    registryPath,
    registrySHA: sha(registry),
    enabledExample: {
      name: enabledRecord.name,
      at: enabledRecord.at,
      records: enabledRecord.registry.filter((r) => ids.includes(r.id)),
    },
    pie: observed,
  },
  findings: [
    {
      defect:
        "revision4 waited for state='active', which is absent from PluginInstallState and real saved records",
      correction:
        "Require enabled=true, state='enabled', errors empty, and successful enable audit. Manager marks enabled only after awaited runtime.enablePlugin and activation epoch guard; no private runtime API used.",
      limitation:
        'Saved results expose records, not auditRecords; audit requirement is validated against the registry implementation, not claimed observed from these saved results.',
    },
    {
      defect: "revision4 startsWith('甲'/'乙') cannot match actual numbered SVG legends",
      correction:
        'Exactly one match for each complete fixture legend string; all saved ordinary and windowed live pie cases checked.',
    },
  ],
  preserved: [
    'Full-file bytes, version and dirty guards',
    'Four source cases/eight caret checks; twelve vectors/twenty-four edges; eight legends',
    'Existing 10s startup / render budgets, wheel limits, delay and inherited inputs',
  ],
  snapshotHashes: Object.fromEntries(
    await Promise.all(
      [
        'run-reachability.mjs',
        'supplement-main.mjs.txt',
        'preparation.json',
        'formal-to-supplement.diff',
      ].map(async (n) => [n, sha(await read('revision04/' + n))]),
    ),
  ),
}
await writeFile(new URL('revision05-static-proof.json', dir), JSON.stringify(proof, null, 2) + '\n')
console.log(JSON.stringify(proof, null, 2))
