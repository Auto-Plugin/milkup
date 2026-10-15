# Milkup plugin SDK 0.2

This is the public, dependency-free ESM API for local Milkup plugins. It contains
JavaScript helpers and TypeScript declarations; importing it never imports the
editor, desktop application, DOM renderer, or a private registry. The package is
private to prevent accidental registry publication. A local `.tgz` is the supported
distribution for this development stage; no npm publication is required.

## Build a plugin outside the host repository

```sh
# In the Milkup checkout; creates a reusable SDK package, not an npm publication.
pnpm --dir packages/plugin-sdk pack --pack-destination /absolute/sdk-output

# In a separately copied plugin directory containing its own package.json.
npm install --no-save --package-lock=false /absolute/sdk-output/milkup-plugin-sdk-0.3.1.tgz
npm run build
```

The outline example has its own manifest, tsconfig and build script. Its build
produces `dist/plugin.js` and `dist/milkup.outline-1.1.0.milkup-plugin`. Install that
archive through Milkup's local plugin manager, then explicitly enable it. Disabling
and uninstalling go through the same manager. No host source registration is used.

## Module and lifecycle

```ts
import { definePlugin, type SdkDocumentScanner } from '@milkup/plugin-sdk'

let scanner: SdkDocumentScanner | undefined
export default definePlugin({
  activate(context) {
    // Capabilities can be absent; request and check only what the plugin needs.
    if (!context.host.document) throw new Error('document:read is required')
    return {
      async dispose() {
        await scanner?.cancel()
      },
    }
  },
  renderers: {
    panel(context) {
      if (context.node?.phase === 'dispose') return ''
      return { type: 'element', tag: 'span', text: 'Hello' }
    },
  },
})
```

`definePlugin` is an identity helper with a `SdkPluginModule` type constraint. It
does not register or execute the module. Export it as the entry's default export.
The host calls `activate(SdkPluginActivationContext)` on enable; it can return
command/renderer maps and an async `dispose`. The module can also expose maps
directly and a `deactivate` hook. Hook cleanup must be idempotent: stop timers,
cancel scans and invalidate pending asynchronous results. Do not rely on an async
task finishing after disable/uninstall; the host terminates the Worker.

Commands and UI views must be declared in `plugin.json`. A controlled UI action
references a declared command; it cannot invoke arbitrary host functions. Command
inputs are untrusted data and must be checked by the handler. The insertion helpers
(`cursor`, `insertText`, `dispatchInsert`, etc.) create structural edit values for
contexts with an editor capability; a read-only plugin should not require one.

## UI snapshots

`SdkPluginRendererContext.node` is a `SdkPluginUiNode`, not a host model or DOM node:

| Field               | Contract                                                            |
| ------------------- | ------------------------------------------------------------------- |
| `phase`             | `mount`, `update`, `focus`, `blur`, or `dispose`                    |
| `documentId`        | Opaque identity; do not interpret it as a filesystem path           |
| `documentVersion`   | Revision for invalidating stale asynchronous results                |
| `documentLineCount` | Logical line count, at least one for an empty document              |
| `viewMode`          | `source` or `live`; document coordinates are unchanged by rendering |
| `viewport`          | One-based inclusive `fromLine`/`toLine`, and caret `activeLine`     |
| `virtualViewport`   | Requested list slice and optional user edge request                 |

Fields are optional: `dispose` can carry only identity and phase, and older hosts
may not provide newer snapshot fields. Lifecycle and viewport updates are
coalesced, not a per-keystroke event log. Reconcile the newest identity/version,
cancel obsolete scans, and ignore late results. A `document`-scoped view disposes
and remounts when documents switch. `host.ui.requestUpdate(viewId?)` requests another
render; batch requests rather than scheduling an update for each heading.
`host.ui.revealLine(line)` navigates to a one-based logical line without editing it.

Virtual list requests use zero-based indices and an exclusive `toIndex`.
`userInitiated`, `edge` (`before`/`after`) and monotonically increasing `requestId`
are optional. Treat a repeated request ID as the same edge request. The host
controls DOM virtualization; the plugin controls its bounded result cache.

