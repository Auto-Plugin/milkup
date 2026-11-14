import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

// Startup has its own bounded budget; editing still uses the original deadline.
export function nativeRequestTimeout(method, route) {
  return method === 'POST' && route === '/session' ? 60000 : 20000
}
const env = () => ({ ...process.env, DISPLAY: process.env.DISPLAY ?? ':99' })
function tree() {
  // X11 tree traversal is not atomic while a just-closed window disappears.
  // Retry only this identified observation race, at most three reads.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return execFileSync('xwininfo', ['-root', '-tree'], {
        encoding: 'utf8',
        timeout: 3000,
        env: env(),
        stdio: 'pipe',
      })
    } catch (error) {
      if (attempt === 2 || !/Bad (Window|Drawable)/.test(String(error.stderr))) throw error
    }
  }
}

function windowPid(id) {
  let result
  try {
    result = execFileSync('xprop', ['-id', id, '_NET_WM_PID'], {
      encoding: 'utf8',
      timeout: 3000,
      env: env(),
      stdio: 'pipe',
    })
  } catch (error) {
    // A window can disappear between the tree snapshot and this property read.
    if (String(error.stderr).includes('BadWindow')) return NaN
    throw error
  }
  return Number(/= (\d+)/.exec(result)?.[1])
}
function milkupPids(output) {
  const ids = [...output.matchAll(/(0x[0-9a-f]+) "[^"]*": \("milkup-desktop"/g)]
  return new Set(
    ids.map((x) => windowPid(x[1])).filter((pid) => Number.isSafeInteger(pid) && pid > 0),
  )
}
let startup
export function beginNativeStartup() {
  startup = {
    at: performance.now(),
    previous: process.platform === 'linux' ? milkupPids(tree()) : new Set(),
    owned: new Map(),
  }
  return startup
}
export async function waitForNativeWindow(started) {
  if (process.platform !== 'linux') return
  while (performance.now() - started.at < 60000) {
    try {
      const output = tree()
      for (const pid of milkupPids(output)) {
        if (!started.previous.has(pid) && !started.owned.has(pid)) {
          started.owned.set(pid, processIdentity(pid))
        }
      }
      const windows = [...output.matchAll(/(0x[0-9a-f]+) "milkup": \("milkup-desktop"/g)]
      if (windows.length === 1 && started.owned.has(windowPid(windows[0][1]))) {
        console.log(
          `${new Date().toISOString()} NATIVE_STARTUP_WINDOW ${Math.round(performance.now() - started.at)}ms`,
        )
        return
      }
    } catch (error) {
      if (error.code !== 'ETIMEDOUT') throw error
      console.log(`${new Date().toISOString()} X11_STARTUP_QUERY_TIMEOUT`)
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw Error(
    'Native startup did not produce one owned Milkup window within 60000ms; editing assertions were not started',
  )
}
function processIdentity(pid) {
  const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
  return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19]
}
export function cleanupNativeApplication(application) {
  // DELETE /session can leave the GTK application alive under proot. Only stop
  // PIDs newly observed on an explicitly dedicated test display. Recheck both
  // executable and process birth time; shared displays never permit automatic kills.
  for (const [pid, identity] of startup?.owned ?? []) {
    try {
      const argv0 = readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0')[0]
      if (
        argv0 === application &&
        processIdentity(pid) === identity &&
        process.env.MILKUP_NATIVE_EXCLUSIVE_DISPLAY === '1'
      ) {
        process.kill(pid, 'SIGTERM')
        console.log(`${new Date().toISOString()} NATIVE_APPLICATION_CLEANUP ${pid}`)
      }
    } catch (error) {
      if (!['ENOENT', 'ESRCH'].includes(error.code)) throw error
    }
  }
}
