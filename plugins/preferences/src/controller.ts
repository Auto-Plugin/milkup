import type {
  SdkPluginSettingsHost,
  SdkSettingsField,
  SdkSettingsSnapshot,
  SdkSettingsValue,
  SdkSettingsValues,
} from '@milkup/plugin-sdk'

export interface State {
  phase: 'closed' | 'loading' | 'ready' | 'previewing' | 'saving' | 'error'
  snapshot?: SdkSettingsSnapshot
  drafts: Record<string, string>
  invalid: Record<string, string>
  message: string
  error?: string
}
const messages: Record<string, string> = {
  busy: '另一处正在修改偏好。请先完成或取消该处更改，再重试。',
  conflict: '偏好已被其他操作修改。请取消并重新加载后再试。',
  revoked: '偏好权限已撤销。请重新审批并启用插件。',
  unavailable: '设置服务暂不可用，请重试。',
  'invalid-transaction': '本次预览已结束，请重新加载偏好。',
  'invalid-input': '宿主拒绝了此值，请检查输入或取消更改。',
  aborted: '操作已取消。',
}
function errorMessage(error: unknown): string {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
  return messages[code] || '操作未完成，请重试或取消更改。'
}
export function parse(field: SdkSettingsField, raw: string): SdkSettingsValue {
  if (field.type === 'enum') {
    const value = field.options.find((option) => String(option) === raw)
    if (value === undefined) throw new Error('请选择列表中的选项。')
    return value
  }
  if (field.type === 'boolean') {
    if (raw === 'true') return true
    if (raw === 'false') return false
    throw new Error('请选择开启或关闭。')
  }
  if (!raw.trim()) throw new Error('请输入数值。')
  const value = Number(raw)
  if (!Number.isFinite(value)) throw new Error('请输入有效数值。')
  if (value === 0 && field.allowZero) return value
  if (value < field.minimum || value > field.maximum)
    throw new Error(
      `请输入 ${field.minimum} 至 ${field.maximum} 之间的数值${field.allowZero ? '，或 0 表示自动' : ''}。`,
    )
  if (field.step) {
    const steps = (value - field.minimum) / field.step
    if (Math.abs(steps - Math.round(steps)) > 1e-7)
      throw new Error(`请按 ${field.step} 的步长输入。`)
  }
  return value
}
const drafts = (values: SdkSettingsValues) =>
  Object.fromEntries(Object.entries(values).map(([key, value]) => [key, String(value)]))

