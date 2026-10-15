import {
  definePlugin,
  type SdkDocumentScanHeading,
  type SdkDocumentScanner,
  type SdkPluginModule,
  type SdkPluginRendererContext,
  type SdkRendererOutput,
} from '../src/index.js'

let scan: SdkDocumentScanner | undefined
const module: SdkPluginModule = definePlugin({
  activate(context) {
    scan = context.host.document?.scan({ query: { kind: 'markdownHeadings' } })
    return {
      async dispose() {
        await scan?.cancel()
      },
    }
  },
  renderers: {
    panel(context) {
      const node = context.node
      if (node?.phase === 'dispose') return ''
      const label = `${node?.documentId}:${node?.documentVersion}:${node?.viewMode}`
      return {
        type: 'element',
        tag: 'button',
        text: label,
        attributes: { role: 'treeitem', 'aria-level': '1', 'aria-expanded': 'false' },
        action: { command: 'example.toggle', input: { line: node?.viewport?.activeLine } },
      }
    },
  },
})
void module

async function headings(scanner: SdkDocumentScanner): Promise<SdkDocumentScanHeading[]> {
  const result: SdkDocumentScanHeading[] = []
  for await (const event of scanner) {
    if (event.type !== 'batch') continue
    for (const item of event.items) if (item.kind === 'heading') result.push(item)
  }
  return result
}
void headings

const dispose: SdkPluginRendererContext = { node: { phase: 'dispose', documentId: 'opaque' } }
void dispose

// @ts-expect-error Plugins cannot use arbitrary HTML tags.
const script: SdkRendererOutput = { type: 'element', tag: 'script', text: 'alert(1)' }
// @ts-expect-error Inline event attributes are not part of the public UI contract.
const handler: SdkRendererOutput = { type: 'element', tag: 'span', attributes: { onclick: 'x' } }
const style: SdkRendererOutput = {
  type: 'element',
  tag: 'span',
  // @ts-expect-error Inline styles are not a plugin UI capability.
  attributes: { style: 'color:red' },
}
void [script, handler, style]

import type {
  SdkPluginReleasesHost,
  SdkReleaseCheckResult,
  SdkReleaseInstallResult,
  SdkReleaseStatus,
} from '../src/index.js'

async function releasesContract(host: SdkPluginReleasesHost): Promise<void> {
  const result: SdkReleaseCheckResult = await host.check()
  if (!result.release) return
  await host.stage(result.release.id)
  const status: SdkReleaseStatus = await host.status(result.release.id)
  if (status.phase === 'ready') {
    const installed: SdkReleaseInstallResult = await host.requestInstall(result.release.id)
    const outcome: 'cancelled' | 'installing' = installed.status
    void outcome
  }
  await host.cancel(result.release.id)
  // @ts-expect-error Plugins cannot supply download URLs or payloads.
  await host.stage({ url: 'https://example.invalid/update', payload: [] })
  // @ts-expect-error Installation confirmation cannot be bypassed through options.
  await host.requestInstall(result.release.id, { confirmed: true })
  // @ts-expect-error Arbitrary execution is not a release capability.
  await host.execute('installer')
  // @ts-expect-error Release metadata contains no payload URL.
  void result.release.url
}
void releasesContract

import type {
  SdkPluginWorkspaceHost,
  SdkPluginWorkspaceReadHost,
  SdkWorkspaceRoot,
  SdkWorkspaceEntry,
  SdkWorkspacePage,
} from '../src/index.js'
async function workspaceContract(
  host: SdkPluginWorkspaceHost,
  activation: SdkPluginWorkspaceReadHost,
) {
  const controller = new AbortController()
  const root: SdkWorkspaceRoot | null = await host.chooseRoot({ signal: controller.signal })
  if (!root) return
  const page: SdkWorkspacePage = await activation.listChildren(root.id, {
    limit: 100,
    signal: controller.signal,
  })
  const resolved: SdkWorkspaceEntry | null = await activation.resolveEntry(
    root.id,
    'notes/readme.md',
  )
  if (resolved?.kind === 'file') await host.requestOpen(resolved.id)
  const fresh = await activation.refreshRoot(root.id)
  await activation.releaseRoot(fresh.id)
  // @ts-expect-error Activation cannot launch a picker.
  activation.chooseRoot()
  // @ts-expect-error Plugins cannot supply a gesture proof.
  host.chooseRoot({ gesture: 'forged' })
  // @ts-expect-error Opening requires an opaque ID, never a path object.
  host.requestOpen({ path: '/outside.md' })
  void page
}
void workspaceContract

