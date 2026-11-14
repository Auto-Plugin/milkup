import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const requiredSummaryFields = [
  '日期/时间',
  '验收人',
  '平台',
  'OS 名称/版本',
  '架构',
  'App build 路径',
  '启动命令',
  'Fixture 目录',
]

const requiredFieldsBySection = {
  'Native Save As OS Dialog': [
    'Result',
    '平台',
    '是否显示保存对话框',
    '保存路径',
    'App 中路径是否更新',
    '是否在 app 外验证保存内容',
  ],
  IME: [
    'Result',
    '平台',
    'IME 名称/版本',
    'Source mode composition 是否不会提前提交',
    'Source mode 最终提交文本是否只出现一次',
    'Live mode 普通文本',
  ],
  Shortcuts: ['Result', '平台', '键盘布局', 'Select all', 'Copy', 'Paste', 'Undo', 'Save'],
  'File Watcher': [
    'Result',
    '平台',
    'Fixture 路径',
    'Clean external modification 是否被检测',
    'Dirty external modification 是否进入 conflict',
    'Conflict 期间普通保存是否被阻止',
  ],
  'External Editor Conflict': [
    'Result',
    '平台',
    'milkup fixture 路径',
    '外部编辑器',
    '外部保存后是否检测到 conflict',
    '普通保存是否被阻止',
  ],
}

const requiredFieldsByItem = {
  'M16 macOS Chinese IME': ['Input source'],
  'M16 Linux IME': ['Desktop environment', 'Display server', 'IME framework', 'Input method'],
  'M16 macOS Cmd shortcuts': ['Cmd+A/C/V/Z/Shift+Z 行为', 'Cmd+S 行为'],
}

const expectedPlatformByItem = {
  'M16 Windows Chinese IME': 'windows',
  'M16 macOS Chinese IME': 'macos',
  'M16 Linux IME': 'linux',
  'M16 macOS Cmd shortcuts': 'macos',
  'M16 Windows Ctrl shortcuts': 'windows',
  'M16 file watcher on Windows': 'windows',
  'M16 file watcher on macOS': 'macos',
}

const placeholderPattern = /^(?:pending|请填写|在这里粘贴准确观察结果。|\s*)$/iu
const failurePattern = /\b(?:fail|failed|skipped|partial)\b|失败|未通过|跳过|部分/iu

if (isCliEntryPoint()) {
  const args = process.argv.slice(2)
  const allowPending = args.includes('--allow-pending')
  const reportPath = args.find((arg) => !arg.startsWith('--'))

  if (!reportPath) {
    console.error(
      'Usage: node scripts/validate-manual-verification-report.mjs <report.md> [--allow-pending]',
    )
    process.exit(2)
  }

  const result = await validateManualVerificationReport(reportPath, { allowPending })

  if (!result.ok) {
    console.error(`手动验收报告未通过验证：${result.reportPath}`)

    for (const issue of result.issues) {
      console.error(`- ${issue}`)
    }

    if (result.pendingItems.length > 0) {
      console.error(`pending 项：${result.pendingItems.join(', ')}`)
    }

    process.exit(1)
  }

  console.log(`手动验收报告通过验证：${result.reportPath}`)

  if (result.passedItems.length > 0) {
    console.log(`可用于勾选的项目：${result.passedItems.join(', ')}`)
  } else {
    console.log('当前没有 pass 项；--allow-pending 允许 pending-only 报告通过格式检查。')
  }
}

export async function validateManualVerificationReport(reportPath, options = {}) {
  const absoluteReportPath = path.resolve(reportPath)
  const report = await readFile(absoluteReportPath, 'utf8')
  const checklistRows = parseChecklistRows(report)
  const issues = []
  const passedItems = []
  const pendingItems = []

  if (checklistRows.length === 0) {
    issues.push('Checklist 映射表为空或无法解析。')
  }

  const summaryFields = validateSummary(report, issues)

  for (const row of checklistRows) {
    if (row.result === 'pass') {
      const section = extractSection(report, row.section)

      if (!section) {
        issues.push(`${row.item}: 找不到证据章节 "${row.section}"。`)
        continue
      }

      validatePassedSection(row, section, summaryFields, issues)

      if (!issues.some((issue) => issue.startsWith(`${row.item}:`))) {
        passedItems.push(row.item)
      }
      continue
    }

    if (row.result === 'pending' || row.result === '') {
      pendingItems.push(row.item)
      continue
    }

    issues.push(`${row.item}: Result 为 "${row.result}"，不能用于勾选 coding-plan.md。`)
  }

  if (passedItems.length === 0 && !options.allowPending) {
    issues.push('没有任何 checklist item 具备可勾选的 pass 证据。')
  }

  return Object.freeze({
    ok: issues.length === 0,
    reportPath: absoluteReportPath,
    issues: Object.freeze(issues),
    passedItems: Object.freeze(passedItems),
    pendingItems: Object.freeze(pendingItems),
  })
}

function parseChecklistRows(markdown) {
  const section = extractSection(markdown, 'Checklist 映射')

  if (!section) {
    return []
  }

  return section
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(
      (line) => line.startsWith('|') && !line.includes('---') && !line.includes('coding-plan item'),
    )
    .map((line) =>
      line
        .split('|')
        .slice(1, -1)
        .map((cell) => cell.trim()),
    )
    .filter((cells) => cells.length >= 3)
    .map(([item, result, evidenceSection]) => ({
      item,
      result: normalizeResult(result),
      section: evidenceSection,
    }))
}

