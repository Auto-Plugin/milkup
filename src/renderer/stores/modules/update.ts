import type { UpdateInfo, UpdateStore } from '../types'
import { useStorage } from '@vueuse/core'
import { computed, readonly } from 'vue'
import { g } from '../utils'

const defaultUpdate: UpdateStore = {
  info: null,
  ignoredVersion: '',
}

function useUpdateStore() {
  const update = useStorage<UpdateStore>(g('update'), defaultUpdate, localStorage, {
    mergeDefaults: true,
  })

  const info = computed(() => update.value.info)
  const ignoredVersion = computed(() => update.value.ignoredVersion)

  const hasUpdate = computed(() => update.value.info !== null)

  const isCurrentUpdateIgnored = computed(() => {
    if (!update.value.info)
      return false
    return update.value.info.version === update.value.ignoredVersion
  })

  function set<K extends keyof UpdateStore>(key: K, value: UpdateStore[K]) {
    update.value[key] = value
  }

  function get<K extends keyof UpdateStore>(key: K) {
    return update.value[key]
  }

  return {
    update: readonly(update),

    info,
    ignoredVersion,
    hasUpdate,
    isCurrentUpdateIgnored,

    get,
    set,

    getInfo: () => get('info'),
    setInfo: (value: UpdateInfo | null) => set('info', value),
    clearInfo: () => set('info', null),

    getIgnoredVersion: () => get('ignoredVersion'),
    setIgnoredVersion: (value: string) => set('ignoredVersion', value),
    clearIgnoredVersion: () => set('ignoredVersion', ''),

    ignoreCurrentUpdate: () => {
      if (update.value.info) {
        update.value.ignoredVersion = update.value.info.version
      }
    },

    isVersionIgnored: (version: string): boolean => {
      return update.value.ignoredVersion === version
    },

    reset: () => {
      update.value = { ...defaultUpdate }
    },
  }
}

export type { UpdateStore }
export { defaultUpdate, useUpdateStore }
