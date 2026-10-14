import { execFileSync } from 'node:child_process'
import { lstat, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const schemaOutputs = new Set(
  ['acl-manifests.json', 'capabilities.json', 'desktop-schema.json', 'windows-schema.json'].map(
    (name) => `apps/desktop/src-tauri/gen/schemas/${name}`,
  ),
)
export async function verifyBuildTree(root) {
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' })
  const changed = [
    ...new Set(
      [
        ...git('diff', '--name-only', '-z', 'HEAD').split('\0'),
        ...git('ls-files', '--others', '--exclude-standard', '-z').split('\0'),
      ].filter(Boolean),
    ),
  ]
  const record = {
    status: 'passed',
    changed,
    generatedSchemas: [],
    gitStatus: git('status', '--porcelain'),
  }
  for (const name of changed) {
    if (!schemaOutputs.has(name)) throw Error(`Build changed a source or unexpected file: ${name}`)
    const file = path.join(root, name)
    const stat = await lstat(file)
    if (!stat.isFile() || stat.size > 4 * 1024 * 1024)
      throw Error(`Invalid generated schema: ${name}`)
    const bytes = await readFile(file)
    JSON.parse(bytes.toString('utf8'))
    record.generatedSchemas.push({
      path: name,
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    })
  }
  return record
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  let record
  try {
    record = await verifyBuildTree(process.argv[2])
  } catch (error) {
    record = {
      status: 'failed',
      error: String(error),
      gitStatus: execFileSync('git', ['-C', process.argv[2], 'status', '--porcelain'], {
        encoding: 'utf8',
      }),
    }
    process.exitCode = 1
  }
  await writeFile(process.argv[3], JSON.stringify(record, null, 2))
  console.log(JSON.stringify(record))
}
