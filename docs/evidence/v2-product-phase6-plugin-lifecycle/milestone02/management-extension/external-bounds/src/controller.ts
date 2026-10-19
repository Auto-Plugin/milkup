import type {
  SdkPluginManagementReadHost,
  SdkPluginManagementHost,
  SdkManagementSnapshot,
  SdkManagementDetails,
} from '@milkup/plugin-sdk'
export interface State {
  readonly phase: 'loading' | 'ready' | 'error'
  readonly snapshot: SdkManagementSnapshot | undefined
  readonly details: SdkManagementDetails | undefined
  readonly busy: boolean
  readonly message: string
}
const message = (error: unknown) => {
  const code =
    error && typeof error === 'object' && 'code' in error ? String(error.code) : 'unavailable'
  return (
    (
      {
        stale: '插件目录已变化，请刷新后重新查看。',
        revoked: '管理权限已撤销，请使用菜单中的宿主插件管理入口。',
        'gesture-required': '请直接点击按钮打开宿主详情。',
        'not-found': '插件已不在目录中，请刷新。',
        aborted: '操作已取消。',
        busy: '插件管理正忙，请稍后重试。',
      } as Record<string, string>
    )[code] ?? '无法读取插件信息，请在宿主插件管理中检查或重试。'
  )
}
export function createController(
  host: SdkPluginManagementReadHost | undefined,
  changed: () => void = () => {},
) {
  let active = true,
    epoch = 0,
    request: AbortController | undefined
  let state: State = {
    phase: 'loading',
    snapshot: undefined,
    details: undefined,
    busy: false,
    message: '',
  }
  const update = (patch: Partial<State>) => {
    state = { ...state, ...patch }
    changed()
  }
  const stop = () => {
    epoch++
    request?.abort()
    request = undefined
  }
  const start = () => {
    stop()
    request = new AbortController()
    return { current: epoch, signal: request.signal }
  }
  const current = (value: number) => active && epoch === value
  return {
    get state() {
      return state
    },
    async refresh() {
      if (!active) return
      const job = start()
      update({ phase: 'loading', details: undefined, busy: true, message: '' })
      if (!host) {
        update({
          phase: 'error',
          busy: false,
          message: '插件管理能力不可用或尚未批准权限；请打开宿主插件管理。',
        })
        return
      }
      try {
        const snapshot = await host.snapshot({ signal: job.signal })
        if (current(job.current)) update({ snapshot, phase: 'ready', busy: false })
      } catch (error) {
        if (current(job.current)) update({ phase: 'error', busy: false, message: message(error) })
      }
    },
    async select(id: string) {
      if (!active || !host || !state.snapshot?.items.some((item) => item.id === id)) return
      const revision = state.snapshot.revision,
        job = start()
      update({ busy: true, message: '' })
      try {
        const details = await host.describe({ pluginId: id, revision }, { signal: job.signal })
        if (details.pluginId !== id || details.revision !== revision) throw { code: 'stale' }
        if (current(job.current)) update({ details, busy: false, phase: 'ready' })
      } catch (error) {
        if (current(job.current)) update({ busy: false, message: message(error) })
      }
    },
    async openTrusted(
      commandHost: SdkPluginManagementHost | undefined,
      view: 'details' | 'settings',
    ) {
      if (!active || !state.details || state.busy) return
      const details = state.details,
        job = start()
      update({ busy: true, message: '' })
      try {
        if (!commandHost) throw { code: 'unavailable' }
        // Keep this call before any await: the command host carries the trusted gesture.
        const opening = commandHost.requestHostView(
          { pluginId: details.pluginId, revision: details.revision, view },
          { signal: job.signal },
        )
        const result = await opening
        if (current(job.current))
          update({
            busy: false,
            message:
              result.status === 'opened'
                ? '已打开宿主页面；批准与变更仍需在宿主中确认。'
                : '已取消打开宿主页面。',
          })
      } catch (error) {
        if (current(job.current)) update({ busy: false, message: message(error) })
      }
    },
    back() {
      if (!active) return
      stop()
      update({ details: undefined, busy: false, message: '' })
    },
    close() {
      stop()
      update({ details: undefined, busy: false, message: '' })
    },
    dispose() {
      if (!active) return
      active = false
      stop()
    },
  }
}
