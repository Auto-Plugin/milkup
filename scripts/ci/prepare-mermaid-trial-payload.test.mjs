// Pure verification fixtures. These tests never install or launch Windows code.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { deflateSync } from 'node:zlib'
import { expectedNsisImage } from './verify-nsis-image.mjs'
import {
  inspectDistArchives,
  inspectEmbeddedEngine,
  verifyInstalledEvidence,
  verifyRuntimeDependencies,
} from './prepare-mermaid-trial-payload.mjs'
import { crc32, validatePng } from '../../tests/windows/mermaid-product-e2e.mjs'

const root = fileURLToPath(new URL('../..', import.meta.url))
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
const writeJson = (file, value) => writeFile(file, JSON.stringify(value))

function dependencyFixture() {
  const imports = Buffer.from(
    'Dump of file extracted.exe\n  Image has the following imports:\n    KERNEL32.dll\n    api-ms-win-crt-runtime-l1-1-0.dll\n  Image has the following delay load imports:\n    ucrtbase.dll\n',
  )
  const applicationSha256 = 'a'.repeat(64)
  const report = {
    schema: 1,
    status: 'passed',
    readOnly: true,
    applicationSha256,
    architecture: 'x86_64',
    dlls: ['API-MS-WIN-CRT-RUNTIME-L1-1-0.DLL', 'KERNEL32.DLL', 'UCRTBASE.DLL'],
    apiSets: ['API-MS-WIN-CRT-RUNTIME-L1-1-0.DLL'],
    extraVcRuntimeDlls: [],
    webview2Loader: 'static-no-loader-dll-import',
    webview2Runtime: 'external-existing-Evergreen',
    nodeOrPnpmRequiredAtRuntime: false,
    source: { dumpbinSha256: 'b'.repeat(64), importsSha256: hash(imports) },
  }
  return { imports, applicationSha256, report }
}
test('payload dependency gate binds extracted image and raw normal/delay-load imports', () => {
  const { report, imports, applicationSha256 } = dependencyFixture()
  assert.equal(verifyRuntimeDependencies(report, imports, applicationSha256), report)
})
for (const scenario of [
  'wrong-image',
  'raw-drift',
  'empty-imports',
  'omitted-dll',
  'duplicate-dll',
  'wrong-api-set',
  'missing-extra-array',
  'wrong-architecture',
  'not-read-only',
  'bad-tool-hash',
  'runtime-installer',
  'node-runtime',
]) {
  test(`payload dependency gate rejects ${scenario}`, () => {
    let { report, imports, applicationSha256 } = dependencyFixture()
    if (scenario === 'wrong-image') report.applicationSha256 = 'c'.repeat(64)
    if (scenario === 'raw-drift') imports = Buffer.concat([imports, Buffer.from('\n')])
    if (scenario === 'empty-imports') {
      imports = Buffer.from('dumpbin could not open the application')
      report.source.importsSha256 = hash(imports)
      report.dlls = []
      report.apiSets = []
    }
    if (scenario === 'omitted-dll') report.dlls.pop()
    if (scenario === 'duplicate-dll') report.dlls.push(report.dlls[0])
    if (scenario === 'wrong-api-set') report.apiSets = []
    if (scenario === 'missing-extra-array') delete report.extraVcRuntimeDlls
    if (scenario === 'wrong-architecture') report.architecture = 'x86'
    if (scenario === 'not-read-only') report.readOnly = false
    if (scenario === 'bad-tool-hash') report.source.dumpbinSha256 = 'not-a-hash'
    if (scenario === 'runtime-installer') report.webview2Runtime = 'downloaded-runtime'
    if (scenario === 'node-runtime') report.nodeOrPnpmRequiredAtRuntime = true
    assert.throws(() => verifyRuntimeDependencies(report, imports, applicationSha256))
  })
}
for (const dll of [
  'vcruntime140_1.dll',
  'msvcp140.dll',
  'concrt140.dll',
  'vcomp140.dll',
  'ucrtbased.dll',
  'WebView2Loader.dll',
]) {
  test(`payload dependency gate detects ${dll} even when an empty extra-runtime list is claimed`, () => {
    const { report, imports, applicationSha256 } = dependencyFixture()
    const actual = Buffer.concat([imports, Buffer.from('    ' + dll + '\n')])
    report.source.importsSha256 = hash(actual)
    report.dlls.push(dll.toUpperCase())
    report.dlls.sort()
    assert.throws(() => verifyRuntimeDependencies(report, actual, applicationSha256))
  })
}
async function temporary(t, prefix) {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix))
  t.after(() => rm(directory, { recursive: true, force: true }))
  return directory
}
function archive(id = 'milkup.fixture', version = '1.0.0') {
  return (
    JSON.stringify(
      {
        format: 'milkup-plugin',
        version: 1,
        manifest: { id, version },
        files: [
          {
            path: 'dist/plugin.js',
            encoding: 'utf8',
            content: '中文 😀\r\n`quote` ${inert} \\ tail',
          },
        ],
      },
      null,
      2,
    ) + '\n'
  )
}
async function distFixture(t) {
  const dist = await temporary(t, 'milkup-trial-dist-')
  await mkdir(path.join(dist, 'assets'))
  await writeFile(
    path.join(dist, 'index.html'),
    '<script crossorigin src="/assets/main.js" type="module"></script>',
  )
  await writeFile(
    path.join(dist, 'assets/main.js'),
    'import "./plugins.js"; export const ready=true',
  )
  const text = archive()
  await writeFile(
    path.join(dist, 'assets/plugins.js'),
    `export const plugin = ${JSON.stringify(text)};`,
  )
  return {
    dist,
    text,
    expected: [
      {
        id: 'milkup.fixture',
        version: '1.0.0',
        bytes: Buffer.byteLength(text),
        sha256: hash(text),
      },
    ],
  }
}
test('production inspection reconstructs exact escaped Unicode/CRLF archive bytes through reachable imports', async (t) => {
  const { dist, expected } = await distFixture(t)
  await writeFile(
    path.join(dist, 'assets/orphan.js'),
    `const old = ${JSON.stringify(archive('milkup.old'))}`,
  )
  const proof = await inspectDistArchives(dist, expected)
  assert.equal(proof.archives.length, 1)
  assert.equal(proof.modules.length, 2)
  assert.equal(proof.archives[0].sha256, expected[0].sha256)
  assert(proof.archives[0].literalEnd > proof.archives[0].literalStart)
})
test('production inspection handles actual cooked template literals without evaluating code', async (t) => {
  const { dist, text, expected } = await distFixture(t)
  const literal = text.replaceAll('\\', '\\\\').replaceAll('`', '\\`').replaceAll('${', '\\${')
  await writeFile(
    path.join(dist, 'assets/plugins.js'),
    `throw Error('must never execute');const archive=\`${literal}\`;`,
  )
  const proof = await inspectDistArchives(dist, expected)
  assert.equal(proof.archives[0].sha256, expected[0].sha256)
})
for (const scenario of [
  'orphan-only',
  'comment-only',
  'wrong-bytes',
  'duplicate',
  'interpolation',
  'escape-path',
]) {
  test(`production evidence rejects ${scenario}`, async (t) => {
    const { dist, text, expected } = await distFixture(t)
    if (scenario === 'orphan-only')
      await writeFile(path.join(dist, 'assets/main.js'), 'export const ready=true')
    if (scenario === 'comment-only')
      await writeFile(path.join(dist, 'assets/plugins.js'), `/* ${JSON.stringify(text)} */`)
    if (scenario === 'wrong-bytes')
      await writeFile(
        path.join(dist, 'assets/plugins.js'),
        `const value=${JSON.stringify(text.replace('tail', 'changed'))}`,
      )
    if (scenario === 'duplicate')
      await writeFile(
        path.join(dist, 'assets/plugins.js'),
        `const first=${JSON.stringify(text)},second=${JSON.stringify(text)}`,
      )
    if (scenario === 'interpolation')
      await writeFile(path.join(dist, 'assets/plugins.js'), 'const value=`${globalThis.hidden}`')
    if (scenario === 'escape-path')
      await writeFile(path.join(dist, 'assets/main.js'), 'import "../../outside.js"')
    await assert.rejects(inspectDistArchives(dist, expected))
  })
}

