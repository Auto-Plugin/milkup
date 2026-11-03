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
import { REVIEWED_MERMAID_PACKAGE } from '../../apps/desktop/src/reviewed-mermaid-package.ts'
import { assertReviewedMermaidPackage } from '../../plugins/diagrams-worker/scripts/package-seals.mjs'
import {
  AuditLedger,
  fixtures,
  validateContext,
  validateHostProcessToken,
  validatePng,
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
      enabledByDefault: false,
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
  const input = await json(path.join(evidence, 'installer-input.json'))
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
      'Current staged build records, reviewed package seals, reachable production archive bytes, compiled/extracted fixed engine bytes; does not assert independent rebuilds or new tests of all ten plugins',
    plugins,
    dist,
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
  return `# Milkup ${manifest.version} 完整 Mermaid Windows 测试包\n\n源码提交：${manifest.candidateSha}\n构建记录：${manifest.runUrl}\n\n这是未签名的 Windows x64 NSIS 测试包，不是正式 Release。安装程序只面向当前用户；不会在本包中安装或下载 WebView2，需要电脑已经安装可用的 [Microsoft Evergreen WebView2](https://developer.microsoft.com/en-us/microsoft-edge/webview2/)。完整 Mermaid 原生服务目前要求纯标准用户；包含 Administrators 成员身份（含 deny-only）的管理员账户不在此支持范围内，保持源码回退。\n\n安装器：\`${manifest.installer.deliveredName}\`。应用内版本为 ${manifest.version}；完整提交与哈希在 manifest.json。可用 PowerShell 的 Get-FileHash -Algorithm SHA256 核对 SHA256SUMS.txt。请使用文档副本试用。\n\n10 个插件已经包含在应用中，首次安装默认全部不启用。在插件管理中查看权限后启用 Diagrams 1.3.0 即可测试；plugins 目录中的相同插件档案只供补装，不是正常使用的必需步骤。旧配置中的禁用或卸载选择应保留，不会借打包自动授权。\n\n正文预览接入固定官方 Mermaid 12.2.0 引擎。samples 包含普通图、宽图、C4 和故意无效语法四类；无效语法应显示源码或诊断。宽图保持自然尺寸并滚动查看。语法范围仍受固定引擎、输入与图片预算限制，不代表所有语法组合均已验收。导出仍走受限路径，不承诺正文图表一比一导出；Windows DOM/PDF 导出未开放。\n\n${manifest.deliveryReady ? '本候选已通过安装后同 SID 纯标准用户的 10 步自动化产品测试，并核对安装后 EXE 完整字节。' : '安装后产品测试尚未通过最终交付门禁；此目录仍是准备材料，不可作为已验收包上传。'} 自动化不是实际系统中文输入法、完整 DPI 矩阵或人工视觉验收。\n\n保留限制：Linux 原生路径目前限 X11，Wayland 未验收。真实旧配置升级与回滚尚未完整验收。历史运行 41642093459 的临时 profile 删除因 Win32 32 失败；旧 hosted runner 已结束，残留无法复查。运行 41653312849 的 native cleanupUncertain 原因未定，后续 debug 10/10 未复现，不宣称根因已修复。当前 C4 关系标签白底约 1px 擦到节点边框，文字与箭头完整，仍需保留这项视觉瑕疵。\n\n下载需要登录有仓库访问权的 GitHub 账户，在本次 Actions 运行的 Artifacts 中下载并解压。Artifacts 设置保留 7 天；准确到期时间以 GitHub 实际 artifact 记录及本次交付消息为准，本包不会推算或虚构日期。离线测试报告位于 reports 目录（只有最终门禁通过后才加入）；manifest.json 与 SHA256SUMS.txt 保留报告身份。反馈请填写 FEEDBACK.md。\n`
}
const feedback = `# 测试反馈\n\n请记录应用“关于”版本、manifest.json 的 candidateSha、Windows 版本、账户类型、已安装 WebView2 版本、显示缩放、插件启用状态和使用的是新配置还是旧配置。\n\n1. 安装、启动、关闭是否成功？\n2. 插件是否首次默认关闭，启用 Diagrams 后原位置是否显示图表？\n3. 普通图编辑、保存、撤销和重做是否保持准确文本？\n4. 宽图是否能滚动且文字清晰？C4 标签、连线是否有重叠？\n5. 无效语法是否保留源码并显示可理解的诊断？\n6. 禁用、重新启用和关闭后是否有残留窗口或错误？\n7. 中文输入的拼音、选词、取消和“- 空格 / - [ ] ”输入行为如何？\n\n请提供最小可复现 Markdown、实际现象、操作顺序和截图；避免附带私人文档内容。导出结果请单独标注，正文通过不表示导出通过。\n`

