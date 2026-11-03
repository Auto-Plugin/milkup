import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseImports } from './windows-loader-imports.mjs'

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')

export function inspectDependencies(application, importsText, tool) {
  assert.equal(application.subarray(0, 2).toString(), 'MZ', 'PE application required')
  const offset = application.readUInt32LE(0x3c)
  assert(offset >= 64 && offset + 26 <= application.length, 'Bounded PE header required')
  assert.equal(application.subarray(offset, offset + 4).toString('hex'), '50450000')
  assert.equal(application.readUInt16LE(offset + 4), 0x8664, 'Windows x64 image required')
  assert.equal(application.readUInt16LE(offset + 24), 0x20b, 'PE32+ image required')
  assert(importsText.length > 0 && importsText.length <= 2 * 1024 * 1024)
  const dlls = [...new Set(parseImports(importsText).map((item) => item.dll.toUpperCase()))].sort()
  assert(dlls.length > 0 && dlls.length <= 128, 'Actual bounded import table required')
  const extraVcRuntimeDlls = dlls.filter((name) =>
    /^(?:VCRUNTIME\d|MSVCP\d|CONCRT\d|VCOMP\d|UCRTBASED\.)/.test(name),
  )
  assert.deepEqual(
    extraVcRuntimeDlls,
    [],
    'Unexpected external VC redistributable dependency requires explicit handling',
  )
  assert(
    !dlls.includes('WEBVIEW2LOADER.DLL'),
    'Static WebView2Loader must not acquire an unbundled loader dependency',
  )
  assert(tool.subarray(0, 2).toString() === 'MZ', 'Actual Windows inspection tool required')
  return {
    schema: 1,
    status: 'passed',
    readOnly: true,
    applicationSha256: sha(application),
    architecture: 'x86_64',
    dlls,
    apiSets: dlls.filter((name) => /^(?:API|EXT)-MS-/.test(name)),
    extraVcRuntimeDlls,
    webview2Loader: 'static-no-loader-dll-import',
    webview2Runtime: 'external-existing-Evergreen',
    nodeOrPnpmRequiredAtRuntime: false,
    source: { dumpbinSha256: sha(tool), importsSha256: sha(Buffer.from(importsText)) },
    scope:
      'Actual static PE imports; Windows system/API-set resolution and WebView2 activation are separately exercised by installed-product acceptance.',
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  assert.equal(
    process.argv.length,
    6,
    'application imports-text dumpbin-executable output-json required',
  )
  const [application, imports, tool, output] = process.argv.slice(2)
  const [imageBytes, importsBytes, toolBytes] = await Promise.all(
    [application, imports, tool].map((name) => readFile(name)),
  )
  const result = inspectDependencies(imageBytes, importsBytes.toString('utf8'), toolBytes)
  await writeFile(output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' })
  console.log(JSON.stringify(result))
}
