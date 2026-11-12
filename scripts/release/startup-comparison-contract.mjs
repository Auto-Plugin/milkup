import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

export const modes = Object.freeze(['early', 'late', 'none', 'none', 'late', 'early'])
export const logBudget = 1024 * 1024
export const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
export function fixtureSource(bytes) {
  const text = bytes.toString('utf8')
  const matches = [...text.matchAll(/^```mermaid\r?\n([\s\S]*?)^```\s*$/gm)]
  assert.equal(matches.length, 1, 'Exactly one Mermaid fixture required')
  return sha(Buffer.from(matches[0][1].replace(/\r\n/g, '\n')))
}

// An owned, fresh per-launch stderr file is additionally bound to held PID and
// creation time by PowerShell. PID-only records are never pooled across launches.
export class StartupLog {
  constructor(pid, sourceSha, creationMs) {
    assert(Number.isSafeInteger(pid) && pid > 0)
    assert(/^[a-f0-9]{64}$/.test(sourceSha))
    assert(Number.isFinite(creationMs) && creationMs > 0)
    Object.assign(this, {
      pid,
      sourceSha,
      creationMs,
      pending: '',
      bytes: 0,
      lines: 0,
      records: [],
      admitted: new Map(),
      started: new Set(),
      firstReady: null,
    })
  }
  append(text, byteLength) {
    this.bytes += byteLength
    assert(this.bytes <= logBudget, 'Complete startup log exceeds bounded budget')
    this.pending += text
    assert(this.pending.length <= logBudget)
    let end
    while ((end = this.pending.indexOf('\n')) >= 0) {
      const line = this.pending.slice(0, end).replace(/\r$/, '')
      this.pending = this.pending.slice(end + 1)
      this.lines++
      assert(this.lines <= 4096, 'Startup line budget')
      const match =
        /^(MILKUP_(?:MERMAID_FRONTEND_AUDIT|STARTUP_TIMING|WRY_STARTUP_TIMING|CATALOG_TIMING)) (.*)$/.exec(
          line,
        )
      if (!match) continue
      const value = JSON.parse(match[2])
      assert.equal(value.productPid ?? value.pid, this.pid, 'Wrong launch in startup log')
      assert(!value.limitReached && !value.truncated, 'Incomplete native startup diagnostics')
      const timestamp = value.timestampUnixMs ?? value.unixMs ?? value.startedUnixMs
      assert(Number.isFinite(timestamp) && timestamp >= this.creationMs - 2, 'Old launch timestamp')
      assert(this.records.length < 512, 'Startup record budget')
      this.records.push({ kind: match[1], value })
      if (match[1] !== 'MILKUP_MERMAID_FRONTEND_AUDIT' || !value.phase) continue
      const key = `${value.ownerId}/${value.requestId}`
      assert(/^[a-f0-9]{32}\/[a-f0-9]{32}$/.test(key), 'Exact frontend request identity required')
      if (value.phase === 'admitted') {
        assert(!this.admitted.has(key), 'Duplicate admission')
        assert.equal(value.sourceSha256, this.sourceSha, 'Unexpected document source')
        this.admitted.set(key, value)
      } else {
        const admitted = this.admitted.get(key)
        assert(
          admitted && admitted.sourceSha256 === value.sourceSha256,
          'Unmatched frontend request',
        )
        assert(value.timestampUnixMs >= admitted.timestampUnixMs)
        if (value.phase === 'started') this.started.add(key)
        else if (value.phase === 'finished' && value.status === 'ready') {
          assert(this.started.has(key), 'Ready without started request')
          assert.equal(value.consumerAborted, false)
          assert(
            /^[a-f0-9]{64}$/.test(value.pngSha256) &&
              value.pngBytes > 0 &&
              value.width > 0 &&
              value.height > 0,
          )
          this.firstReady ??= value
        }
      }
    }
  }
  finish() {
    assert.equal(this.pending, '', 'Truncated startup log record')
  }
}

export async function observeMode(mode, { attach, waitReady, observe }) {
  assert(modes.includes(mode), 'Unknown startup attachment mode')
  if (mode === 'early') await attach()
  const ready = await waitReady()
  assert(ready, 'No successful native first render')
  if (mode === 'late') await attach()
  return { ready, dom: mode === 'none' ? null : await observe() }
}
