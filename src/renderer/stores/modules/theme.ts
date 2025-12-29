import type { Theme, ThemeName, ThemeStore } from '../types'
import { useStorage } from '@vueuse/core'
import { computed, readonly } from 'vue'
import { g } from '../utils'

const defaultTheme: ThemeStore = {
  current: 'normal',
  customThemes: [],
  editingTheme: null,
}

function useThemeStore() {
  const theme = useStorage<ThemeStore>(g('theme'), defaultTheme, localStorage, {
    mergeDefaults: true,
  })

  const current = computed(() => theme.value.current)
  const customThemes = computed(() => theme.value.customThemes)
  const editingTheme = computed(() => theme.value.editingTheme)

  const isCustomTheme = computed(() => {
    return theme.value.customThemes.some(t => t.name === theme.value.current)
  })

  function set<K extends keyof ThemeStore>(key: K, value: ThemeStore[K]) {
    theme.value[key] = value
  }

  function get<K extends keyof ThemeStore>(key: K) {
    return theme.value[key]
  }

  return {
    theme: readonly(theme),

    current,
    customThemes,
    editingTheme,
    isCustomTheme,

    get,
    set,

    getCurrent: () => get('current'),
    setCurrent: (value: ThemeName) => set('current', value),

    getEditingTheme: () => get('editingTheme'),
    setEditingTheme: (value: ThemeName | null) => set('editingTheme', value),
    clearEditingTheme: () => set('editingTheme', null),

    getCustomThemes: () => get('customThemes'),

    addCustomTheme: (newTheme: Theme) => {
      const editingName = theme.value.editingTheme
      if (editingName) {
        theme.value.customThemes = theme.value.customThemes.filter(t => t.name !== editingName)
        theme.value.editingTheme = null
      }
      theme.value.customThemes = [...theme.value.customThemes, newTheme]
    },
    updateCustomTheme: (name: ThemeName, updatedTheme: Partial<Theme>) => {
      theme.value.customThemes = theme.value.customThemes.map(t =>
        t.name === name ? { ...t, ...updatedTheme } : t,
      )
    },

    removeCustomTheme: (name: ThemeName) => {
      theme.value.customThemes = theme.value.customThemes.filter(t => t.name !== name)
    },

    getCustomThemeByName: (name: ThemeName): Theme | undefined => {
      return theme.value.customThemes.find(t => t.name === name)
    },

    hasCustomTheme: (name: ThemeName): boolean => {
      return theme.value.customThemes.some(t => t.name === name)
    },

    reset: () => {
      theme.value = { ...defaultTheme }
    },
  }
}

export type { ThemeStore }
export { defaultTheme, useThemeStore }