## Controlled UI

Return `SdkRendererOutput`: text, a number, a boolean, or a tree of elements tagged
`span`, `strong`, `em`, `code`, `a`, or `button`. Text is rendered as text, not HTML.
There are no HTML injection, script, event-handler, arbitrary stylesheet or direct
DOM capabilities. `text` takes precedence over `children` when both are supplied.
An element's `action: { command, input? }` routes through the contribution registry.

Supported attributes are `class`, `title`, `href`, accessibility attributes exposed
by `SdkRendererAttribute`, `data-host-icon`, and the virtual list attributes below.
Links accept only `http:`, `https:`, `mailto:`, or fragment targets. Unrecognized
tags and attributes fail rendering rather than being passed through.

Shared presentation classes are a public host style vocabulary, not selectors a
plugin may use to inspect the DOM: `plugin-list-panel`, `plugin-list-item`,
`plugin-list-level-1` through `plugin-list-level-6`, `is-active`,
`plugin-list-progress` (loading icon), `plugin-list-summary` (range/status text),
`plugin-virtual-list`, `plugin-ui-state`,
`plugin-ui-state-empty`, `plugin-ui-state-error`, `plugin-ui-state-loading`,
`plugin-ui-state-icon`, `plugin-ui-state-message`, and `plugin-ui-loading-icon`.
Tree views can use `plugin-tree-row`, `plugin-tree-toggle`, and
`plugin-tree-toolbar`, with the same level and active classes.
The host owns their theme/zoom adaptation. `data-host-icon` accepts the documented
host icons `list-tree`, `circle-alert`, `loader-circle`, `chevron-right`, and
`chevron-down`.

A virtual list declares `data-virtual-list` (plugin-local ID), `data-virtual-total`,
`data-virtual-start`, `data-virtual-end`, `data-virtual-item-height`, and
`data-virtual-active` (or `-1`). Optional `data-virtual-follow-active`,
`data-virtual-has-before`, and `data-virtual-has-after` use string booleans.
`data-virtual-scroll-adjust` is a pixel delta applied once for a changed
`data-virtual-revision`. Indices refer to the currently buffered items, not the
entire document. Keep row height consistent with the declared item height.

## Document scans and bounds

`host.document.scan(request)` yields `SdkDocumentScanEvent` batches, progress, and
a terminal `done`. Each event identifies its document and version. A scan ends
with `complete`, `cancelled`, `invalidated`, or `truncated`; only `complete` means
the requested range was fully scanned. Cancellation is asynchronous and idempotent.
Check the identity/version even after cancellation because a result can already
be in transit. Offsets are UTF-16 code units; line numbers are one-based.

Queries are literal text, supported regular expressions, or `markdownHeadings`.
Host bounds include 256 results per batch, 4,096 requested window lines, 50,000
results per scan and 4,096 code units per returned label/text. Long labels carry
`labelTruncated`; a plugin must not assume a label is the complete source line.
Use `fromLine`/`toLine` and bounded buffers. Avoid joining or retaining all document
text, unbounded result arrays, or rescan loops when a document is changing.
The host reads at most 262,144 UTF-16 code units and 128 logical lines per adaptive
read. A single line exceeding that budget fails explicitly; it does not silently
skip content. A heading scan starting in the middle of a document may first read
earlier chunks to establish fenced-code context. Up to 256 fence checkpoints are
cached per document/version; a distant first scan has no fixed 200 ms guarantee.

## Capability and trust boundary

### Temporary paged indexes (SDK 0.1.1)

`host.storage.createTemporaryStore()` creates a disposable, plugin-activation-owned
key/value store. It is optional in the type contract for older hosts; a plugin that
requires it must declare `engines.pluginSdk: "^0.1.1"` and check the capability.
The returned `SdkTemporaryStore` exposes `get(key)`, `set(key, value)`,
`getMany(keys)`, `setMany([{ key, value }])`, and idempotent async `dispose()`.
`getMany` returns values in key order, with `null` for missing keys; `setMany` is
atomic. Keys contain 1–128 ASCII letters, digits, dots, underscores or hyphens.
Duplicate keys in a batch are rejected. No file paths or arbitrary storage IDs
cross this API.

