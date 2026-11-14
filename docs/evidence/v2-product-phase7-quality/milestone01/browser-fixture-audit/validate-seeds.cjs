const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const cp = require('node:child_process')
const ts = require('/workspace/milkup/node_modules/typescript')
const esbuild = require('/workspace/milkup/node_modules/esbuild')
const root = '/workspace/milkup'
const out = __dirname
const baseline = 'fa530b399a5ebbd020f9bfa7ca039378604c8282'
const hash = b => crypto.createHash('sha256').update(b).digest('hex')
const sourcePath = 'packages/plugin/src/registry.ts'
const production = fs.readFileSync(path.join(root, sourcePath))
const baselineSource = cp.execFileSync('git', ['show', `${baseline}:${sourcePath}`], { cwd: root })
const result = { baseline, validatorSha256: hash(production), baselineValidatorSha256: hash(baselineSource), validatorBytesEqual: production.equals(baselineSource), browserRun: false, records: [] }
for (const dir of ['tests/helpers', 'tests/e2e']) {
  for (const name of fs.readdirSync(path.join(root, dir)).filter(n => n.endsWith('.ts'))) {
    const file = path.join(dir, name)
    const text = fs.readFileSync(path.join(root, file), 'utf8')
    const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
    const visit = node => {
      if (ts.isObjectLiteralExpression(node)) {
        const keys = node.properties.map(p => p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) ? p.name.text : '')
        if (['manifestPath', 'rootPath', 'sourcePath'].every(k => keys.includes(k))) result.records.push({ file, line: ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1, missingRoots: ['dataRoot', 'storageRoot'].filter(k => !keys.includes(k)) })
      }
      ts.forEachChild(node, visit)
    }
    visit(ast)
  }
}
esbuild.buildSync({ entryPoints: [path.join(root, sourcePath)], bundle: true, platform: 'node', format: 'cjs', outfile: path.join(out, 'registry-validator.cjs'), logLevel: 'silent' })
const { parsePluginRegistrySnapshot } = require(path.join(out, 'registry-validator.cjs'))
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'plugins/formatting/plugin.json'), 'utf8'))
const record = { manifest, manifestPath: '/plugins/formatting/plugin.json', rootPath: '/plugins/formatting', sourcePath: '/plugins/formatting/plugin.json', state: 'installed', enabled: false, installedAt: 1, updatedAt: 1, trust: 'development', approvals: { permissions: [], hosts: ['worker'] }, errors: [] }
const parse = record => {
  try { parsePluginRegistrySnapshot(JSON.stringify({ version: 1, records: [record], auditRecords: [] })); return { accepted: true } }
  catch (error) { return { accepted: false, error: error.message } }
}
result.existingFixtureShape = parse(record)
result.withDataRootOnly = parse({ ...record, dataRoot: `milkup://plugin-data/${manifest.id}` })
result.withBothScopedRoots = parse({ ...record, dataRoot: `milkup://plugin-data/${manifest.id}`, storageRoot: `milkup://plugin-storage/${manifest.id}` })
console.log(JSON.stringify(result, null, 2))
