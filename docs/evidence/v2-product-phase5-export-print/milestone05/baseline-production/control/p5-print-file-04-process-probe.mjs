// Read-only lifecycle evidence scoped to one app and its observed output descendants.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

async function stat(pid) {
  try {
    const text = await readFile(`/proc/${pid}/stat`, 'utf8')
    const fields = text
      .slice(text.lastIndexOf(')') + 2)
      .trim()
      .split(/\s+/)
    return {
      pid: Number(pid),
      parent: Number(fields[1]),
      group: Number(fields[2]),
      birth: fields[19],
      state: fields[0],
      exitCodeRaw: fields[49],
    }
  } catch {
    return null
  }
}
function windows(pid) {
  try {
    return execFileSync('xdotool', ['search', '--pid', String(pid)], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((id) => {
        let title = ''
        try {
          title = execFileSync('xdotool', ['getwindowname', id], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
          }).trim()
        } catch {}
        return { id, title }
      })
  } catch {
    return []
  }
}
export async function outputProcessEvidence(appPid, output) {
  const app = await stat(appPid)
  assert(app, 'Own app PID exists')
  const tracked = new Map(),
    rows = []
  async function sample(label) {
    const all = (
      await Promise.all((await readdir('/proc')).filter((n) => /^\d+$/.test(n)).map(stat))
    ).filter(Boolean)
    const activeApp = all.find((p) => p.pid === Number(appPid) && p.birth === app.birth)
    const own = new Set(activeApp ? [Number(appPid)] : [])
    for (let changed = true; changed;) {
      changed = false
      for (const p of all)
        if (own.has(p.parent) && !own.has(p.pid)) {
          own.add(p.pid)
          changed = true
        }
    }
    for (const p of all.filter((p) => own.has(p.pid) && p.pid !== Number(appPid))) {
      const command = await readFile(`/proc/${p.pid}/cmdline`, 'utf8').catch(() => '')
      if (command.includes('--milkup-internal-output-helper'))
        tracked.set(`${p.pid}:${p.birth}`, { ...p, command: command.replaceAll('\0', ' ') })
    }
    for (let changed = true; changed;) {
      changed = false
      const parents = new Set(
        [...tracked.values()]
          .filter((observed) =>
            all.some((p) => p.pid === observed.pid && p.birth === observed.birth),
          )
          .map((p) => p.pid),
      )
      for (const p of all)
        if (parents.has(p.parent) && !tracked.has(`${p.pid}:${p.birth}`)) {
          tracked.set(`${p.pid}:${p.birth}`, p)
          changed = true
        }
    }
    const current = await stat(appPid)
    const row = {
      label,
      at: new Date().toISOString(),
      app: { observed: app, current, windows: current?.birth === app.birth ? windows(appPid) : [] },
      helpers: [],
    }
    for (const observed of tracked.values()) {
      const current = await stat(observed.pid),
        sameBirth = current?.birth === observed.birth
      row.helpers.push({
        observed,
        current,
        sameBirth,
        running: sameBirth && current.state !== 'Z',
        windows: sameBirth ? windows(observed.pid) : [],
      })
    }
    rows.push(row)
    await writeFile(
      path.join(output, 'process-lifecycle.json'),
      JSON.stringify(
        {
          scope:
            'Own app and observed output helper/guardian descendants only; no process signals sent',
          rows,
        },
        null,
        2,
      ) + '\n',
    )
    return row
  }
  async function released(label, includeApp = false) {
    const deadline = Date.now() + 10000
    let row
    do {
      row = await sample(label)
      if (
        row.helpers.every((p) => !p.running && p.windows.length === 0) &&
        (!includeApp ||
          ((row.app.current?.birth !== app.birth || row.app.current.state === 'Z') &&
            row.app.windows.length === 0))
      )
        return row
      await new Promise((resolve) => setTimeout(resolve, 100))
    } while (Date.now() < deadline)
    assert.fail('Observed own helper/app process or X11 window remained after operation: ' + label)
  }
  return { sample, released }
}
