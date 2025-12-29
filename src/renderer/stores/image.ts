import type { ImageStore, PasteMethod } from './_types'
import { useStorage } from '@vueuse/core'
import { computed, readonly } from 'vue'
import { g } from './_utils'

const defaultImage: ImageStore = {
  pasteMethod: 'local',
  localPath: '/temp',
}

function useImageStore() {
  const image = useStorage<ImageStore>(g('image'), defaultImage, localStorage, {
    mergeDefaults: true,
  })

  const pasteMethod = computed(() => image.value.pasteMethod)
  const localPath = computed(() => image.value.localPath)

  function set<K extends keyof ImageStore>(key: K, value: ImageStore[K]) {
    image.value[key] = value
  }

  function get<K extends keyof ImageStore>(key: K) {
    return image.value[key]
  }

  return {
    image: readonly(image),

    pasteMethod,
    localPath,

    get,
    set,

    setPasteMethod: (value: PasteMethod) => set('pasteMethod', value),
    setLocalPath: (value: string) => set('localPath', value),

    reset: () => {
      image.value = { ...defaultImage }
    },
  }
}

export type { ImageStore }
export { defaultImage, useImageStore }
