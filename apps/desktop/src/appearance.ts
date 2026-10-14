export type ThemePreference = 'system' | 'light' | 'dark'
export const zoomLevels = [1, 1.25, 1.5, 2] as const
export interface AppearanceSettings {
  theme: ThemePreference
  zoom: number
}
export interface AppearanceState extends AppearanceSettings {
  resolvedTheme: 'light' | 'dark'
  busy: boolean
  error?: string
}
const key = 'milkup.desktop.appearance.v1'
export function readAppearance(storage?: Pick<Storage, 'getItem'>): AppearanceSettings {
  try {
    const value = JSON.parse(storage?.getItem(key) ?? '{}')
    return {
      theme: ['system', 'light', 'dark'].includes(value?.theme) ? value.theme : 'system',
      zoom: zoomLevels.includes(value?.zoom) ? value.zoom : 1,
    }
  } catch {
    return { theme: 'system', zoom: 1 }
  }
}
export function createAppearanceController(options: {
  storage?: Pick<Storage, 'getItem' | 'setItem'> | undefined
  isSystemDark: () => boolean
  applyTheme: (theme: ThemePreference) => Promise<void>
  applyZoom: (zoom: number) => Promise<void>
  onState: (state: AppearanceState) => void
}) {
  const saved = readAppearance(options.storage)
  let settings: AppearanceSettings = { theme: 'system', zoom: 1 }
  let busy = true
  let error: string | undefined
  const render = () =>
    options.onState({
      ...settings,
      busy,
      resolvedTheme:
        settings.theme === 'system' ? (options.isSystemDark() ? 'dark' : 'light') : settings.theme,
      ...(error ? { error } : {}),
    })
  const remember = () => {
    try {
      options.storage?.setItem(key, JSON.stringify(settings))
    } catch {
      error = '外观已应用，但无法记住设置。请检查本地存储权限。'
    }
  }
  const ready = (async () => {
    render()
    try {
      await options.applyTheme(saved.theme)
      settings.theme = saved.theme
    } catch (e) {
      error = `主题未能应用：${String(e)}`
    }
    try {
      await options.applyZoom(saved.zoom)
      settings.zoom = saved.zoom
    } catch (e) {
      error = `缩放未能应用，当前为 100%：${String(e)}`
    }
    busy = false
    render()
  })()
  return {
    ready,
    refreshSystemTheme: render,
    async changeTheme(theme: ThemePreference) {
      if (busy || !['system', 'light', 'dark'].includes(theme)) return
      busy = true
      error = undefined
      render()
      try {
        await options.applyTheme(theme)
        settings = { ...settings, theme }
        remember()
      } catch (e) {
        error = `主题未能应用，已保留原设置：${String(e)}`
      } finally {
        busy = false
        render()
      }
    },
    async changeZoom(zoom: number) {
      if (busy || !zoomLevels.includes(zoom as (typeof zoomLevels)[number])) return
      busy = true
      error = undefined
      render()
      try {
        await options.applyZoom(zoom)
        settings = { ...settings, zoom }
        remember()
      } catch (e) {
        error = `缩放未能应用，已保留原比例：${String(e)}`
      } finally {
        busy = false
        render()
      }
    },
    stepZoom(delta: number) {
      const index = zoomLevels.indexOf(settings.zoom as (typeof zoomLevels)[number])
      return this.changeZoom(
        zoomLevels[Math.max(0, Math.min(zoomLevels.length - 1, index + delta))]!,
      )
    },
  }
}
