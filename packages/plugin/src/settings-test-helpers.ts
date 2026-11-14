import { vi } from 'vitest'
import type { PluginManifest } from './manifest'
import type {
  PluginSettingsBrokerAdapter,
  PluginSettingsDescriptor,
  PluginSettingsSnapshot,
} from './settings-broker'
export const descriptor: PluginSettingsDescriptor = {
  schema: {
    size: { type: 'number', minimum: 12, maximum: 32, step: 1 },
    theme: { type: 'enum', options: ['system', 'light', 'dark'] },
    enabled: { type: 'boolean' },
  },
  defaults: { size: 14, theme: 'system', enabled: true },
}
export const snapshot: PluginSettingsSnapshot = {
  ...descriptor,
  values: descriptor.defaults,
  revision: 0,
}
export const manifest: PluginManifest = {
  id: 'settings-test',
  name: 'Settings',
  version: '1.0.0',
  permissions: ['settings:write'],
  settings: descriptor,
}
export function adapter() {
  let next = 0
  return {
    describe: vi.fn<PluginSettingsBrokerAdapter['describe']>(async () => descriptor),
    get: vi.fn<PluginSettingsBrokerAdapter['get']>(async () => snapshot),
    begin: vi.fn<PluginSettingsBrokerAdapter['begin']>(async () => ({
      id: `tx-${++next}`,
      snapshot,
    })),
    preview: vi.fn<PluginSettingsBrokerAdapter['preview']>(async (_id, patch) => ({
      ...snapshot,
      values: { ...snapshot.values, ...patch },
    })),
    commit: vi.fn<PluginSettingsBrokerAdapter['commit']>(async () => ({
      ...snapshot,
      revision: 1,
    })),
    cancel: vi.fn<PluginSettingsBrokerAdapter['cancel']>(async () => {}),
  }
}
export function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
export async function flush() {
  for (let i = 0; i < 20; i++) await Promise.resolve()
}

import type { PluginIsolationRpcMessageListener } from './isolation-rpc'
class Endpoint {
  peer!: Endpoint
  listeners = new Set<PluginIsolationRpcMessageListener>()
  sent: unknown[] = []
  postMessage(value: unknown) {
    this.sent.push(value)
    queueMicrotask(() => {
      for (const listener of this.peer.listeners) listener({ data: value })
    })
  }
  addEventListener(_type: 'message', listener: PluginIsolationRpcMessageListener) {
    this.listeners.add(listener)
  }
  removeEventListener(_type: 'message', listener: PluginIsolationRpcMessageListener) {
    this.listeners.delete(listener)
  }
}
export function pair() {
  const main = new Endpoint(),
    worker = new Endpoint()
  main.peer = worker
  worker.peer = main
  return { main, worker }
}
