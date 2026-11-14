import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Dumpbin is read-only. These are static candidates, not a simulation of Windows
// activation contexts, API-set mapping, forwarded exports or its DLL search policy.
export function parseImports(text) {
  const result = []
  let current
  let delayed = false
  for (const line of text.split(/\r?\n/)) {
    if (/following delay load imports/i.test(line)) delayed = true
    const dll = /^\s+([^\s]+\.dll)\s*$/i.exec(line)
    if (dll) {
      current = { dll: dll[1], delayed, names: [] }
      result.push(current)
      continue
    }
    const symbol = /^\s+[0-9a-f]+\s+([A-Za-z_?@$][^\s]*)\s*$/i.exec(line)
    if (current && symbol && !['Summary'].includes(symbol[1])) current.names.push(symbol[1])
  }
  return result
}
export function parseExports(text) {
  const result = new Set()
  for (const line of text.split(/\r?\n/)) {
    const entry = /^\s+\d+\s+[0-9a-f]+\s+(?:[0-9a-f]{8,16}\s+)?([^\s=]+)(?:\s+.*)?$/i.exec(line)
    if (entry) result.add(entry[1])
  }
  return result
}
export function missingNames(imported, exported) {
  return [...new Set(imported.names)].filter((name) => !exported.has(name))
}
export function diagnoseImports(executable, dumpbin, directories, options = {}) {
  const run =
    options.run ??
    ((flag, file) => {
      const result = spawnSync(dumpbin, ['/nologo', flag, file], {
        encoding: 'utf8',
        timeout: 3000,
        maxBuffer: 4 * 1024 * 1024,
        windowsHide: true,
      })
      if (result.error || result.status !== 0)
        throw new Error(`dumpbin ${flag}: ${result.error?.message ?? result.status}`)
      return result.stdout
    })
  const exists = options.exists ?? existsSync
  const join = options.join ?? path.join
  const report = {
    executable,
    diagnosticOnly: true,
    limitation:
      'Static candidate paths only; activation contexts, API sets and forwarded exports require Windows loader confirmation. Missing candidates are not a proven root cause.',
    missing: [],
    modules: [],
    errors: [],
    truncated: false,
  }
  const pending = [{ file: executable, depth: 0 }]
  const seen = new Set()
  const exportCache = new Map()
  const deadline = Date.now() + 60000
  while (pending.length && seen.size < 64 && Date.now() < deadline) {
    const { file, depth } = pending.shift()
    if (seen.has(file.toLowerCase())) continue
    seen.add(file.toLowerCase())
    try {
      const imports = parseImports(run('/imports', file))
      const record = { file, imports: [] }
      report.modules.push(record)
      for (const imported of imports) {
        if (Date.now() >= deadline) {
          report.truncated = true
          break
        }
        if (/^(api|ext)-ms-/i.test(imported.dll)) {
          record.imports.push({ dll: imported.dll, resolution: 'OS API-set; not compared' })
          continue
        }
        const candidates = [
          ...new Set(directories.map((directory) => join(directory, imported.dll))),
        ].filter(exists)
        const entry = { dll: imported.dll, delayed: imported.delayed, candidates: [] }
        record.imports.push(entry)
        for (const candidate of candidates.slice(0, 3)) {
          try {
            if (!exportCache.has(candidate))
              exportCache.set(candidate, parseExports(run('/exports', candidate)))
            const absent = missingNames(imported, exportCache.get(candidate))
            entry.candidates.push({ path: candidate, missing: absent })
            if (absent.length)
              report.missing.push({
                importer: file,
                dll: imported.dll,
                path: candidate,
                delayed: imported.delayed,
                names: absent,
              })
            if (depth < 2) pending.push({ file: candidate, depth: depth + 1 })
          } catch (error) {
            report.errors.push({ file: candidate, error: error.message })
          }
        }
      }
    } catch (error) {
      report.errors.push({ file, error: error.message })
    }
  }
  report.truncated ||= pending.length > 0
  return report
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [input, output] = process.argv.slice(2)
  const config = JSON.parse(readFileSync(input, 'utf8'))
  const report = diagnoseImports(config.executable, config.dumpbin, config.directories)
  writeFileSync(output, JSON.stringify(report, null, 2))
}
