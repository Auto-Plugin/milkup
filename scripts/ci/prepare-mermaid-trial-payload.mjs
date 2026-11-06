import { fixedFrameDocument } from '../frontend-mermaid-document.mjs'
import { frontendLedgerClass } from '../../tests/windows/mermaid-frontend-contract.mjs'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'
import { expectedNsisImage } from './verify-nsis-image.mjs'
import { parseImports } from './windows-loader-imports.mjs'
import { publicBuildFile, readPublicPluginBuildInputs } from './public-plugin-build-contract.mjs'
import {
  decodeGuiEvidence,
  verifyGuiEvidence,
  GUI_STEPS,
  requiresLaunchAudit,
} from '../../tests/windows/mermaid-gui-contract.mjs'
import { REVIEWED_MERMAID_PACKAGE } from '../../apps/desktop/src/reviewed-mermaid-package.ts'
import { assertReviewedMermaidPackage } from '../../plugins/diagrams-worker/scripts/package-seals.mjs'
import {
  AuditLedger,
  assertCleanCloseConfirmation,
  fixtures,
  syntaxCases,
  unwrapWebDriverValue,
  validateAccountKind,
  validateContext,
  validateHostProcessToken,
  validatePng,
  validatePreviewModes,
} from '../../tests/windows/mermaid-product-e2e.mjs'

const checkout = fileURLToPath(new URL('../..', import.meta.url))
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
const json = async (file) => JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/, ''))
const writeJson = (file, value, exclusive = false) =>
  writeFile(file, JSON.stringify(value, null, 2) + '\n', exclusive ? { flag: 'wx' } : {})
