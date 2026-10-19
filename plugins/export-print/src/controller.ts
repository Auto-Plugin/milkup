import type {
  SdkPluginOutputHost,
  SdkOutputCaptureRequest,
  SdkOutputSnapshot,
  SdkOutputWriteResult,
} from '@milkup/plugin-sdk'
export interface State {
  phase: 'idle' | 'preparing' | 'choosing' | 'writing' | 'printing' | 'done' | 'cancelled' | 'error'
  format: 'html' | 'pdf' | 'print'
  scope: 'document' | 'selection'
  resources: 'embed' | 'omit'
  pageSize: 'a4' | 'letter'
  landscape: boolean
  snapshot?: SdkOutputSnapshot
  capturedFormat?: State['format']
  result?: SdkOutputWriteResult
  error?: string
}
const errors: Record<string, string> = {
  revoked: '导出权限已撤销，请重新批准权限并启用插件。',
  'permission-denied': '请批准文档读取与导出权限后重试。',
  'gesture-required': '请再次点击导出或打印以开始。',
  'invalid-input': '无法准备此输出，请检查文档与所选范围后重试。',
  'invalid-token': '本次输出已失效，请重新准备。',
  stale: '本次输出已失效，请重新准备。',
  conflict: '目标文件已改变，未覆盖文件。请重试并选择保存位置。',
  busy: '另一项输出尚未完成，请稍后重试。',
  'too-large': '内容或图片超过输出大小限制，请缩小范围或选择不包含图片。',
  unsupported: '当前宿主暂不支持此输出方式，请选择其他格式。',
  unavailable: '输出未完成，请检查保存位置或打印机后重试。',
}
export function createController(changed: () => void) {
  const state: State = {
    phase: 'idle',
    format: 'html',
    scope: 'document',
    resources: 'embed',
    pageSize: 'a4',
    landscape: false,
  }
  type Operation = {
    host: SdkPluginOutputHost
    abort: AbortController
    leases: Set<string>
    serial: number
  }
  let disposed = false,
    serial = 0
  let operation: Operation | undefined
  const tasks = new Set<Promise<void>>()
  const emit = () => {
    if (!disposed) changed()
  }
  const current = (work: Operation) => !disposed && operation === work && !work.abort.signal.aborted
  async function cleanup(work: Operation) {
    const leases = [...work.leases]
    work.leases.clear()
    await Promise.allSettled(
      leases.map(async (id) => {
        await work.host.release(id)
      }),
    )
  }
  async function cancel() {
    const work = operation
    if (!work) return
    operation = undefined
    work.abort.abort()
    state.phase = 'cancelled'
    delete state.error
    emit()
    await cleanup(work)
  }
  function change(field: string, value: string) {
    if (disposed || operation) return
    if (field === 'format' && (value === 'html' || value === 'pdf' || value === 'print'))
      state.format = value
    else if (field === 'scope' && (value === 'document' || value === 'selection'))
      state.scope = value
    else if (field === 'resources' && (value === 'embed' || value === 'omit'))
      state.resources = value
    else if (field === 'pageSize' && (value === 'a4' || value === 'letter')) state.pageSize = value
    else if (field === 'orientation' && (value === 'portrait' || value === 'landscape'))
      state.landscape = value === 'landscape'
    else return
    emit()
  }
  async function run(work: Operation, request: SdkOutputCaptureRequest) {
    const options = { signal: work.abort.signal }
    try {
      // This call precedes every await: the trusted command gesture must be consumed now.
      const snapshot = await work.host.capture(request, options)
      work.leases.add(snapshot.id)
      if (!current(work)) return
      state.snapshot = Object.freeze({
        ...snapshot,
        warnings: Object.freeze(snapshot.warnings.map((warning) => Object.freeze({ ...warning }))),
      })
      state.capturedFormat = request.format
      if (request.format === 'print') {
        state.phase = 'printing'
        emit()
        const result = await work.host.print(snapshot.id, options)
        if (result.status === 'printed' && work.serial === serial) {
          state.phase = 'done'
          emit()
        } else if (current(work)) {
          state.phase = 'cancelled'
          emit()
        }
      } else {
        state.phase = 'choosing'
        emit()
        const target = await work.host.chooseTarget({ snapshotId: snapshot.id }, options)
        if (target.status === 'ready') work.leases.add(target.id)
        if (!current(work)) return
        if (target.status === 'cancelled') {
          state.phase = 'cancelled'
          emit()
          return
        }
        state.phase = 'writing'
        emit()
        const result = await work.host.write(target.id, options)
        // A successful write is committed. Never release its target or undo the saved file.
        work.leases.delete(target.id)
        if (work.serial === serial) {
          state.result = result
          state.phase = 'done'
          delete state.error
          emit()
        }
      }
    } catch (error) {
      if (current(work)) {
        const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
        state.phase = code === 'aborted' || code === 'cancelled' ? 'cancelled' : 'error'
        if (state.phase === 'error')
          state.error = errors[code] ?? '输出未完成，请检查文档与保存位置后重试。'
        emit()
      }
    } finally {
      if (operation === work) operation = undefined
      await cleanup(work)
    }
  }
  function start(host: { readonly output?: SdkPluginOutputHost } | undefined) {
    if (disposed || operation) return
    delete state.error
    delete state.snapshot
    delete state.capturedFormat
    delete state.result
    if (!host?.output) {
      state.phase = 'error'
      state.error = '当前宿主未提供导出与打印能力，请批准权限并检查宿主版本。'
      emit()
      return
    }
    const work: Operation = {
      host: host.output,
      abort: new AbortController(),
      leases: new Set(),
      serial: ++serial,
    }
    operation = work
    state.phase = 'preparing'
    const request: SdkOutputCaptureRequest = {
      format: state.format,
      scope: state.scope,
      resources: state.resources,
      ...(state.format !== 'html' ? { pageSize: state.pageSize, landscape: state.landscape } : {}),
    }
    // run begins synchronously and catches capture errors; callers return within command budget.
    const task = run(work, request)
    tasks.add(task)
    void task.then(() => tasks.delete(task))
    emit()
  }
  return {
    state,
    start,
    change,
    cancel,
    close: cancel,
    async dispose() {
      disposed = true
      await cancel()
    },
    async settled() {
      await Promise.all([...tasks])
    },
  }
}
