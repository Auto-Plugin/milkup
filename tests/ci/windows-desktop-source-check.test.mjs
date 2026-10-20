import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const read = (name) => readFile(new URL(`../../${name}`, import.meta.url), 'utf8')

function assertP8SourceJob(workflow) {
  const job = workflow.split(/\r?\n  desktop-source:\r?\n/)[1]
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
  return job
}

test('P8 source job has independent public branch/marker gates and no delivery actions', async () => {
  assertP8SourceJob(await read('.github/workflows/v2-windows-catalog-check.yml'))
})

test('Windows backend milestone is isolated to its accepted baseline and explicit marker', async () => {
  const workflow = await read('.github/workflows/v2-windows-backends-check.yml')
  for (const required of [
    "github.repository == 'Auto-Plugin/milkup'",
    "github.ref == 'refs/heads/dot/milkup-v2-windows-backends'",
    'github.event.repository.private == false',
    'github.event.deleted == false',
    "contains(github.event.head_commit.message, '[windows-backends-check]')",
    '3747004b15e1dcf9c92b794b1f818c0853b98d11',
    'runs-on: windows-2025',
    'timeout-minutes: 60',
    'persist-credentials: false',
    'cancel-in-progress: false',
  ])
    assert.ok(workflow.includes(required), `Missing backend gate: ${required}`)
  assert.doesNotMatch(
    workflow,
    /upload-artifact|actions\/cache|--bundles|webviewInstallMode|secrets\./i,
  )
  const script = await read('scripts/ci/check-windows-desktop-source.ps1')
  assert.match(script, /switch -CaseSensitive \(\$env:GITHUB_REF\)/)
  assert.match(script, /default \{ throw 'Unexpected source-check scope' \}/)
  assert.match(script, /'merge-base', '--is-ancestor', \$baseline, 'HEAD'/)
  assert.match(script, /head_commit\.message\.Contains\(\$marker\)/)
  assert.match(script, /\$baseline = '3747004b15e1dcf9c92b794b1f818c0853b98d11'/)
})

