import type { BodyType, RequestMethod, UploadStore } from './_types'
import { useStorage } from '@vueuse/core'
import { computed, readonly } from 'vue'
import { g } from './_utils'

const defaultUpload: UploadStore = {
  url: '',
  method: 'post',
  headers: {},
  bodyType: 'multipart/form-data',
  fileField: 'file',
  responseUrlPath: 'data.url',
  extraBody: {},
}

function useUploadStore() {
  const upload = useStorage<UploadStore>(g('upload'), defaultUpload, localStorage, {
    mergeDefaults: true,
  })

  const url = computed(() => upload.value.url)
  const method = computed(() => upload.value.method)
  const headers = computed(() => upload.value.headers)
  const bodyType = computed(() => upload.value.bodyType)
  const fileField = computed(() => upload.value.fileField)
  const extraBody = computed(() => upload.value.extraBody)
  const responseUrlPath = computed(() => upload.value.responseUrlPath)

  function set<K extends keyof UploadStore>(key: K, value: UploadStore[K]) {
    upload.value[key] = value
  }

  function get<K extends keyof UploadStore>(key: K) {
    return upload.value[key]
  }

  return {
    upload: readonly(upload),

    url,
    method,
    headers,
    bodyType,
    fileField,
    responseUrlPath,
    extraBody,

    get,
    set,

    setUrl: (value: string) => set('url', value),
    setMethod: (value: RequestMethod) => set('method', value),
    setHeaders: (value: Record<string, string>) => set('headers', value),
    setBodyType: (value: BodyType) => set('bodyType', value),
    setFileField: (value: string) => set('fileField', value),
    setResponseUrlPath: (value: string) => set('responseUrlPath', value),
    setExtraBody: (value: Record<string, unknown>) => set('extraBody', value),

    addHeader: (key: string, value: string) => {
      upload.value.headers = { ...upload.value.headers, [key]: value }
    },

    removeHeader: (key: string) => {
      const { [key]: _, ...rest } = upload.value.headers
      upload.value.headers = rest
    },

    reset: () => {
      upload.value = { ...defaultUpload }
    },
  }
}

export type { UploadStore }
export { defaultUpload, useUploadStore }
