import type { SdkPluginCommandContext, SdkPluginStorage } from '@milkup/plugin-sdk'
import { markdownImage, parsePolicy, type ImportPolicy } from './format'

export const POLICY_KEY = 'import.policy.v1'
export interface State {
  phase: 'idle' | 'preparing' | 'choosing' | 'staging' | 'applying' | 'done' | 'cancelled' | 'error'
  initializing: boolean
  policy: ImportPolicy
  alt: string
  invalidAlt?: string
  fileName?: string
  error?: string
  warning?: string
}
type CommandHost = SdkPluginCommandContext['host']
const errors: Record<string, string> = {
  invalidated: '文档或保存位置已改变，未插入图片。请重新选择图片。',
  conflict: '文档或保存位置已改变，未插入图片。请重新选择图片。',
  'invalid-snapshot': '编辑位置已失效，未插入图片。请重新选择图片。',
  revoked: '图片导入权限已撤销，请重新批准并启用插件。',
  'permission-denied': '请批准图片导入权限后再试。',
  'invalid-input': '图片或资源引用无效，请选择 PNG、JPEG 或 WebP 图片。',
  unsupported: '暂不支持此图片，请选择 PNG、JPEG 或 WebP 图片。',
  'too-large': '图片超过宿主允许的大小，请选择较小的图片。',
  quota: '资源空间不足，未插入图片。请释放空间后重试。',
  busy: '另一个文档操作尚未完成，请稍后重试。',
  unavailable: '图片导入未完成，请检查文档与保存位置后重试。',
}
const errorCode = (error: unknown) =>
  error && typeof error === 'object' && 'code' in error ? String(error.code) : ''

