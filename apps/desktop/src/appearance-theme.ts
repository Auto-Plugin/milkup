import { compileThemeCss, type CompiledThemeCss } from './appearance-css'
import defaultCss from './appearance-default.css?raw'

export interface ThemeFile {
  revision: string
  name: string
  text: string | null
  defaultText: string
  path: string
  isDefault: boolean
  warning?: string
}
export interface ThemeCandidate {
  text: string
  name: string
  sourceDigest: string
}
export interface ThemeBackend {
  load(): Promise<ThemeFile>
  readCandidate(path: string): Promise<ThemeCandidate>
  commitCandidate(input: {
    path: string
    expectedDigest: string
    expectedRevision: string
  }): Promise<ThemeFile>
  reset(expectedRevision: string): Promise<ThemeFile>
  openCurrent(expectedRevision: string): Promise<{ status: 'requested'; path: string }>
}
export interface ThemeStyleState {
  name: string
  path: string
  isDefault: boolean
  busy: boolean
  css: string
  warning?: string
  error?: string
}
export function nativeThemeBackend(): ThemeBackend {
  const call = async <T>(command: string, args?: Record<string, unknown>): Promise<T> => {
    const { invoke } = await import('@tauri-apps/api/core')
    return invoke<T>(command, args)
  }
  return {
    load: () => call('appearance_theme_load'),
    readCandidate: (path) => call('appearance_theme_read_candidate', { path }),
    commitCandidate: (input) => call('appearance_theme_commit_candidate', { input }),
    reset: (expectedRevision) => call('appearance_theme_reset', { expectedRevision }),
    openCurrent: (expectedRevision) => call('appearance_theme_open_current', { expectedRevision }),
  }
}
/** Read-only browser preview; native file operations are deliberately unavailable. */
export function browserThemeBackend(): ThemeBackend {
  const unavailable = async (): Promise<never> => {
    throw new Error('请在桌面应用中导入或打开主题文件。')
  }
  return {
    load: async () => ({
      revision: 'browser',
      name: '系统默认主题',
      text: defaultCss,
      defaultText: defaultCss,
      path: '',
      isDefault: true,
    }),
    readCandidate: unavailable,
    commitCandidate: unavailable,
    reset: unavailable,
    openCurrent: unavailable,
  }
}
export function createThemeStyleController(options: {
  backend: ThemeBackend
  supports: (property: string, value: string) => boolean
  apply: (theme: CompiledThemeCss) => void | Promise<void>
  onState?: (state: ThemeStyleState) => void
}) {
  const initial = compileThemeCss(defaultCss, options.supports)
  let state: ThemeStyleState = {
    name: '系统默认主题',
    path: '',
    isDefault: true,
    busy: true,
    css: initial.css,
  }
  let revision: string | undefined
  let disposed = false
  const subscribers = new Set<(state: ThemeStyleState) => void>()
  if (options.onState) subscribers.add(options.onState)
  const emit = () => {
    if (!disposed)
      for (const listener of subscribers) {
        try {
          listener({ ...state })
        } catch {
          /* observer does not control file transaction */
        }
      }
  }
  const accept = async (file: ThemeFile): Promise<void> => {
    revision = file.revision
    // The file selection may have committed even if local layout later fails.
    // Keep the repair/open action bound to that observed file, while retaining
    // the last successfully applied style/name until apply completes.
    state = { ...state, path: file.path }
    if (file.text === null)
      throw new Error(file.warning ?? '当前主题文件无法读取，已保留现有样式。')
    const compiled = compileThemeCss(file.text, options.supports)
    if (disposed) return
    await options.apply(compiled)
    if (disposed) return
    state = {
      name: file.name,
      path: file.path,
      isDefault: file.isDefault,
      busy: state.busy,
      css: compiled.css,
      ...(file.warning ? { warning: file.warning } : {}),
    }
  }
  const ready = (async () => {
    try {
      await options.apply(initial)
      if (disposed) return
      await accept(await options.backend.load())
    } catch (e) {
      state = { ...state, error: String(e) }
    } finally {
      state.busy = false
      emit()
    }
  })()
  const act = async (operation: () => Promise<void>): Promise<void> => {
    await ready
    if (disposed || state.busy) return
    state = { ...state, busy: true }
    delete state.error
    emit()
    try {
      await operation()
    } catch (e) {
      if (!disposed) state = { ...state, error: String(e) }
    } finally {
      if (!disposed) {
        state.busy = false
        emit()
      }
    }
  }
  return {
    ready,
    getState: (): ThemeStyleState => ({ ...state }),
    subscribe(listener: (state: ThemeStyleState) => void) {
      subscribers.add(listener)
      listener({ ...state })
      return () => {
        subscribers.delete(listener)
      }
    },
    async importFile(path: string | null): Promise<void> {
      if (!path) return
      return act(async () => {
        if (revision === undefined)
          throw new Error('尚未成功读取主题存储，不能覆盖。请重新打开应用后重试。')
        const candidate = await options.backend.readCandidate(path)
        compileThemeCss(candidate.text, options.supports)
        if (disposed) return
        const saved = await options.backend.commitCandidate({
          path,
          expectedDigest: candidate.sourceDigest,
          expectedRevision: revision,
        })
        await accept(saved)
      })
    },
    reset: () =>
      act(async () => {
        if (revision === undefined) throw new Error('主题存储尚未读取，无法恢复默认。')
        await accept(await options.backend.reset(revision))
      }),
    openCurrent: () =>
      act(async () => {
        if (revision === undefined) throw new Error('主题文件尚未准备好。')
        await options.backend.openCurrent(revision)
      }),
    dispose() {
      disposed = true
      subscribers.clear()
    },
  }
}
export type ThemeStyleController = ReturnType<typeof createThemeStyleController>
