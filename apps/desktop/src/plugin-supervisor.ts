import childUrl from './plugin-worker.ts?worker&url'
import { createCspWorker, assertPluginWorkerCsp } from './csp-worker'
import { initializePluginWorkerSupervisor, type PluginWorkerEndpoint } from '@milkup/plugin'

// This entry imports no plugin module. Only its child enters the plugin realm.
if (import.meta.env.PROD) assertPluginWorkerCsp()

initializePluginWorkerSupervisor(globalThis as unknown as PluginWorkerEndpoint, () =>
  createCspWorker(new URL(childUrl, import.meta.url).href, 'milkup-plugin-renderer'),
)
