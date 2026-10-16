import type { SdkPluginKeymapHost, SdkKeymapSnapshot } from '@milkup/plugin-sdk'
export interface State {
  readonly phase: 'loading' | 'ready' | 'saving' | 'error'
  readonly snapshot?: SdkKeymapSnapshot
  readonly draft: Readonly<Record<string, string>>
  readonly error?: string | undefined
  readonly message?: string | undefined
}
export function createController(backend: SdkPluginKeymapHost | undefined, changed: () => void) {
  let state: State = { phase: 'loading', draft: {} }
  let alive = true,
    generation = 0
  let pending: AbortController | undefined
  const set = (value: State) => {
    state = value
    if (alive) changed()
  }
  const host = () => {
    if (!backend) throw new Error('快捷键权限不可用，请在插件详情中批准 app:keymap 权限。')
    return backend
  }
  const busy = () => state.phase === 'saving' || state.phase === 'loading'
  async function operation(kind: 'reload' | 'save' | 'reset') {
    if (!alive || (kind !== 'reload' && busy())) return
    if (kind !== 'reload' && !state.snapshot) return
    if (kind === 'reload') pending?.abort()
    const request = ++generation,
      abort = new AbortController()
    pending = abort
    set({
      ...state,
      phase: kind === 'reload' ? 'loading' : 'saving',
      error: undefined,
      message: undefined,
    })
    try {
      const api = host()
      const snapshot =
        kind === 'reload'
          ? await api.snapshot({ signal: abort.signal })
          : kind === 'reset'
            ? await api.reset({ revision: state.snapshot!.revision }, { signal: abort.signal })
            : await api.update(
                {
                  revision: state.snapshot!.revision,
                  bindings: Object.entries(state.draft).map(([command, raw]) => ({
                    command,
                    keys: raw.trim() ? raw.trim().split(/\s+/) : [],
                  })),
                },
                { signal: abort.signal },
              )
      if (alive && generation === request)
        set({
          phase: 'ready',
          snapshot,
          draft: {},
          message:
            kind === 'save'
              ? '快捷键已保存。'
              : kind === 'reset'
                ? '已恢复默认快捷键。'
                : '快捷键列表已加载。',
        })
    } catch (error) {
      if (alive && generation === request)
        set({
          ...state,
          phase: 'error',
          error: error instanceof Error ? error.message : '快捷键操作失败，请重试。',
        })
    } finally {
      if (generation === request) pending = undefined
    }
  }
  return {
    get state() {
      return state
    },
    load: () => operation('reload'),
    save: () => operation('save'),
    reset: () => operation('reset'),
    edit(input: unknown) {
      if (!alive || busy() || !input || typeof input !== 'object') return
      const { field, value } = input as { field?: unknown; value?: unknown }
      if (typeof field !== 'string' || typeof value !== 'string' || value.length > 512) return
      const command = state.snapshot?.commands.find(
        (item) => item.id === field && item.available && item.bindable,
      )
      if (!command) return
      const draft = { ...state.draft }
      if (value === command.keys.join(' ')) delete draft[field]
      else draft[field] = value
      set({ ...state, phase: 'ready', draft, error: undefined, message: undefined })
    },
    cancel() {
      if (!alive || busy()) return
      set({
        ...state,
        phase: 'ready',
        draft: {},
        error: undefined,
        message: '已取消未保存的修改。',
      })
    },
    dispose() {
      if (!alive) return
      alive = false
      generation++
      pending?.abort()
      pending = undefined
      state = { phase: 'ready', draft: {} }
    },
  }
}
