// Research-only identity gate. Does not change the system loader or libraries.
import assert from 'node:assert/strict'
import { createReadStream } from 'node:fs'
import { readFile, realpath, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'

export function mappedEngineFiles(text) {
  const result = new Map()
  for (const line of text.split('\n')) {
    const m = /^\S+\s+\S+\s+\S+\s+\S+\s+(\d+)\s+(.+)$/.exec(line)
    if (!m || !/\/lib(?:webkit2gtk|javascriptcoregtk)-4\.1\.so\./.test(m[2])) continue
    assert(!m[2].endsWith(' (deleted)'), 'Mapped runtime file was deleted')
    assert(path.isAbsolute(m[2]), 'Absolute mapped runtime path required')
    assert(m[1] !== '0', 'File-backed engine mapping required')
    const previous = result.get(m[2])
    assert(previous === undefined || previous === m[1], 'Conflicting mapped inode')
    result.set(m[2], m[1])
  }
  assert.equal(result.size, 2, 'Exactly one matched WebKit and JavaScriptCore required')
  assert([...result.keys()].some(p => /\/libwebkit2gtk-4\.1\.so\./.test(p)))
  assert([...result.keys()].some(p => /\/libjavascriptcoregtk-4\.1\.so\./.test(p)))
  return result
}

export async function fileSha256(file) {
  const h = createHash('sha256')
  for await (const chunk of createReadStream(file)) h.update(chunk)
  return h.digest('hex')
}

export async function privateRuntimeGate(prefix, manifestFile) {
  assert(path.isAbsolute(prefix))
  const root = await realpath(prefix)
  const manifest = JSON.parse(await readFile(manifestFile, 'utf8'))
  assert.equal(manifest.status, 'private-runtime-built-not-accepted')
  assert.equal(manifest.prefix, root)
  const checked = new Map()
  for (const f of manifest.runtimeFiles) {
    const full = path.resolve(root, f.path)
    assert(full.startsWith(root + path.sep), 'Manifest path within private prefix')
    assert.equal(await realpath(full), full, 'Manifest contains real installed files')
    const s = await stat(full)
    assert.equal(s.size, f.bytes)
    assert.equal(await fileSha256(full), f.sha256, 'Exact built runtime hash')
    checked.set(full, { ...f, inode: String(s.ino), mtimeMs: s.mtimeMs })
  }
  async function systemUnchanged() {
    for (const [file, digest] of Object.entries(manifest.systemLibrariesBefore))
      assert.equal(await fileSha256(file), digest, 'System runtime remains unchanged')
  }
  await systemUnchanged()
  return {
    systemUnchanged,
    async inspect(pid) {
      assert(Number.isSafeInteger(pid) && pid > 0)
      const generation = async () => (await readFile(`/proc/${pid}/stat`, 'utf8')).split(') ').at(-1).split(' ')[19]
      const birth = await generation()
      const mapped = mappedEngineFiles(await readFile(`/proc/${pid}/maps`, 'utf8'))
      const files = []
      for (const [file, inode] of mapped) {
        const expected = checked.get(file)
        assert(expected, 'Process must map the exact private runtime, not system libraries')
        const current = await stat(file)
        assert.equal(inode, expected.inode)
        assert.equal(String(current.ino), inode)
        assert.equal(current.size, expected.bytes)
        assert.equal(current.mtimeMs, expected.mtimeMs)
        files.push({ path: file, inode, sha256: expected.sha256 })
      }
      assert.equal(await generation(), birth, 'Runtime observation belongs to same process birth')
      return { pid, birth, files }
    },
    async finish() {
      await systemUnchanged()
      for (const [file, expected] of checked)
        assert.equal(await fileSha256(file), expected.sha256, 'Private runtime bytes unchanged after execution')
    },
  }
}
