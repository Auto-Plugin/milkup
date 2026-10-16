export function formatRecoveryError(error: unknown): string {
  const message = String(error)
  if (/os error (28|112)\b|no space left on device/i.test(message))
    return '磁盘已满，恢复点未更新。已有恢复点保留；请释放空间或另存为到其他磁盘。'
  if (/os error (13|5)\b|permission denied|access is denied/i.test(message))
    return '恢复目录无法写入。已有恢复点保留；请检查目录权限，或手动保存当前文档。'
  if (/os error (17|80|183)\b|file exists|already exists/i.test(message))
    return '目标文件已存在，未覆盖任何内容。请选择新的文件名；原恢复记录仍保留。'
  return message
}
export interface RecoveryStorageStatus {
  readonly usedBytes: number
  readonly limitBytes: number
  readonly availableBytes: number
  readonly minFreeBytes: number
  readonly path: string
}
export interface RecoveryRecord {
  readonly id: string
  readonly originalPath?: string | null
  readonly version: number
  readonly createdAt: number
  readonly bytes: number
  readonly disposition: string
}
export interface RecoveryDocument {
  readonly documentId: string
  readonly originalPath?: string
  readonly version: number
  readonly nativeVersion?: number
  readonly text?: string | undefined
  readonly dirty: boolean
}
export interface RecoveryService {
  checkpoint(input: RecoveryDocument & { key: string }): Promise<RecoveryRecord>
  settle(key: string, disposition: 'saved' | 'closed'): Promise<void>
}
export interface RecoveryStatus {
  readonly phase: 'idle' | 'pending' | 'writing' | 'ready' | 'error'
  readonly version?: number
  readonly at?: number
  readonly error?: string
}

// Captures accepted document revisions, not optimistic DOM or IME preedit.
// A timer deadline is an attempt deadline, never a durability promise.
export function createRecoveryController(options: {
  read: (includeText: boolean) => RecoveryDocument
  service: RecoveryService
  onStatus: (status: RecoveryStatus) => void
}) {
  let sequence = 0
  const prefix = Date.now().toString(36)
  let key = `${prefix}-${sequence}`
  let observed = ''
  let wasDirty = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let firstPending: number | undefined
  let durable: RecoveryRecord | undefined
  let queue = Promise.resolve()
  const cancel = () => {
    clearTimeout(timer)
    timer = undefined
    firstPending = undefined
  }
  const notify = (phase: RecoveryStatus['phase'], error?: unknown) =>
    options.onStatus({
      phase,
      ...(durable ? { version: durable.version, at: durable.createdAt } : {}),
      ...(error === undefined ? {} : { error: formatRecoveryError(error) }),
    })
  const settle = (oldKey: string, disposition: 'saved' | 'closed') => {
    queue = queue
      .then(() => options.service.settle(oldKey, disposition))
      .catch((error) => {
        // Retain pending records when archival fails; duplicate recovery is safer
        // than declaring a checkpoint disposable without a durable acknowledgement.
        if (oldKey === key) notify('error', error)
      })
  }
  const flush = (): Promise<void> => {
    cancel()
    const capturedKey = key
    queue = queue.then(async () => {
      if (capturedKey !== key) return
      const document = options.read(true)
      if (!document.dirty || durable?.version === document.version) return
      notify('writing')
      try {
        const record = await options.service.checkpoint({ ...document, key: capturedKey })
        if (capturedKey !== key) return
        const latest = options.read(false)
        durable = latest.dirty ? record : undefined
        notify(!latest.dirty ? 'idle' : latest.version === record.version ? 'ready' : 'pending')
      } catch (error) {
        if (capturedKey === key) notify('error', error)
      }
    })
    return queue
  }
  const observe = () => {
    const document = options.read(false)
    const signature = `${document.documentId}:${document.version}:${document.dirty}`
    if (signature === observed) return
    observed = signature
    if (!document.dirty) {
      cancel()
      if (wasDirty) settle(key, 'saved')
      wasDirty = false
      durable = undefined
      notify('idle')
      return
    }
    wasDirty = true
    firstPending ??= Date.now()
    clearTimeout(timer)
    timer = setTimeout(
      () => {
        void flush()
      },
      Math.max(0, Math.min(750, 5000 - (Date.now() - firstPending))),
    )
    notify('pending')
  }
  const endDocument = () => {
    const oldKey = key
    cancel()
    key = `${prefix}-${++sequence}`
    observed = ''
    durable = undefined
    if (wasDirty) settle(oldKey, 'closed')
    wasDirty = false
    notify('idle')
    return queue
  }
  return { observe, flush, endDocument }
}
