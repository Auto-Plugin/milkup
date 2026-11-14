// Read-only offline inventory. Output goes to stdout; place it outside the inspected tree.
import assert from 'node:assert/strict'
import { lstat, readdir, readFile } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
assert(process.argv[2], 'node scripts/inspect-v2-recovery.mjs <closed-app recovery directory>')
const root = path.resolve(process.argv[2]),
  files = []
let entries = 0
async function visit(dir, depth = 0) {
  assert(depth <= 8, 'depth exceeds review budget; no files changed')
  const info = await lstat(dir)
  assert(info.isDirectory() && !info.isSymbolicLink(), 'directory link/special entry refused')
  for (const name of (await readdir(dir)).sort()) {
    assert(++entries <= 20000, 'entry count exceeds review budget; no files changed')
    const file = path.join(dir, name),
      before = await lstat(file)
    assert(!before.isSymbolicLink(), 'links refused; no files changed')
    if (before.isDirectory()) {
      await visit(file, depth + 1)
      continue
    }
    assert(before.isFile(), 'special entries refused; no files changed')
    const sha = createHash('sha256')
    for await (const chunk of createReadStream(file)) sha.update(chunk)
    const after = await lstat(file)
    assert(
      before.size === after.size && before.mtimeMs === after.mtimeMs && before.ino === after.ino,
      'file changed during inventory; stop app and retry once',
    )
    files.push({
      path: path.relative(root, file).split(path.sep).join('/'),
      bytes: after.size,
      sha256: sha.digest('hex'),
    })
  }
}
await visit(root)
const records = []
for (const file of files.filter((f) => /^[^/]+\/manifest\.json$/.test(f.path))) {
  try {
    const r = JSON.parse(await readFile(path.join(root, file.path), 'utf8'))
    assert(/^snapshot-\d+$/.test(r.payload), 'unsafe payload name')
    const payload = files.find((f) => f.path === file.path.replace(/manifest\.json$/, r.payload))
    records.push({
      manifest: file.path,
      id: r.id,
      disposition: r.disposition,
      payload: r.payload,
      valid: !!payload && payload.bytes === r.bytes && payload.sha256 === r.sha256,
    })
  } catch (error) {
    records.push({ manifest: file.path, valid: false, error: String(error) })
  }
}
const result = {
  root,
  at: new Date().toISOString(),
  readOnly: true,
  closedApplicationRequired: true,
  entries,
  totalBytes: files.reduce((n, f) => n + f.bytes, 0),
  files,
  records,
}
console.log(JSON.stringify(result, null, 2))
if (records.some((r) => !r.valid)) process.exitCode = 1