Each call accepts at most 32 keys/entries and at most 256 KiB of UTF-8 value data
in total. An oversized `getMany` fails explicitly: split the batch rather than
assuming every page fits together. There are at most 16 in-flight storage RPCs,
four active/creating stores per plugin activation and 32 stores in the shared
temporary database. Per-store charged space is capped at 256 MiB; global charged
space at 512 MiB and 131,072 pages. Charges include UTF-8 values, ASCII keys and
1 KiB overhead per page/store. These are application accounting limits, not an
exact browser database file-size promise; the engine can add its own overhead.
Database quota failures are surfaced; there is no fallback to full in-memory or
localStorage copies.

The desktop adapter persists pages in a separate IndexedDB database, using one
transaction for pages and their quota counters. It keeps no all-page in-memory
index. Replacing a page adjusts its charge; a failed batch rolls back both data
and accounting. Two plugin activations or application instances never share store
handles, even when their plugin IDs match. Normal disable/uninstall and awaited
application close dispose the owning stores. Disposal seals the handle before
deleting its pages; late reads/writes reject and cannot recreate it.

These values are rebuildable indexes, **not recovery copies or durable plugin
settings**. After a crash the new session cannot safely decide whether an unknown
owner is dead or another live instance. Such stores remain isolated and count
against the shared quota; they are never cleared by a timeout, another plugin, or
a new application instance. Repeated interruptions can therefore exhaust the
budget and indexing will fail explicitly until those temporary indexes are
separately cleared with confirmed ownership. This release adds no automatic
orphan sweep or long-term storage-management UI. Ordinary documents and recovery
data are never touched by temporary-store disposal.

The standard outline requests only `document:read`; navigation and controlled UI
are host-mediated. It needs no filesystem, network, storage or edit permissions.
The host brokers declared capabilities and terminates disabled plugin Workers.
Worker separation keeps plugin code away from the editor's DOM and synchronous
editor execution, but it is **not a security sandbox against malicious JavaScript**:
ordinary Worker globals are not a complete OS/network capability firewall. Install
only locally reviewed, trusted plugins. This release neither loads untrusted third
party code nor grants new credentials, persistent permissions, or security bypasses.

Compatibility is explicit in `engines.pluginSdk` and `engines.milkup`; this SDK's
local version is `0.3.1`. Adding optional snapshot fields is compatible; removing
or changing their meaning requires a new compatibility contract.

## Managed application releases (SDK 0.2.0)

Declare `permissions: ["app:updates"]` and an explicitly tested SDK range, such as
`engines.pluginSdk: ">=0.2.0 <0.4.0"`, in the
manifest. `host.releases` is optional and absent without both approval and a host
provider. Retain it from activation only for that activation's lifetime.

- `check()` returns `{ configured, channel, currentVersion, release? }`; `release`
  contains only `{ id, version, notes, date }`, with a nullable date.
- `stage(release.id)` starts background download and signature verification.
- `status(release.id)` returns `{ phase, received, total, error? }`; phases are
  `available`, `downloading`, `verifying`, `ready` and `error`; total may be null.
- `cancel(release.id)` asks the host to cancel staging.
- `requestInstall(release.id)` opens mandatory trusted host confirmation and
  dirty-document handling, then returns `{ status: "cancelled" | "installing" }`.
  Cancellation never installs. Plugins cannot supply confirmation, save decisions,
  an executable, installer arguments, URLs, paths, payload bytes or signing keys.

IDs are opaque, scoped to the broker activation, and must have been returned by
`check()`; never construct them from versions or interpret them as paths. The
host owns release configuration, trusted keys, signature checks, staging and the
install gate. A successful `stage()` means staging started, not that the release
is ready. Poll `status()` at a bounded cadence and stop timers in `dispose()`.