test('binary evidence finds full official engine/bootstrap in both exact NSIS-related images', async () => {
  const engine = await readFile(
    path.join(root, 'apps/desktop/src-tauri/mermaid-engine/assets/mermaid-12.2.0.min.js'),
  )
  const bootstrap = await readFile(
    path.join(root, 'apps/desktop/src-tauri/mermaid-engine/assets/bootstrap.js'),
  )
  const compiled = Buffer.concat([
    Buffer.from('MZ\0__TAURI_BUNDLE_TYPE_VAR_UNK\0'),
    engine,
    Buffer.from('\0'),
    bootstrap,
  ])
  const { expected } = expectedNsisImage(compiled)
  const proof = inspectEmbeddedEngine(compiled, expected, engine, bootstrap)
  assert.equal(proof.changedBytes, 3)
  assert.equal(proof.compiled.engine.sha256, proof.extracted.engine.sha256)
  assert.equal(proof.compiled.bootstrap.sha256, hash(bootstrap))
  const changed = Buffer.from(expected)
  changed[2] ^= 1
  assert.throws(() => inspectEmbeddedEngine(compiled, changed, engine, bootstrap), /differs beyond/)
  const truncated = compiled.subarray(0, compiled.length - 1)
  assert.throws(
    () =>
      inspectEmbeddedEngine(truncated, expectedNsisImage(truncated).expected, engine, bootstrap),
    /bootstrap.*absent/,
  )
  const drifted = Buffer.from(engine)
  drifted[0] ^= 1
  assert.throws(() => inspectEmbeddedEngine(compiled, expected, drifted, bootstrap), /hash changed/)
})

