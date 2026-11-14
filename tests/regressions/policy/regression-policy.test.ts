import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const v1RegressionRoot = join(packageRoot, 'v1')

function listTestFiles(root: string): string[] {
  const entries = readdirSync(root)
  const files: string[] = []

  for (const entry of entries) {
    const path = join(root, entry)
    const stat = statSync(path)

    if (stat.isDirectory()) {
      files.push(...listTestFiles(path))
      continue
    }

    if (entry.endsWith('.test.ts')) {
      files.push(path)
    }
  }

  return files.sort()
}

describe('regression policy', () => {
  it('requires v1 regression tests to declare issue metadata', () => {
    const files = listTestFiles(v1RegressionRoot)

    expect(files.length).toBeGreaterThan(0)

    for (const file of files) {
      const source = readFileSync(file, 'utf8')
      const path = relative(packageRoot, file).replaceAll('\\', '/')

      expect(source, `${path} should import the metadata helper`).toContain(
        "from './helpers/metadata'",
      )
      expect(source, `${path} should declare v1 issue metadata`).toContain('v1Issue({')
      expect(source, `${path} should explain the invariant learned from the bug`).toContain(
        'lesson:',
      )
      expect(source, `${path} should explain the user-visible regression risk`).toContain('risk:')
    }
  })
})
