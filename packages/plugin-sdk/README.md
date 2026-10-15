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
npm install --no-save --package-lock=false /absolute/sdk-output/milkup-plugin-sdk-0.2.0.tgz
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
local version is `0.2.0`. Adding optional snapshot fields is compatible; removing
or changing their meaning requires a new compatibility contract.

## Managed application releases (SDK 0.2.0)

Declare `permissions: ["app:updates"]` and `engines.pluginSdk: "^0.2.0"` in the
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
