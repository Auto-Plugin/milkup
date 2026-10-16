import { initializePluginWorkerRealm, type PluginWorkerEndpoint } from '@milkup/plugin'

const DESKTOP_WORKER_FILE_PLUGIN_MODULE = 'milkup://desktop/worker-file-plugin'

initializePluginWorkerRealm(globalThis as unknown as PluginWorkerEndpoint, {
  importModule: async (moduleSpecifier) => {
    if (moduleSpecifier !== DESKTOP_WORKER_FILE_PLUGIN_MODULE) {
      return import(/* @vite-ignore */ moduleSpecifier)
    }

    return import('./worker-file-plugin')
  },
})
