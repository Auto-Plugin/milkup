import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { test } from 'node:test'
import {
  diagnoseImports,
  missingNames,
  parseExports,
  parseImports,
} from '../../scripts/ci/windows-loader-imports.mjs'

const imports = `
  Section contains the following imports:
    COMCTL32.dll
             140100000 Import Address Table
             140200000 Import Name Table
                     0 time date stamp
                     0 Index of first forwarder reference
                          164 TaskDialogIndirect
                          11A InitCommonControlsEx
    KERNEL32.dll
                           10 ExitProcess
  Section contains the following delay load imports:
    optional.dll
                           20 OptionalFunction
  Summary
        1000 .data
`
const exports = `
  ordinal hint RVA      name
        1    0 00001000 InitCommonControlsEx
        2    1          ForwardedFunction (forwarded to KERNEL32.ExitProcess)
        3    2 00002000 ?Decorated@@Function
  Summary
        1000 .data
`
test('parses direct and delay imports without counting address-table headings', () => {
  assert.deepEqual(parseImports(imports), [
    { dll: 'COMCTL32.dll', delayed: false, names: ['TaskDialogIndirect', 'InitCommonControlsEx'] },
    { dll: 'KERNEL32.dll', delayed: false, names: ['ExitProcess'] },
    { dll: 'optional.dll', delayed: true, names: ['OptionalFunction'] },
  ])
})
test('compares exact export names, preserving forwarded and decorated exports', () => {
  assert.deepEqual(
    [...parseExports(exports)],
    ['InitCommonControlsEx', 'ForwardedFunction', '?Decorated@@Function'],
  )
  assert.deepEqual(missingNames(parseImports(imports)[0], parseExports(exports)), [
    'TaskDialogIndirect',
  ])
  assert.deepEqual(missingNames({ names: ['initCommonControlsEx'] }, parseExports(exports)), [
    'initCommonControlsEx',
  ])
})
test('reports concrete missing candidates and recursively inspects dependencies without claiming loader resolution', () => {
  const files = new Map([
    [
      'app.exe:/imports',
      '    custom.dll\n          10 Start\n    api-ms-win-core-test.dll\n          20 SystemApi\n',
    ],
    ['app/custom.dll:/exports', '  1 0 00001000 Start\n'],
    ['app/custom.dll:/imports', '    COMCTL32.dll\n          10 TaskDialogIndirect\n'],
    ['system/COMCTL32.dll:/exports', '  1 0 00001000 InitCommonControlsEx\n'],
    ['system/COMCTL32.dll:/imports', ''],
    ['v6/COMCTL32.dll:/exports', '  1 0 00001000 TaskDialogIndirect\n'],
    ['v6/COMCTL32.dll:/imports', ''],
  ])
  const report = diagnoseImports('app.exe', 'dumpbin', ['app', 'system', 'v6'], {
    join: path.posix.join,
    exists: (file) => files.has(`${file}:/exports`),
    run: (flag, file) => {
      assert.ok(files.has(`${file}:${flag}`))
      return files.get(`${file}:${flag}`)
    },
  })
  assert.equal(report.diagnosticOnly, true)
  assert.match(report.limitation, /not a proven root cause/)
  assert.deepEqual(report.missing, [
    {
      importer: 'app/custom.dll',
      dll: 'COMCTL32.dll',
      path: 'system/COMCTL32.dll',
      delayed: false,
      names: ['TaskDialogIndirect'],
    },
  ])
  assert.deepEqual(report.errors, [])
  assert.equal(report.modules[0].imports[1].resolution, 'OS API-set; not compared')
  assert.equal(report.truncated, false)
})
test('failed tool inspection is recorded as uncertainty, never a missing symbol', () => {
  const report = diagnoseImports('app.exe', 'dumpbin', [], {
    run: () => {
      throw new Error('tool unavailable')
    },
  })
  assert.deepEqual(report.missing, [])
  assert.equal(report.errors[0].error, 'tool unavailable')
})
test('Windows gate runs the original full suite and temporary-copy probes cannot satisfy it', async () => {
  const wrapper = await readFile(
    new URL('../../scripts/ci/test-windows-rust-library.ps1', import.meta.url),
    'utf8',
  )
  assert.match(
    wrapper,
    /cargo test --locked --manifest-path apps\/desktop\/src-tauri\/Cargo.toml --lib --message-format=json/,
  )
  assert.doesNotMatch(wrapper, /--no-run|--list|--skip/)
  assert.match(wrapper, /\$testExitCode = \$LASTEXITCODE/)
  assert.match(wrapper, /throw "Full Rust library test suite failed/)
  const probe = await readFile(
    new URL('../../scripts/ci/capture-windows-rust-loader.ps1', import.meta.url),
    'utf8',
  )
  assert.match(probe, /Copy-Item -LiteralPath \$Executable -Destination \$probe/)
  assert.match(probe, /-outputresource:\$probe;#1/)
  assert.doesNotMatch(probe, /-outputresource:\$Executable/)
  assert.match(probe, /originalUnchanged/)
  assert.match(probe, /WaitForExit\(120000\)/)
  assert.match(probe, /Remove-Item -LiteralPath \$probe/)
})

test('build retains the fatal Rust gate and workflow publishes bounded diagnostic logs only', async () => {
  const read = (name) => readFile(new URL(`../../${name}`, import.meta.url), 'utf8')
  const build = await read('scripts/ci/build-windows-v2-package.ps1')
  assert.match(build, /test-windows-rust-library.ps1/)
  assert.ok(
    build.indexOf('test-windows-rust-library.ps1') <
      build.indexOf("Invoke-Checked 'pnpm' $tauriArguments"),
  )
  const workflow = await read('.github/workflows/v2-windows-plugin-offline-delivery.yml')
  for (const evidence of [
    'rust-test-result.json',
    'rust-loader-result.json',
    'rust-v6-list.log',
    'rust-v6-tests.log',
  ])
    assert.ok(workflow.includes(evidence))
  assert.match(workflow, /Min\(\$text.Length, 65536\)/)
  assert.equal((workflow.match(/actions\/upload-artifact@/g) ?? []).length, 1)
  assert.doesNotMatch(workflow, /continue-on-error/)
})
