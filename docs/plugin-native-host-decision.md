# Plugin Native Host Decision

> Status: accepted for M11 implementation planning.
> Scope: desktop/Tauri plugin execution, filesystem-capable plugins, and future sidecar support.

## Context

M11 already has:

- `PluginManifest` permissions and runtime allowlist checks.
- `PluginRuntime` registration into the shared `ActionRegistry`.
- `@milkup/plugin-sdk` as the public plugin authoring surface.
- `PluginIsolationHost`, `createIsolatedPluginModule`, Worker-style RPC, and an isolated module host.
- A real playground module Worker fixture proving plugin commands can run outside the main realm and still mutate the editor through transactions/history.

The remaining risk is native capability exposure. Browser Workers isolate JavaScript objects, but they do not provide enough control for desktop filesystem, process, shell, or native API access. Tauri native commands currently serve the app shell directly, and those commands must not become ambient plugin APIs.

## Decision

milkup v2 will use a tiered plugin host model:

1. Browser module Worker is the default plugin execution realm.
2. Filesystem and network access must go through host-provided broker APIs, never direct ambient APIs.
3. Tauri native code is the authority for local filesystem policy on desktop.
4. A native sidecar is optional and reserved for advanced plugins that need process-level isolation or long-running native workloads.
5. All plugin commands, regardless of host tier, still enter the product through `ActionRegistry` and document transactions.

The default desktop plugin path is therefore:

```text
Plugin module Worker
  -> PluginIsolationHost RPC
  -> PluginRuntime
  -> ActionRegistry
  -> Editor transaction/history

Plugin filesystem request
  -> Worker structural host capability
  -> frontend plugin file broker
  -> Tauri command
  -> native path policy
  -> filesystem
```

The sidecar path is not the default:

```text
Plugin package
  -> sidecar manifest approval
  -> sidecar process RPC
  -> same PluginIsolationHost protocol shape
  -> same ActionRegistry/document transaction path
```

## Host Tiers

| Tier                  | Use case                                                         | Allowed capabilities                                             | Default             |
| --------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------- |
| Same-realm dev module | tests, trusted dev fixtures, CLI smoke                           | no ambient native capability by default                          | no                  |
| Browser module Worker | normal JS plugins, renderers, commands, image upload providers   | document/view actions, brokered network/file only when permitted | yes                 |
| Tauri broker          | desktop filesystem and app-native resources                      | path-scoped file operations, asset storage, settings storage     | yes, as broker only |
| Native sidecar        | advanced local integrations, language servers, native converters | explicit IPC contract and explicit permission review             | no                  |

## Filesystem Policy

Filesystem-capable plugins must not call raw Tauri commands directly. They must receive a scoped host capability object. The broker must enforce:

- Permission check: manifest must declare `file:read`, `file:write`, or `file:delete`.
- Scope check: every path must resolve inside an approved root.
- Operation check: read/write/delete are separate permissions.
- Document check: document-local operations must be tied to the active `documentId` or a declared workspace root.
- Audit check: every filesystem operation should include plugin id, operation, resolved path, and outcome.

Recommended roots:

- Current document directory.
- Workspace root.
- Plugin data directory.
- Explicit user-selected path granted for this plugin session.
- Asset directory managed by `@milkup/assets`.

The broker must reject:

- Relative traversal escaping the granted root.
- Symlink escapes after canonicalization.
- Absolute paths without an explicit grant.
- Delete operations outside plugin-owned or user-confirmed scopes.
- Any app shell command, process spawn, or reveal/open call unless a future dedicated permission exists.

## Network Policy

Current Worker loader blocks common network globals when `network:access` is absent. This remains useful as a browser-level guard, but product policy should still prefer brokered network access for production plugins.

Network-capable plugins should receive `host.fetch` only when:

- Manifest declares `network:access`.
- Runtime allowlist permits it.
- Future user settings or plugin trust policy allow it.

Future hardening:

- Optional domain allowlist in manifest.
- Request audit log.
- Redaction policy for document content in outbound requests.
- Per-plugin rate/concurrency limits.

## Sidecar Policy

Do not introduce sidecar execution as the common plugin path.

Use a sidecar only when at least one is true:

