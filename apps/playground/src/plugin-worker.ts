import { initializePluginWorkerRealm, type PluginWorkerEndpoint } from '@milkup/plugin'

const PLAYGROUND_WORKER_PLUGIN_MODULE = 'milkup://playground/worker-demo-plugin'

initializePluginWorkerRealm(globalThis as unknown as PluginWorkerEndpoint, {
  importModule: async (moduleSpecifier) => {
    if (moduleSpecifier !== PLAYGROUND_WORKER_PLUGIN_MODULE) {
      throw new Error(`Unknown playground worker plugin module: ${moduleSpecifier}`)
    }

    return import('./worker-demo-plugin')
  },
})
