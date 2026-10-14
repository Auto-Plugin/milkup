// Prepares fresh manual fixtures; never sends input or marks native acceptance passed.
import assert from 'node:assert/strict'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
const [command, directory, caseName] = process.argv.slice(2)
assert(
  directory && ['prepare', 'verify'].includes(command),
  'prepare <new-directory> | verify <directory> <case>',
)
const root = path.resolve(directory)
const hash = (b) => createHash('sha256').update(b).digest('hex')
if (command === 'prepare') {
  await mkdir(root) // EEXIST prevents reusing or overwriting a previous run.
  const cases = []
  for (const [backend, size] of [
    ['ordinary', 4096],
    ['windowed-js', 179200],
    ['windowed-native', 1048576],
  ]) {
    const header = Buffer.from(
      '起点A👩🏽‍💻B\r\n\r\n# 标题\r\n\r\n- 列表\r\n\r\n```js\r\nconst x = 1\r\n```\r\n\r\n| 甲 | 乙 |\r\n| --- | --- |\r\n| 丙 | 丁 |\r\n\r\n',
    )
    const row = Buffer.from('body ' + 'x'.repeat(57) + '\r\n')
    const bytes = Buffer.concat([
      header,
      Buffer.from(row.toString().repeat(Math.ceil((size - header.length) / row.length))),
    ])
    const expected = Buffer.concat([Buffer.from('中文候选'), bytes])
    for (const mode of ['source', 'live']) {
      const name = `${backend}-${mode}`
      await writeFile(path.join(root, `${name}.md`), bytes, { flag: 'wx' })
      cases.push({
        name,
        mode,
        requestedBackend: backend,
        bytes: bytes.length,
        originalSha256: hash(bytes),
        expectedBytes: expected.length,
        expectedSha256: hash(expected),
        result: 'pending',
      })
    }
  }
  const manifest = {
    sourceHead: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    platform: process.platform,
    osRelease: os.release(),
    preparedAt: new Date().toISOString(),
    status: 'pending-manual-native-input',
    cases,
  }
  await writeFile(path.join(root, 'manifest.json'), JSON.stringify(manifest, null, 2), {
    flag: 'wx',
  })
  console.log(
    JSON.stringify({ directory: root, cases: cases.map((c) => c.name), status: manifest.status }),
  )
} else {
  assert(
    /^(ordinary|windowed-js|windowed-native)-(source|live)$/.test(caseName ?? ''),
    'unknown case',
  )
  const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'))
  const c = manifest.cases.find((c) => c.name === caseName)
  assert(c, 'unknown case')
  const bytes = await readFile(path.join(root, `${c.name}.md`))
  const observation = {
    case: c.name,
    checkedAt: new Date().toISOString(),
    bytes: bytes.length,
    sha256: hash(bytes),
    byteMatch: bytes.length === c.expectedBytes && hash(bytes) === c.expectedSha256,
    imeAccepted: false,
    note: 'Disk bytes alone do not prove real IME, undo, selection, candidates, or platform acceptance.',
  }
  console.log(JSON.stringify(observation, null, 2))
  assert(observation.byteMatch, 'disk bytes differ from the single Chinese-prefix commit')
}