Install confirmation may remain open longer than command execution. Start the
asynchronous request from a user command, return promptly, and update the UI when
it settles. Release RPCs normally time out after 30 seconds; install requests have
a ten-minute bound. The trusted host must expire the confirmation within that
bound and cancel pending confirmation/staging when its broker is disposed.
Permission revocation, disable and Worker disposal invalidate captured methods
and pending RPCs. Re-enabling creates a fresh capability; old handles stay invalid.

## Scoped workspaces (SDK 0.3.0)

Declare `workspace:read` and `engines.pluginSdk: "^0.3.0"`. This sensitive permission
requires explicit approval. It provides metadata for a user-selected directory and
protected document opening; it does not grant arbitrary filesystem reads or writes.

Activation `host.workspace` exposes `listChildren`, `resolveEntry`, `refreshRoot`
and `releaseRoot`. Only a command's `context.host?.workspace` exposes `chooseRoot`
and `requestOpen`. Those methods require a genuine host-routed click or key command:
a one-use internal authorization expires after five seconds if unused. Start the
operation promptly and update UI asynchronously; do not hold a command open while
waiting for a directory picker or dirty-document confirmation. The host performs
all saving, conflict and recovery checks. Cancellation never discards a draft.

`chooseRoot({signal})` returns `{id,key,label}` or `null` if dismissed. `id` is an
activation-local grant. `key` is only a stable metadata partition key and cannot
restore access. A successful new selection replaces the old root.

`listChildren(rootId,{directoryId?,cursor?,limit?,signal?})` returns `{entries,
nextCursor}`. Entries contain `{id,name,kind,relativePath}` with kind `file` or
`directory`. Omit directoryId to list the root. Limit is 1–200 (default 100).
Omitting cursor restarts the directory enumeration and invalidates its previous
cursors. `refreshRoot(rootId,{signal})` returns a fresh grant and invalidates all
old file, directory and cursor IDs. Directory changes can also invalidate cursors;
restart rather than treating invalidation as an empty directory.

The plugin owns recent-file UI and persistence. Store bounded relative paths under
`root.key` with `host.storage`, only after `requestOpen(fileId)` reports `opened`.
After a restart or re-enable, the user must select the root again. Call
`resolveEntry(newRoot.id, relativePath,{signal})` to obtain a new entry token;
missing entries return null. Relative paths use `/`, are never URL-decoded, and
must have no absolute/drive/UNC prefix, backslashes, empty/dot/parent components,
control characters or trailing dots/spaces. Maximum length is 4096 characters and
maximum depth is 64 components. The native host additionally enforces containment,
rejects links/reparse points and rechecks identity before protected opening.

Abort a view's outstanding operations when closing it. Cancellation, timeout,
disablement, permission revocation, uninstall and root release invalidate pending
work; late replies cannot publish grants or switch documents. No AbortSignal is
sent over RPC: the host receives a dedicated cancellation message. `releaseRoot`
relinquishes the grant without changing the active document or recovery records.
Workspace failures have a safe `code` (`revoked`, `invalid-token`, `invalid-path`,
`invalidated`, `gesture-required`, `quota`, `busy`, `aborted`, `unavailable`); native
absolute paths and internal errors are not exposed. Host dialogs have bounded
waiting time, and their cancellation does not authorize a later operation.

UI lifecycle snapshots may include `node.visible`: `false` means the controlled
view is collapsed or not visible. Missing means visible for compatibility. Cancel
outstanding enumeration when hidden, then request fresh data when visible again.

The engine-range grammar supports full-version exact, caret, minimum (`>=`), `*`,
and an explicit bounded interval `>=FULL_VERSION <FULL_VERSION`. For example,
`>=0.2.0 <0.4.0` accepts SDK 0.2 and 0.3 releases and rejects 0.4. This uses ordinary
SemVer rules, including prerelease opt-in; OR expressions, partial versions and
combined wildcard expressions are unsupported. Expand a plugin's declared range
only after testing it against the added SDK version.

## Settings transactions (SDK 0.3.1)

