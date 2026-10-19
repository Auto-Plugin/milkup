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

// SDK 0.3.6: pending is explicit; omitted fields preserve old renderer contracts.
import type { SdkDocumentPresentationResult } from '../src/index.js'
const pendingPresentation: SdkDocumentPresentationResult = {
  fragments: [],
  complete: false,
  pending: true,
}
const legacyPresentation: SdkDocumentPresentationResult = { fragments: [], complete: true }
const legacyIncomplete: SdkDocumentPresentationResult = { fragments: [], complete: false }
const invalidPending: SdkDocumentPresentationResult = {
  fragments: [],
  complete: false,
  // @ts-expect-error Omit pending instead of returning false.
  pending: false,
}
const stringPending: SdkDocumentPresentationResult = {
  fragments: [],
  complete: false,
  // @ts-expect-error The pending marker is literal true, not a string.
  pending: 'true',
}
void [pendingPresentation, legacyPresentation, legacyIncomplete, invalidPending, stringPending]

// SDK 0.3.5: output requests contain options and opaque leases, never paths or HTML.
import type { SdkPluginOutputHost, SdkOutputSnapshot } from '../src/index.js'
async function outputContract(host: SdkPluginOutputHost) {
  const controller = new AbortController()
  const snapshot: SdkOutputSnapshot = await host.capture(
    {
      format: 'html',
      scope: 'selection',
      resources: 'embed',
      pageSize: 'a4',
      landscape: false,
    },
    { signal: controller.signal },
  )
  const target = await host.chooseTarget({ snapshotId: snapshot.id })
  if (target.status === 'ready') {
    const result = await host.write(target.id)
    const status: 'written' = result.status
    void status
  }
  await host.release(snapshot.id)
  const printable = await host.capture({ format: 'print', scope: 'document', resources: 'omit' })
  await host.print(printable.id)
  // @ts-expect-error Output cannot request arbitrary paths.
  await host.chooseTarget({ snapshotId: snapshot.id, path: '/tmp/private.md' })
  // @ts-expect-error Plugins cannot supply raw HTML or executable renderer output.
  await host.write({ html: '<script/>', targetId: 'fake' })
  await host.capture(
    { format: 'html', scope: 'document', resources: 'embed' },
    // @ts-expect-error A command gesture is internal metadata, not a public option.
    { gesture: 'forged' },
  )
  // @ts-expect-error Snapshot metadata does not reveal document text.
  void snapshot.text
  // @ts-expect-error Targets never expose native paths.
  if (target.status === 'ready') void target.path
}
void outputContract

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

// 0.3.3 adds a separate inert document contract without changing UI renderers.
import type { SdkDocumentRenderer, SdkDocumentPresentationNode } from '../src/index.js'
const documentRenderer: SdkDocumentRenderer = async (request, { signal }) => {
  if (signal.aborted) return { fragments: [], complete: false }
  return {
    fragments: [
      {
        from: request.from,
        to: request.to,
        layout: 'inline',
        content: { type: 'text', text: request.source },
        accessibleText: request.source,
      },
    ],
    complete: true,
  }
}
definePlugin({
  documentRenderers: { example: documentRenderer },
  renderers: { legacy: () => ({ type: 'element', tag: 'span', text: 'Still compatible' }) },
})
// @ts-expect-error Raw HTML is deliberately not a document semantic node.
const unsafePresentation: SdkDocumentPresentationNode = { type: 'html', html: '<script/>' }
void unsafePresentation

// SDK 0.3.4 closed image contract.
import type {
  SdkDocumentPresentationNode as ImagePresentationNode,
  SdkDocumentRenderer as ImageRenderer,
} from '../src/index.js'

const svgImage: ImagePresentationNode = {
  type: 'svg-image',
  profile: 'bounded-svg-v1',
  motion: 'static',
  width: 160,
  height: 96,
  rasterBounds: [0, 0, 160, 96],
  viewBox: [0, 0, 160, 96],
  aspect: { align: 'xMidYMid', fit: 'meet' },
  styles: [{ shapeRendering: 'crispEdges', fill: { kind: 'color', rgba: [40, 60, 80, 1] } }],
  definitions: [],
  children: [{ kind: 'rect', style: 0, x: 4, y: 8, width: 80, height: 40 }],
}
const svgImageRenderer: ImageRenderer = (request) => ({
  complete: true,
  fragments: [
    {
      from: request.from,
      to: request.to,
      layout: 'block',
      content: svgImage,
      accessibleText: 'Example diagram',
    },
  ],
})
void svgImageRenderer

type ImageNode = Extract<ImagePresentationNode, { readonly type: 'svg-image' }>
declare const readonlyImage: ImageNode
const { rasterBounds: explicitRasterBounds, ...withoutRasterBounds } = readonlyImage
// @ts-expect-error Every closed image explicitly declares its raster region.
const implicitRasterImage: ImageNode = withoutRasterBounds
// @ts-expect-error Region coordinates are immutable presentation data.
readonlyImage.rasterBounds[0] = 1
void [explicitRasterBounds, implicitRasterImage]
// @ts-expect-error Image profile is immutable data, not an edit handle.
readonlyImage.width = 2
// @ts-expect-error Plugins cannot provide an image URL or live object URL.
const withURL: ImageNode = { ...readonlyImage, url: 'https://example.invalid/image.svg' }
// @ts-expect-error Raw markup is not a renderer capability.
const withMarkup: ImageNode = { ...readonlyImage, rawSvg: '<svg/>' }
const withCSS: ImageNode = {
  ...readonlyImage,
  // @ts-expect-error Free-form CSS is not a style-table member.
  styles: [{ cssText: 'fill:url(https://example.invalid)' }],
}
const withEvent: ImageNode = {
  ...readonlyImage,
  // @ts-expect-error No event attributes or handlers in typed geometry.
  children: [{ kind: 'rect', x: 0, y: 0, width: 20, height: 20, onload: 'x' }],
}
void [withURL, withMarkup, withCSS, withEvent]

const unresolvedFilter: import('../src/index.js').SdkDocumentSvgFilterValue = {
  kind: 'unresolved-local',
}
const arbitraryFilter: import('../src/index.js').SdkDocumentSvgFilterValue = {
  kind: 'unresolved-local',
  // @ts-expect-error Unresolved local filter carries no producer-controlled reference.
  ref: 'https://example.invalid',
}
void [unresolvedFilter, arbitraryFilter]
