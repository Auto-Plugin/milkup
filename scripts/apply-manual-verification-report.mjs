import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { validateManualVerificationReport } from './validate-manual-verification-report.mjs'

const checkboxTargets = new Map([
  [
    'M6 native Save As OS dialog interaction',
    'Verify native save-as OS dialog interaction manually; see [manual-verification-protocol.md](./manual-verification-protocol.md).',
  ],
  [
    'M6 native file dialogs manually verified',
    'Native file dialogs are manually verified; see [manual-verification-protocol.md](./manual-verification-protocol.md).',
  ],
  ['M16 Windows Chinese IME', 'Windows Chinese IME.'],
  ['M16 macOS Chinese IME', 'macOS Chinese IME.'],
  ['M16 Linux IME', 'Linux IME.'],
  ['M16 macOS Cmd shortcuts', 'macOS Cmd shortcuts.'],
  ['M16 Windows Ctrl shortcuts', 'Windows Ctrl shortcuts.'],
  ['M16 file watcher on Windows', 'File watcher on Windows.'],
  ['M16 file watcher on macOS', 'File watcher on macOS.'],
  ['M16 external editor conflict', 'External editor conflict.'],
])

const args = process.argv.slice(2)
const writeChanges = args.includes('--write')
const planArgIndex = args.indexOf('--plan')
const reportPath = args.find((arg, index) => {
  if (arg.startsWith('--')) {
    return false
  }

  return planArgIndex < 0 || index !== planArgIndex + 1
})
const planPath =
  planArgIndex >= 0 ? args[planArgIndex + 1] : path.join(process.cwd(), 'docs', 'coding-plan.md')

if (!reportPath) {
  console.error(
    'Usage: node scripts/apply-manual-verification-report.mjs <report.md> [--plan docs/coding-plan.md] [--write]',
  )
  process.exit(2)
}

if (planArgIndex >= 0 && !planPath) {
  console.error('--plan 需要提供路径。')
  process.exit(2)
}

const validation = await validateManualVerificationReport(reportPath)

if (!validation.ok) {
  console.error(`报告未通过验证，不能更新 coding-plan.md：${validation.reportPath}`)

  for (const issue of validation.issues) {
    console.error(`- ${issue}`)
  }

  process.exit(1)
}

const absolutePlanPath = path.resolve(planPath)
const originalPlan = await readFile(absolutePlanPath, 'utf8')
let nextPlan = originalPlan
const applied = []
const alreadyChecked = []
const missing = []

for (const item of validation.passedItems) {
  const target = checkboxTargets.get(item)

  if (!target) {
    missing.push(`${item}: 没有 apply 映射`)
    continue
  }

  const uncheckedLine = `- [ ] ${target}`
  const checkedLine = `- [x] ${target}`

  if (nextPlan.includes(checkedLine)) {
    alreadyChecked.push(item)
    continue
  }

  if (!nextPlan.includes(uncheckedLine)) {
    missing.push(`${item}: 找不到未勾选行 "${uncheckedLine}"`)
    continue
  }

  nextPlan = nextPlan.replace(uncheckedLine, checkedLine)
  applied.push(item)
}

if (missing.length > 0) {
  console.error('无法安全更新 coding-plan.md：')

  for (const issue of missing) {
    console.error(`- ${issue}`)
  }

  process.exit(1)
}

console.log(`报告验证通过：${validation.reportPath}`)

if (applied.length > 0) {
  console.log(`${writeChanges ? '将更新' : 'dry-run 将更新'}：${applied.join(', ')}`)
}

if (alreadyChecked.length > 0) {
  console.log(`已是勾选状态：${alreadyChecked.join(', ')}`)
}

if (applied.length === 0) {
  console.log('没有需要更新的 coding-plan.md checkbox。')
}

if (!writeChanges) {
  console.log('当前为 dry-run；带 --write 才会写入文件。')
  process.exit(0)
}

await writeFile(absolutePlanPath, nextPlan, 'utf8')
console.log(`已更新：${absolutePlanPath}`)