export function createController(
  storage: SdkPluginStorage | undefined,
  changed: () => void,
  notify?: (message: string) => Promise<void>,
) {
  const state: State = { phase: 'idle', initializing: true, policy: 'assets', alt: '' }
  let disposed = false
  let preferenceRevision = 0
  let writes = Promise.resolve()
  type Operation = {
    abort: AbortController
    host: NonNullable<CommandHost>
    handles: Set<string>
    snapshot?: string
  }
  let operation: Operation | undefined
  const emit = () => {
    if (!disposed) changed()
  }
  const report = (message: string) => {
    void Promise.resolve()
      .then(() => {
        if (!disposed) return notify?.(message)
      })
      .catch(() => {})
  }
  const ready = (async () => {
    const revision = preferenceRevision
    try {
      const value = await storage?.getItem(POLICY_KEY)
      if (!disposed && revision === preferenceRevision) state.policy = parsePolicy(value)
    } catch {
      if (!disposed && revision === preferenceRevision)
        state.warning = '未能读取导入策略，当前使用 assets 目录。'
    } finally {
      if (!disposed) {
        state.initializing = false
        emit()
      }
    }
  })()
  const current = (work: Operation) => !disposed && operation === work && !work.abort.signal.aborted
  async function cleanup(work: Operation) {
    const handles = [...work.handles]
    work.handles.clear()
    const snapshot = work.snapshot
    delete work.snapshot
    await Promise.allSettled([
      ...handles.map((id) => work.host.resources!.abort(id)),
      ...(snapshot ? [work.host.editing!.release(snapshot)] : []),
    ])
  }
  async function cancel(notify = true) {
    const work = operation
    if (!work) return
    operation = undefined
    work.abort.abort()
    state.phase = 'cancelled'
    delete state.error
    if (notify) emit()
    await cleanup(work)
  }
  function change(field: string, value: string) {
    if (disposed || operation) return
    if (field === 'alt') {
      state.alt = value
      if (value.length > 512) state.invalidAlt = '替代文本最多 512 个字符。'
      else delete state.invalidAlt
      emit()
      return
    }
    if (field !== 'policy' || (value !== 'assets' && value !== 'document-assets')) return
    state.policy = value
    const revision = ++preferenceRevision
    delete state.warning
    emit()
    writes = writes.then(async () => {
      if (disposed) return
      try {
        if (!storage) throw new Error('Unavailable')
        await storage.setItem(POLICY_KEY, value)
      } catch {
        if (!disposed && revision === preferenceRevision) {
          state.warning = '未能保存导入策略，本次仍使用当前选择；重启后可能恢复默认。'
          emit()
        }
      }
    })
  }
  async function run(host: CommandHost, pasteId?: string) {
    if (disposed || operation) return
    if (state.invalidAlt) {
      if (pasteId) report(state.invalidAlt)
      state.phase = 'error'
      emit()
      return
    }
    if (!host?.resources || !host.editing) {
      state.phase = 'error'
      state.error = '宿主暂不提供图片导入能力，请批准权限并检查宿主版本。'
      if (pasteId) report(state.error)
      emit()
      return
    }
    const work: Operation = {
      host,
      abort: new AbortController(),
      handles: new Set(pasteId ? [pasteId] : []),
    }
    operation = work
    const options = { signal: work.abort.signal }
    const alt = state.alt
    state.phase = 'preparing'
    delete state.error
    delete state.fileName
    emit()
    try {
      const intent = await host.resources.prepareDocument(pasteId ? { pasteId } : {}, options)
      if (intent.status === 'cancelled') {
        if (current(work)) {
          state.phase = 'cancelled'
          emit()
        }
        return
      }
      work.handles.add(intent.id)
      if (!current(work)) return
      const snapshot = await host.editing.capture({ extent: 'selection' }, options)
      work.snapshot = snapshot.id
      if (!current(work)) return
      state.phase = 'choosing'
      emit()
      const source = await host.resources.choose(intent.id, options)
      if (source) work.handles.add(source.id)
      if (!current(work)) return
      if (!source) {
        state.phase = 'cancelled'
        emit()
        return
      }
      await ready
      if (!current(work)) return
      const policy = state.policy
      state.fileName = source.name
      state.phase = 'staging'
      emit()
      const asset = await host.resources.stage(
        { sourceId: source.id, snapshotId: snapshot.id, strategy: policy },
        options,
      )
      work.handles.add(asset.id)
      if (!current(work)) return
      const insert = markdownImage(alt, asset.reference)
      const from = Math.min(snapshot.selection.anchor, snapshot.selection.head)
      const cursor = from + insert.length
      state.phase = 'applying'
      emit()
      await host.editing.apply(
        {
          snapshotId: snapshot.id,
          changes: [
            {
              from,
              to: Math.max(snapshot.selection.anchor, snapshot.selection.head),
              insert,
            },
          ],
          selection: { anchor: cursor, head: cursor },
          assetIds: [asset.id],
        },
        options,
      )
      // Accepted resources now belong to the document, including its undo/recovery lifetime.
      work.handles.delete(asset.id)
      if (current(work)) {
        state.phase = 'done'
        emit()
      }
    } catch (error) {
      if (current(work)) {
        const code = errorCode(error)
        state.phase = code === 'aborted' || code === 'cancelled' ? 'cancelled' : 'error'
        if (state.phase === 'error') {
          state.error = errors[code] ?? '图片导入未完成，请检查文档后重新选择图片。'
          if (pasteId) report(state.error)
        }
        emit()
      }
    } finally {
      if (operation === work) operation = undefined
      await cleanup(work)
    }
  }
  return {
    state,
    ready,
    change,
    choose: (host: CommandHost) => run(host),
    async paste(host: CommandHost, input: unknown) {
      const grantId =
        input && typeof input === 'object' && 'grantId' in input ? input.grantId : undefined
      if (typeof grantId !== 'string' || !grantId || grantId.length > 256) {
        if (disposed || operation) return
        state.phase = 'error'
        state.error = '未收到有效的图片粘贴授权，请在编辑器中重新粘贴。'
        report(state.error)
        emit()
        return
      }
      try {
        if (disposed || operation) {
          if (!disposed) report('正在导入另一张图片，请完成或取消后重新粘贴。')
          return
        }
        await run(host, grantId)
      } finally {
        // Also release grants rejected before an Operation exists (invalid drafts or busy UI).
        try {
          await host?.resources?.abort(grantId)
        } catch {
          /* host revocation also cleans grants */
        }
      }
    },
    cancel,
    close: () => cancel(),
    async dispose() {
      disposed = true
      await cancel(false)
    },
    flushPreferences: () => writes,
  }
}