`host.settings` is optional and requires the explicit `settings:write` permission.
It exposes only schema-defined scalar settings, with no filesystem or network
capability. `describe(scope)` returns `{ schema, defaults }`; `get(scope)` returns
`{ revision, schema, defaults, values }`. The scope is either `application` or
`plugin`. A plugin cannot supply another plugin ID. Its own scope is enabled by
its manifest's `settings: { schema, defaults }` declaration and stored separately
by the trusted host.

Fields are `boolean`, `enum` with string/number `options`, or `number` with
`minimum`, `maximum`, optional positive `step` and optional `allowZero`.
Descriptors contain 1–64 fields. Values are flat strings (up to 256 characters),
finite numbers or booleans; patch keys must exist in the schema. Unknown keys,
nested values, unknown schema properties and prototype keys are rejected.

```ts
const settings = context.host.settings
if (settings) {
  const draft = await settings.begin('application')
  try {
    await settings.preview(draft.id, { 'editor.fontSize': 16 })
    // Render the preview, then commit only after the user's Save command.
    // await settings.commit(draft.id)
  } finally {
    // Cancel/close restores the committed values. Reset previews draft.snapshot.defaults.
    await settings.cancel(draft.id)
  }
}
```

The application scope permits one active transaction across all plugins. Each
plugin scope permits one transaction for that plugin. Transaction IDs belong to
the issuing activation; forged, foreign, committed or cancelled IDs cannot edit
settings. A preview updates effective values but does not persist. A successful
commit consumes its ID and advances the revision; a failed commit remains
retryable. Cancel is idempotent for a recently issued, already closed ID. Cancel,
plugin disable/unload and permission revocation roll back active previews.
Every method accepts an optional final `{ signal?: AbortSignal }`. Cancelling an
in-flight preview rolls back its transaction; late begin replies are cancelled.
The host rechecks cancellation before durable commit. Once a commit has completed,
its saved values remain when the optional preferences plugin is disabled.

Application keys are `editor.fontFamily` (`system`, `serif`, `monospace`; default
`monospace`), `editor.fontSize` (12–32; default 14), `editor.lineWidth` (480–1200 or
0 for adaptive width; default 0), `editor.lineHeight` (1.2–2.4; default 1.5),
`editor.indentSize` (2 or 4), `editor.indentStyle` (`spaces` or `tabs`),
`appearance.theme` (`system`, `light`, `dark`) and `appearance.zoom`
(1, 1.25, 1.5 or 2). Read actual defaults and constraints from `describe()`.
Errors expose a bounded `code`: `revoked`, `invalid-scope`, `invalid-transaction`,
`invalid-input`, `busy`, `conflict`, `aborted` or `unavailable`. They do not expose
native storage locations or diagnostics.

## Controlled fields and shortcuts (SDK 0.3.1)

A renderer can return `{ type: 'field', key, kind, label, value, onChange }`.
`kind` is `text`, `number` or `select`; `value` is always a string so empty or
invalid drafts remain editable. `onChange: { command }` invokes the command with
`{ field: key, value: string }`. Optional metadata includes select `options`,
`disabled`, `invalid`, `help`, `placeholder`, `min`, `max` and `step`.
The host supplies the native control and enforces bounds. There is no plugin HTML,
CSS, inline script or arbitrary attribute access. Native input/change events do
not grant workspace picker/open authority. A controlled `element` button can set
`disabled: true`; other element tags cannot use this property.

`host.keymap` is optional and requires `app:keymap`. `snapshot()` returns a
revision, registered command metadata and fixed shortcuts. A command describes
its `defaultKeys`, current `keys`, `available` and `bindable` flags; optional
`input` explains required parameters that prevent safe rebinding. To save, call
`update({ revision, bindings: [{ command, keys }] })`; `reset({ revision })`
restores defaults. Both return the new snapshot. The trusted host rejects stale
revisions, conflicts, reserved keys and unsupported chords before persistence.
Each method accepts a final `{ signal?: AbortSignal }`. The host does not expose
arbitrary action execution through this capability.

