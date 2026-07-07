import { mkdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'

const args = process.argv.slice(2)
const platform = readOption('--platform') ?? process.platform
const normalizedPlatform = normalizePlatform(platform)
const prepareOnly = args.includes('--prepare-only')
const stamp = readOption('--stamp') ?? createStamp()
const repoRoot = path.resolve(import.meta.dirname, '..')
const suggestedBuildPath = getSuggestedBuildPath(normalizedPlatform)
const suggestedLaunchCommand = 'pnpm --filter @milkup/desktop tauri dev'
const fixtureRoot = path.join(os.tmpdir(), `milkup-manual-${normalizedPlatform}-${stamp}`)
const watchFile = path.join(fixtureRoot, 'watcher.md')
const imeScratchFile = path.join(fixtureRoot, `${normalizedPlatform}-ime-notes.md`)
const reportPath = path.join(
  repoRoot,
  'docs',
  `manual-verification-${normalizedPlatform}-${stamp}.md`,
)
const runbookPath = path.join(
  repoRoot,
  'docs',
  'manual-verification-cross-platform-runbook-2026-07-06.md',
)

await mkdir(fixtureRoot, { recursive: true })
await writeFile(imeScratchFile, `# ${normalizedPlatform} IME manual notes\n\n`, 'utf8')

if (normalizedPlatform === 'macos') {
  await writeFile(watchFile, '# Watcher\ninitial watcher content\n', 'utf8')
}

await writeFile(reportPath, createReport(), 'utf8')

console.log('Milkup cross-platform 手动验收环境已准备好。')
console.log(`平台：${normalizedPlatform}`)
console.log(`Fixture 目录：${fixtureRoot}`)
console.log(`报告草稿：${reportPath}`)
console.log('')
console.log('下一步：')
console.log(`1. 启动真实 desktop app：${suggestedLaunchCommand}`)
console.log('2. 按打开的中文操作手册完成目标平台验收，并把观察结果填入报告草稿。')
console.log(`3. 验证报告：pnpm manual:validate ${path.relative(repoRoot, reportPath)}`)
console.log(`4. 预览计划更新：pnpm manual:apply ${path.relative(repoRoot, reportPath)}`)
console.log(
  `5. 确认只勾选本次通过项目后写入：pnpm manual:apply ${path.relative(repoRoot, reportPath)} --write`,
)

if (!prepareOnly) {
  openPath(runbookPath)
  openPath(reportPath)
}

function createReport() {
  const now = new Date().toISOString()
  const platformTitle = normalizedPlatform === 'macos' ? 'macOS' : 'Linux'
  const checklistRows =
    normalizedPlatform === 'macos'
      ? [
          '| M16 macOS Chinese IME      | pending | IME          |      |',
          '| M16 macOS Cmd shortcuts    | pending | Shortcuts    |      |',
          '| M16 file watcher on macOS  | pending | File Watcher |      |',
        ]
      : ['| M16 Linux IME              | pending | IME          |      |']
  const summaryPlatformFields =
    normalizedPlatform === 'macos'
      ? `- IME 记录草稿：${imeScratchFile}
- Watcher fixture：${watchFile}`
      : `- IME 记录草稿：${imeScratchFile}`
  const optionalSections =
    normalizedPlatform === 'macos'
      ? `
## Shortcuts

- Result：pending
- 平台：${platformTitle}
- 键盘布局：请填写
- Cmd+A/C/V/Z/Shift+Z 行为：
- Cmd+S 行为：
- Save As/dialog-focus 行为：
- Mode switch 后行为：
- Active document 定向：
- OS dialog 聚焦时行为：
- Select all：
- Copy：
- Paste：
- Undo：
- Redo：
- Save：
- 备注：
- 截图：

证据详情：

~~~text
请填写真实观察结果。
~~~

## File Watcher

- Result：pending
- 平台：${platformTitle}
- Fixture 路径：${watchFile}
- Clean external modification 是否被检测：
- Clean reload 路径：
- Dirty external modification 是否进入 conflict：
- Conflict 期间普通保存是否被阻止：
- Own-save watcher echo 是否被忽略：
- External delete 是否被检测：
- 备注：
- 截图：

建议外部命令：

~~~sh
printf '\\nexternal clean edit ${stamp}\\n' >> "${watchFile}"
printf '\\nexternal dirty edit ${stamp}\\n' >> "${watchFile}"
rm "${watchFile}"
~~~

证据详情：

~~~text
请填写真实观察结果。
~~~
`
      : ''

  return `# ${platformTitle} 手动验收报告 - ${stamp}

本报告由 scripts/open-manual-verification-cross-platform.mjs 预生成。请在目标平台实际验收后填写观察结果。只有明确 pass 且有证据说明的项目，才能更新 coding-plan.md。

## 摘要

- 日期/时间：${now}
- 验收人：${os.userInfo().username}
- 平台：${platformTitle}
- OS 名称/版本：${os.type()} ${os.release()}
- 架构：${os.arch()}
- 显示缩放：目标平台执行时确认
- App build 路径：${suggestedBuildPath}
- 启动命令：${suggestedLaunchCommand}
- Fixture 目录：${fixtureRoot}
${summaryPlatformFields}
- 截图或录屏：请填写
- 总体结果：pending

## 下一步

1. 启动真实 desktop app：\`${suggestedLaunchCommand}\`。
2. 按中文操作手册完成本报告列出的目标平台验收。
3. 把每个通过项目的 \`Result\` 从 \`pending\` 改为 \`pass\`，并填写对应证据详情。
4. 运行 \`pnpm manual:validate ${path.relative(repoRoot, reportPath)}\`。
5. 验证通过后先运行 \`pnpm manual:apply ${path.relative(repoRoot, reportPath)}\` 预览更新，再运行 \`pnpm manual:apply ${path.relative(repoRoot, reportPath)} --write\` 写入计划。

## Checklist 映射

| coding-plan item            | Result  | 证据章节     | 备注 |
| --------------------------- | ------- | ------------ | ---- |
${checklistRows.join('\n')}

## IME

- Result：pending
- 平台：${platformTitle}
- IME 名称/版本：请填写
- Input source：${normalizedPlatform === 'macos' ? '请填写' : '不适用'}
- Desktop environment：${normalizedPlatform === 'linux' ? '请填写' : '不适用'}
- Display server：${normalizedPlatform === 'linux' ? '请填写' : '不适用'}
- IME framework：${normalizedPlatform === 'linux' ? '请填写' : '不适用'}
- Input method：${normalizedPlatform === 'linux' ? '请填写' : '不适用'}
- Source mode composition 是否不会提前提交：
- Source mode 最终提交文本是否只出现一次：
- Source mode undo 行为：
- Live mode 普通文本：
- Live mode 列表项：
- Live mode inline marker 附近：
- Composition 后 mode switch 是否保留文本/selection/history：
- 备注：
- 截图：

证据详情：

~~~text
请填写真实观察结果。建议至少记录：
- source mode 输入的最终中文/标点/中英混排文本。
- composition 期间是否没有提前写入正文。
- compositionend 后文本是否只出现一次。
- undo 是否能撤销本次提交。
- live mode 普通文本、列表项、inline marker 附近是否正常。
- composition 后切换 source/live/preview 时文本、selection 和 history 是否保留。
~~~

${optionalSections}

## 最终 Checklist 更新前确认

- 每个要勾选的项目在本报告中都有对应的 Result：pass。
- 报告包含平台、build 路径、启动命令和 fixture 路径。
- 失败步骤附有说明或截图。
- 其他平台项没有在本报告中声明完成。
`
}

function readOption(name) {
  const index = args.indexOf(name)

  return index >= 0 ? args[index + 1] : undefined
}

function normalizePlatform(value) {
  const normalized = value.toLowerCase()

  if (normalized === 'darwin' || normalized === 'mac' || normalized === 'macos') {
    return 'macos'
  }

  if (normalized === 'linux') {
    return 'linux'
  }

  throw new Error(`Unsupported platform for cross-platform manual verification: ${value}`)
}

function getSuggestedBuildPath(targetPlatform) {
  const executable = targetPlatform === 'macos' ? 'milkup' : 'milkup'

  return path.join(repoRoot, 'apps', 'desktop', 'src-tauri', 'target', 'debug', executable)
}

function createStamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-')
}

function openPath(target) {
  const command =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open'
  const commandArgs = process.platform === 'win32' ? ['/c', 'start', '', target] : [target]

  spawn(command, commandArgs, { detached: true, stdio: 'ignore' }).unref()
}
