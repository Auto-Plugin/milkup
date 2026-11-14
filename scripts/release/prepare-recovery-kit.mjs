import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lstat, mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { checkChannel, checkSignedRelease, recoveryVersionRelation } from './update-readiness.mjs'

const target = 'windows-x86_64'
export function verifyRecoveryCandidate(envelope, config, installer, installedVersion, now) {
  // Parsing locates the asserted version; no parsed data is trusted until the
  // existing verifier authenticates the exact payload, package and freshness.
  assert.ok(envelope.length <= 256 * 1024, 'Manifest exceeds application limit')
  const statement = JSON.parse(Buffer.from(JSON.parse(envelope).payload, 'base64'))
  const version = statement.release?.version
  const verified = checkSignedRelease(envelope, config, installer, target, version, now)
  const relation = recoveryVersionRelation(installedVersion, version)
  assert.ok(relation <= 0, 'Use the normal update flow for newer versions')
  if (relation < 0) {
    // rollbackFrom withdraws an offered candidate, not an installed application.
    // Require a separate signed manual-recovery declaration; never repurpose it.
    const recovery = statement.release.recovery
    assert.ok(recovery, 'Older recovery requires a separate signed manual-recovery declaration')
    assert.deepEqual(Object.keys(recovery).sort(), [
      'dataBackwardCompatible',
      'fromVersion',
      'mode',
      'schema',
      'toVersion',
    ])
    assert.equal(recovery.schema, 1)
    assert.equal(recovery.mode, 'manual-reinstall')
    assert.equal(
      recovery.fromVersion,
      installedVersion,
      'Recovery declaration must match exact installed version',
    )
    assert.equal(recovery.toVersion, version, 'Recovery declaration must match target version')
    assert.equal(
      recovery.dataBackwardCompatible,
      true,
      'Publisher has not declared data backward compatibility',
    )
  }
  return {
    ...verified,
    purpose: relation === 0 ? 'same-version-repair' : 'manual-older-version-recovery',
    reportedInstalledVersion: installedVersion,
    automaticRollback: false,
    executed: false,
    dataCompatibilityVerified: false,
    publisherDeclaresBackwardCompatibility: relation < 0,
  }
}
function instructions(receipt) {
  return `Milkup 人工恢复包（未执行安装，未完成健康验收）

已报告安装版本：${receipt.reportedInstalledVersion}
恢复目标版本：${receipt.version}
安装器：${receipt.installer}
SHA-256：${receipt.artifactSha256}
操作：${receipt.purpose === 'same-version-repair' ? '同版本修复安装' : '需要人工决定的旧版本恢复'}

1. 不要循环启动失败版本或反复点击更新。先关闭 Milkup 和仍在运行的安装器。
   若安装器仍有进度或磁盘活动，等待它结束，不强杀安装器或覆盖正在写入的程序。
2. 单独备份用户文档，并复制当前用户的 Milkup 应用数据/配置目录（包括未保存恢复副本、
   插件配置、update-trust）到新的备份目录。Windows 默认检查并分别备份存在的\n   %APPDATA%\\app.milkup.desktop 与 %LOCALAPPDATA%\\app.milkup.desktop；若使用自定义\n   数据路径，以实际路径为准。不要删除原目录、清空信任记录或覆盖文档。
   本工具没有访问、复制或修改这些用户数据。未确认备份完成时不要安装。
3. 如果这是旧版本恢复，先由发布者确认数据格式向后兼容；当前包没有此兼容性证明。
   不兼容或不确定时停止，保留数据并联系发布者。签名授权不等于数据迁移安全。
4. 在资源管理器中选择本目录安装器，由用户主动启动，核对目标版本和原安装位置。
   使用同一 Windows 账户；不要改成另一份并行安装，也不要通过卸载删除应用数据。
   本包未自动运行安装器；Windows 可能显示独立的 UAC/SmartScreen 确认。
5. 安装器结束后重新打开 Milkup，在“关于”核对实际版本 ${receipt.version}。
   仅安装器退出或启动窗口出现不能证明恢复成功。打开原文档和恢复副本并核对内容，
   检查插件配置，再另存一个新副本验证写入。不要用测试保存覆盖唯一原件。
6. 若仍无法启动，停止重试并保留备份、此恢复包、安装器错误及当前版本记录。
   不自动降级、不删除 update-trust、不回退或覆盖新写入的用户文档。

此包只证明准备时清单与安装器签名/版本资源通过校验。
尚未验证：真实安装完成、首次启动健康、用户数据兼容性和完整恢复结果。
有效期只用于准备时授权校验，不意味着可以无限期重新分发或自动安装。
`
}
export async function prepareRecoveryKit({
  envelope,
  config,
  installer,
  installedVersion,
  output,
  inspect,
  now,
}) {
  const receipt = verifyRecoveryCandidate(envelope, config, installer, installedVersion, now)
  const channel = checkChannel(config, { requireConfigured: true })
  await mkdir(output, { recursive: false }) // refuse overwrite/reuse of old kits
  const incomplete = path.join(output, 'INCOMPLETE.txt')
  await writeFile(incomplete, '恢复包准备未完成。不要执行安装器或分发本目录。\n', { flag: 'wx' })
  const installerName = `milkup-${receipt.version}-recovery-setup.exe`
  const installerPath = path.resolve(output, installerName)
  await writeFile(installerPath, installer, { flag: 'wx' })
  // A failure leaves only an explicitly incomplete directory, never a success
  // receipt or instructions. Do not remove evidence or delete an existing file.
  const inspected = await inspect(installerPath)
  assert.equal(
    inspected.productVersion,
    receipt.version,
    'PE ProductVersion differs from signed version',
  )
  assert.equal(
    inspected.sha256,
    receipt.artifactSha256,
    'Inspected installer differs from signed bytes',
  )
  assert.equal(
    createHash('sha256')
      .update(await readFile(installerPath))
      .digest('hex'),
    receipt.artifactSha256,
    'Installer changed after PE inspection',
  )
  const complete = {
    ...receipt,
    installer: installerName,
    channel,
    status: 'prepared-for-manual-recovery-not-installed',
    boundary:
      'Preparation only: no installer execution, health confirmation, data backup or restore',
  }
  await writeFile(path.join(output, 'signed-envelope.json'), envelope, { flag: 'wx' })
  await writeFile(
    path.join(output, 'SHA256SUMS.txt'),
    `${receipt.artifactSha256}  ${installerName}\n`,
    { flag: 'wx' },
  )
  await writeFile(path.join(output, 'RECOVERY.txt'), instructions(complete), { flag: 'wx' })
  // Write the completion marker last. An incomplete kit must never be delivered.
  await writeFile(
    path.join(output, 'recovery-receipt.json'),
    JSON.stringify(complete, null, 2) + '\n',
    { flag: 'wx' },
  )
  await unlink(incomplete)
  return complete
}
export function inspectWindowsInstaller(file) {
  assert.equal(process.platform, 'win32', 'PE version inspection requires Windows')
  return JSON.parse(
    execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-File',
        fileURLToPath(new URL('./inspect-recovery-installer.ps1', import.meta.url)),
        '-InstallerPath',
        file,
      ],
      { encoding: 'utf8', windowsHide: true, timeout: 30000 },
    ),
  )
}

async function boundedFile(file, maximum) {
  const stat = await lstat(file)
  assert.ok(
    stat.isFile() && !stat.isSymbolicLink() && stat.size > 0 && stat.size <= maximum,
    'Input must be a bounded regular file',
  )
  const bytes = await readFile(file)
  assert.ok(bytes.length <= maximum, 'Input grew beyond limit')
  return bytes
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [envelopePath, installerPath, installedVersion, output, ...rest] = process.argv.slice(2)
  assert.ok(
    output && !rest.length,
    'Usage: prepare-recovery-kit.mjs <fresh-signed-envelope.json> <installer.exe> <reported-installed-version> <new-output-directory>',
  )
  assert.equal(
    process.platform,
    'win32',
    'PE version inspection requires Windows; no cross-platform success fallback',
  )
  const config = JSON.parse(await boundedFile('release/update-channel.json', 16384))
  const receipt = await prepareRecoveryKit({
    envelope: await boundedFile(envelopePath, 256 * 1024),
    installer: await boundedFile(installerPath, 256 * 1024 * 1024),
    config,
    installedVersion,
    output: path.resolve(output),
    inspect: inspectWindowsInstaller,
  })
  console.log(JSON.stringify(receipt, null, 2))
}