test('the same LF and CRLF workflow preserves every P8 job gate', async () => {
  const lf = (await read('.github/workflows/v2-windows-catalog-check.yml')).replaceAll('\r\n', '\n')
  const crlf = lf.replaceAll('\n', '\r\n')
  assert.ok(crlf.includes('\r\n  desktop-source:\r\n'), 'Fixture must contain actual CRLF bytes')
  assert.equal(crlf.replaceAll('\r\n', '\n'), lf)
  const expectedJob = assertP8SourceJob(lf)
  assert.equal(assertP8SourceJob(crlf).replaceAll('\r\n', '\n'), expectedJob)
  for (const workflow of [lf, crlf]) {
    assert.throws(
      () =>
        assertP8SourceJob(workflow.replaceAll('github.event.repository.private == false', 'true')),
      /Missing gate: github.event.repository.private == false/,
    )
  }
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

test('W0 has a separate explicit experiment gate and preserves production source checks', async () => {
  const workflow = await read('.github/workflows/v2-windows-backends-check.yml')
  const job = workflow.split(/\r?\n  windows-w0:\r?\n/)[1]
  assert.ok(job)
  for (const gate of [
    "github.repository == 'Auto-Plugin/milkup'",
    "github.ref == 'refs/heads/dot/milkup-v2-windows-backends'",
    'github.event.repository.private == false',
    'github.event.deleted == false',
    "contains(github.event.head_commit.message, '[windows-w0-probe]')",
    'timeout-minutes: 15',
    'persist-credentials: false',
  ])
    assert.ok(job.includes(gate), `Missing W0 gate: ${gate}`)
  assert.doesNotMatch(job, /upload-artifact|actions\/cache|secrets\./i)
  const script = await read('scripts/ci/run-windows-w0-probe.ps1')
  assert.match(script, /Missing public W0 gate/)
  assert.match(script, /No installed WebView2 Runtime; W0 blocked without download fallback/)
  assert.match(script, /temporary-ci-no-network-private-directory-only/)
  assert.match(script, /cargo build --locked/)
  assert.doesNotMatch(script, /Invoke-WebRequest|Start-BitsTransfer|RunAs|CheckNetIsolation|netsh/i)
  const manifest = await read('scripts/ci/windows-w0-probe/Cargo.lock')
  const original = await read('apps/desktop/src-tauri/Cargo.lock')
  // A separate experimental closure may not silently bring in a new package/version.
  const blocks = (text) => text.split('[[package]]').slice(1)
  const key = (block) =>
    [
      block.match(/^name = (.+)$/m)?.[1],
      block.match(/^version = (.+)$/m)?.[1],
      block.match(/^checksum = (.+)$/m)?.[1],
    ].join('|')
  const allowed = new Set(blocks(original).map(key))
  for (const block of blocks(manifest)) {
    if (/^source = /m.test(block))
      assert.ok(allowed.has(key(block)), `New W0 dependency: ${key(block)}`)
  }
})

test('W0 matrix keeps its accepted baseline, private permissions and product boundary', async () => {
  const script = await read('scripts/ci/run-windows-w0-probe.ps1')
  assert.match(script, /param\(\[switch\]\$Matrix, \[switch\]\$UdpDiagnosis\)/)
  assert.match(script, /e37e9b43e0f8481074872a7514c62246e1cd0d0f/)
  assert.match(script, /\[windows-w0-matrix\]/)
  assert.match(script, /Get-Service -Name BFE, mpssvc, Dnscache/)
  assert.match(script, /Get-NetFirewallProfile/)
  assert.doesNotMatch(script, /Set-NetFirewall|Start-Service|Set-DnsClient|RunAs|Invoke-WebRequest/)
  const matrix = await read('scripts/ci/windows-w0-probe/src/windows-w0/matrix.rs')
  assert.match(matrix, /report\["fullIsolationGatePassed"\] = json!\(false\)/)
  assert.match(matrix, /NetworkIsolationGetAppContainerConfig/)
  assert.doesNotMatch(matrix, /NetworkIsolationSetAppContainerConfig/)
  assert.match(matrix, /\.arg\(&private\)/)
  const dns = await read('scripts/ci/windows-w0-probe/src/windows-w0/matrix/dns.rs')
  assert.match(dns, /request\.pDnsServerList = &mut servers/)
  assert.match(dns, /DNS_QUERY_NO_MULTICAST/)
  assert.match(dns, /not the WebView2 system DNS path/)
  const browser = await read('scripts/ci/windows-w0-probe/src/windows-w0/matrix/network.js')
  assert.match(browser, /iceTransportPolicy: 'relay'/)
  assert.doesNotMatch(browser, /stun:|getUserMedia|https:\/\//)
})

test('W0 UDP diagnosis compares held sockets without changing platform policy', async () => {
  const script = await read('scripts/ci/run-windows-w0-probe.ps1')
  assert.match(script, /1d095d4def531e73578902ad36591e13ed1d8d58/)
  assert.match(script, /Get-NetIPAddress -AddressFamily IPv4 -AddressState Preferred/)
  assert.doesNotMatch(script, /Set-Net|New-Net|Remove-Net|Start-Service|Stop-Service|RunAs/)
  const probe = await read('scripts/ci/windows-w0-probe/src/windows-w0/matrix/udp_diagnosis.rs')
  for (const variant of [
    'explicit-close',
    'explicit-held',
    'wildcard-held',
    'wildcard-connected',
    'wildcard-wsasendto',
  ])
    assert.ok(probe.includes(variant))
  assert.match(probe, /recv_from/)
  const matrix = await read('scripts/ci/windows-w0-probe/src/windows-w0/matrix.rs')
  assert.match(matrix, /udp_diagnosis::run\(input, "before-runtime"\)/)
  assert.match(matrix, /udp_diagnosis::run\(input, "after-runtime"\)/)
  assert.match(matrix, /loopbackExemptionsAfter-/)
})