const enginePath = 'apps/desktop/src-tauri/mermaid-engine/assets/mermaid-12.2.0.min.js'
const bootstrapPath = 'apps/desktop/src-tauri/mermaid-engine/assets/bootstrap.js'
const engineSha256 = 'a8a6a6f805b074a8261a2825c86f99c8054acb3b35f50bb7e24a4f9f2c3c3b9f'
const stepNames = [
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
const safeName = (name) => typeof name === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(name)
const windowsPath = (value) => String(value).replaceAll('/', '\\').toLowerCase()

async function plainBytes(file, maximum = 128 * 1024 * 1024) {
  const info = await lstat(file)
  assert(info.isFile() && !info.isSymbolicLink(), 'Plain file required: ' + file)
  assert(info.size <= maximum, 'File exceeds inspection budget: ' + file)
  const bytes = await readFile(file)
  assert.equal(bytes.length, info.size, 'File changed during inspection: ' + file)
  return bytes
}
async function recordedBytes(record) {
  assert(record && path.isAbsolute(record.path), 'Absolute recorded file path required')
  const bytes = await plainBytes(record.path)
  assert.equal(record.bytes, bytes.length, 'Recorded byte length changed')
  assert.equal(record.sha256, hash(bytes), 'Recorded SHA-256 changed')
  return bytes
}

/** No eval/import of application or plugin code. Parse the built module graph
 * reachable from index.html and decode only literal string/template values. */
export async function inspectDistArchives(dist, expected) {
  const root = await realpath(dist)
  const index = (await publicBuildFile(root, 'index.html')).bytes
  assert(index.length <= 256 * 1024, 'Production index budget exceeded')
  const queue = []
  const resolveModule = (parent, specifier) => {
    assert(
      typeof specifier === 'string' && !/[\\\u0000?#:%]/.test(specifier),
      'Non-local production module',
    )
    assert(!specifier.startsWith('//'), 'Remote production module')
    const relative = specifier.startsWith('/')
      ? specifier.slice(1)
      : path.posix.join(path.posix.dirname(parent), specifier)
    assert(
      relative && !relative.startsWith('../') && !path.posix.isAbsolute(relative),
      'Module escapes production dist',
    )
    assert(/\.(?:m?js)$/.test(relative), 'Unexpected production module extension')
    return relative
  }
  const html = index.toString('utf8').replace(/<!--[\s\S]*?-->/g, '')
  for (const tag of html.matchAll(/<script\b[^>]*>/gi)) {
    if (!/\btype\s*=\s*(["'])module\1/i.test(tag[0])) continue
    const source = /\bsrc\s*=\s*(["'])(.*?)\1/i.exec(tag[0])
    assert(source, 'Production module scripts must have a local src')
    queue.push(resolveModule('index.html', source[2]))
  }
  assert(queue.length > 0, 'No production entry module')
  const modules = new Map()
  const archives = []
  while (queue.length) {
    const name = queue.shift()
    if (modules.has(name)) continue
    assert(modules.size < 128, 'Production module graph budget exceeded')
    const bytes = (await publicBuildFile(root, name)).bytes
    assert(bytes.length <= 32 * 1024 * 1024, 'Production module too large')
    const source = ts.createSourceFile(
      name,
      bytes.toString('utf8'),
      ts.ScriptTarget.ESNext,
      true,
      ts.ScriptKind.JS,
    )
    assert.equal(source.parseDiagnostics.length, 0, 'Production JavaScript parse failed')
    modules.set(name, { name, bytes: bytes.length, sha256: hash(bytes) })
    function visit(node) {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
        assert(ts.isStringLiteral(node.moduleSpecifier), 'Non-literal production import')
        queue.push(resolveModule(name, node.moduleSpecifier.text))
      } else if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword
      ) {
        const argument = node.arguments[0]
        // Vite may retain variable imports for non-bundled plugin execution.
        // These cannot provide proof of an embedded archive.
        if (
          argument &&
          (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument))
        )
          queue.push(resolveModule(name, argument.text))
      }
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
        if (node.text.startsWith('{') && node.text.includes('"milkup-plugin"')) {
          let value
          try {
            value = JSON.parse(node.text)
          } catch {
            /* Other application text is not an archive. */
          }
          if (value?.format === 'milkup-plugin') {
            const decoded = Buffer.from(node.text)
            archives.push({
              id: value.manifest?.id,
              version: value.manifest?.version,
              bytes: decoded.length,
              sha256: hash(decoded),
              module: name,
              literalStart: node.getStart(source),
              literalEnd: node.end,
              syntax: ts.SyntaxKind[node.kind],
            })
          }
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
  assert.equal(
    archives.length,
    expected.length,
    'Production dist archive count differs from staged inventory',
  )
  const found = new Set()
  for (const item of expected) {
    const matches = archives.filter((archive) => archive.id === item.id)
    assert.equal(matches.length, 1, 'Missing or duplicate embedded plugin: ' + item.id)
    const actual = matches[0]
    assert.equal(actual.version, item.version, 'Embedded plugin version changed')
    assert.equal(actual.bytes, item.bytes, 'Embedded archive length differs from staged bytes')
    assert.equal(actual.sha256, item.sha256, 'Embedded archive differs from staged bytes')
    found.add(actual.id)
  }
  assert.equal(found.size, archives.length, 'Unreviewed embedded archive')
  return {
    method:
      'TypeScript AST literal decoding; local module graph from production index.html; no bundle execution',
    parserVersion: ts.version,
    index: { bytes: index.length, sha256: hash(index) },
    modules: [...modules.values()].sort((a, b) => a.name.localeCompare(b.name)),
    archives: archives.sort((a, b) => a.id.localeCompare(b.id)),
  }
}

/** Exact fixed frontend assets must be referenced by the reachable production modules. */
export async function inspectFrontendAssets(dist, modules, expected) {
  const names = await readdir(path.join(dist, 'assets'))
  assert(names.length <= 4096, 'Bounded production asset inventory')
  const moduleSources = await Promise.all(
    modules.map(async (module) => {
      const bytes = (await publicBuildFile(dist, module.name)).bytes
      assert.equal(hash(bytes), module.sha256, 'Reachable module changed during asset inspection')
      return bytes.toString('utf8')
    }),
  )
  const records = []
  for (const [kind, pattern] of [
    ['engine', /^mermaid-12\.2\.0\.min-[A-Za-z0-9_-]+\.js$/],
    ['bootstrap', /^frame-[A-Za-z0-9_-]+\.html$/],
  ]) {
    const found = names.filter((name) => pattern.test(name))
    assert.equal(found.length, 1, 'Exactly one pinned ' + kind + ' frontend asset')
    const name = 'assets/' + found[0]
    const bytes = (await publicBuildFile(dist, name)).bytes
    assert(bytes.length > 0 && bytes.length <= 8 * 1024 * 1024, 'Bounded fixed frontend asset')
    assert.equal(
      hash(bytes),
      hash(expected[kind]),
      'Frontend ' + kind + ' bytes differ from reviewed source',
    )
    assert(
      moduleSources.some((source) => source.includes('/' + name)),
      'Fixed ' + kind + ' asset is not reachable from the production entry',
    )
    records.push({ kind, name, bytes: bytes.length, sha256: hash(bytes) })
  }
  return {
    renderer: 'frontend-mermaid-12.2.0',
    assets: records,
    claim: 'Exact reachable production build assets; installed execution is verified separately',
  }
}

/** Compare full binary bytes; only the pinned Tauri UNK-to-NSS transform is allowed. */
export function inspectEmbeddedEngine(compiled, extracted, engine, bootstrap) {
  assert.equal(engine.length, 5_494_801, 'Official Mermaid asset length changed')
  assert.equal(hash(engine), engineSha256, 'Official Mermaid 12.2.0 hash changed')
  assert(bootstrap.length > 0 && bootstrap.length <= 256 * 1024, 'Bootstrap source budget')
  const { expected, offset } = expectedNsisImage(compiled)
  assert(
    extracted.equals(expected),
    'Extracted application differs beyond the exact NSIS marker change',
  )
  const locate = (binary, bytes, name) => {
    const position = binary.indexOf(bytes)
    assert(position >= 0, name + ' complete source bytes absent from executable')
    return { offset: position, bytes: bytes.length, sha256: hash(bytes) }
  }
  return {
    engineVersion: '12.2.0',
    compiledSha256: hash(compiled),
    extractedSha256: hash(extracted),
    markerOffset: offset,
    changedBytes: 3,
    compiled: {
      engine: locate(compiled, engine, 'Official Mermaid'),
      bootstrap: locate(compiled, bootstrap, 'Fixed bootstrap'),
    },
    extracted: {
      engine: locate(extracted, engine, 'Official Mermaid'),
      bootstrap: locate(extracted, bootstrap, 'Fixed bootstrap'),
    },
  }
}

/** Re-read the actual dumpbin output; a claimed empty dependency list alone is
 * not evidence that the extracted application has no extra runtime DLLs. */
export function verifyRuntimeDependencies(report, importsBytes, applicationSha256) {
  assert.equal(report.schema, 1)
  assert.equal(report.status, 'passed')
  assert.equal(report.readOnly, true)
  assert.equal(report.architecture, 'x86_64')
  assert.match(applicationSha256, /^[a-f0-9]{64}$/)
  assert.equal(
    report.applicationSha256,
    applicationSha256,
    'Dependencies refer to a different extracted application',
  )
  assert(
    Buffer.isBuffer(importsBytes) &&
      importsBytes.length > 0 &&
      importsBytes.length <= 2 * 1024 * 1024,
    'Bounded raw imports evidence required',
  )
  assert.equal(report.source.importsSha256, hash(importsBytes), 'Raw imports evidence changed')
  assert.match(
    report.source.dumpbinSha256,
    /^[a-f0-9]{64}$/,
    'Actual inspection tool hash required',
  )
  const dlls = [
    ...new Set(parseImports(importsBytes.toString('utf8')).map((item) => item.dll.toUpperCase())),
  ].sort()
  assert(dlls.length > 0 && dlls.length <= 128, 'Actual non-empty import table required')
  assert(
    dlls.every((name) => /^[A-Z0-9_.+-]+\.DLL$/.test(name)),
    'Only DLL names may appear in the dependency list',
  )
  assert.deepEqual(report.dlls, dlls, 'Dependency list differs from raw imports')
  assert.deepEqual(
    report.apiSets,
    dlls.filter((name) => /^(?:API|EXT)-MS-/.test(name)),
    'API-set list differs from raw imports',
  )
  const externalVc = dlls.filter((name) =>
    /^(?:VCRUNTIME\d|MSVCP\d|CONCRT\d|VCOMP\d|UCRTBASED\.)/.test(name),
  )
  assert.deepEqual(externalVc, [], 'Unexpected external VC runtime dependency')
  assert.deepEqual(report.extraVcRuntimeDlls, [], 'External VC runtime dependencies must be absent')
  assert(!dlls.includes('WEBVIEW2LOADER.DLL'), 'Unexpected external WebView2Loader dependency')
  assert.equal(report.webview2Loader, 'static-no-loader-dll-import')
  assert.equal(report.webview2Runtime, 'external-existing-Evergreen')
  assert.equal(report.nodeOrPnpmRequiredAtRuntime, false)
  return report
}

async function verifyInputs(evidence) {
  const packaging = await json(path.join(evidence, 'packaging-record.json'))
  assert.equal(packaging.schema, 1)
  assert.equal(
    packaging.rendererMode,
    'frontend',
    'Current package requires the frontend renderer contract',
  )
  assert.match(packaging.candidateSha, /^[a-f0-9]{40}$/)
  const head = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: checkout,
    encoding: 'utf8',
  }).trim()
  assert.equal(packaging.candidateSha, head, 'Packaging source is not the current exact candidate')
  const version = (await json(path.join(checkout, 'package.json'))).version
  assert.match(version, /^2\.0\.0-beta\.[1-9][0-9]*$/, 'Test-only beta version required')
  assert.equal(packaging.version, version)
  assert.equal(packaging.platform, 'windows-x86_64')
  assert.equal(packaging.nsisInstallMode, 'currentUser')
  assert.equal(packaging.webviewInstallMode, 'skip')
  assert.equal(packaging.existingEvergreenRequired, true)
  assert.equal(packaging.officialRelease, false)
  assert.equal(packaging.signing, 'unsigned')
  assert.equal(packaging.artifactRetentionDays, 7)
  assert.match(String(packaging.runId), /^\d+$/)
  assert.equal(
    packaging.runUrl,
    `https://github.com/Auto-Plugin/milkup/actions/runs/${packaging.runId}`,
  )
  const [installer, compiled, extracted] = await Promise.all(
    ['installer', 'compiledApplication', 'extractedApplication'].map((key) =>
      recordedBytes(packaging[key]),
    ),
  )
  for (const key of ['installer', 'compiledApplication', 'extractedApplication']) {
    assert.equal(
      packaging[key].signature,
      'NotSigned',
      'This trial must explicitly remain unsigned',
    )
    assert.equal(packaging[key].productVersion, version, 'PE product version mismatch')
  }
  for (const binary of [installer, compiled, extracted])
    assert.equal(binary.subarray(0, 2).toString(), 'MZ', 'Windows PE input required')
  const nsis = await json(path.join(evidence, 'nsis-image-proof.json'))
  assert.equal(nsis.status, 'passed')
  assert.equal(nsis.transform, 'tauri-cli-2.11.4-unique-UNK-to-NSS')
  assert.equal(nsis.compiledSha256, hash(compiled))
  assert.equal(nsis.expectedNsisSha256, hash(extracted))
  assert.equal(nsis.changedBytes, 3)
  assert.equal(path.resolve(nsis.path), path.resolve(packaging.extractedApplication.path))
  const dependencies = await json(path.join(evidence, 'windows-runtime-dependencies.json'))
  assert.deepEqual(
    packaging.dependencies,
    dependencies,
    'Packaging and runtime dependency reports differ',
  )
  verifyRuntimeDependencies(
    dependencies,
    await plainBytes(path.join(evidence, 'windows-runtime-imports.log'), 2 * 1024 * 1024),
    hash(extracted),
  )
  const engine = await plainBytes(path.join(checkout, enginePath))
  const bootstrap = await plainBytes(path.join(checkout, bootstrapPath))
  const engineSource = (
    await publicBuildFile(checkout, 'apps/desktop/src-tauri/mermaid-engine/src/engine.rs')
  ).bytes.toString('utf8')
  assert(
    engineSource.includes('include_bytes!("../assets/mermaid-12.2.0.min.js")') &&
      engineSource.includes('include_bytes!("../assets/bootstrap.js")'),
    'Reviewed compile-time fixed assets required',
  )
  execFileSync(
    'git',
    [
      'diff',
      '--quiet',
      'HEAD',
      '--',
      enginePath,
      bootstrapPath,
      'apps/desktop/src/reviewed-mermaid-package.ts',
    ],
    { cwd: checkout },
  )
  const embedded = inspectEmbeddedEngine(compiled, extracted, engine, bootstrap)
  assert.equal(nsis.markerOffset, embedded.markerOffset)
  const { plugins: expected } = await readPublicPluginBuildInputs(checkout, { platform: 'win32' })
  assert.equal(expected.length, 10, 'Exactly ten Windows plugins required')
  const staging = await json(path.join(evidence, 'public-plugins/staged-bundles.json'))
  assert(Array.isArray(staging) && staging.length === 10)
  const byName = new Map(staging.map((item) => [item.name, item]))
  assert.equal(byName.size, 10, 'Duplicate staging record')
  const stagedRoot = path.join(checkout, 'apps/desktop/src/bundled-plugins')
  assert.deepEqual(
    (await readdir(stagedRoot)).sort(),
    expected.map((item) => item.name).sort(),
    'Staged directory is not the exact Windows inventory',
  )
  const plugins = []
  const archives = new Map()
  for (const item of expected) {
    const record = byName.get(item.name)
    assert(record, 'Missing staged build record: ' + item.name)
    const bytes = (await publicBuildFile(stagedRoot, item.name)).bytes
    assert.equal(record.bytes, bytes.length)
    assert.equal(record.sha256, hash(bytes))
    assert.equal(record.host, item.host)
    assert.equal(record.buildMode, item.buildMode)
    assert.equal(record.mode, item.buildMode)
    assert.deepEqual(record.outputImports, [])
    assert.match(record.metafileSha256, /^[a-f0-9]{64}$/)
    assert(Number.isSafeInteger(record.dependencyInputs) && record.dependencyInputs >= 0)
    const archive = JSON.parse(bytes.toString('utf8'))
    assert.equal(archive.format, 'milkup-plugin')
    assert.equal(archive.version, 1)
    assert.deepEqual(
      archive.manifest,
      await json(path.join(checkout, item.directory, 'plugin.json')),
    )
    assert.equal(
      archive.manifest.host,
      'worker',
      'Windows distribution contains Worker packages only',
    )
    assert.equal(archive.manifest.engines.milkup, '^2.0.0-0')
    let seals
    if (item.id === REVIEWED_MERMAID_PACKAGE.pluginId) {
      seals = assertReviewedMermaidPackage(archive, REVIEWED_MERMAID_PACKAGE)
      assert.deepEqual(
        record.reviewedNativeSeals,
        seals,
        'Staged Mermaid seals differ from reviewed identity',
      )
    }
    archives.set(item.name, bytes)
    plugins.push({
      id: item.id,
      version: item.version,
      archiveFile: item.name,
      bytes: bytes.length,
      sha256: hash(bytes),
      host: item.host,
      permissions: item.permissions,
      bundled: true,
      enabledByDefault: item.id === REVIEWED_MERMAID_PACKAGE.pluginId,
      standaloneArchiveRequired: false,
      buildMode: item.buildMode,
      buildInputVerification: {
        metafileSha256: record.metafileSha256,
        dependencyInputs: record.dependencyInputs,
        outputImports: record.outputImports,
      },
      ...(seals ? { reviewedNativeSeals: seals } : {}),
    })
  }
  const dist = await inspectDistArchives(path.join(checkout, 'apps/desktop/dist'), plugins)
  const fixedDocument = await plainBytes(
    path.join(checkout, 'apps/desktop/src/frontend-mermaid/frame.html'),
  )
  const fixedBootstrap = await plainBytes(
    path.join(checkout, 'apps/desktop/src/frontend-mermaid/frame.js'),
  )
  assert.equal(
    fixedDocument.toString('utf8'),
    fixedFrameDocument(fixedBootstrap.toString('utf8')),
    'Fixed renderer document is stale or altered',
  )
  assert(
    compiled.includes(fixedDocument) && extracted.includes(fixedDocument),
    'Native fixed document bytes must match packaged frontend document',
  )
  const frontendAssets = await inspectFrontendAssets(
    path.join(checkout, 'apps/desktop/dist'),
    dist.modules,
    {
      engine,
      bootstrap: await plainBytes(
        path.join(checkout, 'apps/desktop/src/frontend-mermaid/frame.html'),
      ),
    },
  )
  const input = await json(path.join(evidence, 'installer-input.json'))
  assert.equal(input.rendererMode, 'frontend')
  assert.equal(input.schema, 1)
  assert.equal(input.candidateSha, packaging.candidateSha)
  assert.equal(input.version, version)
  assert.equal(input.builtBinarySha256, hash(compiled))
  assert.equal(input.expectedInstalledBinarySha256, hash(extracted))
  assert(Array.isArray(input.resources) && input.resources.length === 1)
  const resource = input.resources[0]
  assert.equal(resource.relativePath, 'file.ico')
  const icon = (await publicBuildFile(checkout, 'apps/desktop/src-tauri/icons/file.ico')).bytes
  assert.equal(resource.bytes, icon.length)
  assert.equal(resource.sha256, hash(icon))
  const bundledPlugins = plugins.map(({ id, version, archiveFile, bytes, sha256 }) => ({
    id,
    version,
    archiveFile,
    bytes,
    sha256,
  }))
  assert(Array.isArray(input.bundledPlugins))
  if (input.bundledPlugins.length) assert.deepEqual(input.bundledPlugins, bundledPlugins)
  const installerInput = {
    ...input,
    installMode: 'currentUser',
    webviewInstallMode: 'skip',
    bundledPlugins,
  }
  const verification = {
    schema: 1,
    status: 'passed',
    candidateSha: packaging.candidateSha,
    version,
    scope:
      'Current staged build records, reviewed package seals, reachable production archive bytes, compiled/extracted legacy asset bytes and reachable fixed frontend assets; does not assert independent rebuilds or new tests of all ten plugins',
    plugins,
    dist,
    frontendAssets,
    embedded,
    dependencies,
    nsis,
    stagingSha256: hash(
      await plainBytes(path.join(evidence, 'public-plugins/staged-bundles.json')),
    ),
  }
  return { packaging, installer, archives, plugins, installerInput, verification, dependencies }
}

function readme(manifest) {
  const modern = Number(/^2\.0\.0-beta\.([1-9][0-9]*)$/.exec(manifest.version)?.[1]) >= 10
  const guiPassed = manifest.deliveryReady && manifest.guiAcceptance?.status === 'passed'
  return `# Milkup ${manifest.version} 完整 Mermaid Windows 测试包\n\n源码提交：${manifest.candidateSha}\n构建记录：${manifest.runUrl}\n\n这是未签名的 Windows x64 NSIS 测试包，不是正式 Release。安装程序只面向当前用户；不会安装或下载 WebView2，需要电脑已经安装可用的 [Microsoft Evergreen WebView2](https://developer.microsoft.com/en-us/microsoft-edge/webview2/)。完整 Mermaid 支持标准用户和正常启动的未提权管理员账户；请勿选择“以管理员身份运行”。实际提权、关闭 UAC 后具有完整管理员权限等不符合隔离要求的启动仍不支持，并保留源码。\n\n安装器：\`${manifest.installer.deliveredName}\`。应用内版本为 ${manifest.version}；完整提交与哈希在 manifest.json。可用 PowerShell 的 Get-FileHash -Algorithm SHA256 核对 SHA256SUMS.txt。请使用文档副本试用。已交付的 beta.8 和 beta.9 安装包保持独立，不由本包覆盖其下载文件。\n\n10 个插件已经包含在应用中，首次安装默认启用随包审核的 Diagrams 1.3.0，打开 Mermaid 文档即可预览；其他插件保持关闭；plugins 目录中的相同插件档案只供补装，不是正常使用的必需步骤。旧配置中的禁用或卸载选择应保留，不会借打包自动授权。\n\n编辑区模式选择器提供“源码”“渲染”“混合”：渲染模式只读，但允许选择和复制；混合模式在当前编辑的代码块内保留源码。开启图表插件后当前文档立即刷新，无需重启。正文预览在应用现有 WebView 内运行固定官方 Mermaid.js 12.2.0，不逐图启动外部辅助程序或命令行。图表脚本在宿主管理的 opaque sandbox 帧中运行，原生桥接拒绝、导航限制和帧释放均纳入验收；移除帧不等于任意 JavaScript 死循环的硬终止，也不提供操作系统级内存配额。samples 包含普通图、宽图、C4 和故意无效语法四类；无效语法应显示源码或诊断。${modern ? '宽图默认按实际编辑区宽度等比缩小；可点击“原始尺寸”查看清晰原图并横向滚动，再点击“适应宽度”返回缩略全图，切换不修改文档或重复渲染。滚动条预留位置避免图表替换源码后反复改变视口宽度。已完成的固定可信 Mermaid 图块在原有权限和内存预算内复用，避免同一内容因布局变化重复启动渲染。历史原生路径的 ACL 设置已改为 Windows API；该路径不属于当前正文的前端渲染流程。' : '宽图保持自然尺寸并滚动查看。'}本候选包含 C4 标签白底碰边修复。源码保留的旧原生目录清理与辅助程序实现不用于当前正文渲染；当前前端发布、取消和释放仍受独立严格合同约束。语法范围仍受固定引擎、输入与图片预算限制，不代表所有语法组合均已验收。导出仍走受限路径，不承诺正文图表一比一导出；Windows DOM/PDF 导出未开放。\n\n${manifest.deliveryReady ? '本候选已分别通过标准用户和未提权管理员安装后的 11 步自动化产品测试（含 12 类扩展语法）、各 19 张正文图、各 5 次自然关闭以及原生和外层清理，并核对两次安装后 EXE 完整字节。' : '两种账户的安装后产品测试尚未通过最终交付门禁；此目录仍是准备材料，不可作为已验收包上传。'}${modern ? (guiPassed ? ' 同一安装器另经两个新账户的独立 GUI 验收：启用后从原生文件选择器打开、普通图和宽图各持续 75 秒、宽图原始尺寸/适应宽度切换及横向滚动、反复改变实际窗口宽度、重复打开及多图预览、空闲与渲染进行中关闭、可见控制台正控以及产品期间未见新控制台窗口；同时核对产品内部资源和外层账户清理。' : ' 新增双账户 GUI 场景尚未通过最终门禁。') : ''} 自动化不是实际系统中文输入法、完整 DPI 矩阵或人工视觉验收；另行人工复核情况以本次交付消息为准。\n\n历史原生路径记录（不属于当前正文前端调用链）：运行 42013443914 曾在辅助程序复制耗时 6.188 秒后等待 ready 帧超时；后续通过的运行未复现，具体延迟根因尚未证实。运行 41692476025 的管道读取 Win32 995 在安装验收 41708284083 中再次出现，具体持有管道的进程仍未查明，错误 5 的重试与它无关。保留的旧原生实现已关闭辅助进程三个协议管道向后代的普通继承路径，并记录退出顺序；该收紧不等于证实历史根因，也不覆盖显式复制句柄。${modern ? '协议失败仍拒绝发布图像并停用新的渲染；仅在当前请求的进程、线程、配置和自建目录全部有完整释放证明时允许关闭。真实资源残留或缺失证明仍会阻止退出，不能用删除外层测试账号替代产品清理。' : '若再次出现清理不确定，程序仍会拒绝发布图像。'}更早运行 41653312849 的 cleanupUncertain 原因同样未定。历史运行 41642093459 的临时 profile 删除曾因 Win32 32 失败，旧 hosted runner 已结束，残留无法复查。旧配置升级、重启与卸载须查独立生命周期报告，并核对其候选与安装器哈希，不能由本次新安装结果替代；回滚功能、安装器交互和 SmartScreen 提示尚未完整验收。本包只有 Windows x64；Linux 原生路径此前限 X11，Wayland 未验收。C4 修复只覆盖所测布局，不代表所有复杂布局均无碰边。\n\n下载需要登录有仓库访问权的 GitHub 账户，在本次 Actions 运行的 Artifacts 中下载并解压。Artifacts 设置保留 7 天；准确到期时间以 GitHub 实际 artifact 记录及本次交付消息为准，本包不会推算或虚构日期。两种账户的原始离线测试报告分别位于 reports/pure-standard 和 reports/filtered-admin（只有最终门禁通过后才加入）${modern ? '；新增 GUI 原始报告、控制台正控和窗口/图表像素保留在 reports/gui-pure-standard 与 reports/gui-filtered-admin' : ''}；manifest.json 与 SHA256SUMS.txt 保留报告身份。反馈请填写 FEEDBACK.md。\n`
}
const feedback = `# 测试反馈\n\n请记录应用“关于”版本、manifest.json 的 candidateSha、Windows 版本、账户类型、已安装 WebView2 版本、显示缩放、插件启用状态和使用的是新配置还是旧配置。\n\n1. 安装、启动、关闭是否成功？\n2. 首次安装是否无需操作就显示图表？源码、渲染、混合能否切换？旧配置禁用是否保留，重新启用后是否立即显示？\n3. 普通图编辑、保存、撤销和重做是否保持准确文本？\n4. 宽图尺寸是否适合编辑区，调整窗口后是否稳定且文字清晰？C4 标签、连线是否有重叠？\n5. 无效语法是否保留源码并显示可理解的诊断？\n6. 是否出现命令行闪窗、反复重绘或回退源码？禁用、重新启用以及空闲/出图中关闭后是否有残留窗口或错误？\n7. 中文输入的拼音、选词、取消和“- 空格 / - [ ] ”输入行为如何？\n\n请提供最小可复现 Markdown、实际现象、操作顺序和截图；避免附带私人文档内容。导出结果请单独标注，正文通过不表示导出通过。\n`

const guiDeliveryReports = [
  'installation-result.json',
  'installed-binary-comparison.json',
  'windows-standard-product-audit.json',
  'gui-regression.json',
  'gui-native-audit.json',
  'native-window-events.json',
  'evidence-files.json',
  'standard-context.json',
]
export const guiDeliveryFiles = Object.freeze(
  ['pure-standard', 'filtered-admin'].flatMap((kind) =>
    [
      ...guiDeliveryReports,
      'gui-console-positive.png',
      ...GUI_STEPS.map((name) => `gui-${name}-window.png`),
      'gui-wide-natural-window.png',
      ...['ordinary', 'wide', 'multi', 'multi-2'].map((name) => `gui-${name}-diagram.png`),
    ].map((name) => `reports/gui-${kind}/${name}`),
  ),
)
export function verifyPayloadInventory(files, { gui = false } = {}) {
  const extra = new Set(guiDeliveryFiles)
  const guiNames = files
    .filter((file) => file.name.startsWith('reports/gui-'))
    .map((file) => file.name)
  if (gui)
    assert.deepEqual(
      [...guiNames].sort(),
      [...extra].sort(),
      'Exact additional GUI delivery files required',
    )
  else assert.deepEqual(guiNames, [], 'No GUI evidence before the additional gate')
  assert(
    files.filter((file) => !extra.has(file.name)).length <= 32,
    'Original payload file-count budget exceeded',
  )
  assert.equal(new Set(files.map((file) => file.name)).size, files.length)
  assert(files.every((file) => Number.isSafeInteger(file.bytes) && file.bytes >= 0))
  assert(
    files.reduce((sum, file) => sum + file.bytes, 0) <= 128 * 1024 * 1024,
    'Payload byte budget exceeded',
  )
  return files
}
async function inventory(directory, options) {
  const files = []
  async function visit(relative = '') {
    for (const entry of await readdir(path.join(directory, relative), { withFileTypes: true })) {
      assert(safeName(entry.name), 'Unexpected payload filename')
      const name = path.posix.join(relative, entry.name)
      if (entry.isDirectory()) await visit(name)
      else {
        const bytes = await plainBytes(path.join(directory, name))
        files.push({ name, bytes: bytes.length, sha256: hash(bytes) })
      }
    }
  }
  await visit()
  verifyPayloadInventory(files, options)
  return files.sort((a, b) => a.name.localeCompare(b.name))
}
async function sums(output, options) {
  const files = (await inventory(output, options)).filter((item) => item.name !== 'SHA256SUMS.txt')
  await writeFile(
    path.join(output, 'SHA256SUMS.txt'),
    files.map((file) => `${file.sha256}  ${file.name}\n`).join(''),
  )
  return files
}

export async function preparePayload(evidence, output) {
  const verified = await verifyInputs(evidence)
  await mkdir(output) // New directory only: never overwrite a previous deliverable.
  await mkdir(path.join(output, 'plugins'))
  await mkdir(path.join(output, 'samples'))
  const name = `milkup-${verified.packaging.version}-windows-x64-${verified.packaging.candidateSha.slice(0, 12)}-setup.exe`
  await writeFile(path.join(output, name), verified.installer, { flag: 'wx' })
  for (const [name, bytes] of verified.archives)
    await writeFile(path.join(output, 'plugins', name), bytes, { flag: 'wx' })
  await writeJson(path.join(output, 'plugins.json'), verified.plugins, true)
  for (const name of ['ordinary', 'wide', 'c4', 'syntax', 'invalid'])
    await writeFile(path.join(output, 'samples', name + '.md'), fixtures[name], { flag: 'wx' })
  const manifest = {
    schema: 1,
    status: 'prepared-pending-installed-verification',
    deliveryReady: false,
    rendererMode: 'frontend',
    candidateSha: verified.packaging.candidateSha,
    version: verified.packaging.version,
    platform: 'windows-x86_64',
    runId: String(verified.packaging.runId),
    runUrl: verified.packaging.runUrl,
    signing: 'unsigned',
    releaseCreated: false,
    installMode: 'currentUser',
    webviewInstallMode: 'skip; existing Evergreen required',
    installer: { ...verified.packaging.installer, deliveredName: name },
    compiledApplication: verified.packaging.compiledApplication,
    extractedApplication: verified.packaging.extractedApplication,
    dependencies: verified.dependencies,
    installerExecuted: false,
    installationAcceptance: 'pending',
    realImeAccepted: false,
    systemDpiMatrixAccepted: false,
    visualReviewAccepted: false,
    windowsMermaid:
      'Pinned official 12.2.0 in the existing frontend WebView; opaque script-only frame, native IPC/navigation rejection required, no per-diagram helper. No independent hard JavaScript termination guarantee.',
    export: 'Existing restricted export path; no full Mermaid or Windows DOM/PDF export acceptance',
    plugins: verified.plugins,
    verification: verified.verification,
    artifactRetentionDays: 7,
    artifactExpiresAt: null,
    expirySource: 'Actual GitHub artifact record after upload; not inferred at build time',
  }
  await writeJson(path.join(output, 'manifest.json'), manifest, true)
  await writeFile(path.join(output, 'README.md'), readme(manifest), { flag: 'wx' })
  await writeFile(path.join(output, 'FEEDBACK.md'), feedback, { flag: 'wx' })
  await writeFile(
    path.join(output, 'MERMAID-LICENSE.txt'),
    (
      await publicBuildFile(
        checkout,
        'apps/desktop/src-tauri/mermaid-engine/assets/MERMAID-LICENSE',
      )
    ).bytes,
    { flag: 'wx' },
  )
  await writeJson(path.join(evidence, 'installer-input.json'), verified.installerInput)
  await writeJson(
    path.join(evidence, 'public-plugins/verification.json'),
    verified.verification,
    true,
  )
  const files = await sums(output)
  const preparation = {
    schema: 1,
    status: 'prepared',
    candidateSha: manifest.candidateSha,
    output: path.resolve(output),
    files,
    checksumsSha256: hash(await plainBytes(path.join(output, 'SHA256SUMS.txt'))),
    packagingSha256: hash(await plainBytes(path.join(evidence, 'packaging-record.json'))),
    installerInputSha256: hash(await plainBytes(path.join(evidence, 'installer-input.json'))),
    verificationSha256: hash(
      await plainBytes(path.join(evidence, 'public-plugins/verification.json')),
    ),
  }
  await writeJson(path.join(evidence, 'mermaid-trial-preparation.json'), preparation, true)
  return { status: manifest.status, deliveryReady: false, output, files: files.length + 1 }
}

function verifyBoundedCloseResponse(value) {
  assert(value && typeof value === 'object', 'Bounded close response required')
  assert.deepEqual(Object.keys(value).sort(), ['bytes', 'sha256', 'text', 'truncated'])
  assert.equal(typeof value.text, 'string')
  assert(Number.isSafeInteger(value.bytes) && value.bytes >= 0)
  assert.match(value.sha256, /^[a-f0-9]{64}$/)
  assert.equal(value.truncated, value.bytes > 2048)
  const bytes = Buffer.from(value.text)
  assert(bytes.length <= 2048)
  if (value.truncated) {
    // The complete-body digest cannot be recomputed from its UTF-8 prefix.
    assert(bytes.length >= 2045 && bytes.length <= value.bytes)
  } else {
    assert.equal(bytes.length, value.bytes)
    assert.equal(hash(bytes), value.sha256, 'Retained raw close response changed')
  }
  return !value.truncated
}

/** Recheck the frozen harness's actual owned-exit acceptance. The report does
 * not expose its original monotonic deadline, so do not invent one from dates. */
export function verifyInstalledProductCloses(product, requireSyntax = false) {
  assert(Array.isArray(product.launches))
  assert.deepEqual(
    product.launches.map((launch) => launch.fixture),
    requireSyntax
      ? ['ordinary', 'wide', 'c4', 'syntax', 'invalid']
      : ['ordinary', 'wide', 'c4', 'invalid'],
  )
  const expectedPhases = [
    'native-drain',
    'ui-close',
    'ui-exit-wait',
    'stdio-drain',
    'normal-exit',
    'native-final-verification',
    'webdriver-detach',
  ]
  for (const launch of product.launches) {
    assert(Number.isSafeInteger(launch.productPid) && launch.productPid > 0)
    assert.equal(launch.exitCode, 0, 'Held product must exit normally')
    assert.equal(launch.signal, null, 'A signalled product exit is not a natural close')
    assert(Number.isFinite(launch.exitObservedMonotonicMs) && launch.exitObservedMonotonicMs >= 0)
    assert.equal(typeof launch.exitedAt, 'string')
    assert.equal(typeof launch.stdioClosedAt, 'string', 'Actual product stdio drain required')
    assert.equal(launch.closedByUi, true)
    assertCleanCloseConfirmation(launch)
    for (const key of ['discardedOwnedUnsavedFixture', 'outerTerminationRequired'])
      assert.notEqual(launch[key], true, 'Forced/discarded close cannot pass')
    const teardown = launch.teardown
    assert(teardown && typeof teardown === 'object', 'Actual close teardown required')
    assert.equal(teardown.afterFailure, false)
    assert.equal(teardown.ownedProductPid, launch.productPid)
    for (const key of ['uiCloseAttempted', 'realUiCloseRequested', 'closedByUi'])
      assert.equal(teardown[key], true, 'Real UI close must be requested and accepted')
    for (const key of ['uiExitWaitFailed', 'uiExitDeadlineUnmet', 'outerTerminationRequired'])
      assert.notEqual(teardown[key], true, 'Failed wait or fallback cannot pass')
    assert.deepEqual(teardown.errors, [])
    assert(Array.isArray(teardown.phases))
    assert.deepEqual(
      teardown.phases.map((phase) => phase.phase),
      expectedPhases,
    )
    assert(teardown.phases.every((phase) => phase.ok === true))
    const phases = teardown.phases
    assert.equal(phases[1].result?.realUiCloseRequested, true)
    assert.equal(phases[2].result, true, 'Frozen harness must accept its original 15-second wait')
    assert.equal(phases[4].result, true)
    assert.equal(phases[0].result?.innerCleanupVerified, true)
    assert.equal(phases[5].result?.innerCleanupVerified, true)
    if (!Object.hasOwn(launch, 'closeConfirmationProbes')) continue
    const history = launch.closeConfirmationProbes
    assert.equal(history?.retainedLimit, 32)
    assert(Number.isSafeInteger(history.total) && history.total >= 1 && history.total <= 4096)
    assert(Number.isSafeInteger(history.omitted) && history.omitted >= 0)
    assert(Array.isArray(history.observations))
    assert.equal(history.observations.length, Math.min(history.total, 32))
    assert(
      !Object.hasOwn(history, 'firstVisibleDialog'),
      'A retained positive dialog blocks delivery',
    )
    assert.deepEqual(
      history.observations.map((row) => row.sequence),
      Array.from({ length: history.observations.length }, (_, index) => index + 1),
    )
    const observations = [...history.observations]
    if (history.total > 32) {
      assert.equal(history.lastObservation?.sequence, history.total)
      assert.equal(history.omitted, history.total - 33)
      observations.push(history.lastObservation)
    } else {
      assert(!Object.hasOwn(history, 'lastObservation'))
      assert.equal(history.omitted, 0)
    }
    for (const row of observations) {
      assert.equal(typeof row.startedAt, 'string')
      assert(
        [
          'no-visible-unsaved-dialog',
          'null-result-awaiting-owned-exit',
          'closed-context-awaiting-owned-exit',
          'pending',
          'interrupted',
        ].includes(row.decision),
      )
      assert.notEqual(row.value, true, 'Observed unsaved dialog blocks delivery')
      if (row.decision !== 'pending') assert.equal(typeof row.finishedAt, 'string')
      if (['pending', 'interrupted'].includes(row.decision))
        assert.equal(row.sequence, history.total)
      if (Object.hasOwn(row, 'error')) verifyBoundedCloseResponse(row.error)
      let decoded = false,
        raw,
        protocolError,
        ownValueError = false
      if (Object.hasOwn(row, 'response')) {
        assert(
          Number.isSafeInteger(row.httpStatus) && row.httpStatus >= 100 && row.httpStatus <= 599,
        )
        if (verifyBoundedCloseResponse(row.response)) {
          const envelope = JSON.parse(row.response.text)
          raw = unwrapWebDriverValue(envelope)
          protocolError = typeof raw?.error === 'string' ? raw.error : undefined
          ownValueError =
            envelope !== null &&
            typeof envelope === 'object' &&
            Object.hasOwn(envelope, 'value') &&
            raw !== null &&
            typeof raw === 'object' &&
            Object.hasOwn(raw, 'error')
          decoded = true
          assert.notEqual(raw, true, 'Actual raw unsaved dialog blocks delivery')
          if (row.httpStatus >= 200 && row.httpStatus < 300 && !protocolError) {
            if (Object.hasOwn(row, 'valueType'))
              assert.equal(row.valueType, raw === null ? 'null' : typeof raw)
            if (Object.hasOwn(row, 'value')) assert.deepEqual(row.value, raw)
          }
        }
      }
      if (['no-visible-unsaved-dialog', 'null-result-awaiting-owned-exit'].includes(row.decision)) {
        const value = row.decision === 'no-visible-unsaved-dialog' ? false : null
        assert.equal(row.valueType, value === null ? 'null' : 'boolean')
        assert.equal(row.value, value)
        assert(row.response && row.httpStatus >= 200 && row.httpStatus < 300)
        if (decoded) {
          assert.equal(raw, value)
          assert.equal(protocolError, undefined)
        }
      } else if (row.decision === 'closed-context-awaiting-owned-exit') {
        const code = row.webDriverErrorCode
        assert(
          [
            'no such window',
            'no such frame',
            'invalid session id',
            'target frame detached',
          ].includes(code),
        )
        assert(row.response && row.error)
        assert(!Object.hasOwn(row, 'value') && !Object.hasOwn(row, 'valueType'))
        if (code === 'target frame detached') {
          assert.equal(row.httpStatus, 404)
          if (decoded) assert(ownValueError, 'Detached target needs own envelope.value.error')
        }
        if (decoded) assert.equal(protocolError, code)
      }
    }
  }
  return {
    naturalUiCloses: product.launches.length,
    configuredWaitBudgetMs: 15000,
    independentMonotonicDeadlineRecomputed: false,
    dialogAbsenceInferredFromNullOrExit: false,
  }
}

export async function verifyInstalledEvidence(directory, expected) {
  const accountKind = validateAccountKind(expected.expectedAccountKind)
  assert.match(expected.harnessSha256, /^[a-f0-9]{64}$/)
  const names = [
    'installation-result.json',
    'installed-binary-comparison.json',
    'windows-standard-product-audit.json',
    'mermaid-product-e2e.json',
  ]
  const records = await Promise.all(
    names.map(async (name) => {
      const bytes = await plainBytes(path.join(directory, name), 4 * 1024 * 1024)
      return {
        name,
        bytes: bytes.length,
        sha256: hash(bytes),
        value: JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, '')),
      }
    }),
  )
  const [installation, comparison, audit, product] = records.map((item) => item.value)
  for (const value of [installation, comparison, audit, product])
    assert.equal(value.status, 'passed', 'Installed acceptance evidence is not passed')
  assert.equal(installation.schema, 1)
  assert.equal(installation.mode, 'nsis-current-user')
  assert.equal(installation.candidateSha, expected.candidateSha)
  assert.equal(product.candidateSha, expected.candidateSha)
  assert.equal(
    product.harnessSha256,
    expected.harnessSha256,
    'Exact installed acceptance harness required',
  )
  assert.equal(audit.source, expected.candidateSha)
  assert.equal(installation.installer.sha256, expected.installerSha256)
  assert.equal(installation.installerRun.started, true)
  assert.equal(installation.installerRun.status, 'passed')
  assert.equal(installation.installerRun.exited, true)
  assert.equal(installation.installerRun.exitCode, 0)
  assert.equal(installation.installerRun.identityVerified, true)
  assert.equal(installation.installerRun.streamsDrained, true)
  assert.equal(installation.installerRun.forcedProcessTermination, false)
  assert.equal(installation.installerRun.timedOut, false)
  assert.deepEqual(installation.installerRun.cleanupErrors, [])
  assert.equal(installation.expectedAccountKind, accountKind)
  assert.equal(installation.installerRun.expectedAccountKind, accountKind)
  for (const identity of [
    installation.installerRun.callerIdentity,
    installation.installerRun.startedProcess,
  ]) {
    validateHostProcessToken(
      identity.token,
      installation.actualSid,
      installation.sessionId,
      accountKind,
    )
    assert.equal(identity.sessionId, installation.sessionId)
    assert.equal(identity.inJob, true)
    assert.equal(identity.expectedAccountKind, accountKind)
    assert.equal(identity.accountKindVerified, true)
  }
  assert.equal(installation.installerRun.startedProcess.imageTruncated, false)
  assert.equal(
    windowsPath(installation.installerRun.startedProcess.image),
    windowsPath(installation.installer.path),
  )
  assert.match(installation.installerRun.startedProcess.creationFileTime, /^\d+$/)
  assert.equal(installation.productAcceptance, 'passed')
  assert.deepEqual(installation.cleanupErrors, [])
  assert.equal(installation.installedBinary.productVersion, expected.version)
  assert.equal(installation.installedBinary.fileVersion, expected.version)
  assert.equal(installation.installedBinary.peMachine, '0x8664')
  assert.equal(installation.installedBinary.sha256, expected.installedSha256)
  assert.equal(product.applicationSha256, expected.installedSha256)
  assert.equal(windowsPath(product.application), windowsPath(installation.installedBinary.path))
  for (const value of [comparison, installation.binaryComparison]) {
    assert.equal(value.status, 'passed')
    assert.equal(value.builtSha256, expected.builtSha256)
    assert.equal(value.expectedInstalledSha256, expected.installedSha256)
    assert.equal(value.installedSha256, expected.installedSha256)
    assert.equal(value.bytes, expected.applicationBytes)
    assert.equal(value.bundleMarkerOffset, expected.markerOffset)
    assert.equal(value.transformation, '__TAURI_BUNDLE_TYPE_VAR_UNK -> __TAURI_BUNDLE_TYPE_VAR_NSS')
  }
  assert.deepEqual(installation.bundledPlugins, expected.bundledPlugins)
  assert.deepEqual(
    installation.resources,
    expected.resources.map((item) => ({ ...item, verified: true })),
  )
  assert.equal(installation.embeddedPluginBinding, 'exact-installed-image-byte-comparison')
  assert.equal(installation.actualSid, installation.expectedSid)
  assert.equal(installation.actualSid, audit.accountSid)
  assert.equal(installation.sessionId, installation.expectedSessionId)
  assert.equal(audit.expectedAccountKind, accountKind)
  assert.equal(audit.childResult.expectedAccountKind, accountKind)
  assert.equal(product.expectedAccountKind, accountKind)
  validateContext(
    audit.standardContext,
    installation.actualSid,
    installation.sessionId,
    accountKind,
  )
  validateContext(product.context, installation.actualSid, installation.sessionId, accountKind)
  for (const key of [
    'accountCreated',
    'accountDeleted',
    'accountGroupCleanupConfirmed',
    'profileDeleted',
    'stageRemoved',
    'installerExecuted',
    'installedDirectoryRemoved',
  ])
    assert.equal(audit[key], true, key + ' must be actually observed')
  for (const key of [
    'runtimeInstalled',
    'fixedRuntimeUsed',
    'changedAcl',
    'changedUacOrSecurityPolicy',
    'passwordInLogsFilesArgumentsOrEnvironment',
  ])
    assert.equal(audit[key], false, key + ' must remain false')
  assert.deepEqual(audit.cleanupErrors, [])
  const groupCleanup = audit.accountGroupCleanup
  assert.equal(groupCleanup?.sid, installation.actualSid)
  assert.equal(groupCleanup.readOnly, true)
  assert.equal(groupCleanup.complete, true)
  assert.deepEqual(groupCleanup.errors, [])
  assert.deepEqual(
    groupCleanup.groups?.map((group) => group.groupSid),
    ['S-1-5-32-545', 'S-1-5-32-544'],
  )
  assert(
    groupCleanup.groups.every((group) => group.queried === true && group.exactSidPresent === false),
    'Actual deleted SID must be absent from both Users and Administrators',
  )
  assert.equal(audit.supervisor.jobEmpty, true)
  assert.deepEqual(audit.supervisor.cleanupErrors, [])
  assert.equal(audit.childResult.status, 'passed')
  assert.equal(audit.evidenceCopy.complete, true)
  assert.deepEqual(
    product.steps.map((step) => step.name),
    stepNames,
    'Complete exact installed-product sequence required',
  )
  assert(
    product.steps.every((step) => step.passed === true),
    'An installed product step failed',
  )
  validatePreviewModes(product.steps[1])
  const syntax = product.steps.find((step) => step.name === '07-syntax')
  assert.deepEqual(
    syntax?.syntaxCases?.map((item) => item.id),
    syntaxCases.map((item) => item.id),
    'Complete official syntax cases required',
  )
  for (const [index, item] of syntax.syntaxCases.entries())
    assert.equal(item.sourceSha256, hash(syntaxCases[index].source))
  const observedPlugins = product.steps[0].bundledPluginsObserved
  assert(Array.isArray(observedPlugins), 'Actual initial bundled-plugin switch states required')
  assert.deepEqual(
    observedPlugins.map((item) => item.id).sort(),
    expected.bundledPlugins.map((item) => item.id).sort(),
  )
  assert(
    observedPlugins.every(
      (item) =>
        item.checked === (item.id === REVIEWED_MERMAID_PACKAGE.pluginId ? 'true' : 'false') &&
        item.busy !== 'true',
    ),
    'Diagrams must start enabled; other bundled plugins remain disabled',
  )
  for (const observed of observedPlugins)
    assert.equal(
      observed.version,
      expected.bundledPlugins.find((item) => item.id === observed.id).version,
      'Actual initial plugin version differs from sealed inventory',
    )
  assert.equal(
    product.runtime.provenance,
    'Existing installed Evergreen selected by reviewed wrapper; no runtime installation',
  )
  assert.match(product.runtime.sha256, /^[a-f0-9]{64}$/)
  const closes = verifyInstalledProductCloses(product, true)
  const productPids = new Set(product.launches.map((launch) => launch.productPid))
  const strictLaunches = requiresLaunchAudit(product, expected.candidateSha)
  if (product.auditIdentityVersion !== undefined) assert.equal(product.auditIdentityVersion, 1)
  if (product.launches.some((launch) => launch.creationFileTime !== undefined))
    assert(strictLaunches)
  const rendererMode = expected.rendererMode ?? 'native'
  assert(['native', 'frontend'].includes(rendererMode))
  if (rendererMode === 'frontend') {
    assert.equal(product.rendererMode, 'frontend')
    assert.equal(audit.rendererMode, 'frontend')
  } else assert(product.rendererMode === undefined || product.rendererMode === 'native')
  const Ledger = rendererMode === 'frontend' ? frontendLedgerClass(AuditLedger) : AuditLedger
  const ledger = new Ledger(
    installation.actualSid,
    installation.sessionId,
    accountKind,
    strictLaunches,
  )
  assert(
    Array.isArray(product.nativeAudit) && product.nativeAudit.length > 0,
    'Real native ownership audit required',
  )
  if (strictLaunches) {
    let consumed = 0
    for (const launch of product.launches) {
      assert.equal(launch.creationFileTime, launch.identity.creationFileTime)
      assert.equal(launch.productPid, launch.identity.pid)
      ledger.registerLaunch(launch)
      for (const event of product.nativeAudit.filter(
        (event) =>
          event.productPid === launch.productPid &&
          event.productCreationFileTime === launch.creationFileTime,
      )) {
        ledger.accept(event, launch.productPid, launch.creationFileTime)
        consumed++
      }
      ledger.closeLaunch(launch)
    }
    assert.equal(consumed, product.nativeAudit.length, 'Every event has an exact launch')
  } else
    for (const event of product.nativeAudit) {
      assert(productPids.has(event.productPid))
      ledger.accept(event, event.productPid)
    }
  ledger.verifyAll()
  assert(
    product.nativeAudit.some((event) => event.phase === 'started'),
    'Native rendering never started',
  )
  const pixels = []
  for (const step of product.steps) {
    assert(step.screenshot, 'Retained actual window screenshot required')
    if (strictLaunches) {
      const matches = product.launches.filter(
        (launch) =>
          launch.productPid === step.productPid &&
          launch.creationFileTime === step.productCreationFileTime &&
          launch.fixture === step.fixture,
      )
      assert.equal(matches.length, 1, 'Step belongs to one exact fixture launch')
    }
    if (
      [
        '02-enable-and-exact-bytes',
        '03-real-edit-save-replacement',
        '04-undo-exact-original',
        '05-redo-exact-edit',
        '06-disable-and-reenable-in-place',
        '07-wide',
        '07-c4',
      ].includes(step.name)
    )
      assert(step.image, 'Retained actual native diagram PNG required')
    for (const record of [
      step.screenshot,
      step.image,
      ...(step.syntaxCases ?? []).map((item) => item.image),
    ].filter(Boolean)) {
      assert(safeName(record.file) && record.file.endsWith('.png'))
      const bytes = await plainBytes(path.join(directory, record.file), 32 * 1024 * 1024)
      const png = validatePng(bytes, 32 * 1024 * 1024)
      assert.equal(png.sha256, record.sha256, 'Retained image changed')
      assert.equal(png.bytes, record.bytes)
      assert.equal(png.width, record.width)
      assert.equal(png.height, record.height)
      assert.equal(record.fullyDecoded, true)
      assert.equal(record.nonuniform, true)
      if (record !== step.screenshot) {
        if (strictLaunches) {
          assert.match(record.native.productCreationFileTime ?? '', /^\d+$/)
          assert.equal(record.native.productCreationFileTime, step.productCreationFileTime)
          assert.equal(record.native.productPid, step.productPid)
        }
        ledger.matchPng(record.native.productPid, png, record.native.productCreationFileTime)
      }
      pixels.push({ name: record.file, bytes: bytes.length, sha256: png.sha256 })
    }
  }
  return {
    status: 'passed',
    scope:
      'Exact installed image, same-SID verified account, eleven product operations, retained PNG hashes and native cleanup records; no human visual/IME/DPI acceptance',
    expectedAccountKind: accountKind,
    closes,
    records: records.map(({ value: _value, ...record }) => record),
    pixels,
    runtime: product.runtime,
    account: { sid: installation.actualSid, sessionId: installation.sessionId },
    applicationSha256: product.applicationSha256,
  }
}

export async function verifyInstalledAccountMatrix(parent, expected) {
  const kinds = ['pure-standard', 'filtered-admin']
  const info = await lstat(parent)
  assert(info.isDirectory() && !info.isSymbolicLink(), 'Plain installed-evidence parent required')
  assert.deepEqual(
    (await readdir(parent)).sort(),
    [...kinds].sort(),
    'Exactly two independent installed-account evidence directories required',
  )
  const accounts = {}
  for (const kind of kinds) {
    const directory = path.join(parent, kind)
    const info = await lstat(directory)
    assert(
      info.isDirectory() && !info.isSymbolicLink(),
      'Plain installed-account directory required',
    )
    accounts[kind] = await verifyInstalledEvidence(directory, {
      ...expected,
      expectedAccountKind: kind,
    })
  }
  assert.notEqual(
    accounts['pure-standard'].account.sid,
    accounts['filtered-admin'].account.sid,
    'Installed account fixtures must have distinct actual SIDs',
  )
  return {
    status: 'passed',
    scope:
      'Separate fresh pure-standard and non-elevated filtered-admin installations of the same verified package',
    requiredAccountKinds: kinds,
    naturalUiCloses: Object.values(accounts).reduce(
      (total, account) => total + account.closes.naturalUiCloses,
      0,
    ),
    accounts,
  }
}

/** Additional GUI acceptance never replaces the original ten-step product gate. */
export async function verifyInstalledGuiEvidence(directory, expected) {
  const kind = validateAccountKind(expected.expectedAccountKind)
  const names = guiDeliveryReports
  const entries = await Promise.all(
    names.map(async (name) => {
      const bytes = await plainBytes(path.join(directory, name), 2 * 1024 * 1024)
      return {
        name,
        bytes,
        sha256: hash(bytes),
        value: JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, '')),
      }
    }),
  )
  const byName = new Map(entries.map((entry) => [entry.name, entry]))
  const [installation, comparison, audit, report] = entries.map((entry) => entry.value)
  for (const value of [installation, comparison, audit, report])
    assert.equal(value.status, 'passed', 'Installed GUI evidence must independently pass')
  assert.equal(installation.schema, 1)
  assert.equal(installation.mode, 'nsis-current-user')
  assert.equal(installation.candidateSha, expected.candidateSha)
  assert.equal(installation.expectedAccountKind, kind)
  assert.equal(installation.guiAcceptance, 'passed')
  assert.equal(
    installation.productAcceptance,
    'not-run-gui-only',
    'GUI evidence must not impersonate the original product sequence',
  )
  assert.equal(installation.installer.sha256, expected.installerSha256)
  assert.deepEqual(installation.cleanupErrors, [])
  const run = installation.installerRun
  for (const key of ['started', 'exited', 'identityVerified', 'streamsDrained'])
    assert.equal(run[key], true)
  for (const key of ['forcedProcessTermination', 'timedOut']) assert.equal(run[key], false)
  assert.equal(run.status, 'passed')
  assert.equal(run.exitCode, 0)
  assert.equal(run.expectedAccountKind, kind)
  assert.deepEqual(run.cleanupErrors, [])
  for (const identity of [run.callerIdentity, run.startedProcess]) {
    validateHostProcessToken(identity.token, installation.actualSid, installation.sessionId, kind)
    assert.equal(identity.sessionId, installation.sessionId)
    assert.equal(identity.inJob, true)
    assert.equal(identity.expectedAccountKind, kind)
    assert.equal(identity.accountKindVerified, true)
  }
  assert.equal(run.startedProcess.imageTruncated, false)
  assert.equal(windowsPath(run.startedProcess.image), windowsPath(installation.installer.path))
  assert.match(run.startedProcess.creationFileTime, /^\d+$/)
  assert.equal(installation.actualSid, installation.expectedSid)
  assert.equal(installation.actualSid, audit.accountSid)
  assert.equal(installation.sessionId, installation.expectedSessionId)
  for (const key of ['productVersion', 'fileVersion'])
    assert.equal(installation.installedBinary[key], expected.version)
  assert.equal(installation.installedBinary.peMachine, '0x8664')
  assert.equal(installation.installedBinary.sha256, expected.installedSha256)
  assert.equal(installation.installedBinary.bytes, expected.applicationBytes)
  for (const value of [comparison, installation.binaryComparison]) {
    assert.equal(value.status, 'passed')
    assert.equal(value.builtSha256, expected.builtSha256)
    assert.equal(value.expectedInstalledSha256, expected.installedSha256)
    assert.equal(value.installedSha256, expected.installedSha256)
    assert.equal(value.bytes, expected.applicationBytes)
    assert.equal(value.bundleMarkerOffset, expected.markerOffset)
    assert.equal(value.transformation, '__TAURI_BUNDLE_TYPE_VAR_UNK -> __TAURI_BUNDLE_TYPE_VAR_NSS')
  }
  assert.deepEqual(installation.bundledPlugins, expected.bundledPlugins)
  assert.deepEqual(
    installation.resources,
    expected.resources.map((item) => ({ ...item, verified: true })),
  )
  assert.equal(installation.embeddedPluginBinding, 'exact-installed-image-byte-comparison')
  assert.equal(audit.source, expected.candidateSha)
  assert.equal(audit.applicationCandidateSha, expected.candidateSha)
  assert.equal(audit.harnessMode, 'gui-regression')
  assert.equal(audit.mode, 'nsis-current-user')
  assert.equal(audit.binaryRole, 'compiledCandidate')
  assert.equal(audit.binary.sha256, expected.builtSha256)
  assert.equal(audit.expectedAccountKind, kind)
  assert.equal(audit.childResult.expectedAccountKind, kind)
  assert.equal(audit.childResult.status, 'passed')
  assert.equal(audit.evidenceCopy.complete, true)
  assert.equal(audit.supervisor.jobEmpty, true)
  assert.deepEqual(audit.supervisor.cleanupErrors, [])
  assert.deepEqual(audit.cleanupErrors, [])
  for (const key of [
    'accountCreated',
    'accountDeleted',
    'accountGroupCleanupConfirmed',
    'profileDeleted',
    'stageRemoved',
    'installerExecuted',
    'installedDirectoryRemoved',
  ])
    assert.equal(audit[key], true, 'GUI outer cleanup must be observed: ' + key)
  for (const key of [
    'runtimeInstalled',
    'fixedRuntimeUsed',
    'changedAcl',
    'changedUacOrSecurityPolicy',
    'passwordInLogsFilesArgumentsOrEnvironment',
    'outerCleanupProvesProductInnerCleanup',
  ])
    assert.equal(audit[key], false, 'GUI boundary must remain false: ' + key)
  const groups = audit.accountGroupCleanup
  assert.equal(groups.sid, installation.actualSid)
  assert.equal(groups.readOnly, true)
  assert.equal(groups.complete, true)
  assert.deepEqual(groups.errors, [])
  assert.deepEqual(
    groups.groups.map((group) => group.groupSid),
    ['S-1-5-32-545', 'S-1-5-32-544'],
  )
  assert(groups.groups.every((group) => group.queried === true && group.exactSidPresent === false))
  for (const context of [
    audit.standardContext,
    report.context,
    byName.get('standard-context.json').value,
  ])
    validateContext(context, installation.actualSid, installation.sessionId, kind)
  assert.equal(report.contextSha256, byName.get('standard-context.json').sha256)
  assert.deepEqual(report.context, byName.get('standard-context.json').value)
  assert.equal(
    report.identityKind,
    'current-candidate',
    'Historical baseline failures cannot authorize new delivery',
  )
  assert.equal(report.applicationCandidateSha, expected.candidateSha)
  assert.equal(report.harnessCandidateSha, expected.candidateSha)
  assert.equal(report.applicationSha256, expected.installedSha256)
  assert.equal(report.installerSha256, expected.installerSha256)
  assert.equal(report.expectedAccountKind, kind)
  assert.equal(windowsPath(report.application), windowsPath(installation.installedBinary.path))
  for (const key of ['harnessSha256', 'contractSha256']) {
    assert.match(expected[key], /^[a-f0-9]{64}$/)
    assert.equal(report[key], expected[key], 'Exact GUI source input required: ' + key)
  }
  assert.deepEqual(report.observerInputs, expected.observerInputs)
  assert.equal(report.runtime.installedEvergreen, true)
  assert.equal(report.runtime.sha256, audit.runtime.sha256)
  assert.equal(report.runtime.version, audit.runtime.version)
  assert.equal(windowsPath(report.runtime.executable), windowsPath(audit.runtime.path))
  assert.equal(report.nativeAudit.file, 'gui-native-audit.json')
  assert.equal(report.nativeWindowEvidence.file, 'native-window-events.json')
  assert.equal(
    report.nativeWindowEvidence.bytes,
    byName.get('native-window-events.json').bytes.length,
  )
  assert.deepEqual(report.errors, [])
  // Validate the bounded lossless envelope before reading any native identity.
  // Keep the stored bytes unchanged for the report/copy-manifest hash gates.
  const rawWindows = JSON.parse(
    decodeGuiEvidence(byName.get('native-window-events.json').bytes, 'window'),
  )
  validateHostProcessToken(
    rawWindows.identityContext.token,
    installation.actualSid,
    installation.sessionId,
    kind,
  )
  assert.equal(rawWindows.identityContext.sessionId, installation.sessionId)
  assert.equal(rawWindows.identityContext.desktopEligible, true)
  assert.deepEqual(rawWindows.identityContext.blockedReasons, [])
  assert.equal(rawWindows.context.sessionId, installation.sessionId)
  assert.equal(rawWindows.context.sameInputDesktop, true)
  assert.equal(rawWindows.context.desktopChanged, false)
  assert.equal(rawWindows.context.threadDesktop, rawWindows.context.inputDesktop)
  assert(
    typeof rawWindows.context.inputDesktop === 'string' &&
      rawWindows.context.inputDesktop.length > 0,
  )
  assert.equal(report.launches.length, 2)
  assert.equal(rawWindows.trackedProducts.length, 2)
  const tracked = new Map(rawWindows.trackedProducts.map((value) => [value.pid, value]))
  assert.equal(tracked.size, 2)
  for (const launch of report.launches) {
    const identity = launch.identity,
      held = tracked.get(launch.productPid)
    assert(held, 'Native window observation must track this exact product launch')
    assert.equal(identity.pid, launch.productPid)
    assert.match(identity.creationFileTime, /^\d+$/)
    validateHostProcessToken(identity.token, installation.actualSid, installation.sessionId, kind)
    assert.equal(windowsPath(identity.image), windowsPath(installation.installedBinary.path))
    assert.equal(held.creationFileTime, identity.creationFileTime)
    assert.equal(windowsPath(held.image), windowsPath(identity.image))
    assert.equal(held.heldProcessSignaledAtStop, true)
  }
  const gui = verifyGuiEvidence(
    report,
    byName.get('gui-native-audit.json').bytes,
    byName.get('native-window-events.json').bytes,
    expected.rendererMode ?? 'native',
  )
  // The outer copy manifest binds each retained child report and screenshot to
  // the bytes read before that exact fresh account/profile was removed.
  const copied = byName.get('evidence-files.json').value
  assert.equal(copied.schema, 1)
  assert.equal(copied.complete, true)
  assert.equal(copied.rejectedCount, 0)
  assert.equal(copied.rejectionsOmitted, 0)
  assert.deepEqual(copied.rejected, [])
  assert(Array.isArray(copied.files) && copied.files.length <= 94)
  for (const entry of copied.files) {
    assert(safeName(entry.retainedName) && safeName(entry.relativePath))
    assert(Number.isSafeInteger(entry.bytes) && entry.bytes >= 0 && entry.bytes <= 32 * 1024 * 1024)
    assert.match(entry.sha256, /^[a-f0-9]{64}$/)
  }
  assert.equal(
    copied.totalBytes,
    copied.files.reduce((sum, entry) => sum + entry.bytes, 0),
  )
  assert(
    copied.totalBytes <= 126 * 1024 * 1024,
    'Original GUI copy remains within its aggregate budget',
  )
  const copiedByName = new Map(copied.files.map((entry) => [entry.retainedName, entry]))
  assert.equal(copiedByName.size, copied.files.length)
  const bind = (name, bytes) => {
    const entry = copiedByName.get(name)
    assert(entry, 'Missing original evidence copy identity: ' + name)
    assert.equal(entry.relativePath, name)
    assert.equal(entry.bytes, bytes.length)
    assert.equal(entry.sha256, hash(bytes), 'Copied GUI evidence changed: ' + name)
  }
  for (const entry of entries)
    if (!['windows-standard-product-audit.json', 'evidence-files.json'].includes(entry.name))
      bind(entry.name, entry.bytes)
  const screenshots = new Map(report.screenshotProofs.map((item) => [item.file, item]))
  const diagrams = new Map(report.diagramProofs.map((item) => [item.file, item]))
  assert.equal(screenshots.size, report.screenshotProofs.length)
  assert.equal(diagrams.size, report.diagramProofs.length)
  assert.deepEqual(
    [...screenshots.keys()].sort(),
    [...GUI_STEPS.map((name) => `gui-${name}-window.png`), 'gui-wide-natural-window.png'].sort(),
  )
  assert.deepEqual(
    [...diagrams.keys()].sort(),
    ['ordinary', 'wide', 'multi', 'multi-2'].map((name) => `gui-${name}-diagram.png`).sort(),
  )
  const pixels = []
  const retainPng = async (name, claimed) => {
    assert(safeName(name) && name.endsWith('.png'))
    const bytes = await plainBytes(path.join(directory, name), 32 * 1024 * 1024)
    bind(name, bytes)
    const actual = validatePng(bytes, 32 * 1024 * 1024)
    const observed = screenshots.get(name) ?? diagrams.get(name)
    if (name !== 'gui-console-positive.png') {
      assert(observed, 'Actual GUI capture identity required')
      assert.equal(observed.bytes, bytes.length)
      assert.equal(observed.sha256, actual.sha256)
    }
    if (claimed)
      for (const key of ['sha256', 'bytes', 'width', 'height'])
        assert.equal(actual[key], claimed[key], 'Retained GUI PNG ' + key)
    pixels.push({ name, bytes: bytes.length, sha256: actual.sha256 })
  }
  await retainPng('gui-console-positive.png')
  for (const name of GUI_STEPS) {
    const step = report.steps.find((step) => step.name === name)
    assert.equal(step.screenshot, `gui-${name}-window.png`)
    await retainPng(step.screenshot)
  }
  await retainPng(
    report.steps.find((step) => step.name === 'open-wide-stable').wideInteraction.naturalScreenshot,
  )
  for (const [name, stepName] of [
    ['ordinary', 'open-ordinary-stable'],
    ['wide', 'open-wide-stable'],
    ['multi', 'multi-diagram'],
  ]) {
    const step = report.steps.find((step) => step.name === stepName)
    const claimed = name === 'multi' ? step.decodedImages[0] : step.finalPng
    await retainPng(`gui-${name}-diagram.png`, claimed)
  }
  await retainPng(
    'gui-multi-2-diagram.png',
    report.steps.find((step) => step.name === 'multi-diagram').decodedImages[1],
  )
  return {
    status: 'passed',
    scope:
      'Separate real installed GUI acceptance; observed desktop DPI only, no full DPI matrix or system IME acceptance',
    expectedAccountKind: kind,
    gui,
    account: { sid: installation.actualSid, sessionId: installation.sessionId },
    applicationSha256: report.applicationSha256,
    runtime: report.runtime,
    records: entries.map(({ name, bytes, sha256 }) => ({ name, bytes: bytes.length, sha256 })),
    pixels,
  }
}

export async function verifyInstalledGuiMatrix(parent, expected) {
  const kinds = ['pure-standard', 'filtered-admin']
  const info = await lstat(parent)
  assert(
    info.isDirectory() && !info.isSymbolicLink(),
    'Plain installed GUI evidence parent required',
  )
  assert.deepEqual(
    (await readdir(parent)).sort(),
    [...kinds].sort(),
    'Both distinct installed GUI account directories required',
  )
  const accounts = {}
  for (const kind of kinds) {
    const directory = path.join(parent, kind),
      info = await lstat(directory)
    assert(info.isDirectory() && !info.isSymbolicLink(), 'Plain GUI account directory required')
    accounts[kind] = await verifyInstalledGuiEvidence(directory, {
      ...expected,
      expectedAccountKind: kind,
    })
  }
  assert.notEqual(
    accounts['pure-standard'].account.sid,
    accounts['filtered-admin'].account.sid,
    'GUI accounts need distinct actual SIDs',
  )
  return { status: 'passed', requiredAccountKinds: kinds, naturalUiCloses: 4, accounts }
}

export function requireGuiEvidence(version, directory) {
  const match = /^2\.0\.0-beta\.([1-9][0-9]*)$/.exec(version)
  assert(match, 'Explicit test version required')
  const required = Number(match[1]) >= 10
  if (required) assert(directory, 'beta.10 and later require separate installed GUI evidence')
  return required || !!directory
}

export async function finalizePayload(evidence, output, installedEvidence, guiEvidence) {
  const preparation = await json(path.join(evidence, 'mermaid-trial-preparation.json'))
  assert.equal(preparation.status, 'prepared')
  assert.equal(preparation.output, path.resolve(output))
  const currentFiles = await inventory(output)
  assert.deepEqual(
    currentFiles.filter((file) => file.name !== 'SHA256SUMS.txt'),
    preparation.files,
    'Prepared payload changed before installed acceptance',
  )
  assert.equal(
    hash(await plainBytes(path.join(output, 'SHA256SUMS.txt'))),
    preparation.checksumsSha256,
  )
  for (const [name, key] of [
    ['packaging-record.json', 'packagingSha256'],
    ['installer-input.json', 'installerInputSha256'],
    ['public-plugins/verification.json', 'verificationSha256'],
  ])
    assert.equal(
      hash(await plainBytes(path.join(evidence, name))),
      preparation[key],
      'Preparation evidence changed',
    )
  const verified = await verifyInputs(evidence)
  assert.deepEqual(
    await json(path.join(evidence, 'public-plugins/verification.json')),
    verified.verification,
  )
  const expected = {
    rendererMode: 'frontend',
    candidateSha: verified.packaging.candidateSha,
    version: verified.packaging.version,
    installerSha256: verified.packaging.installer.sha256,
    installedSha256: verified.packaging.extractedApplication.sha256,
    builtSha256: verified.packaging.compiledApplication.sha256,
    applicationBytes: verified.packaging.extractedApplication.bytes,
    markerOffset: verified.verification.embedded.markerOffset,
    bundledPlugins: verified.installerInput.bundledPlugins,
    resources: verified.installerInput.resources,
    harnessSha256: hash(
      await plainBytes(path.join(checkout, 'tests/windows/mermaid-product-e2e.mjs')),
    ),
  }
  const installed = await verifyInstalledAccountMatrix(installedEvidence, expected)
  const gui = requireGuiEvidence(expected.version, guiEvidence)
    ? await verifyInstalledGuiMatrix(guiEvidence, {
        ...expected,
        harnessSha256: hash(
          await plainBytes(path.join(checkout, 'tests/windows/mermaid-gui-regression.mjs')),
        ),
        contractSha256: hash(
          await plainBytes(path.join(checkout, 'tests/windows/mermaid-gui-contract.mjs')),
        ),
        observerInputs: {
          scriptSha256: hash(
            await plainBytes(
              path.join(checkout, 'scripts/ci/run-windows-mermaid-gui-observer.ps1'),
            ),
          ),
          sourceSha256: hash(
            await plainBytes(path.join(checkout, 'scripts/ci/WindowsMermaidGuiObserver.cs')),
          ),
        },
      })
    : undefined
  if (gui) {
    const sids = [...Object.values(installed.accounts), ...Object.values(gui.accounts)].map(
      (account) => account.account.sid,
    )
    assert.equal(
      new Set(sids).size,
      4,
      'Product and GUI matrices require four independently created installation accounts',
    )
  }
  const manifest = await json(path.join(output, 'manifest.json'))
  assert.equal(manifest.deliveryReady, false)
  await mkdir(path.join(output, 'reports'))
  for (const [kind, account] of Object.entries(installed.accounts)) {
    await mkdir(path.join(output, 'reports', kind))
    for (const record of account.records) {
      const bytes = await plainBytes(
        path.join(installedEvidence, kind, record.name),
        4 * 1024 * 1024,
      )
      assert.equal(hash(bytes), record.sha256, 'Installed report changed before delivery copy')
      await writeFile(path.join(output, 'reports', kind, record.name), bytes, { flag: 'wx' })
    }
  }
  if (gui)
    for (const [kind, account] of Object.entries(gui.accounts)) {
      const destination = path.join(output, 'reports', `gui-${kind}`)
      await mkdir(destination)
      for (const record of [...account.records, ...account.pixels]) {
        const bytes = await plainBytes(
          path.join(guiEvidence, kind, record.name),
          record.name.endsWith('.png') ? 32 * 1024 * 1024 : 2 * 1024 * 1024,
        )
        assert.equal(hash(bytes), record.sha256, 'GUI report changed before delivery copy')
        await writeFile(path.join(destination, record.name), bytes, { flag: 'wx' })
      }
    }
  Object.assign(manifest, {
    status: 'verified-for-user-trial',
    deliveryReady: true,
    installerExecuted: true,
    installationAcceptance: installed,
    ...(gui ? { guiAcceptance: gui } : {}),
    finalizedAt: new Date().toISOString(),
  })
  const finalReadme = readme(manifest)
  const finalManifest = JSON.stringify(manifest, null, 2) + '\n'
  // Validate the exact future payload, including larger acceptance reports and
  // checksum inventory, before persisting any delivery-ready marker.
  const planned = await inventory(output, { gui: !!gui })
  for (const [name, bytes] of [
    ['manifest.json', Buffer.byteLength(finalManifest)],
    ['README.md', Buffer.byteLength(finalReadme)],
  ]) {
    const item = planned.find((file) => file.name === name)
    assert(item, 'Prepared payload metadata missing')
    item.bytes = bytes
  }
  const checksum = planned.find((file) => file.name === 'SHA256SUMS.txt')
  assert(checksum)
  checksum.bytes = planned
    .filter((file) => file.name !== 'SHA256SUMS.txt')
    .reduce((sum, file) => sum + Buffer.byteLength(`${'0'.repeat(64)}  ${file.name}\n`), 0)
  verifyPayloadInventory(planned, { gui: !!gui })
  await writeFile(path.join(output, 'manifest.json'), finalManifest)
  await writeFile(path.join(output, 'README.md'), finalReadme)
  const files = await sums(output, { gui: !!gui })
  const proof = {
    schema: 1,
    status: 'passed',
    deliveryReady: true,
    candidateSha: manifest.candidateSha,
    output: path.resolve(output),
    files,
    checksumsSha256: hash(await plainBytes(path.join(output, 'SHA256SUMS.txt'))),
    installed,
    ...(gui ? { gui } : {}),
    artifactRetentionDays: 7,
    artifactExpiresAt: null,
  }
  await writeJson(path.join(evidence, 'mermaid-trial-finalization.json'), proof, true)
  return { status: proof.status, deliveryReady: true, output, files: files.length + 1 }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [mode, evidence, output, installedEvidence, guiEvidence, ...extra] = process.argv.slice(2)
  assert(
    ['prepare', 'finalize'].includes(mode) && evidence && output,
    'Usage: prepare-mermaid-trial-payload.mjs prepare|finalize <evidence> <new-payload> [installed-evidence-parent-with-both-account-directories] [separate-installed-gui-evidence-parent]',
  )
  assert.equal(extra.length, 0)
  assert(mode === 'prepare' ? !installedEvidence && !guiEvidence : !!installedEvidence)
  const result =
    mode === 'prepare'
      ? await preparePayload(path.resolve(evidence), path.resolve(output))
      : await finalizePayload(
          path.resolve(evidence),
          path.resolve(output),
          path.resolve(installedEvidence),
          guiEvidence ? path.resolve(guiEvidence) : undefined,
        )
  console.log(JSON.stringify(result))
}
