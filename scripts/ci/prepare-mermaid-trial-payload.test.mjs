import { syntheticRapidScroll } from '../../tests/windows/mermaid-gui-test-fixtures.mjs'
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
  inspectFrontendAssets,
  inspectEmbeddedEngine,
  verifyInstalledEvidence,
  verifyInstalledGuiEvidence,
  verifyInstalledGuiMatrix,
  requireGuiEvidence,
  verifyPayloadInventory,
  guiDeliveryFiles,
  verifyInstalledAccountMatrix,
  verifyInstalledProductCloses,
  verifyRuntimeDependencies,
} from './prepare-mermaid-trial-payload.mjs'
import {
  encodeGuiEvidence,
  GUI_STEPS,
  validateNativeDpiObservation,
} from '../../tests/windows/mermaid-gui-contract.mjs'
import {
  crc32,
  validatePng,
  syntaxCases,
  encodeProductEvidence,
} from '../../tests/windows/mermaid-product-e2e.mjs'
import { syntheticWideInteraction } from '../../tests/windows/mermaid-gui-test-fixtures.mjs'

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

function png(width = 2, height = 1) {
  const chunk = (kind, data) => {
    const bytes = Buffer.alloc(data.length + 12)
    bytes.writeUInt32BE(data.length)
    bytes.write(kind, 4)
    data.copy(bytes, 8)
    bytes.writeUInt32BE(crc32(bytes.subarray(4, -4)), bytes.length - 4)
    return bytes
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 6
  const pixels = Buffer.alloc((width * 4 + 1) * height, 255)
  for (let y = 0; y < height; y++) {
    const row = y * (width * 4 + 1)
    pixels[row] = 0
    for (let x = Math.ceil(width / 2); x < width; x++)
      pixels.fill(0, row + 1 + x * 4, row + 1 + x * 4 + 3)
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(pixels)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}
function cleanLaunch(fixture, productPid) {
  const phases = [
    'native-drain',
    'ui-close',
    'ui-exit-wait',
    'stdio-drain',
    'normal-exit',
    'native-final-verification',
    'webdriver-detach',
  ].map((phase) => ({ phase, ok: true, result: true }))
  phases[0].result = { admittedJobs: 1, innerCleanupVerified: true }
  phases[1].result = { realUiCloseRequested: true }
  phases[5].result = { admittedJobs: 1, innerCleanupVerified: true }
  return {
    fixture,
    productPid,
    exitCode: 0,
    signal: null,
    exitObservedMonotonicMs: 5,
    exitedAt: '2026-11-03T00:00:01Z',
    stdioClosedAt: '2026-11-03T00:00:01Z',
    closedByUi: true,
    teardown: {
      afterFailure: false,
      ownedProductPid: productPid,
      uiCloseAttempted: true,
      realUiCloseRequested: true,
      closedByUi: true,
      errors: [],
      phases,
    },
  }
}

async function installedFixture(
  t,
  { accountKind = 'pure-standard', parent, sameSid = false } = {},
) {
  const filtered = accountKind === 'filtered-admin'
  const directory = parent
    ? path.join(parent, accountKind)
    : await temporary(t, 'milkup-trial-installed-')
  if (parent) await mkdir(directory)
  const sid = 'S-1-5-21-11-22-33-' + (filtered && !sameSid ? '1002' : '1001')
  const bytes = png()
  const image = { file: 'fixture.png', ...validatePng(bytes), fullyDecoded: true, nonuniform: true }
  await writeFile(path.join(directory, image.file), bytes)
  const expected = {
    candidateSha: 'dbb7c3bf49c9135eb10a695b7f824fff0cc56fe7',
    version: '2.0.0-beta.9',
    expectedAccountKind: accountKind,
    harnessSha256: '8'.repeat(64),
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
  const defaultLinkedAuthority = {
    callerThreadTokenAbsent: true,
    callerThreadQueryWin32Error: 1008,
    queryAttempted: false,
    querySucceeded: false,
    queryWin32Error: null,
    targetTokenType: null,
    targetImpersonationLevel: null,
    targetQueryWin32Error: null,
  }
  const nativeToken = {
    tokenType: 1,
    sessionId: 2,
    elevated: false,
    elevationType: filtered ? 3 : 1,
    integrityRid: 8192,
    uiAccess: false,
    ownerIsUser: true,
    administratorsGroupPresentIncludingDenyOnly: filtered,
    administratorsGroupAttributes: filtered ? 16 : null,
    privilegeCount: 1,
    hostDisallowedPrivilegeCount: 0,
    sandboxDisallowedPrivilegeCount: 0,
    seDebugPrivilegePresent: false,
    linkedAuthority: null,
  }
  const processToken = {
    ...nativeToken,
    sid,
    ownerSid: sid,
    pureStandardUser: !filtered,
    filteredAdmin: filtered,
    privilegesComplete: true,
    privileges: [{ name: 'SeChangeNotifyPrivilege', attributes: 3 }],
  }
  const context = {
    status: 'ready',
    actualSid: sid,
    expectedSid: sid,
    pureStandard: !filtered,
    filteredAdmin: filtered,
    expectedAccountKind: accountKind,
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
    expectedAccountKind: accountKind,
    expectedSid: sid,
    actualSid: sid,
    expectedSessionId: 2,
    sessionId: 2,
    installer: { sha256: expected.installerSha256 },
    installerRun: { status: 'passed', started: true, exited: true, exitCode: 0 },
    installedBinary: {
      path: 'C:/Users/test/Milkup/milkup-desktop.exe',
      productVersion: expected.version,
      fileVersion: expected.version,
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
    expectedAccountKind: accountKind,
    standardContext: context,
    accountCreated: true,
    accountDeleted: true,
    accountGroupCleanupConfirmed: true,
    accountGroupCleanup: {
      sid,
      readOnly: true,
      complete: true,
      errors: [],
      groups: ['S-1-5-32-545', 'S-1-5-32-544'].map((groupSid) => ({
        groupSid,
        queried: true,
        exactSidPresent: false,
      })),
    },
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
    childResult: { status: 'passed', expectedAccountKind: accountKind },
    evidenceCopy: { complete: true },
  }
  const ownership = {
    hostSid: sid,
    childSid: sid,
    browserSid: sid,
    hostPureStandard: !filtered,
    hostTokenClass: accountKind,
    hostNonElevatedVerified: true,
    hostTokenEvidence: nativeToken,
    childTokenEvidence: {
      ...nativeToken,
      integrityRid: 4096,
      linkedAuthority: { ...defaultLinkedAuthority },
    },
    browserTokenEvidence: {
      ...nativeToken,
      integrityRid: 4096,
      linkedAuthority: { ...defaultLinkedAuthority },
    },
    helperSelfTokenEvidence: {
      ...nativeToken,
      integrityRid: 4096,
      linkedAuthority: { ...defaultLinkedAuthority },
    },
    browserFromHelperTokenEvidence: {
      ...nativeToken,
      integrityRid: 4096,
      linkedAuthority: { ...defaultLinkedAuthority },
    },
    helperNativeProofVerified: true,
    helperProtocolHandlesNonInheritable: true,
    helperSelfSid: sid,
    browserFromHelperSid: sid,
    helperSelfAppContainerSid: 'S-1-15-2-1-2-3-4-5-6-7',
    browserFromHelperAppContainerSid: 'S-1-15-2-1-2-3-4-5-6-7',
    helperPid: 222,
    helperSelfObserverPid: 222,
    helperSelfSubjectPid: 222,
    browserFromHelperObserverPid: 222,
    browserFromHelperSubjectPid: 333,
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
    '01-default-mermaid-preview',
    '02-enable-and-exact-bytes',
    '03-real-edit-save-replacement',
    '04-undo-exact-original',
    '05-redo-exact-edit',
    '06-disable-and-reenable-in-place',
    '07-wide',
    '07-c4',
    '07-syntax',
    '07-invalid',
    '08-final-disable',
  ]
  const product = {
    status: 'passed',
    candidateSha: expected.candidateSha,
    harnessSha256: expected.harnessSha256,
    expectedAccountKind: accountKind,
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
    launches: ['ordinary', 'wide', 'c4', 'syntax', 'invalid'].map((fixture, index) =>
      cleanLaunch(fixture, 111 + index),
    ),
  }
  Object.assign(product.steps[1], {
    modeTransitions: [
      { mode: 'source', strategy: 'preview', cursor: 35, images: 0 },
      { mode: 'live', strategy: 'preview', cursor: 35, images: 1 },
      { mode: 'source', strategy: 'preview', cursor: 35, images: 0 },
      { mode: 'live', strategy: 'preview', cursor: 35, images: 1 },
      { mode: 'live', strategy: 'live', cursor: 35, images: 0 },
    ],
    hotEnableWithoutRestart: true,
    editorEditableAfterHotEnable: true,
    editorCopy: { isTrusted: true, defaultPrevented: true },
    editorCopyExactSource: true,
    sourcePreserved: true,
  })
  product.steps[3].pluginUndo = {
    editorMode: 'live',
    strategy: 'preview',
    editable: true,
    versionBefore: 1,
    versionAfter: 2,
    modeAfter: 'live',
    exactSourceRestored: true,
  }
  product.steps.find((step) => step.name === '07-syntax').syntaxCases = syntaxCases.map((item) => ({
    id: item.id,
    sourceSha256: hash(item.source),
    image: { ...image, native: { productPid: 111 } },
  }))
  product.steps[0].bundledPluginsObserved = expected.bundledPlugins.map((item) => ({
    id: item.id,
    version: item.version,
    checked: item.id === 'milkup.diagrams' ? 'true' : 'false',
    busy: 'false',
  }))
  for (const index of [1, 2, 3, 4, 5, 6, 7])
    product.steps[index].image = { ...image, native: { productPid: 111 } }
  installation.installer.path = 'C:/owned/trial.exe'
  const identity = {
    pid: 555,
    expectedAccountKind: accountKind,
    accountKindVerified: true,
    token: processToken,
    sessionId: 2,
    inJob: true,
  }
  Object.assign(installation.installerRun, {
    expectedAccountKind: accountKind,
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
  if (filtered) limitedNativeViews(product)
  const save = async () => {
    for (const [name, value] of Object.entries(values))
      await writeJson(path.join(directory, name), value)
  }
  await save()
  return { directory, expected, installation, comparison, audit, product, save }
}
const limitedNativeViews = (product) => {
  for (const event of product.nativeAudit) {
    if (!['started', 'finished'].includes(event.phase)) continue
    for (const field of [
      'childTokenEvidence',
      'browserTokenEvidence',
      'helperSelfTokenEvidence',
      'browserFromHelperTokenEvidence',
    ]) {
      event[field] = {
        ...event[field],
        elevationType: 3,
        linkedAuthority: {
          callerThreadTokenAbsent: true,
          callerThreadQueryWin32Error: 1008,
          queryAttempted: true,
          querySucceeded: true,
          queryWin32Error: null,
          targetTokenType: 2,
          targetImpersonationLevel: 1,
          targetQueryWin32Error: null,
        },
      }
    }
  }
}
test('final gate accepts consistent synthetic evidence without upgrading visual/IME claims', async (t) => {
  const fixture = await installedFixture(t)
  const proof = await verifyInstalledEvidence(fixture.directory, fixture.expected)
  assert.equal(proof.status, 'passed')
  assert.match(proof.scope, /no human visual\/IME\/DPI acceptance/)
  assert.equal(proof.records.length, 4)
})
test('installed standard-host evidence accepts Limited native views only with identification proofs', async (t) => {
  const fixture = await installedFixture(t)
  limitedNativeViews(fixture.product)
  await fixture.save()
  assert.equal(
    (await verifyInstalledEvidence(fixture.directory, fixture.expected)).status,
    'passed',
  )
})
test('installed filtered-admin evidence preserves real Limited/deny-only identities throughout', async (t) => {
  const fixture = await installedFixture(t, { accountKind: 'filtered-admin' })
  const proof = await verifyInstalledEvidence(fixture.directory, fixture.expected)
  assert.equal(proof.status, 'passed')
  assert.equal(proof.expectedAccountKind, 'filtered-admin')
  assert.equal(fixture.product.context.pureStandard, false)
  assert.equal(fixture.installation.installerRun.startedProcess.token.elevationType, 3)
})
test('final account matrix requires two separately verified installations with distinct actual SIDs', async (t) => {
  const parent = await temporary(t, 'milkup-trial-two-accounts-')
  const pure = await installedFixture(t, { parent })
  await installedFixture(t, { parent, accountKind: 'filtered-admin' })
  const proof = await verifyInstalledAccountMatrix(parent, pure.expected)
  assert.equal(proof.status, 'passed')
  assert.equal(proof.naturalUiCloses, 10)
  assert.deepEqual(Object.keys(proof.accounts), ['pure-standard', 'filtered-admin'])
  for (const account of Object.values(proof.accounts)) assert.equal(account.records.length, 4)
})
for (const scenario of [
  'missing-account',
  'extra-account',
  'same-sid',
  'failed-admin',
  'different-package',
]) {
  test(`final account matrix rejects ${scenario}`, async (t) => {
    const parent = await temporary(t, 'milkup-trial-two-accounts-')
    const pure = await installedFixture(t, { parent })
    if (scenario !== 'missing-account') {
      const admin = await installedFixture(t, {
        parent,
        accountKind: 'filtered-admin',
        sameSid: scenario === 'same-sid',
      })
      if (scenario === 'failed-admin') admin.product.steps[5].passed = false
      if (scenario === 'different-package') admin.installation.installer.sha256 = '9'.repeat(64)
      await admin.save()
    }
    if (scenario === 'extra-account') await mkdir(path.join(parent, 'unexpected'))
    await assert.rejects(verifyInstalledAccountMatrix(parent, pure.expected))
  })
}

test('installed close gate preserves actual prior successes and failures without mutating raw reports', async () => {
  for (const [run, outcomes] of [
    ['41688389731', [true, false]],
    ['41692476025', [false, true]],
    ['41699494037', [false, true]],
    ['41703213523', [true, true]],
  ]) {
    for (const [index, account] of ['pure-standard', 'filtered-admin'].entries()) {
      const report = JSON.parse(
        await readFile(
          path.join(
            root,
            'docs/evidence/mermaid-account-compat-2026-11-03',
            `attempt-${run}/extracted/${account}/mermaid-product-e2e.json`,
          ),
          'utf8',
        ),
      )
      const before = JSON.stringify(report)
      if (outcomes[index]) assert.equal(verifyInstalledProductCloses(report).naturalUiCloses, 4)
      else assert.throws(() => verifyInstalledProductCloses(report))
      assert.equal(JSON.stringify(report), before)
    }
  }
})

function responseHistory(value, decision, status = 200) {
  const text = JSON.stringify({ value })
  const bytes = Buffer.from(text)
  const row = {
    sequence: 1,
    startedAt: '2026-11-03T00:00:00Z',
    finishedAt: '2026-11-03T00:00:00Z',
    decision,
    httpStatus: status,
    response: { text, bytes: bytes.length, sha256: hash(bytes), truncated: false },
  }
  if (value === false || value === null)
    Object.assign(row, { value, valueType: value === null ? 'null' : 'boolean' })
  else if (value?.error)
    Object.assign(row, {
      webDriverErrorCode: value.error,
      error: {
        text: 'protocol error',
        bytes: 14,
        sha256: hash(Buffer.from('protocol error')),
        truncated: false,
      },
    })
  return { retainedLimit: 32, total: 1, omitted: 0, observations: [row] }
}
test('close proof permits the final pending observation and truncated protocol evidence only with actual owned exit', () => {
  const product = {
    launches: ['ordinary', 'wide', 'c4', 'syntax', 'invalid'].map((name, i) =>
      cleanLaunch(name, 111 + i),
    ),
  }
  product.launches[0].closeConfirmationProbes = {
    retainedLimit: 32,
    total: 1,
    omitted: 0,
    observations: [{ sequence: 1, startedAt: '2026-11-03T00:00:00Z', decision: 'pending' }],
  }
  const history = responseHistory(
    { error: 'target frame detached', message: 'a'.repeat(3000) },
    'closed-context-awaiting-owned-exit',
    404,
  )
  const response = history.observations[0].response
  response.text = response.text.slice(0, 2048)
  response.truncated = true
  product.launches[1].closeConfirmationProbes = history
  const summary = verifyInstalledProductCloses(product, true)
  assert.equal(summary.naturalUiCloses, 5)
  assert.equal(summary.independentMonotonicDeadlineRecomputed, false)
  assert.equal(summary.dialogAbsenceInferredFromNullOrExit, false)
  product.launches[1].signal = 'SIGTERM'
  assert.throws(() => verifyInstalledProductCloses(product, true))
})
for (const scenario of [
  'raw-positive-dialog',
  'false-raw-mismatch',
  'raw-hash-mismatch',
  'detached-wrong-status',
  'lost-positive-history',
  'failed-close-phase',
  'missing-stdio',
  'missing-signal',
  'deadline-unmet',
  'fallback',
  'native-not-clean',
]) {
  test(`installed close gate rejects ${scenario}`, () => {
    const product = {
      launches: ['ordinary', 'wide', 'c4', 'syntax', 'invalid'].map((name, i) =>
        cleanLaunch(name, 111 + i),
      ),
    }
    const launch = product.launches[0]
    launch.closeConfirmationProbes = responseHistory(false, 'no-visible-unsaved-dialog')
    if (scenario === 'raw-positive-dialog')
      launch.closeConfirmationProbes = responseHistory(true, 'pending')
    if (scenario === 'false-raw-mismatch')
      launch.closeConfirmationProbes.observations[0].value = null
    if (scenario === 'raw-hash-mismatch')
      launch.closeConfirmationProbes.observations[0].response.sha256 = '0'.repeat(64)
    if (scenario === 'detached-wrong-status')
      launch.closeConfirmationProbes = responseHistory(
        { error: 'target frame detached' },
        'closed-context-awaiting-owned-exit',
        500,
      )
    if (scenario === 'lost-positive-history') launch.closeConfirmationProbes.firstVisibleDialog = {}
    if (scenario === 'failed-close-phase') launch.teardown.phases[2].ok = false
    if (scenario === 'missing-stdio') delete launch.stdioClosedAt
    if (scenario === 'missing-signal') delete launch.signal
    if (scenario === 'deadline-unmet') launch.teardown.uiExitDeadlineUnmet = true
    if (scenario === 'fallback') launch.teardown.outerTerminationRequired = true
    if (scenario === 'native-not-clean')
      launch.teardown.phases[0].result.innerCleanupVerified = false
    assert.throws(() => verifyInstalledProductCloses(product, true))
  })
}
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
  'native-limited-child-without-proof',
  'native-limited-browser-without-proof',
  'installer-disabled-debug-privilege',
  'native-missing-helper-self-proof',
  'native-missing-browser-from-helper-proof',
  'native-primary-linked-target',
  'native-usable-impersonation-target',
  'native-linked-query-failure',
  'native-partial-linked-proof',
  'native-impersonating-caller',
  'native-spoofed-helper-pid',
  'native-foreign-helper-appsid',
  'wrong-harness',
  'missing-installer-account-kind',
  'unverified-installer-account',
  'missing-file-version',
  'group-membership-remains',
  'missing-group-proof',
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
    if (scenario === 'native-limited-child-without-proof')
      f.product.nativeAudit.at(-1).childTokenEvidence.elevationType = 3
    if (scenario === 'native-limited-browser-without-proof')
      f.product.nativeAudit.at(-1).browserTokenEvidence.elevationType = 3
    if (scenario === 'installer-disabled-debug-privilege')
      f.installation.installerRun.startedProcess.token.privileges[0] = {
        name: 'SeDebugPrivilege',
        attributes: 0,
      }
    if (scenario === 'native-missing-helper-self-proof')
      f.product.nativeAudit.at(-1).helperSelfTokenEvidence = null
    if (scenario === 'native-missing-browser-from-helper-proof')
      f.product.nativeAudit.at(-1).browserFromHelperTokenEvidence = null
    if (
      [
        'native-primary-linked-target',
        'native-usable-impersonation-target',
        'native-linked-query-failure',
        'native-partial-linked-proof',
        'native-impersonating-caller',
      ].includes(scenario)
    ) {
      limitedNativeViews(f.product)
      const proof = f.product.nativeAudit.at(-1).browserFromHelperTokenEvidence.linkedAuthority
      if (scenario === 'native-primary-linked-target') proof.targetTokenType = 1
      if (scenario === 'native-usable-impersonation-target') proof.targetImpersonationLevel = 2
      if (scenario === 'native-linked-query-failure') proof.queryWin32Error = 5
      if (scenario === 'native-partial-linked-proof') delete proof.targetQueryWin32Error
      if (scenario === 'native-impersonating-caller') proof.callerThreadTokenAbsent = false
    }
    if (scenario === 'native-spoofed-helper-pid')
      f.product.nativeAudit.at(-1).helperSelfSubjectPid = 333
    if (scenario === 'native-foreign-helper-appsid')
      f.product.nativeAudit.at(-1).browserFromHelperAppContainerSid = 'S-1-15-2-8-2-3-4-5-6-7'
    if (scenario === 'wrong-harness') f.product.harnessSha256 = '0'.repeat(64)
    if (scenario === 'missing-installer-account-kind')
      delete f.installation.installerRun.expectedAccountKind
    if (scenario === 'unverified-installer-account')
      f.installation.installerRun.startedProcess.accountKindVerified = false
    if (scenario === 'missing-file-version') delete f.installation.installedBinary.fileVersion
    if (scenario === 'group-membership-remains')
      f.audit.accountGroupCleanup.groups[1].exactSidPresent = true
    if (scenario === 'missing-group-proof') delete f.audit.accountGroupCleanup
    await f.save()
    await assert.rejects(verifyInstalledEvidence(f.directory, f.expected))
  })
}

// Synthetic verifier fixtures only. No Windows execution or product acceptance
// is claimed by these deliberately tiny PNGs and in-memory audit records.
async function guiInstalledFixture(t, options = {}) {
  const f = await installedFixture(t, options)
  const { installation, audit, expected, product, directory } = f
  // The general installer fixture uses invented package IDs. This GUI-specific
  // synthetic fixture also exercises the explicit Diagrams persistence gate.
  const originalFirstId = expected.bundledPlugins[0].id
  Object.assign(expected.bundledPlugins[0], {
    id: 'milkup.diagrams',
    version: '1.3.0',
    archiveFile: 'milkup.diagrams-1.3.0.milkup-plugin',
  })
  Object.assign(
    product.steps[0].bundledPluginsObserved.find((item) => item.id === originalFirstId),
    { id: 'milkup.diagrams', version: '1.3.0' },
  )
  expected.version = '2.0.0-beta.10'
  expected.contractSha256 = '9'.repeat(64)
  expected.observerInputs = { scriptSha256: '3'.repeat(64), sourceSha256: '4'.repeat(64) }
  installation.productAcceptance = 'not-run-gui-only'
  installation.guiAcceptance = 'passed'
  Object.assign(installation.installedBinary, {
    productVersion: expected.version,
    fileVersion: expected.version,
    bytes: expected.applicationBytes,
  })
  Object.assign(audit, {
    applicationCandidateSha: expected.candidateSha,
    harnessMode: 'gui-regression',
    mode: 'nsis-current-user',
    binaryRole: 'compiledCandidate',
    binary: { sha256: expected.builtSha256 },
    outerCleanupProvesProductInnerCleanup: false,
  })
  const runtime = {
    installedEvergreen: true,
    version: '156.0.0.0',
    executable: 'C:/Runtime/msedgewebview2.exe',
    sha256: '7'.repeat(64),
  }
  audit.runtime = { ...runtime, path: runtime.executable }
  const bytes = png(1200, 60),
    decoded = {
      ...validatePng(bytes),
      fullyDecoded: true,
      nonuniform: true,
      nativeMatch: { productPid: 111 },
    }
  const directoryAccess = {
    aclOperations: 2,
    allowAcesPerDirectory: 3,
    inheritanceFlags: 3,
    rootAppMask: 0x1200a9,
    stateAppMask: 0x1f01ff,
    ownerAndDaclVerified: true,
    sameHandleReadback: true,
    lowStateLabel: true,
    aclProcessesStarted: false,
    stateWriteProbe: true,
    ancestorWritesDenied: true,
    denialCount: 6,
  }
  const native = [111, 112].flatMap((pid, index) =>
    product.nativeAudit.map((event) => ({
      ...structuredClone(event),
      productPid: pid,
      requestId: 'gui' + index,
      timestampUnixMs: event.phase === 'finished' ? 3000 : 1000,
      ...(event.phase === 'finished' ? { pngBytes: bytes.length, pngSha256: decoded.sha256 } : {}),
      ...(event.phase !== 'admitted'
        ? { directoryAccess, resourceReleaseProven: true, resourceCleanupUncertain: false }
        : {}),
    })),
  )
  const summary = {
    complete: true,
    positiveControlPassed: true,
    productVisibleConsoleCount: 0,
    unattributedVisibleConsoleCount: 0,
    overflow: false,
    observerErrors: [],
  }
  const windows = {
    ...summary,
    windowEventHookUsed: true,
    desktopOrAclChanged: false,
    productTerminatedByObserver: false,
    childLifeVersion: 1,
    windowLifetimes: [],
    childShowEvidence: [],
    observationStoppedAtTick: 10000,
    workingGenerationPeak: 0,
    sharedRecordCount: 1,
    knownChildShowEvents: 0,
    knownWindowShowEvents: 0,
    unresolvedEvents: [],
    resolvedChildEvents: [],
    processes: [],
    positiveControl: {
      title: 'synthetic-control',
      sameInputDesktop: true,
      passed: true,
      detectedVisible: true,
      heldProcessSignaled: true,
      naturalExit: true,
      cleanupComplete: true,
      screenshotCaptured: true,
      exitCode: 0,
      jobActiveAfterStop: 0,
    },
    events: [
      {
        sequence: 1,
        elapsedMs: 1,
        positiveControlInterval: true,
        productObservationInterval: false,
        consoleCandidate: true,
        visibleNow: true,
        cloaked: 0,
        rect: [0, 0, 100, 100],
        desktopRect: [0, 0, 1920, 1080],
        intersectsDesktop: true,
        title: 'synthetic-control',
        showEvent: true,
        baselineVisible: false,
        observedVisible: true,
      },
    ],
  }
  const samples = (duration, count = 1) =>
    Array.from({ length: Math.ceil(duration / 1000) + 1 }, (_, i) => ({
      elapsedMs: Math.min(i * 1000, duration),
      imageCount: count,
      pending: 0,
      admitted: 1,
      mode: 'live',
      dirty: false,
      path: 'synthetic.md',
      sourceVisible: false,
      geometry: 'synthetic',
      imageSources: 'synthetic',
      notices: '[]',
    }))
  const close = (kind) => ({
    kind,
    productPid: kind === 'busy' ? 112 : 111,
    realUiCloseRequested: true,
    deadlineMs: 15000,
    exitCode: 0,
    signal: null,
    exitedWithinDeadline: true,
    stdioDrained: true,
    innerCleanupVerified: true,
    forcedTermination: false,
    errors: [],
    ...(kind === 'busy'
      ? {
          preDrained: false,
          pendingAtClick: 1,
          pendingRequestIds: ['gui1'],
          clickedAt: new Date(2000).toISOString(),
        }
      : {}),
  })
  const report = {
    schema: 1,
    status: 'passed',
    harnessMode: 'gui-regression',
    identityKind: 'current-candidate',
    applicationCandidateSha: expected.candidateSha,
    harnessCandidateSha: expected.candidateSha,
    application: installation.installedBinary.path,
    applicationSha256: expected.installedSha256,
    installerSha256: expected.installerSha256,
    harnessSha256: expected.harnessSha256,
    contractSha256: expected.contractSha256,
    observerInputs: expected.observerInputs,
    context: product.context,
    expectedAccountKind: expected.expectedAccountKind,
    runtime,
    launches: [{ productPid: 111 }, { productPid: 112 }],
    observerSummary: summary,
    nativeCleanupVerified: true,
    logOverflow: false,
    errors: [],
    steps: GUI_STEPS.map((name) => ({
      name,
      status: 'passed',
      screenshot: `gui-${name}-window.png`,
    })),
  }
  for (const name of ['open-ordinary-stable', 'open-wide-stable'])
    Object.assign(
      report.steps.find((row) => row.name === name),
      {
        samples: samples(75000),
        nativePickerAccepted: true,
        png: decoded,
        finalPng: decoded,
        exactBytesUnchanged: true,
      },
    )
  report.steps.find((row) => row.name === 'resize-wide').operations = Array.from(
    { length: 6 },
    () => ({ nativeWindowChanged: true, settled: true }),
  )
  report.steps.find((row) => row.name === 'repeat-document-open').opens = Array.from(
    { length: 3 },
    () => ({ nativePickerAccepted: true, exactBytesUnchanged: true, stable: true }),
  )
  Object.assign(
    report.steps.find((row) => row.name === 'multi-diagram'),
    { decodedImages: [decoded, decoded], samples: samples(10000, 2) },
  )
  const manyPngs = Array.from({ length: 12 }, (_, index) => {
    const imageBytes = png(1201 + index, 60)
    const image = {
      ...validatePng(imageBytes),
      fullyDecoded: true,
      nonuniform: true,
      nativeMatch: { productPid: 111 },
    }
    native.push(
      ...native
        .filter((event) => event.requestId === 'gui0')
        .map((event) => ({
          ...structuredClone(event),
          requestId: 'gui-many-' + index,
          ...(event.phase === 'finished'
            ? { pngBytes: imageBytes.length, pngSha256: image.sha256 }
            : {}),
        })),
    )
    return image
  })
  report.steps.find((row) => row.name === 'multi-diagram').manyDiagrams = [
    'many',
    'manyScroll',
  ].map((name) => ({
    name,
    exactBytesUnchanged: true,
    ...(name === 'manyScroll' ? { rapidScroll: syntheticRapidScroll() } : {}),
    sourceOffsets: Array.from({ length: 12 }, (_, index) => index * 30),
    visits: [...Array(12).keys(), 0, 11, 0].map((diagram, index) => {
      const geometry = 'synthetic many-diagram geometry',
        digest = hash(Buffer.from(geometry))
      return {
        diagram,
        rapidRecoveryMs: 100,
        from: diagram * 30,
        png: manyPngs[diagram],
        imageCount: 1,
        wheelInputs: [{ deltaY: index === 12 || index === 14 ? -300 : 300 }],
        geometryTable: { [digest]: geometry },
        samples: samples(3000, 1).map((sample) => ({ ...sample, geometry: digest })),
      }
    }),
  }))
  report.steps.find((row) => row.name === 'idle-close').close = close('idle')
  report.steps.find((row) => row.name === 'busy-close').close = close('busy')
  const initialInventory = installation.bundledPlugins.map(({ id, version }) => ({
    id,
    version,
    checked: id === 'milkup.diagrams' ? 'true' : 'false',
    busy: null,
  }))
  const activeInventory = initialInventory.map((item) =>
    item.id === 'milkup.diagrams'
      ? { id: item.id, checked: 'true', busy: null, versionSource: 'details-required' }
      : { ...item },
  )
  for (const [name, phase] of [
    ['blank-start-enable', 'fresh'],
    ['busy-close', 'persisted'],
  ])
    report.steps.find((row) => row.name === name).pluginState = {
      phase,
      togglePerformed: false,
      initialInventory: structuredClone(phase === 'fresh' ? initialInventory : activeInventory),
      finalInventory: structuredClone(activeInventory),
      installedIdentity: {
        id: 'milkup.diagrams',
        version: '1.3.0',
        text: 'milkup.diagrams · v1.3.0',
        source: 'public-details-ui',
      },
    }
  for (const launch of report.launches)
    launch.identity = {
      pid: launch.productPid,
      image: installation.installedBinary.path,
      creationFileTime: String(133000000000 + launch.productPid),
      token: product.context.desktop.token,
    }
  let measurementSequence = 0
  windows.productMeasurements = []
  const syntheticWindowMetrics = (launch, width = 1100, height = 760) => {
    const rect = { left: 0, top: 0, right: width, bottom: height, width, height }
    const value = {
      native: {
        measurementSequence: ++measurementSequence,
        measurementElapsedMs: measurementSequence * 1000,
        observed: true,
        displaySettingsChanged: false,
        pid: launch.productPid,
        creationFileTime: launch.identity.creationFileTime,
        hwnd: '0x' + launch.productPid.toString(16),
        className: 'Tauri Window',
        maximized: false,
        minimized: false,
        dpi: 96,
        dpiAwareness: 2,
        dpiAwarenessContext: '0xfffffffffffffffc',
        observerThreadDpiAwareness: 0,
        windowRect: { ...rect },
        clientRect: { ...rect },
        clientScreenRect: { ...rect },
        desktopRect: { left: 0, top: 0, right: 1920, bottom: 1080, width: 1920, height: 1080 },
      },
      dom: {
        innerWidth: width,
        innerHeight: height,
        devicePixelRatio: 1,
        screenAvailWidth: 1920,
        screenAvailHeight: 1080,
      },
    }
    value.relationship = validateNativeDpiObservation(
      value,
      launch.productPid,
      launch.identity.creationFileTime,
    )
    windows.productMeasurements.push(structuredClone(value.native))
    return value
  }
  const nativeSnapshot = (measurement) => {
    const copy = structuredClone(measurement)
    delete copy.measurementSequence
    delete copy.measurementElapsedMs
    return copy
  }
  report.launches[0].windowMetrics = syntheticWindowMetrics(report.launches[0])
  const resizeStep = report.steps.find((row) => row.name === 'resize-wide')
  resizeStep.initialNativeWindow = syntheticWindowMetrics(report.launches[0]).native
  let previousNativeWindow = nativeSnapshot(resizeStep.initialNativeWindow)
  for (const [index, operation] of resizeStep.operations.entries()) {
    const requested = {
      mode: 'normal',
      width: index % 2 === 0 ? 740 : 1180,
      height: index % 2 === 0 ? 650 : 820,
    }
    const metrics = syntheticWindowMetrics(report.launches[0], requested.width, requested.height)
    Object.assign(operation, {
      operation: requested,
      before: structuredClone(previousNativeWindow.windowRect),
      after: structuredClone(metrics.native.windowRect),
      nativeControl: {
        ok: true,
        operationSequence: index + 1,
        requested: structuredClone(requested),
        nativeWindowOperation: true,
        displaySettingsChanged: false,
        before: structuredClone(previousNativeWindow),
        after: nativeSnapshot(metrics.native),
      },
      windowMetrics: metrics,
    })
    previousNativeWindow = nativeSnapshot(metrics.native)
  }
  report.launches[1].windowMetrics = syntheticWindowMetrics(report.launches[1])
  for (const launch of report.launches) {
    launch.windowMetrics.native.readiness = {
      attempts: 2,
      zeroMatches: 0,
      elapsedMs: 25,
      stableSamples: 2,
    }
    const retained = windows.productMeasurements.find(
      (entry) => entry.measurementSequence === launch.windowMetrics.native.measurementSequence,
    )
    retained.readiness = structuredClone(launch.windowMetrics.native.readiness)
  }
  windows.productWindowReadiness = report.launches.map((launch, index) => ({
    requestSequence: index + 1,
    startedElapsedMs: index * 1000,
    finishedElapsedMs: index * 1000 + 26,
    ok: true,
    attempts: 2,
    zeroMatches: 0,
    lastMeasurement: structuredClone(launch.windowMetrics.native),
  }))
  // Keep raw helper records independent. save() only serializes these arrays;
  // it must not rebuild them from the report and erase deliberate drift tests.
  windows.productWindowOperations = resizeStep.operations.map((operation) =>
    structuredClone(operation.nativeControl),
  )
  windows.identityContext = {
    token: product.context.desktop.token,
    sessionId: installation.sessionId,
    desktopEligible: true,
    blockedReasons: [],
  }
  windows.context = {
    sessionId: installation.sessionId,
    threadDesktop: 'Default',
    inputDesktop: 'Default',
    sameInputDesktop: true,
    desktopChanged: false,
  }
  windows.trackedProducts = report.launches.map((launch) => ({
    pid: launch.productPid,
    image: launch.identity.image,
    creationFileTime: launch.identity.creationFileTime,
    heldProcessSignaledAtStop: true,
  }))
  const imageNames = [
    'gui-console-positive.png',
    'gui-wide-natural-window.png',
    ...GUI_STEPS.map((name) => `gui-${name}-window.png`),
    ...['ordinary', 'wide', 'multi', 'multi-2'].map((name) => `gui-${name}-diagram.png`),
  ]
  for (const name of imageNames) await writeFile(path.join(directory, name), bytes)
  report.screenshotProofs = GUI_STEPS.map((name) => ({
    file: `gui-${name}-window.png`,
    bytes: bytes.length,
    sha256: hash(bytes),
  }))
  report.screenshotProofs.push({
    file: 'gui-wide-natural-window.png',
    bytes: bytes.length,
    sha256: hash(bytes),
  })
  report.steps.find((step) => step.name === 'open-wide-stable').wideInteraction =
    syntheticWideInteraction(decoded.sha256, decoded.width, decoded.height)
  report.diagramProofs = ['ordinary', 'wide', 'multi', 'multi-2'].map((name) => ({
    file: `gui-${name}-diagram.png`,
    bytes: bytes.length,
    sha256: hash(bytes),
  }))
  const copyNames = [
    'installation-result.json',
    'installed-binary-comparison.json',
    'gui-regression.json',
    'gui-native-audit.json',
    'native-window-events.json',
    'standard-context.json',
    ...imageNames,
  ]
  const save = async () => {
    await f.save()
    const nativeBytes = Buffer.from(JSON.stringify(native)),
      contextBytes = Buffer.from(JSON.stringify(report.context))
    let windowBytes = Buffer.from(JSON.stringify(windows))
    if (options.compressedWindows) {
      const envelope = JSON.parse(encodeGuiEvidence(windowBytes, 'window'))
      options.mutateEnvelope?.(envelope)
      windowBytes = Buffer.from(JSON.stringify(envelope))
    }
    report.nativeAudit = {
      file: 'gui-native-audit.json',
      sha256: hash(nativeBytes),
      events: native.length,
    }
    report.nativeWindowEvidence = {
      file: 'native-window-events.json',
      sha256: hash(windowBytes),
      bytes: windowBytes.length,
    }
    report.contextSha256 = hash(contextBytes)
    for (const [name, value] of [
      ['gui-regression.json', JSON.stringify(report)],
      ['gui-native-audit.json', nativeBytes],
      ['native-window-events.json', windowBytes],
      ['standard-context.json', contextBytes],
    ])
      await writeFile(path.join(directory, name), value)
    const files = await Promise.all(
      copyNames.map(async (name) => {
        const data = await readFile(path.join(directory, name))
        return { relativePath: name, retainedName: name, bytes: data.length, sha256: hash(data) }
      }),
    )
    await writeJson(path.join(directory, 'evidence-files.json'), {
      schema: 1,
      complete: true,
      rejectedCount: 0,
      rejectionsOmitted: 0,
      rejected: [],
      totalBytes: files.reduce((sum, entry) => sum + entry.bytes, 0),
      files,
    })
  }
  await save()
  return { ...f, report, native, windows, save }
}

test('beta.10 requires a distinct installed GUI matrix without changing historical beta.9', () => {
  assert.equal(requireGuiEvidence('2.0.0-beta.9'), false)
  assert.throws(() => requireGuiEvidence('2.0.0-beta.10'))
  assert.throws(() => requireGuiEvidence('2.0.0-beta.11'))
  assert.equal(requireGuiEvidence('2.0.0-beta.10', '/synthetic/gui'), true)
  assert.throws(() => requireGuiEvidence('2.0.0'))
})
test('additional installed GUI gate binds complete raw audit, real copied pixel bytes and current installer identity', async (t) => {
  const f = await guiInstalledFixture(t)
  const proof = await verifyInstalledGuiEvidence(f.directory, f.expected)
  assert.equal(proof.status, 'passed')
  assert.equal(proof.records.length, 8)
  assert.equal(proof.pixels.length, 14)
  assert.match(proof.scope, /no full DPI matrix/)
})
test('additional GUI matrix requires separately installed pure-standard and filtered-admin identities', async (t) => {
  const parent = await temporary(t, 'milkup-gui-matrix-')
  const a = await guiInstalledFixture(t, { parent })
  await guiInstalledFixture(t, { parent, accountKind: 'filtered-admin' })
  assert.equal((await verifyInstalledGuiMatrix(parent, a.expected)).naturalUiCloses, 4)
})
test('installed GUI finalization decodes lossless window evidence before strict native identity checks', async (t) => {
  const f = await guiInstalledFixture(t, { compressedWindows: true })
  assert.equal((await verifyInstalledGuiEvidence(f.directory, f.expected)).status, 'passed')
  f.windows.identityContext.token.sid = 'S-1-5-21-11-22-33-9999'
  await f.save()
  await assert.rejects(verifyInstalledGuiEvidence(f.directory, f.expected))
})
for (const scenario of [
  'raw-budget',
  'missing-chunk',
  'truncated',
  'chunk-hash',
  'raw-hash',
  'record-count',
])
  test(`installed GUI rejects compressed ${scenario} despite matching outer file hashes`, async (t) => {
    const f = await guiInstalledFixture(t, {
      compressedWindows: true,
      mutateEnvelope(value) {
        if (scenario === 'raw-budget') value.rawBytes = 8 * 1024 * 1024 + 1
        if (scenario === 'missing-chunk') value.chunks.pop()
        if (scenario === 'truncated') {
          const chunk = value.chunks.at(-1)
          const bytes = Buffer.from(chunk.data, 'base64').subarray(0, -1)
          chunk.data = bytes.toString('base64')
          chunk.bytes = bytes.length
          chunk.sha256 = hash(bytes)
          value.packedBytes--
        }
        if (scenario === 'chunk-hash') value.chunks[0].sha256 = '0'.repeat(64)
        if (scenario === 'raw-hash') value.rawSha256 = '0'.repeat(64)
        if (scenario === 'record-count') value.recordCount++
      },
    })
    await assert.rejects(verifyInstalledGuiEvidence(f.directory, f.expected))
  })
for (const scenario of [
  'baseline-substitution',
  'wrong-harness',
  'wrong-contract',
  'wrong-observer',
  'wrong-installer',
  'wrong-binary',
  'not-installed',
  'reported-as-product',
  'missing-profile-cleanup',
  'missing-inner-cleanup',
  'uncertain-native-cleanup',
  'incomplete-positive-control',
  'visible-console',
  'wrong-context',
  'source-fallback',
  'repeat-native-request',
  'short-idle',
  'predrained-busy-close',
  'different-request-at-close',
  'not-really-inflight',
  'wrong-account',
  'missing-second-png',
  'missing-many-diagrams',
  'missing-ninth-diagram',
  'unmatched-many-native',
  'copied-png-drift',
  'raw-native-drift',
  'raw-window-drift',
  'copy-manifest-drift',
  'other-observer-account',
  'other-window-session',
  'other-window-pid',
  'reused-window-pid',
  'wrong-window-image',
  'window-product-still-live',
  'wrong-capture-hash',
  'plugin-state-reset',
  'plugin-toggled-again',
  'wrong-installed-plugin-version',
  'unknown-native-dpi',
  'reused-dpi-window-pid',
  'inconsistent-css-client-size',
  'missing-native-resize-control',
  'webview-only-resize',
  'wrong-resize-product',
  'reused-resize-product',
  'mismatched-measured-native-window',
  'native-resize-changed-display',
  'different-resize-hwnd',
  'forged-resize-request',
  'missing-raw-resize-operation',
  'raw-resize-control-drift',
  'raw-resize-sequence-drift',
  'missing-raw-window-measurement',
  'raw-window-measurement-drift',
  'missing-initial-native-measurement',
  'unretained-initial-native-measurement',
  'duplicate-measurement-sequence',
  'missing-wide-interaction',
  'wide-control-rerendered',
  'wide-original-still-shrunk',
  'missing-natural-view-screenshot',
  'missing-startup-readiness',
  'raw-startup-readiness-drift',
  'missing-child-lifetime-proof',
])
  test(`installed GUI delivery gate rejects ${scenario}`, async (t) => {
    const f = await guiInstalledFixture(t)
    const wide = f.report.steps.find((step) => step.name === 'open-wide-stable')
    if (scenario === 'missing-wide-interaction') delete wide.wideInteraction
    if (scenario === 'wide-control-rerendered') wide.wideInteraction.natural.requests.admitted++
    if (scenario === 'wide-original-still-shrunk') wide.wideInteraction.natural.image.width = 800
    if (scenario === 'missing-startup-readiness')
      delete f.report.launches[0].windowMetrics.native.readiness
    if (scenario === 'raw-startup-readiness-drift') f.windows.productWindowReadiness[0].attempts++
    if (scenario === 'missing-child-lifetime-proof') delete f.windows.childLifeVersion
    if (scenario === 'baseline-substitution') f.report.applicationCandidateSha = 'b'.repeat(40)
    if (scenario === 'wrong-harness') f.report.harnessSha256 = 'c'.repeat(64)
    if (scenario === 'plugin-state-reset')
      f.report.steps.at(-1).pluginState.initialInventory[0].checked = 'false'
    if (scenario === 'plugin-toggled-again')
      f.report.steps.at(-1).pluginState.togglePerformed = true
    if (scenario === 'wrong-installed-plugin-version')
      f.report.steps.at(-1).pluginState.installedIdentity.version = '1.2.0'
    if (scenario === 'unknown-native-dpi') f.report.launches[0].windowMetrics.native.dpi = 0
    if (scenario === 'reused-dpi-window-pid')
      f.report.launches[0].windowMetrics.native.creationFileTime = '123'
    if (scenario === 'inconsistent-css-client-size')
      f.report.steps.find(
        (row) => row.name === 'resize-wide',
      ).operations[0].windowMetrics.dom.innerWidth = 600
    const resize = f.report.steps.find((row) => row.name === 'resize-wide').operations[0]
    if (scenario === 'missing-native-resize-control') delete resize.nativeControl
    if (scenario === 'webview-only-resize') {
      // The DOM viewport changes while all actual Win32 window observations
      // remain unchanged. A claimed boolean must not turn this into a resize.
      resize.nativeControl.after = structuredClone(resize.nativeControl.before)
      resize.after = structuredClone(resize.before)
      resize.windowMetrics.native = structuredClone(resize.nativeControl.before)
    }
    if (scenario === 'wrong-resize-product') resize.nativeControl.before.pid++
    if (scenario === 'reused-resize-product')
      resize.nativeControl.after.creationFileTime = '133999999999'
    if (scenario === 'mismatched-measured-native-window') {
      resize.windowMetrics.native.windowRect.width++
      resize.windowMetrics.native.windowRect.right++
    }
    if (scenario === 'native-resize-changed-display') {
      resize.nativeControl.after.desktopRect.width++
      resize.nativeControl.after.desktopRect.right++
    }
    if (scenario === 'different-resize-hwnd') resize.nativeControl.after.hwnd = '0x999'
    if (scenario === 'forged-resize-request') resize.nativeControl.requested.width++
    if (scenario === 'missing-raw-resize-operation') f.windows.productWindowOperations.pop()
    if (scenario === 'raw-resize-control-drift')
      f.windows.productWindowOperations[0].requested.width++
    if (scenario === 'raw-resize-sequence-drift')
      f.windows.productWindowOperations[0].operationSequence++
    if (scenario === 'missing-raw-window-measurement') f.windows.productMeasurements.pop()
    if (scenario === 'raw-window-measurement-drift') {
      f.windows.productMeasurements[2].windowRect.width++
      f.windows.productMeasurements[2].windowRect.right++
    }
    if (scenario === 'missing-initial-native-measurement')
      delete f.report.steps.find((row) => row.name === 'resize-wide').initialNativeWindow
    if (scenario === 'unretained-initial-native-measurement')
      f.report.steps.find(
        (row) => row.name === 'resize-wide',
      ).initialNativeWindow.measurementSequence = 99
    if (scenario === 'duplicate-measurement-sequence')
      f.windows.productMeasurements[1].measurementSequence = 1
    if (scenario === 'wrong-contract') f.report.contractSha256 = 'c'.repeat(64)
    if (scenario === 'wrong-observer')
      f.report.observerInputs = { ...f.report.observerInputs, scriptSha256: 'c'.repeat(64) }
    if (scenario === 'wrong-installer') f.installation.installer.sha256 = 'c'.repeat(64)
    if (scenario === 'wrong-binary') f.installation.installedBinary.sha256 = 'd'.repeat(64)
    if (scenario === 'not-installed') f.audit.installerExecuted = false
    if (scenario === 'reported-as-product') f.installation.productAcceptance = 'passed'
    if (scenario === 'missing-profile-cleanup') f.audit.profileDeleted = false
    if (scenario === 'missing-inner-cleanup')
      f.report.steps.at(-1).close.innerCleanupVerified = false
    if (scenario === 'uncertain-native-cleanup') f.native.at(-1).resourceCleanupUncertain = true
    if (scenario === 'incomplete-positive-control')
      f.windows.positiveControl.detectedVisible = false
    if (scenario === 'visible-console')
      f.windows.events.push({
        ...f.windows.events[0],
        sequence: 2,
        elapsedMs: 2,
        positiveControlInterval: false,
        productObservationInterval: true,
        attribution: 'unattributed',
        hwnd: '2',
        pid: 777,
      })
    if (scenario === 'wrong-context')
      f.report.context = { ...f.report.context, actualSid: 'S-1-5-21-11-22-33-9999' }
    if (scenario === 'source-fallback') f.report.steps[1].samples[5].sourceVisible = true
    if (scenario === 'repeat-native-request') f.report.steps[1].samples[5].admitted++
    if (scenario === 'short-idle') f.report.steps[1].samples.pop()
    if (scenario === 'predrained-busy-close') f.report.steps.at(-1).close.preDrained = true
    if (scenario === 'different-request-at-close')
      f.report.steps.at(-1).close.pendingRequestIds = ['not-this-job']
    if (scenario === 'not-really-inflight')
      f.report.steps.at(-1).close.clickedAt = new Date(4000).toISOString()
    if (scenario === 'wrong-account') f.report.expectedAccountKind = 'filtered-admin'
    if (scenario === 'other-observer-account')
      f.windows.identityContext.token = {
        ...f.windows.identityContext.token,
        sid: 'S-1-5-21-11-22-33-9999',
      }
    if (scenario === 'other-window-session') f.windows.context.sessionId++
    if (scenario === 'other-window-pid') f.windows.trackedProducts[0].pid++
    if (scenario === 'reused-window-pid')
      f.windows.trackedProducts[0].creationFileTime = '133999999999'
    if (scenario === 'wrong-window-image') f.windows.trackedProducts[0].image = 'C:/other.exe'
    if (scenario === 'window-product-still-live')
      f.windows.trackedProducts[0].heldProcessSignaledAtStop = false
    if (scenario === 'wrong-capture-hash') f.report.screenshotProofs[0].sha256 = '0'.repeat(64)
    const many = f.report.steps.find((row) => row.name === 'multi-diagram')
    if (scenario === 'missing-many-diagrams') delete many.manyDiagrams
    if (scenario === 'missing-ninth-diagram') many.manyDiagrams[0].visits.splice(8, 1)
    if (scenario === 'unmatched-many-native')
      many.manyDiagrams[0].visits[8].png.nativeMatch.productPid = 999
    await f.save()
    if (scenario === 'missing-natural-view-screenshot')
      await rm(path.join(f.directory, 'gui-wide-natural-window.png'))
    if (scenario === 'missing-second-png')
      await rm(path.join(f.directory, 'gui-multi-2-diagram.png'))
    if (scenario === 'copied-png-drift')
      await writeFile(
        path.join(f.directory, 'gui-console-positive.png'),
        Buffer.concat([png(), Buffer.from('changed')]),
      )
    if (scenario === 'raw-native-drift')
      await writeFile(path.join(f.directory, 'gui-native-audit.json'), '[]')
    if (scenario === 'raw-window-drift')
      await writeFile(path.join(f.directory, 'native-window-events.json'), '{}')
    if (scenario === 'copy-manifest-drift') {
      const p = path.join(f.directory, 'evidence-files.json')
      const value = JSON.parse(await readFile(p))
      value.files[0].sha256 = '0'.repeat(64)
      await writeJson(p, value)
    }
    await assert.rejects(verifyInstalledGuiEvidence(f.directory, f.expected))
  })

test('final payload permits only the exact additional 44 GUI evidence files and keeps the original 32-file budget', () => {
  const original = Array.from({ length: 29 }, (_, i) => ({ name: `original-${i}.json`, bytes: 10 }))
  const gui = guiDeliveryFiles.map((name) => ({ name, bytes: 10 }))
  assert.equal(gui.length, 44)
  assert.equal(verifyPayloadInventory([...original, ...gui], { gui: true }).length, 73)
  assert.throws(() => verifyPayloadInventory([...original, ...gui]))
  assert.throws(() => verifyPayloadInventory([...original, ...gui.slice(1)], { gui: true }))
  assert.throws(() =>
    verifyPayloadInventory(
      [...original, ...gui, { name: 'reports/gui-pure-standard/unreviewed.txt', bytes: 1 }],
      { gui: true },
    ),
  )
  assert.throws(() =>
    verifyPayloadInventory(
      [
        ...original,
        ...gui,
        ...Array.from({ length: 4 }, (_, i) => ({ name: `extra-${i}`, bytes: 1 })),
      ],
      { gui: true },
    ),
  )
  assert.throws(() =>
    verifyPayloadInventory(
      [
        ...original,
        ...gui.map((file, index) => (index === 0 ? { ...file, bytes: 128 * 1024 * 1024 } : file)),
      ],
      { gui: true },
    ),
  )
  assert.throws(() => verifyPayloadInventory([...original, ...gui, gui[0]], { gui: true }))
})

test('fixed frontend assets require exact bytes and reachable production references', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'milkup-frontend-assets-'))
  try {
    await mkdir(path.join(dir, 'assets'))
    const engine = Buffer.from('reviewed engine'),
      bootstrap = Buffer.from('fixed frame')
    const entry = Buffer.from(
      'const engine="/assets/mermaid-12.2.0.min-sealed.js",frame="/assets/frame-sealed.html";',
    )
    await writeFile(path.join(dir, 'assets/entry.js'), entry)
    await writeFile(path.join(dir, 'assets/mermaid-12.2.0.min-sealed.js'), engine)
    await writeFile(path.join(dir, 'assets/frame-sealed.html'), bootstrap)
    const modules = [
      { name: 'assets/entry.js', sha256: createHash('sha256').update(entry).digest('hex') },
    ]
    assert.equal(
      (await inspectFrontendAssets(dir, modules, { engine, bootstrap })).assets.length,
      2,
    )
    await assert.rejects(
      inspectFrontendAssets(dir, modules, { engine, bootstrap: Buffer.from('other') }),
    )
    await assert.rejects(inspectFrontendAssets(dir, [], { engine, bootstrap }))
    await writeFile(path.join(dir, 'assets/frame-duplicate.html'), bootstrap)
    await assert.rejects(inspectFrontendAssets(dir, modules, { engine, bootstrap }))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('installed final gate restores lossless product evidence before original identity and cleanup checks', async (t) => {
  const fixture = await installedFixture(t)
  fixture.product.retainedLargeState = '中文😀'.repeat(180000)
  const file = path.join(fixture.directory, 'mermaid-product-e2e.json')
  const encoded = encodeProductEvidence(fixture.product)
  assert.equal(JSON.parse(encoded).encoding, 'milkup-product-gzip-v1')
  await writeFile(file, encoded)
  const proof = await verifyInstalledEvidence(fixture.directory, fixture.expected)
  assert.equal(proof.status, 'passed')
  assert.equal(
    proof.records.find((r) => r.name === 'mermaid-product-e2e.json').sha256,
    hash(Buffer.from(encoded)),
  )
  const damaged = JSON.parse(encoded)
  damaged.rawSha256 = '0'.repeat(64)
  await writeJson(file, damaged)
  await assert.rejects(verifyInstalledEvidence(fixture.directory, fixture.expected))
  fixture.product.candidateSha = 'f'.repeat(40)
  await writeFile(file, encodeProductEvidence(fixture.product))
  await assert.rejects(verifyInstalledEvidence(fixture.directory, fixture.expected))
})

test('installed prefetch evidence requires its actual retained PNG, not only a report hash', async (t) => {
  const f = await installedFixture(t)
  const row = f.product.steps.find((x) => x.image)
  row.prefetch = { warmedImage: structuredClone(row.image) }
  await f.save()
  assert.equal((await verifyInstalledEvidence(f.directory, f.expected)).status, 'passed')
  row.prefetch.warmedImage.file = 'missing-prefetched-diagram.png'
  await f.save()
  await assert.rejects(verifyInstalledEvidence(f.directory, f.expected))
})