SDK 0.3.1 is additive: existing 0.3.0 optional capabilities, event shapes and
method signatures are unchanged. Existing manifests retain their declared engine
ranges and approvals; upgrading the SDK does not enable plugins or expand their
permissions automatically.

## Bounded editing and images (SDK 0.3.2)

`host.editing` requires both `document:read` and `document:write`. Capture a
selection or complete lines with `capture({ extent: 'selection' | 'lines',
beforeLines?, afterLines? })`. A snapshot contains at most 65,536 UTF-16 code
units and 256 lines; oversized requests fail with `too-large`, never a truncated
editable result. Up to eight snapshots may be held per activation. Release
unused snapshots with `release(id)`.

Snapshot `from`/`to` are absolute document offsets; `selection.anchor/head`,
syntax node ranges, and all `apply()` change offsets are relative to snapshot
text. Result selection offsets are relative to the changed snapshot text.
Direction is preserved. Optional `context`, bounded `syntax.nodes`, and `table`
metadata describe host-verified context; unknown or incomplete context must not
be treated as proof of safe Markdown structure. There is no arbitrary CST data.

Call `apply({ snapshotId, changes, selection?, assetIds? })` with at most 64 sorted,
non-overlapping changes and at most 65,536 inserted UTF-16 units. The host checks
session, text version, editor selection revision, save-location generation,
read-only state and activation again immediately before one atomic history
transaction. `table({ snapshotId, operation, ... })` exposes only bounded table
primitives: insert, add/delete row or column, align, clear/set/select cell,
select table and exit. `insert-table.rows` counts body rows, excluding the header
(1–64 rows, 1–16 columns). Both successful operations consume their snapshot.
`UiNode.selectionRevision` changes when the real editor selection changes;
focus moving into plugin UI alone does not move the editor selection.
`UiNode.documentEditable` reflects the current read-only/busy/save/composition
gate so a plugin can retry a bounded capture when editing becomes available.

`host.resources` additionally requires `images:import`; it never grants arbitrary
filesystem, network or clipboard access. A genuine command click/keydown can call
`prepareDocument()`. A declared `contributes.pasteHandlers: [{ kind: 'image',
command: 'your.imagePaste' }]` instead receives `{ grantId }` from the trusted
paste route and calls `prepareDocument({ pasteId: grantId })`. The host binds that
single-use grant to the original document and selection. Synthetic events and
invented IDs cannot authorize import. Conflicting image paste contributions are
shadowed after the first active, valid handler.

Preparation returns `{ status: 'cancelled' }` or `{ status: 'ready', id }`; an
unnamed document first passes through ordinary Save As. Only then capture the
editing selection. Call `choose(intentId)` for an opaque image source, then
`stage({ sourceId, snapshotId, strategy: 'assets' | 'document-assets' })`. The host
derives either `assets/` or `<document>.assets/`; the plugin cannot choose a path.
Only PNG, JPEG and WebP are supported, bounded to 16 MiB, dimensions 16,384 and
40 million pixels. A staged asset has an opaque `id` and relative `reference`.
Insert the Markdown reference using `editing.apply(..., assetIds: [asset.id])`.
The host atomically validates/adopts the files with the edit. Accepted images
belong to the document and remain after plugin disable or undo. `abort(id)`
cleans unaccepted grants; it never deletes an accepted asset.

Every editing/resource method accepts a final `{ signal?: AbortSignal }`.
Disable, revocation and disposal cancel pending work and clean unaccepted grants;
late responses cannot revive handles. Interactive resource RPCs have a bounded
five-minute timeout. Start long picker workflows asynchronously from a command
so the command itself does not occupy its shorter execution timeout. Failures
expose fixed error codes, not native paths or diagnostics.

`host.ui.open(viewId)` opens only the caller's declared modal and requires a
current trusted command. `host.ui.notify({ kind: 'info' | 'error', message })`
reports bounded plain text (1,000 characters, rate limited); it does not accept
HTML. `context-menu` is a controlled document UI contribution slot. None of
these additions changes existing manifest engine ranges, approvals or enabled
state; SDK 0.3.2 remains compatible with previously installed 0.3.x packages.
