import { createLiteralLineMatcher } from '@milkup/core'
interface Scan {
  readonly type: 'scan'
  readonly text: string
  readonly query: string
  readonly caseSensitive: boolean
  readonly fromUtf16: number
  readonly fromLine: number
}
const worker = globalThis as unknown as {
  onmessage: ((event: MessageEvent<Scan | { type: 'ack' }>) => void) | null
  postMessage: (message: unknown, transfer?: Transferable[]) => void
}
let acknowledge: (() => void) | undefined
worker.onmessage = (event) => {
  if (event.data.type === 'ack') {
    acknowledge?.()
    acknowledge = undefined
    return
  }
  void scan(event.data).catch((error) =>
    worker.postMessage({ type: 'error', message: String(error) }),
  )
}
async function scan(request: Scan) {
  const matcher = createLiteralLineMatcher(request.query, request.caseSensitive)
  let packed = new Float64Array(8192 * 4),
    used = 0,
    position = request.fromUtf16,
    line = request.fromLine
  let started = performance.now(),
    scanMs = 0
  const flush = async (done: boolean) => {
    scanMs += performance.now() - started
    const values = packed.slice(0, used)
    packed = new Float64Array(8192 * 4)
    used = 0
    await new Promise<void>((resolve) => {
      acknowledge = resolve
      worker.postMessage({ type: 'matches', values: values.buffer, done }, [values.buffer])
    })
    started = performance.now()
  }
  for (const raw of request.text.split('\n')) {
    const content = raw.endsWith('\r') ? raw.slice(0, -1) : raw
    for (const hit of matcher(content)) {
      packed[used++] = position + hit.from
      packed[used++] = position + hit.to
      packed[used++] = line
      packed[used++] = hit.from
      if (used === packed.length) await flush(false)
    }
    position += raw.length + 1
    line++
  }
  await flush(true)
  worker.postMessage({ type: 'complete', scanMs })
}
