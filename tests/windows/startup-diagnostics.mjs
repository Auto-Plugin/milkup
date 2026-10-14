import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

// Read-only inspection while the owned application is still alive. No UI input,
// process termination, policy changes, dumps or arbitrary profile reads.
export async function captureStartup(launch, evidence, label) {
  const output = path.join(evidence, `${label}-startup.json`)
  try {
    await promisify(execFile)(
      'pwsh',
      [
        '-NoLogo',
        '-NoProfile',
        '-File',
        'scripts/ci/capture-windows-startup.ps1',
        '-RootProcessId',
        String(launch.pid),
        '-DebugPort',
        String(launch.debugPort),
        '-ProfileDirectory',
        launch.profile,
        '-OutputFile',
        output,
        '-StartedAt',
        launch.startedAt,
      ],
      { timeout: 20000, maxBuffer: 128 * 1024, windowsHide: true },
    )
    const record = JSON.parse((await readFile(output, 'utf8')).replace(/^\uFEFF/, ''))
    return {
      output,
      processCount: record.processes?.length,
      windowCount: record.windows?.length,
      profileExists: record.profileExists,
      debugListening: record.listeners?.some((listener) => listener.LocalPort === launch.debugPort),
      errors: record.errors,
    }
  } catch (error) {
    return { captureError: String(error), output }
  }
}
