import { readdir, readFile } from 'node:fs/promises'
// For a serial native test run in the isolated display/environment. RSS is a
// process sum (shared pages may be counted twice); cgroup values include cache.
export function observeNativeMemory() {
  if (process.platform !== 'linux')
    return async () => ({ available: false, reason: 'Linux /proc sampler', samples: [] })
  const samples = []
  let running = false
  async function sample() {
    if (running) return
    running = true
    try {
      const processes = []
      for (const pid of await readdir('/proc')) {
        if (!/^\d+$/.test(pid)) continue
        try {
          const command = (await readFile(`/proc/${pid}/cmdline`, 'utf8')).split('\0')[0]
          if (!/(?:^|\/)(milkup-desktop|WebKitWebProcess|WebKitNetworkProcess)$/.test(command))
            continue
          const status = await readFile(`/proc/${pid}/status`, 'utf8')
          processes.push({
            pid: Number(pid),
            command,
            rssKiB: Number(/^VmRSS:\s+(\d+)/m.exec(status)?.[1] ?? 0),
          })
        } catch {}
      }
      const stats = await readFile('/sys/fs/cgroup/memory.stat', 'utf8').catch(() => '')
      samples.push({
        at: Date.now(),
        rssKiB: processes.reduce((n, p) => n + p.rssKiB, 0),
        processes,
        anonymousBytes: Number(/^anon (\d+)$/m.exec(stats)?.[1] ?? 0),
        fileCacheBytes: Number(/^file (\d+)$/m.exec(stats)?.[1] ?? 0),
      })
    } finally {
      running = false
    }
  }
  const timer = setInterval(() => void sample(), 250)
  void sample()
  return async () => {
    clearInterval(timer)
    await sample()
    return {
      samplePeriodMs: 250,
      maxProcessSumRssKiB: Math.max(0, ...samples.map((s) => s.rssKiB)),
      samples,
    }
  }
}
