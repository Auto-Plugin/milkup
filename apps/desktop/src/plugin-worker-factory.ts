import workerUrl from './plugin-worker.ts?worker&url'
import supervisorUrl from './plugin-supervisor.ts?worker&url'
import { createCspWorker } from './csp-worker'

export function createDesktopPluginWorker(pluginId: string, supervised: boolean): Worker {
  return createCspWorker(
    new URL(supervised ? supervisorUrl : workerUrl, import.meta.url).href,
    `milkup-${supervised ? 'supervisor' : 'plugin'}-${pluginId}`,
  )
}
