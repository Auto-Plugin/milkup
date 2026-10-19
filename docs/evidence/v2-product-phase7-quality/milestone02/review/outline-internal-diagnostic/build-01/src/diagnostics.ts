import type { SdkDocumentScanner, SdkTemporaryStore } from '@milkup/plugin-sdk'

// Diagnostic copy only. No text, keys, paths, headings, or per-event records retained.
// Fixed call-site keys, additionally capped at 64 phase and 32 counter slots.
export class Diagnostics {
  private readonly phases: Record<string, [number, number, number, number]> = Object.create(null)
  private readonly counters: Record<string, number> = Object.create(null)
  private phaseCount = 0
  private counterCount = 0
  private frozen = ''
  private serial = 0
  constructor(readonly generation: number, readonly version: number) {}
  add(key: string, amount = 1): void {
    if (!(key in this.counters)) {
      if (this.counterCount >= 32) return
      this.counterCount++
      this.counters[key] = 0
    }
    this.counters[key] = Math.min(Number.MAX_SAFE_INTEGER, this.counters[key]! + amount)
  }
  duration(key: string, milliseconds: number): void {
    if (!(key in this.phases)) {
      if (this.phaseCount >= 64) return
      this.phaseCount++
      this.phases[key] = [0, 0, 0, 0]
    }
    const value = this.phases[key]!
    value[0]++
    value[1] += milliseconds
    value[2] = Math.max(value[2], milliseconds)
  }
  start(key: string): () => void {
    this.duration(key, 0)
    const slot = this.phases[key]
    if (slot) { slot[0]--; slot[3]++ }
    const from = performance.now()
    return () => {
      if (slot) slot[3]--
      this.duration(key, performance.now() - from)
    }
  }
  capture(status: string, headings: number, scannedLines: number): string {
    const phases = Object.fromEntries(Object.entries(this.phases).map(([key, v]) =>
      [key, [v[0], Math.round(v[1] * 100) / 100, Math.round(v[2] * 100) / 100, v[3]]]))
    const value = JSON.stringify({ schema: 1, serial: ++this.serial, generation: this.generation,
      version: this.version, status, headings, scannedLines, phases, counters: this.counters })
    // Never emit a truncated/misleading JSON document. No dynamic input controls keys.
    this.frozen = value.length <= 8192 ? 'P7_OUTLINE_DIAGNOSTICS_V1 ' + value
      : 'P7_OUTLINE_DIAGNOSTICS_V1 {"schema":1,"error":"summary-budget"}'
    return this.frozen
  }
  title(status: string, headings: number, scannedLines: number): string {
    // Do not invalidate controlled-output equality on every progress render.
    if (!this.frozen && status === 'complete') this.capture(status, headings, scannedLines)
    return this.frozen || 'P7_OUTLINE_DIAGNOSTICS_V1 pending'
  }
}

export function diagnosticStore(store: SdkTemporaryStore, d: Diagnostics): SdkTemporaryStore {
  return {
    async get(key) {
      d.add('rpc.get.keys'); const end = d.start('rpc.get')
      try { const value = await store.get(key); d.add('rpc.read.utf16', value?.length ?? 0); return value }
      finally { end() }
    },
    async getMany(keys) {
      d.add('rpc.getMany.keys', keys.length); const end = d.start('rpc.getMany')
      try { const values = await store.getMany(keys); for (const value of values) d.add('rpc.read.utf16', value?.length ?? 0); return values }
      finally { end() }
    },
    async set(key, value) {
      d.add('rpc.write.utf16', value.length); const end = d.start('rpc.set')
      try { return await store.set(key, value) } finally { end() }
    },
    async setMany(entries) {
      d.add('rpc.setMany.entries', entries.length)
      for (const entry of entries) d.add('rpc.write.utf16', entry.value.length)
      const end = d.start('rpc.setMany')
      try { return await store.setMany(entries) } finally { end() }
    },
    dispose: () => store.dispose(),
  }
}

export function diagnosticScanner(scanner: SdkDocumentScanner, d: Diagnostics): SdkDocumentScanner {
  return {
    cancel: () => scanner.cancel(),
    [Symbol.asyncIterator]() {
      const iterator = scanner[Symbol.asyncIterator]()
      return {
        async next() {
          const end = d.start('scan.next.wait')
          try {
            const result = await iterator.next()
            if (!result.done) {
              d.add('scan.event.' + result.value.type)
              if (result.value.type === 'batch') d.add('scan.items', result.value.items.length)
            }
            return result
          } finally { end() }
        },
        async return() {
          return iterator.return ? await iterator.return() : { done: true as const, value: undefined }
        },
      }
    },
  }
}