function validateSummary(markdown, issues) {
  const summary = extractSection(markdown, '摘要')

  if (!summary) {
    issues.push('找不到摘要章节。')
    return new Map()
  }

  const fields = parseFields(summary)

  for (const field of requiredSummaryFields) {
    const value = fields.get(field)

    if (!isFilled(value)) {
      issues.push(`摘要字段未填写：${field}`)
    }
  }

  return fields
}

function validatePassedSection(row, section, summaryFields, issues) {
  const fields = parseFields(section)
  const sectionResult = normalizeResult(fields.get('Result') ?? '')

  if (sectionResult !== 'pass') {
    issues.push(`${row.item}: checklist 为 pass，但章节 "${row.section}" 的 Result 不是 pass。`)
  }

  const requiredFields = [
    ...(requiredFieldsBySection[row.section] ?? ['Result']),
    ...(requiredFieldsByItem[row.item] ?? []),
  ]

  for (const field of requiredFields) {
    const value = fields.get(field)

    if (!isFilled(value)) {
      issues.push(`${row.item}: 章节 "${row.section}" 缺少有效字段：${field}`)
    }
  }

  validatePlatformMatch(row, fields, summaryFields, issues)

  if (failurePattern.test(section)) {
    issues.push(
      `${row.item}: 章节 "${row.section}" 包含失败/跳过/部分通过字样，请人工确认后再标 pass。`,
    )
  }

  const evidence = extractEvidenceText(section)

  if (!isFilled(evidence)) {
    issues.push(`${row.item}: 章节 "${row.section}" 缺少证据详情。`)
  }
}

function validatePlatformMatch(row, sectionFields, summaryFields, issues) {
  const expected = expectedPlatformByItem[row.item]

  if (!expected) {
    return
  }

  const summaryPlatform = normalizePlatformField(summaryFields.get('平台') ?? '')
  const sectionPlatform = normalizePlatformField(sectionFields.get('平台') ?? '')
  const osPlatform = normalizeOsPlatformField(summaryFields.get('OS 名称/版本') ?? '')

  if (summaryPlatform !== expected) {
    issues.push(
      `${row.item}: 摘要平台必须是 ${formatPlatform(expected)}，当前为 "${summaryFields.get('平台') ?? ''}"。`,
    )
  }

  if (sectionPlatform !== expected) {
    issues.push(
      `${row.item}: 章节 "${row.section}" 的平台必须是 ${formatPlatform(expected)}，当前为 "${sectionFields.get('平台') ?? ''}"。`,
    )
  }

  if (osPlatform !== expected) {
    issues.push(
      `${row.item}: OS 名称/版本必须来自 ${formatPlatform(expected)}，当前为 "${summaryFields.get('OS 名称/版本') ?? ''}"。`,
    )
  }
}

function parseFields(section) {
  const fields = new Map()

  for (const line of section.split(/\r?\n/)) {
    const match = line.match(/^\s*-\s*([^:：]+)\s*[:：]\s*(.*)$/u)

    if (match) {
      fields.set(match[1].trim(), match[2].trim())
    }
  }

  return fields
}

function extractSection(markdown, heading) {
  const lines = markdown.split(/\r?\n/)
  const headingLine = `## ${heading}`
  const start = lines.findIndex((line) => line.trim() === headingLine)

  if (start < 0) {
    return undefined
  }

  const end = lines.findIndex((line, index) => index > start && line.startsWith('## '))
  const sectionLines = end < 0 ? lines.slice(start + 1) : lines.slice(start + 1, end)

  return sectionLines.join('\n').trim()
}

function extractEvidenceText(section) {
  const fenced = section.match(/(?:```|~~~)[^\n]*\n([\s\S]*?)(?:```|~~~)/u)

  if (fenced) {
    return fenced[1].trim()
  }

  const detailsIndex = section.indexOf('证据详情')

  return detailsIndex >= 0 ? section.slice(detailsIndex).trim() : ''
}

function normalizeResult(value) {
  return String(value).trim().toLowerCase()
}

function normalizePlatformField(value) {
  const text = String(value).trim().toLowerCase()

  if (/\bwindows\b|windows_nt|microsoft windows/u.test(text)) {
    return 'windows'
  }

  if (/\bmacos\b|\bmac os\b|\bdarwin\b/u.test(text)) {
    return 'macos'
  }

  if (/\blinux\b/u.test(text)) {
    return 'linux'
  }

  return text
}

function normalizeOsPlatformField(value) {
  const text = String(value).trim().toLowerCase()

  if (/\bwindows\b|windows_nt|microsoft windows/u.test(text)) {
    return 'windows'
  }

  if (/\bmacos\b|\bmac os\b|\bdarwin\b|sonoma|ventura|monterey|big sur/u.test(text)) {
    return 'macos'
  }

  if (
    /\blinux\b|ubuntu|debian|fedora|arch|opensuse|suse|centos|red hat|rhel|mint|pop!_os|kde neon/u.test(
      text,
    )
  ) {
    return 'linux'
  }

  return text
}

function formatPlatform(platform) {
  if (platform === 'macos') {
    return 'macOS'
  }

  if (platform === 'windows') {
    return 'Windows'
  }

  if (platform === 'linux') {
    return 'Linux'
  }

  return platform
}

function isFilled(value) {
  if (value === undefined) {
    return false
  }

  return !placeholderPattern.test(String(value).trim())
}

function isCliEntryPoint() {
  return process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
}