async function inventory(directory) {
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
  assert(files.length <= 32, 'Payload file-count budget exceeded')
  assert(
    files.reduce((sum, file) => sum + file.bytes, 0) <= 128 * 1024 * 1024,
    'Payload byte budget exceeded',
  )
  return files.sort((a, b) => a.name.localeCompare(b.name))
}
async function sums(output) {
  const files = (await inventory(output)).filter((item) => item.name !== 'SHA256SUMS.txt')
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
  for (const name of ['ordinary', 'wide', 'c4', 'invalid'])
    await writeFile(path.join(output, 'samples', name + '.md'), fixtures[name], { flag: 'wx' })
  const manifest = {
    schema: 1,
    status: 'prepared-pending-installed-verification',
    deliveryReady: false,
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
      'Pinned official 12.2.0 host-private native screen rendering; pure standard user required',
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

export async function verifyInstalledEvidence(directory, expected) {
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
  for (const identity of [
    installation.installerRun.callerIdentity,
    installation.installerRun.startedProcess,
  ]) {
    validateHostProcessToken(
      identity.token,
      installation.actualSid,
      installation.sessionId,
      'pure-standard',
    )
    assert.equal(identity.sessionId, installation.sessionId)
    assert.equal(identity.inJob, true)
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
  assert.equal(audit.expectedAccountKind, 'pure-standard')
  assert.equal(audit.childResult.expectedAccountKind, 'pure-standard')
  assert.equal(product.expectedAccountKind, 'pure-standard')
  validateContext(
    audit.standardContext,
    installation.actualSid,
    installation.sessionId,
    'pure-standard',
  )
  validateContext(product.context, installation.actualSid, installation.sessionId, 'pure-standard')
  for (const key of [
    'accountCreated',
    'accountDeleted',
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
  const observedPlugins = product.steps[0].bundledPluginsObserved
  assert(Array.isArray(observedPlugins), 'Actual initial bundled-plugin switch states required')
  assert.deepEqual(
    observedPlugins.map((item) => item.id).sort(),
    expected.bundledPlugins.map((item) => item.id).sort(),
  )
  assert(
    observedPlugins.every((item) => item.checked === 'false' && item.busy !== 'true'),
    'All ten bundled plugins must actually start disabled',
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
  const ledger = new AuditLedger(installation.actualSid, installation.sessionId, 'pure-standard')
  assert(
    Array.isArray(product.nativeAudit) && product.nativeAudit.length > 0,
    'Real native ownership audit required',
  )
  for (const event of product.nativeAudit) ledger.accept(event, event.productPid)
  ledger.verifyAll()
  assert(
    product.nativeAudit.some((event) => event.phase === 'started'),
    'Native rendering never started',
  )
  assert(
    Array.isArray(product.launches) && product.launches.length === 4,
    'Four installed-product fixture launches required',
  )
  for (const launch of product.launches) {
    assert.equal(launch.closedByUi, true, 'Product must close through its UI')
    assert.notEqual(
      launch.outerTerminationRequired,
      true,
      'Outer forced kill is not native cleanup acceptance',
    )
  }
  const pixels = []
  for (const step of product.steps) {
    assert(step.screenshot, 'Retained actual window screenshot required')
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
    for (const record of [step.screenshot, step.image].filter(Boolean)) {
      assert(safeName(record.file) && record.file.endsWith('.png'))
      const bytes = await plainBytes(path.join(directory, record.file), 32 * 1024 * 1024)
      const png = validatePng(bytes, 32 * 1024 * 1024)
      assert.equal(png.sha256, record.sha256, 'Retained image changed')
      assert.equal(png.bytes, record.bytes)
      assert.equal(png.width, record.width)
      assert.equal(png.height, record.height)
      assert.equal(record.fullyDecoded, true)
      assert.equal(record.nonuniform, true)
      if (record === step.image) ledger.matchPng(record.native.productPid, png)
      pixels.push({ name: record.file, bytes: bytes.length, sha256: png.sha256 })
    }
  }
  return {
    status: 'passed',
    scope:
      'Exact installed image, same-SID pure-standard user, ten product operations, retained PNG hashes and native cleanup records; no human visual/IME/DPI acceptance',
    records: records.map(({ value: _value, ...record }) => record),
    pixels,
    runtime: product.runtime,
    account: { sid: installation.actualSid, sessionId: installation.sessionId },
    applicationSha256: product.applicationSha256,
  }
}

export async function finalizePayload(evidence, output, installedEvidence) {
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
  const installed = await verifyInstalledEvidence(installedEvidence, {
    candidateSha: verified.packaging.candidateSha,
    version: verified.packaging.version,
    installerSha256: verified.packaging.installer.sha256,
    installedSha256: verified.packaging.extractedApplication.sha256,
    builtSha256: verified.packaging.compiledApplication.sha256,
    applicationBytes: verified.packaging.extractedApplication.bytes,
    markerOffset: verified.verification.embedded.markerOffset,
    bundledPlugins: verified.installerInput.bundledPlugins,
    resources: verified.installerInput.resources,
  })
  const manifest = await json(path.join(output, 'manifest.json'))
  assert.equal(manifest.deliveryReady, false)
  await mkdir(path.join(output, 'reports'))
  for (const record of installed.records) {
    const bytes = await plainBytes(path.join(installedEvidence, record.name), 4 * 1024 * 1024)
    assert.equal(hash(bytes), record.sha256, 'Installed report changed before delivery copy')
    await writeFile(path.join(output, 'reports', record.name), bytes, { flag: 'wx' })
  }
  Object.assign(manifest, {
    status: 'verified-for-user-trial',
    deliveryReady: true,
    installerExecuted: true,
    installationAcceptance: installed,
    finalizedAt: new Date().toISOString(),
  })
  await writeJson(path.join(output, 'manifest.json'), manifest)
  await writeFile(path.join(output, 'README.md'), readme(manifest))
  const files = await sums(output)
  const proof = {
    schema: 1,
    status: 'passed',
    deliveryReady: true,
    candidateSha: manifest.candidateSha,
    output: path.resolve(output),
    files,
    checksumsSha256: hash(await plainBytes(path.join(output, 'SHA256SUMS.txt'))),
    installed,
    artifactRetentionDays: 7,
    artifactExpiresAt: null,
  }
  await writeJson(path.join(evidence, 'mermaid-trial-finalization.json'), proof, true)
  return { status: proof.status, deliveryReady: true, output, files: files.length + 1 }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [mode, evidence, output, installedEvidence] = process.argv.slice(2)
  assert(
    ['prepare', 'finalize'].includes(mode) && evidence && output,
    'Usage: prepare-mermaid-trial-payload.mjs prepare|finalize <evidence> <new-payload> [installed-evidence]',
  )
  assert(mode === 'prepare' ? !installedEvidence : !!installedEvidence)
  const result =
    mode === 'prepare'
      ? await preparePayload(path.resolve(evidence), path.resolve(output))
      : await finalizePayload(
          path.resolve(evidence),
          path.resolve(output),
          path.resolve(installedEvidence),
        )
  console.log(JSON.stringify(result))
}