function png() {
  const chunk = (kind, data) => {
    const bytes = Buffer.alloc(data.length + 12)
    bytes.writeUInt32BE(data.length)
    bytes.write(kind, 4)
    data.copy(bytes, 8)
    bytes.writeUInt32BE(crc32(bytes.subarray(4, -4)), bytes.length - 4)
    return bytes
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(2)
  header.writeUInt32BE(1, 4)
  header[8] = 8
  header[9] = 6
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.from([0, 255, 255, 255, 255, 0, 0, 0, 255]))),
    chunk('IEND', Buffer.alloc(0)),
  ])
}
async function installedFixture(t) {
  const directory = await temporary(t, 'milkup-trial-installed-')
  const sid = 'S-1-5-21-11-22-33-1001'
  const bytes = png()
  const image = { file: 'fixture.png', ...validatePng(bytes), fullyDecoded: true, nonuniform: true }
  await writeFile(path.join(directory, image.file), bytes)
  const expected = {
    candidateSha: 'a'.repeat(40),
    version: '2.0.0-beta.8',
    installerSha256: 'b'.repeat(64),
    installedSha256: 'c'.repeat(64),
    builtSha256: 'd'.repeat(64),
    applicationBytes: 1024,
    markerOffset: 32,
    resources: [{ relativePath: 'file.ico', bytes: 42, sha256: 'e'.repeat(64) }],
    bundledPlugins: Array.from({ length: 10 }, (_, index) => ({
      id: `milkup.fixture${index}`,
      version: '1.0.0',
      archiveFile: `milkup.fixture${index}-1.0.0.milkup-plugin`,
      bytes: 99,
      sha256: 'f'.repeat(64),
    })),
  }
  const nativeToken = {
    tokenType: 1,
    sessionId: 2,
    elevated: false,
    elevationType: 1,
    integrityRid: 8192,
    uiAccess: false,
    ownerIsUser: true,
    administratorsGroupPresentIncludingDenyOnly: false,
    administratorsGroupAttributes: null,
    privilegeCount: 1,
    hostDisallowedPrivilegeCount: 0,
    sandboxDisallowedPrivilegeCount: 0,
    seDebugPrivilegePresent: false,
  }
  const processToken = {
    ...nativeToken,
    sid,
    ownerSid: sid,
    pureStandardUser: true,
    filteredAdmin: false,
    privilegesComplete: true,
    privileges: [{ name: 'SeChangeNotifyPrivilege', attributes: 3 }],
  }
  const context = {
    status: 'ready',
    actualSid: sid,
    expectedSid: sid,
    pureStandard: true,
    filteredAdmin: false,
    expectedAccountKind: 'pure-standard',
    accountKindVerified: true,
    desktop: { token: processToken },
    interactive: true,
    sessionId: 2,
    expectedSessionId: 2,
    blockedReasons: [],
    knownFolders: {
      profile: 'C:/Users/test',
      roamingAppData: 'C:/Users/test/AppData/Roaming',
      localAppData: 'C:/Users/test/AppData/Local',
    },
  }
  const comparison = {
    status: 'passed',
    builtSha256: expected.builtSha256,
    expectedInstalledSha256: expected.installedSha256,
    installedSha256: expected.installedSha256,
    bytes: expected.applicationBytes,
    bundleMarkerOffset: expected.markerOffset,
    transformation: '__TAURI_BUNDLE_TYPE_VAR_UNK -> __TAURI_BUNDLE_TYPE_VAR_NSS',
  }
  const installation = {
    schema: 1,
    status: 'passed',
    candidateSha: expected.candidateSha,
    mode: 'nsis-current-user',
    expectedSid: sid,
    actualSid: sid,
    expectedSessionId: 2,
    sessionId: 2,
    installer: { sha256: expected.installerSha256 },
    installerRun: { status: 'passed', started: true, exited: true, exitCode: 0 },
    installedBinary: {
      path: 'C:/Users/test/Milkup/milkup-desktop.exe',
      productVersion: expected.version,
      peMachine: '0x8664',
      sha256: expected.installedSha256,
    },
    binaryComparison: comparison,
    resources: expected.resources.map((item) => ({ ...item, verified: true })),
    bundledPlugins: expected.bundledPlugins,
    embeddedPluginBinding: 'exact-installed-image-byte-comparison',
    productAcceptance: 'passed',
    cleanupErrors: [],
  }
  const audit = {
    status: 'passed',
    source: expected.candidateSha,
    accountSid: sid,
    expectedAccountKind: 'pure-standard',
    standardContext: context,
    accountCreated: true,
    accountDeleted: true,
    profileDeleted: true,
    stageRemoved: true,
    installerExecuted: true,
    runtimeInstalled: false,
    fixedRuntimeUsed: false,
    changedAcl: false,
    changedUacOrSecurityPolicy: false,
    passwordInLogsFilesArgumentsOrEnvironment: false,
    cleanupErrors: [],
    supervisor: { jobEmpty: true, cleanupErrors: [] },
    childResult: { status: 'passed', expectedAccountKind: 'pure-standard' },
    evidenceCopy: { complete: true },
  }
  const ownership = {
    hostSid: sid,
    childSid: sid,
    browserSid: sid,
    hostPureStandard: true,
    hostTokenClass: 'pure-standard',
    hostNonElevatedVerified: true,
    hostTokenEvidence: nativeToken,
    childTokenEvidence: { ...nativeToken, integrityRid: 4096 },
    browserTokenEvidence: { ...nativeToken, integrityRid: 4096 },
    appContainerSid: 'S-1-15-2-1-2-3-4-5-6-7',
    childAppContainerSid: 'S-1-15-2-1-2-3-4-5-6-7',
    browserAppContainerSid: 'S-1-15-2-1-2-3-4-5-6-7',
    appContainer: true,
    zeroCapabilities: true,
    browserAppContainer: true,
    browserZeroCapabilities: true,
    browserInOwnedJob: true,
    browserPid: 333,
  }
  const completion = {
    ...ownership,
    successful: true,
    ownedJobCreated: true,
    profileCreated: true,
    jobActiveAfterStop: 0,
    ipcThreadsCompleted: true,
    profileDeleted: true,
    privateTreeRemoved: true,
    cleanupUncertain: false,
    cancelled: false,
    deadlineExpired: false,
    ownedPidsBeforeStop: [222, 333],
    pngBytes: bytes.length,
    pngSha256: image.sha256,
  }
  const names = [
    '01-initial-disabled-source',
    '02-enable-and-exact-bytes',
    '03-real-edit-save-replacement',
    '04-undo-exact-original',
    '05-redo-exact-edit',
    '06-disable-and-reenable-in-place',
    '07-wide',
    '07-c4',
    '07-invalid',
    '08-final-disable',
  ]
  const product = {
    status: 'passed',
    candidateSha: expected.candidateSha,
    expectedAccountKind: 'pure-standard',
    application: installation.installedBinary.path,
    applicationSha256: expected.installedSha256,
    context,
    runtime: {
      provenance:
        'Existing installed Evergreen selected by reviewed wrapper; no runtime installation',
      sha256: '1'.repeat(64),
    },
    steps: names.map((name) => ({ name, passed: true, screenshot: image })),
    nativeAudit: [
      { phase: 'admitted', requestId: 'r1', productPid: 111 },
      { phase: 'started', requestId: 'r1', productPid: 111, ...ownership },
      { phase: 'finished', requestId: 'r1', productPid: 111, ...completion },
    ],
    launches: Array.from({ length: 4 }, () => ({ closedByUi: true })),
  }
  product.steps[0].bundledPluginsObserved = expected.bundledPlugins.map((item) => ({
    id: item.id,
    version: item.version,
    checked: 'false',
    busy: 'false',
  }))
  for (const index of [1, 2, 3, 4, 5, 6, 7])
    product.steps[index].image = { ...image, native: { productPid: 111 } }
  installation.installer.path = 'C:/owned/trial.exe'
  const identity = {
    pid: 555,
    token: processToken,
    sessionId: 2,
    inJob: true,
  }
  Object.assign(installation.installerRun, {
    identityVerified: true,
    streamsDrained: true,
    forcedProcessTermination: false,
    timedOut: false,
    cleanupErrors: [],
    callerIdentity: identity,
    startedProcess: {
      ...identity,
      pid: 556,
      image: installation.installer.path,
      imageTruncated: false,
      creationFileTime: '133123456789',
    },
  })
  audit.installedDirectoryRemoved = true
  const values = {
    'installation-result.json': installation,
    'installed-binary-comparison.json': comparison,
    'windows-standard-product-audit.json': audit,
    'mermaid-product-e2e.json': product,
  }
  const save = async () => {
    for (const [name, value] of Object.entries(values))
      await writeJson(path.join(directory, name), value)
  }
  await save()
  return { directory, expected, installation, comparison, audit, product, save }
}
test('final gate accepts consistent synthetic evidence without upgrading visual/IME claims', async (t) => {
  const fixture = await installedFixture(t)
  const proof = await verifyInstalledEvidence(fixture.directory, fixture.expected)
  assert.equal(proof.status, 'passed')
  assert.match(proof.scope, /no human visual\/IME\/DPI acceptance/)
  assert.equal(proof.records.length, 4)
})
for (const scenario of [
  'installation-pending',
  'wrong-installed-hash',
  'wrong-candidate',
  'different-sid',
  'administrator',
  'incomplete-steps',
  'enabled-plugin',
  'native-cleanup-uncertain',
  'account-left-behind',
  'runtime-installed',
  'forced-close',
  'pixel-tamper',
  'installer-wrong-sid',
  'installer-unverified',
  'installed-directory-left-behind',
  'missing-native-png',
  'observed-plugin-wrong-version',
  'missing-token-facts',
  'filtered-account-mixed-in',
  'native-privileged-browser',
  'native-limited-child',
  'native-limited-browser',
  'installer-disabled-debug-privilege',
]) {
  test(`final delivery gate rejects ${scenario}`, async (t) => {
    const f = await installedFixture(t)
    if (scenario === 'installation-pending') f.installation.status = 'pending'
    if (scenario === 'wrong-installed-hash') f.product.applicationSha256 = '9'.repeat(64)
    if (scenario === 'wrong-candidate') f.installation.candidateSha = '9'.repeat(40)
    if (scenario === 'different-sid') f.installation.actualSid += '-other'
    if (scenario === 'administrator') f.product.context.pureStandard = false
    if (scenario === 'incomplete-steps') f.product.steps.pop()
    if (scenario === 'enabled-plugin') f.product.steps[0].bundledPluginsObserved[1].checked = 'true'
    if (scenario === 'native-cleanup-uncertain')
      f.product.nativeAudit.at(-1).cleanupUncertain = true
    if (scenario === 'account-left-behind') f.audit.accountDeleted = false
    if (scenario === 'runtime-installed') f.audit.runtimeInstalled = true
    if (scenario === 'forced-close') f.product.launches[0].outerTerminationRequired = true
    if (scenario === 'pixel-tamper')
      await writeFile(path.join(f.directory, 'fixture.png'), Buffer.from('not a PNG'))
    if (scenario === 'installer-wrong-sid')
      f.installation.installerRun.startedProcess.token = {
        ...f.installation.installerRun.startedProcess.token,
        sid: 'wrong',
      }
    if (scenario === 'installer-unverified') f.installation.installerRun.identityVerified = false
    if (scenario === 'installed-directory-left-behind') f.audit.installedDirectoryRemoved = false
    if (scenario === 'missing-native-png') delete f.product.steps[2].image
    if (scenario === 'observed-plugin-wrong-version')
      f.product.steps[0].bundledPluginsObserved[0].version = '0.0.0'
    if (scenario === 'missing-token-facts') delete f.product.context.desktop.token.ownerSid
    if (scenario === 'filtered-account-mixed-in') f.product.expectedAccountKind = 'filtered-admin'
    if (scenario === 'native-privileged-browser')
      f.product.nativeAudit.at(-1).browserTokenEvidence.sandboxDisallowedPrivilegeCount = 1
    if (scenario === 'native-limited-child')
      f.product.nativeAudit.at(-1).childTokenEvidence.elevationType = 3
    if (scenario === 'native-limited-browser')
      f.product.nativeAudit.at(-1).browserTokenEvidence.elevationType = 3
    if (scenario === 'installer-disabled-debug-privilege')
      f.installation.installerRun.startedProcess.token.privileges[0] = {
        name: 'SeDebugPrivilege',
        attributes: 0,
      }
    await f.save()
    await assert.rejects(verifyInstalledEvidence(f.directory, f.expected))
  })
}