- The plugin needs native dependencies or long-running CPU work.
- The plugin needs stronger process isolation than Worker can provide.
- The plugin integrates with external local tools through a stable IPC protocol.
- The plugin must run without access to the renderer process.

Sidecar requirements:

- Separate manifest field such as `host: "sidecar"` or a future contribution block.
- Explicit user approval during install/enable.
- No direct editor access.
- Same serialized transaction protocol for document edits.
- Same action permission model for GUI/CLI/MCP exposure.
- Kill/dispose lifecycle tied to plugin disable/unload.

Current implementation status:

- `PluginManifest.host` now accepts `worker` and `sidecar`; missing `host` defaults to the normal worker policy.
- `PluginRuntime` allows only `worker` by default and rejects `host: "sidecar"` during enable unless the embedding host passes an explicit `allowedHosts` policy.
- `loadLocalPlugin` also refuses to import sidecar-declared plugins through the ordinary JavaScript module loader unless the caller explicitly allows that host tier.
- `createSidecarPluginModule` defines the host-agnostic sidecar lifecycle contract: start an explicit sidecar endpoint, communicate over the existing `PluginIsolationHost` RPC protocol, commit document edits only through serialized transactions, and close/stop the sidecar on plugin disable.
- `apps/desktop` now has a Tauri-backed sidecar process adapter: the frontend endpoint sends JSON messages through dedicated Tauri commands, Rust starts an absolute-path stdio sidecar process, forwards stdout JSON lines as `milkup-plugin-sidecar-message` events, and stops/kills the process on disable.
- Native Tauri WebDriver smoke now starts a real stdio sidecar fixture from the running desktop app, executes a plugin command over the isolation RPC protocol, applies the returned serialized transaction through the editor, and verifies the sidecar process exits after plugin unload.
- Packaged sidecar distribution, user approval UI, and manual OS-level verification remain deferred.

## Implications For CLI And MCP

The host tier must not change the external action shape.

- CLI and MCP should see plugin actions generated from `ActionRegistry`.
- Plugin actions with file/network permissions must expose those permissions in metadata.
- Headless CLI can use a Node-side broker for workspace-scoped paths.
- Embedded desktop MCP must use the same Tauri broker as the GUI.
- Destructive filesystem actions must keep confirmation metadata.

## Implementation Plan

1. Add a host-agnostic plugin filesystem broker contract.
2. Add path scope validation and canonicalization tests.
3. Add a desktop adapter that maps broker calls to existing or new Tauri commands.
4. Route Worker plugin host file capabilities through the broker, not raw functions.
5. Add playground/package-level tests for denied read/write/delete without permission.
6. Add desktop mock tests for scoped read/write/delete.
7. Add manifest/runtime gates for advanced host declarations before any sidecar code is loaded.
8. Add a host-agnostic sidecar lifecycle/RPC adapter that reuses the existing isolation protocol.
9. Add a desktop/Tauri sidecar process adapter and native verification before claiming advanced plugin hard isolation.
10. Only after the broker exists, consider marking `Restrict filesystem/network access` complete at the baseline product level.

## Acceptance Criteria

Before filesystem-capable plugins are considered safe enough for M11:

- A plugin without `file:*` permission cannot receive file host capabilities.
- A plugin with only `file:read` cannot write or delete.
- A plugin with only `file:write` cannot read arbitrary files.
- A plugin with `file:delete` still requires destructive confirmation metadata.
- Paths are canonicalized before scope checks.
- Symlink and `..` escapes are rejected.
- Worker plugin commands still commit document edits only through transactions.
- CLI/MCP metadata shows plugin file/network permissions.
- Sidecar-hosted plugins cannot be enabled or imported through the default host path without explicit host-tier approval.
- Sidecar-hosted plugins communicate through the same serialized isolation RPC contract as Worker plugins.
- Desktop sidecar processes are launched only from explicit absolute executable paths and communicate through stdio JSON messages bridged by Tauri commands/events.
- Real desktop sidecar fixture execution is covered by native WebDriver smoke.

## Deferred

- Plugin signing and marketplace trust.
- Per-domain network allowlists.
- Process sandboxing beyond normal OS process boundaries.
- Packaged sidecar distribution and install/enable approval UI.
- Manual OS-level verification for dialogs and packaged sidecar distribution.
