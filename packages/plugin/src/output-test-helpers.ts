import { vi } from 'vitest'
import {
  createPluginOutputBroker,
  type PluginOutputBrokerAdapter,
  type PluginOutputCaptureRequest,
  type PluginOutputSnapshot,
} from './output-broker'
export const outputManifest = {
  id: 'output-test',
  name: 'Output',
  version: '1.0.0',
  permissions: ['document:read', 'document:output'] as const,
}
export const outputRequest: PluginOutputCaptureRequest = {
  format: 'html',
  scope: 'document',
  resources: 'embed',
}
export const outputSnapshot: PluginOutputSnapshot = {
  id: 'snapshot-1',
  documentId: 'doc:1',
  version: 4,
  title: '中文 document',
  from: 0,
  to: 128,
  lineCount: 8,
  warnings: [],
}
export function outputAdapter() {
  let next = 0
  return {
    capture: vi.fn<PluginOutputBrokerAdapter['capture']>(async () => ({
      ...outputSnapshot,
      id: `snapshot-${++next}`,
    })),
    chooseTarget: vi.fn<PluginOutputBrokerAdapter['chooseTarget']>(async () => ({
      status: 'ready',
      id: `target-${++next}`,
      name: '中文.html',
    })),
    write: vi.fn<PluginOutputBrokerAdapter['write']>(async () => ({
      status: 'written',
      name: '中文.html',
      bytes: 123,
    })),
    print: vi.fn<PluginOutputBrokerAdapter['print']>(async () => ({ status: 'printed' })),
    release: vi.fn<PluginOutputBrokerAdapter['release']>(async () => {}),
  }
}
export function outputSetup() {
  let active = true
  const adapter = outputAdapter()
  const broker = createPluginOutputBroker({
    manifest: outputManifest,
    adapter,
    isActive: () => active,
    consumeGesture: (proof) => proof === 'trusted',
  })
  return {
    adapter,
    broker,
    revoke: () => {
      active = false
    },
  }
}