export function createController(host: SdkPluginSettingsHost | undefined, changed: () => void) {
  const state: State = { phase: 'closed', drafts: {}, invalid: {}, message: '' }
  let queue = Promise.resolve()
  let transaction: string | undefined
  let generation = 0
  let revision = 0
  const dirty = new Set<string>()
  let disposed = false
  let visible = false
  let abort = new AbortController()
  const current = (token: number) => !disposed && visible && token === generation
  const emit = () => {
    if (!disposed && visible) changed()
  }
  const fail = (error: unknown) => {
    state.phase = 'error'
    state.message = ''
    state.error = errorMessage(error)
    emit()
  }
  function enqueue(operation: () => Promise<void>) {
    queue = queue.catch(() => {}).then(operation)
    return queue
  }
  async function cancelTransaction() {
    const id = transaction
    if (id && host) await host.cancel(id)
    transaction = undefined
  }
  async function begin(token: number, preserveDrafts = false) {
    if (!host) throw Object.assign(new Error(), { code: 'unavailable' })
    const result = await host.begin('application', { signal: abort.signal })
    if (!current(token)) {
      await host.cancel(result.id).catch(() => {})
      return false
    }
    transaction = result.id
    const previousDrafts = state.drafts
    state.snapshot = result.snapshot
    state.drafts = drafts(result.snapshot.values)
    if (preserveDrafts) {
      for (const key of dirty)
        if (previousDrafts[key] !== undefined) state.drafts[key] = previousDrafts[key]!
    } else {
      state.invalid = {}
      dirty.clear()
    }
    return true
  }
  function open() {
    if (disposed || visible) return queue
    visible = true
    abort = new AbortController()
    const token = ++generation
    state.phase = 'loading'
    state.message = ''
    delete state.error
    emit()
    return enqueue(async () => {
      try {
        await cancelTransaction()
        if (!current(token) || !(await begin(token))) return
        state.phase = 'ready'
        emit()
      } catch (error) {
        if (current(token)) fail(error)
      }
    })
  }
  function preview(patch: SdkSettingsValues, token: number, inputRevision: number) {
    return enqueue(async () => {
      if (!current(token)) return
      try {
        if (!transaction && !(await begin(token, true))) return
        const snapshot = await host!.preview(transaction!, patch, { signal: abort.signal })
        if (!current(token)) return
        state.snapshot = snapshot
        if (inputRevision === revision) {
          state.phase = 'ready'
          state.message = '正在预览，尚未保存。'
          delete state.error
        }
        emit()
      } catch (error) {
        if (current(token) && state.phase !== 'saving') fail(error)
      }
    })
  }
  function change(key: string, raw: string) {
    if (!visible || disposed || state.phase === 'loading' || state.phase === 'saving') return queue
    const field = state.snapshot?.schema[key]
    if (!field) return queue
    state.drafts[key] = raw
    state.message = ''
    dirty.add(key)
    const inputRevision = ++revision
    let value: SdkSettingsValue
    try {
      value = parse(field, raw)
      delete state.invalid[key]
    } catch (error) {
      state.invalid[key] = (error as Error).message
      state.phase = 'ready'
      emit()
      return queue
    }
    state.phase = 'previewing'
    delete state.error
    emit()
    return preview({ [key]: value }, generation, inputRevision)
  }
  function reset() {
    if (!visible || !state.snapshot || state.phase === 'loading' || state.phase === 'saving')
      return queue
    const defaults = state.snapshot.defaults
    state.message = ''
    for (const key of Object.keys(defaults)) dirty.add(key)
    state.drafts = drafts(defaults)
    state.invalid = {}
    delete state.error
    state.phase = 'previewing'
    emit()
    return preview(defaults, generation, ++revision)
  }
  function save() {
    if (!visible || !state.snapshot || state.phase === 'loading' || state.phase === 'saving')
      return queue
    if (Object.keys(state.invalid).length) {
      state.error = '请先修正标出的输入，再保存。'
      emit()
      return queue
    }
    const token = generation
    revision++
    state.phase = 'saving'
    state.message = ''
    delete state.error
    emit()
    return enqueue(async () => {
      if (!current(token)) return
      try {
        if (!transaction && dirty.size && !(await begin(token, true))) return
        if (!transaction) {
          state.phase = 'ready'
          state.message = '偏好已保存。'
          emit()
          return
        }
        // Reapply all valid drafts so a failed earlier preview cannot silently
        // commit a different value from the one currently displayed.
        const patch = Object.fromEntries(
          Object.entries(state.drafts).map(([key, raw]) => [
            key,
            parse(state.snapshot!.schema[key]!, raw),
          ]),
        )
        await host!.preview(transaction, patch, { signal: abort.signal })
        if (!current(token)) return
        const snapshot = await host!.commit(transaction, { signal: abort.signal })
        transaction = undefined
        if (!current(token)) return
        state.snapshot = snapshot
        state.drafts = drafts(snapshot.values)
        dirty.clear()
        state.phase = 'ready'
        state.message = '偏好已保存。'
        emit()
      } catch (error) {
        if (current(token)) fail(error)
      }
    })
  }
  function cancel() {
    if (!visible || disposed || state.phase === 'saving') return queue
    const token = ++generation
    abort.abort()
    abort = new AbortController()
    state.phase = 'loading'
    state.message = ''
    delete state.error
    emit()
    return enqueue(async () => {
      try {
        await cancelTransaction()
        if (!current(token) || !(await begin(token))) return
        state.phase = 'ready'
        state.message = '未保存的预览已取消。'
        emit()
      } catch (error) {
        if (current(token)) fail(error)
      }
    })
  }
  function close() {
    visible = false
    generation++
    abort.abort()
    state.phase = 'closed'
    return enqueue(async () => {
      await cancelTransaction().catch(() => {})
    })
  }
  return {
    state,
    open,
    change,
    reset,
    save,
    cancel,
    retry: cancel,
    close,
    async dispose() {
      if (disposed) return
      disposed = true
      await close()
    },
    settled: () => queue,
  }
}
