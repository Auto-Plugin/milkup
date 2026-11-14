import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mappedEngineFiles, privateRuntimeGate, fileSha256 } from './linux-private-runtime.mjs'
import { mkdtemp, writeFile, mkdir, stat, rename, copyFile, rm } from 'node:fs/promises'
import { execFileSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import { tmpdir } from 'node:os'
import path from 'node:path'
const line = (name, inode = 42) => `7f000-7f100 r-xp 00000000 08:01 ${inode} /tmp/private/lib/${name}\n`
const a = line('libwebkit2gtk-4.1.so.0.21.0')
const b = line('libjavascriptcoregtk-4.1.so.0.16.0', 43)
test('maps exact library files once across multiple segments', () => {
  assert.equal(mappedEngineFiles(a + a + b).size, 2)
})
test('rejects missing, mixed, deleted and conflicting runtime evidence', () => {
  for (const text of [a, b, a + b + a.replace('/tmp/private', '/usr'),
    a + b.replace(/\n$/, ' (deleted)\n'), a + b + a.replace('42 ', '44 '),
    a + line('libjavascriptcoregtk-4.1.so.0.16.0', 0)])
    assert.throws(() => mappedEngineFiles(text))
})

test('real proc maps enforce private file identity, not merely matching library names',
  { skip: process.platform !== 'linux', timeout: 15000 }, async () => {
    // Tiny fixture libraries exercise the identity gate, never the browser engine.
    const root = await mkdtemp(path.join(tmpdir(), 'milkup-runtime-identity-'))
    let child
    try {
      const prefix = path.join(root, 'prefix'), other = path.join(root, 'other')
      await mkdir(prefix); await mkdir(other)
      const source = path.join(root, 'fixture.c')
      await writeFile(source, 'int fixture_symbol(void) { return 7; }\n')
      const names = ['libwebkit2gtk-4.1.so.0', 'libjavascriptcoregtk-4.1.so.0']
      for (const name of names) {
        execFileSync('cc', ['-shared', '-fPIC', source, '-o', path.join(prefix, name)])
        await copyFile(path.join(prefix, name), path.join(other, name))
      }
      const files = await Promise.all(names.map(async name => ({
        path: name, bytes: (await stat(path.join(prefix, name))).size,
        sha256: await fileSha256(path.join(prefix, name)),
      })))
      const manifest = path.join(root, 'manifest.json')
      const report = { status: 'private-runtime-built-not-accepted', prefix,
        runtimeFiles: files, systemLibrariesBefore: {} }
      await writeFile(manifest, JSON.stringify(report))
      child = spawn('python3', ['-c',
        'import ctypes,sys\na=ctypes.CDLL(sys.argv[1]);b=ctypes.CDLL(sys.argv[2]);print("ready",flush=True);sys.stdin.read()',
        ...names.map(name => path.join(prefix, name))], { stdio: ['pipe', 'pipe', 'inherit'] })
      await once(child.stdout, 'data')
      const gate = await privateRuntimeGate(prefix, manifest)
      assert.equal((await gate.inspect(child.pid)).files.length, 2)
      await gate.finish()
      await writeFile(manifest, JSON.stringify({ ...report, prefix: other }))
      const mismatched = await privateRuntimeGate(other, manifest)
      await assert.rejects(() => mismatched.inspect(child.pid), /exact private runtime/)
      const first = path.join(prefix, names[0])
      await rename(first, first + '.old')
      await copyFile(first + '.old', first)
      await assert.rejects(() => gate.inspect(child.pid), /exact private runtime/)
      await writeFile(manifest, JSON.stringify({ ...report,
        runtimeFiles: [{ ...files[0], sha256: '0'.repeat(64) }, files[1]] }))
      await assert.rejects(() => privateRuntimeGate(prefix, manifest), /Exact built runtime hash/)
    } finally {
      if (child && child.exitCode === null) { child.stdin.end(); await once(child, 'close') }
      await rm(root, { recursive: true, force: true })
    }
  })
