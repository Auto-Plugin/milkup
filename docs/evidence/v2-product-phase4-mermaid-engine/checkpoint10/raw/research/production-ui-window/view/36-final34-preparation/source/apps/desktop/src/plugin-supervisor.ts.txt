import { initializePluginWorkerSupervisor, type PluginWorkerEndpoint } from '@milkup/plugin'

// This entry imports no plugin module. Only its child enters the plugin realm.
initializePluginWorkerSupervisor(
  globalThis as unknown as PluginWorkerEndpoint,
  () =>
    new Worker(new URL('./plugin-worker.ts', import.meta.url), {
      type: 'module',
      name: 'milkup-plugin-renderer',
    }),
)
