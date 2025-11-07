import type { FontConfig, FontSizeConfig } from '@/types/font'
import { useStorage } from '@vueuse/core'
import { readonly, watch } from 'vue'

import { defaultFontConfig, defaultFontSizeConfig } from '@/config/fonts'
import { setNestedProperty } from '@/utils/tool'

interface AppConfig extends Record<string, any> {
  font: {
    family: FontConfig
    size: FontSizeConfig
  }
  other: {
    editorPadding: string
  }
}

const defaultConfig: AppConfig = {
  font: {
    family: defaultFontConfig,
    size: defaultFontSizeConfig,
  },
  other: {
    editorPadding: '120px',
  },
}

const config = useStorage<AppConfig>('milkup-config', defaultConfig, localStorage, {
  serializer: {
    read: (value: string) => {
      try {
        return { ...defaultConfig, ...JSON.parse(value) }
      } catch {
        return defaultConfig
      }
    },
    write: (value: AppConfig) => JSON.stringify(value),
  },
})

export function useConfig() {
  return {
    config,

    getConf: <K extends keyof AppConfig>(key: K) => readonly(config.value[key]),

    setConf: <K extends keyof AppConfig>(key: K, value: AppConfig[K] | string, pathValue?: any) => {
      if (typeof value === 'string' && pathValue !== undefined) {
        config.value = { ...config.value, [key]: setNestedProperty(config.value[key], value, pathValue) }
      } else {
        config.value = { ...config.value, [key]: value as AppConfig[K] }
      }
    },

    watchConf: <K extends keyof AppConfig>(key: K, callback: (value: AppConfig[K]) => void) => {
      return watch(() => config.value[key], callback, { deep: true })
    },

  }
}
