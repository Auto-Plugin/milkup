/** Blob Workers inherit the creator's CSP; URL Workers may have no response CSP. */
export function createCspWorker(bootstrapUrl: string, name: string): Worker {
  const url = URL.createObjectURL(
    new Blob([`import ${JSON.stringify(bootstrapUrl)};`], {
      type: 'text/javascript',
    }),
  )
  let worker: Worker
  try {
    worker = new Worker(url, { type: 'module', name })
  } catch (error) {
    URL.revokeObjectURL(url)
    throw error
  }
  const terminate = worker.terminate.bind(worker)
  let closed = false
  worker.terminate = () => {
    if (closed) return
    closed = true
    try {
      terminate()
    } finally {
      URL.revokeObjectURL(url)
    }
  }
  return worker
}

/** Fail closed before plugin import if the production realm lost its inherited CSP. */
export function assertPluginWorkerCsp(
  evaluate: () => unknown = () => (0, eval)('1'),
  construct: () => unknown = () => function () {}.constructor('return 1')(),
): void {
  for (const probe of [evaluate, construct]) {
    let denied = false
    try {
      probe()
    } catch (error) {
      denied = error instanceof EvalError
    }
    if (!denied) throw new Error('Plugin Worker requires CSP denial of dynamic code generation')
  }
}
