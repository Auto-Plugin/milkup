import { readFile, readdir, appendFile, writeFile, access } from 'node:fs/promises'
import path from 'node:path'
const [identityPath, output] = process.argv.slice(2)
const owner = JSON.parse(await readFile(identityPath, 'utf8'))
const log = path.join(output, 'process-samples.jsonl'),
  stop = path.join(output, 'sampler.stop')
const errors = new Map(),
  known = new Map(),
  started = Date.now(),
  intervalMs = 100,
  maxDurationMs = 15 * 60 * 1000
let nextDiscovery = 0,
  sequence = 0,
  lastStart = null
async function safe(file) {
  try {
    return await readFile(file, 'utf8')
  } catch (e) {
    const key = file + ':' + e.code
    errors.set(key, (errors.get(key) || 0) + 1)
    return null
  }
}
function stat(raw) {
  if (!raw) return null
  const end = raw.lastIndexOf(')'),
    a = raw.slice(end + 2).split(' ')
  return {
    comm: raw.slice(raw.indexOf('(') + 1, end),
    state: a[0],
    ppid: Number(a[1]),
    utime: Number(a[11]),
    stime: Number(a[12]),
    birth: a[19],
    processor: Number(a[36]),
  }
}
async function identityValid() {
  const s = stat(await safe(`/proc/${owner.pid}/stat`)),
    argv = await safe(`/proc/${owner.pid}/cmdline`)
  return s && s.birth === owner.birth && argv?.split('\0').join('\0') === owner.argv.join('\0')
}
async function lineage(pid) {
  const chain = []
  let current = pid
  for (let depth = 0; depth < 16; depth++) {
    const s = stat(await safe(`/proc/${current}/stat`))
    if (!s) return null
    chain.push({ pid: current, birth: s.birth, ppid: s.ppid, state: s.state })
    if (current === owner.pid) return s.birth === owner.birth ? chain : null
    if (s.ppid <= 1) return null
    current = s.ppid
  }
  return null
}
async function discover() {
  for (const name of await readdir('/proc')) {
    if (!/^\d+$/.test(name) || known.has(Number(name))) continue
    const pid = Number(name),
      cmd = await safe(`/proc/${pid}/cmdline`)
    if (!cmd) continue
    const argv = cmd.split('\0')
    if (!argv[0]?.endsWith('/WebKitWebProcess')) continue
    const chain = await lineage(pid)
    if (!chain) continue
    const cg = await safe(`/proc/${pid}/cgroup`)
    known.set(pid, { pid, argv, birth: chain[0].birth, lineage: chain, cgroup: cg })
    await appendFile(
      log,
      JSON.stringify({ kind: 'owned-process-discovered', wall: Date.now(), ...known.get(pid) }) +
        '\n',
    )
  }
}
async function cgroupFiles(raw) {
  const unified = raw
    ?.split('\n')
    .find((l) => l.startsWith('0::'))
    ?.slice(3)
  const base = '/sys/fs/cgroup'
  const resolved = unified ? path.resolve(base, '.' + unified) : null
  const ownPath =
    resolved && resolved.startsWith(base + '/') ? resolved : resolved === base ? base : null
  const candidates = [...new Set([ownPath, base].filter(Boolean))]
  const out = []
  for (const p of candidates) {
    out.push({
      path: p,
      scope:
        p === ownPath
          ? 'process cgroup as exposed by namespace'
          : 'exposed cgroup mount root; shared, not attributed solely to WebKit',
      cpuStat: await safe(path.join(p, 'cpu.stat')),
      cpuPressure: await safe(path.join(p, 'cpu.pressure')),
    })
  }
  return out
}
await writeFile(log, '')
await writeFile(
  path.join(output, 'sampler-provenance.json'),
  JSON.stringify(
    {
      owner,
      intervalMs,
      maxDurationMs,
      pid: process.pid,
      started,
      clockTicksPerSecond: 'Linux /proc ticks; raw deltas retained, no assumed conversion',
      readOnly: true,
      noSignalsToApplication: true,
    },
    null,
    2,
  ),
)
let reason = 'bounded-duration'
try {
  while (Date.now() - started < maxDurationMs) {
    try {
      await access(stop)
      reason = 'stop-file'
      break
    } catch {}
    const wall = Date.now()
    if (!(await identityValid())) {
      reason = 'owner-exited-or-identity-mismatch'
      break
    }
    if (wall >= nextDiscovery) {
      await discover()
      nextDiscovery = wall + 1000
    }
    const processes = []
    for (const [pid, identity] of known) {
      const ps = stat(await safe(`/proc/${pid}/stat`))
      if (!ps || ps.birth !== identity.birth) {
        processes.push({ pid, birth: identity.birth, exitedOrReused: true })
        known.delete(pid)
        continue
      }
      const chain = await lineage(pid)
      if (!chain) {
        processes.push({ pid, birth: identity.birth, lineageLost: true })
        known.delete(pid)
        continue
      }
      const tasks = []
      let tids = []
      try {
        tids = await readdir(`/proc/${pid}/task`)
      } catch (e) {
        errors.set('task-list:' + e.code, (errors.get('task-list:' + e.code) || 0) + 1)
      }
      for (const tid of tids) {
        const ts = stat(await safe(`/proc/${pid}/task/${tid}/stat`))
        if (!ts) {
          tasks.push({ tid: Number(tid), unavailable: true })
          continue
        }
        const sched = await safe(`/proc/${pid}/task/${tid}/schedstat`)
        tasks.push({
          tid: Number(tid),
          ...ts,
          active: ts.state !== 'Z' && ts.state !== 'X',
          schedstat: sched?.trim() ?? null,
        })
      }
      processes.push({
        pid,
        birth: identity.birth,
        ...ps,
        lineage: chain,
        tasks,
        cgroup: await cgroupFiles(identity.cgroup),
      })
    }
    const end = Date.now()
    await appendFile(
      log,
      JSON.stringify({
        kind: 'sample',
        sequence: sequence++,
        wall,
        finishedWall: end,
        elapsedMs: end - wall,
        intervalSinceLastMs: lastStart === null ? null : wall - lastStart,
        processes,
      }) + '\n',
    )
    lastStart = wall
    await new Promise((resolve) =>
      setTimeout(resolve, Math.max(0, intervalMs - (Date.now() - wall))),
    )
  }
} finally {
  await writeFile(
    path.join(output, 'sampler-summary.json'),
    JSON.stringify(
      {
        started,
        finished: Date.now(),
        reason,
        samples: sequence,
        errors: [...errors].map(([key, count]) => ({ key, count })),
      },
      null,
      2,
    ),
  )
}