// SDK 0.3.1 adds only optional capabilities and controlled field output.
import type {
  SdkPluginSettingsHost,
  SdkSettingsDescriptor,
  SdkRendererField,
} from '../src/index.js'
const settingsDescriptor: SdkSettingsDescriptor = {
  schema: { size: { type: 'number', minimum: 12, maximum: 32, step: 1 } },
  defaults: { size: 14 },
}
async function settingsContract(host: SdkPluginSettingsHost) {
  const schema = await host.describe('application')
  const tx = await host.begin('plugin')
  await host.preview(tx.id, schema.defaults)
  await host.commit(tx.id)
  await host.cancel(tx.id)
  // @ts-expect-error A plugin cannot request another plugin's settings namespace.
  await host.get('plugin:other')
  // @ts-expect-error Settings patches contain scalar values, not nested file/network requests.
  await host.preview(tx.id, { target: { path: '/private' } })
}
const field: SdkRendererField = {
  type: 'field',
  kind: 'number',
  key: 'size',
  label: 'Size',
  value: '',
  onChange: { command: 'settings.edit' },
  min: 12,
  max: 32,
}
void settingsDescriptor
void settingsContract
void field

import type { SdkPluginKeymapHost } from '../src/index.js'
async function keymapContract(host: SdkPluginKeymapHost) {
  const current = await host.snapshot()
  await host.update({
    revision: current.revision,
    bindings: [{ command: 'document.save', keys: ['Mod+S'] }],
  })
  await host.reset({ revision: current.revision })
  // @ts-expect-error Shortcut capability cannot execute commands.
  await host.execute('document.save')
  // @ts-expect-error Updates must carry an observed revision.
  await host.update({ bindings: [] })
}
void keymapContract

import type { SdkPluginEditingHost, SdkPluginResourcesHost, SdkPluginUiHost } from '../src/index.js'
async function editingResourcesContract(
  editing: SdkPluginEditingHost,
  resources: SdkPluginResourcesHost,
  ui: SdkPluginUiHost,
) {
  const target = await resources.prepareDocument()
  if (target.status === 'cancelled') return
  const snapshot = await editing.capture({ extent: 'selection' })
  const source = await resources.choose(target.id)
  if (!source) {
    await editing.release(snapshot.id)
    return
  }
  const asset = await resources.stage({
    sourceId: source.id,
    snapshotId: snapshot.id,
    strategy: 'assets',
  })
  await editing.apply({
    snapshotId: snapshot.id,
    changes: [{ from: 0, to: snapshot.text.length, insert: asset.reference }],
    assetIds: [asset.id],
  })
  await ui.notify({ kind: 'error', message: 'Import cancelled' })
  await ui.open('images.settings')
  await resources.stage({
    sourceId: source.id,
    snapshotId: snapshot.id,
    strategy: 'assets',
    // @ts-expect-error Resource paths are host-derived, never arbitrary plugin input.
    path: '/tmp/file',
  })
  // @ts-expect-error Plugins cannot pass privileged gesture proofs.
  await resources.prepareDocument({}, { gesture: 'forged' })
  // @ts-expect-error Table operations are a bounded allowlist, not arbitrary host commands.
  await editing.table({ snapshotId: snapshot.id, operation: 'execute' })
  // @ts-expect-error UI notifications do not accept HTML.
  await ui.notify({ kind: 'error', message: 'Error', html: '<script>' })
}
void editingResourcesContract
