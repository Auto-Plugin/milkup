import type { ConfigStore } from '../types'

import { useStorage } from '@vueuse/core'
import { computed, readonly } from 'vue'

import { defaultFontConfig, defaultFontSizeConfig } from '@/config/fonts'

import { g } from '../utils'

const defaultConfig: ConfigStore = {
  lang: 'zh-CN',
  spellcheck: false,
  font: {
    family: defaultFontConfig,
    size: defaultFontSizeConfig,
  },
  editor: {
    padding: '120px',
  },
}

function useConfigStore() {
  const config = useStorage<ConfigStore>(g('config'), defaultConfig, localStorage, {
    mergeDefaults: true,
  })

  const lang = computed(() => config.value.lang)
  const spellcheck = computed(() => config.value.spellcheck)
  const font = computed(() => config.value.font)
  const editor = computed(() => config.value.editor)

  function setConf<K extends keyof ConfigStore>(key: K, value: ConfigStore[K]) {
    config.value[key] = value
  }

  function getConf<K extends keyof ConfigStore>(key: K) {
    return config.value[key]
  }

  function setNestedConf<K extends keyof ConfigStore, NK extends keyof ConfigStore[K]>(
    key: K,
    nestedKey: NK,
    value: ConfigStore[K][NK],
  ) {
    const current = config.value[key]
    if (typeof current === 'object' && current !== null) {
      config.value[key] = { ...current, [nestedKey]: value }
    }
  }

  return {
    config: readonly(config),

    lang,
    spellcheck,
    font,
    editor,

    getConf,
    setConf,
    setNestedConf,

    getLang: () => getConf('lang'),
    setLang: (value: string) => setConf('lang', value),

    getSpellcheck: () => getConf('spellcheck'),
    setSpellcheck: (value: boolean) => setConf('spellcheck', value),

    getFont: () => getConf('font'),
    setFontFamily: (key: keyof ConfigStore['font']['family'], value: ConfigStore['font']['family'][typeof key]) => {
      const current = config.value.font.family
      config.value.font = {
        ...config.value.font,
        family: { ...current, [key]: value },
      }
    },
    setFontSize: (key: keyof ConfigStore['font']['size'], value: string) => {
      const current = config.value.font.size
      config.value.font = {
        ...config.value.font,
        size: { ...current, [key]: value },
      }
    },

    getEditor: () => getConf('editor'),
    setEditorPadding: (value: string) => setNestedConf('editor', 'padding', value),
  }
}

export type { ConfigStore }
export { defaultConfig, useConfigStore }
