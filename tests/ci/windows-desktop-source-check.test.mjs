import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const read = (name) => readFile(new URL(`../../${name}`, import.meta.url), 'utf8')

test('P8 source job has independent public branch/marker gates and no delivery actions', async () => {
  const workflow = await read('.github/workflows/v2-windows-catalog-check.yml')
  const job = workflow.split('\n  desktop-source:\n')[1]
  assert.ok(job, 'Missing independent P8 desktop source job')
  for (const clause of [
    "github.repository == 'Auto-Plugin/milkup'",
    "github.ref == 'refs/heads/dot/milkup-v2-product-phase8-readiness'",
    'github.event.repository.private == false',
    'github.event.deleted == false',
    "contains(github.event.head_commit.message, '[windows-desktop-source-check]')",
    'runs-on: windows-2025',
    'timeout-minutes: 60',
    'persist-credentials: false',
    'a4d44e680478d7894450f30f3d533dc1c3131974',
  ])
    assert.ok(job.includes(clause), `Missing gate: ${clause}`)
  assert.doesNotMatch(
    job,
    /upload-artifact|actions\/cache|--bundles|build-windows-v2-package|webviewInstallMode|secrets\./i,
  )
  assert.match(workflow, /\[windows-catalog-check\]/)
  assert.match(workflow, /run-windows-baseline\.ps1/)
  assert.match(workflow, /^      - vendor\/\*\*$/m)
  const checkout = job.indexOf('uses: actions/checkout@')
  const longPaths = job.indexOf('git config --global core.longpaths true')
  assert.ok(longPaths >= 0 && longPaths < checkout, 'Long paths must be enabled before checkout')
  assert.match(
    job.slice(longPaths, checkout),
    /if \(\$LASTEXITCODE -ne 0\) \{ throw 'Git long-path configuration failed' \}/,
  )
  assert.doesNotMatch(job, /sparse-checkout:/)
})

test('source script checks, tests and links actual production app without bundler', async () => {
  const script = await read('scripts/ci/check-windows-desktop-source.ps1')
  for (const command of [
    "'install', '--frozen-lockfile'",
    "'test'",
    "'typecheck'",
    "'build'",
    'verify-public-plugin-builds.mjs',
    'stage-public-plugin-check.mjs',
    "'check', '--locked'",
    "'--all-targets'",
    'test-windows-rust-library.ps1',
    "'build', '--locked'",
    "'--release'",
    "'tauri/custom-protocol'",
    'verify-windows-app-manifest.ps1',
    'rust-test-result.json',
    '$LASTEXITCODE',
    'phases.json',
    'exitCode = $exitCode',
    'exitCode = $result.cargoExitCode',
    "$record['commands']",
  ])
    assert.ok(script.includes(command), `Missing phase/exit evidence: ${command}`)
  assert.doesNotMatch(
    script,
    /--bundles|\bnsis\b|tauri\s+build|downloadBootstrapper|offlineInstaller|upload-artifact/i,
  )
  assert.match(script, /x86_64-pc-windows-msvc/)
  assert.match(script, /RUST_TEST_THREADS\s*=\s*'1'/)
})

test('Windows updater dependency regressions cannot pass with an empty filter', async () => {
  const script = await read('scripts/ci/check-windows-desktop-source.ps1')
  const phase = script
    .split("Invoke-Phase 'windows-updater-launch-tests' {")[1]
    ?.split("$null = Invoke-Phase 'desktop-full-library-tests'")[0]
  assert.ok(phase, 'Dependency tests require their own checked phase')
  assert.match(phase, /'test', '--locked', '--manifest-path', \$manifest/)
  assert.match(phase, /'-p', 'tauri-plugin-updater', '--lib', 'windows_install::tests::'/)
  assert.match(phase, /Invoke-Checked cargo .*'--list'/)
  assert.match(phase, /foreach \(\$test in \$requiredTests\)/)
  assert.match(phase, /if \(\$testList -cnotcontains "\$\{test\}: test"\) \{ throw/)
  for (const name of [
    'rejected_launch_preserves_app_and_can_be_retried',
    'real_missing_executable_returns_error_without_cleanup_or_exit',
  ]) {
    assert.ok(phase.includes(`'windows_install::tests::${name}'`))
    assert.match(
      await read('vendor/tauri-plugin-updater/src/windows_install.rs'),
      new RegExp(`fn ${name}\\(`),
    )
  }
  assert.match(phase, /Invoke-Checked cargo .*'--nocapture', '--test-threads=1'/)
})
