# M11 Plugin Sandbox Audit

> Date: 2026-07-06
> Scope: baseline M11 filesystem/network access restriction and host-tier isolation.

## Verdict

Baseline M11 plugin filesystem/network sandboxing is complete for the current product paths.

This means normal plugin execution is no longer an ambient in-process module path:

- Browser plugins run through a Worker-style isolated host.
- CLI/headless plugins run through the isolated module host.
- Desktop filesystem-capable plugins use broker-backed Tauri commands.
- Advanced sidecar plugins require explicit host-tier allowance and communicate through the same serialized isolation RPC protocol.
- Plain in-process modules are rejected by `PluginRuntime` by default and are now limited to explicit trusted/dev fixture opt-in.

## Evidence

| Requirement                                                                              | Evidence                                                                                                                                                                                                                                                                                                                                                    |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Plugin without `file:*` permission cannot receive file host capabilities.                | `packages/plugin/src/filesystem-broker.test.ts` rejects reads without `file:read`; `packages/plugin/src/isolation.test.ts` and `packages/plugin/src/isolation-module-host.test.ts` prove only declared/restricted host capabilities cross the isolation boundary.                                                                                           |
| Read/write/delete permissions are independent.                                           | `packages/plugin/src/filesystem-broker.test.ts` covers write-only access rejecting read/delete; runtime action permissions and command-level permission narrowing are covered in `packages/plugin/src/runtime.test.ts`.                                                                                                                                     |
| File paths are scoped and canonicalized before access.                                   | `packages/plugin/src/filesystem-broker.test.ts` covers sibling prefix escapes, `..` traversal, symlink-style adapter resolution escapes, Windows separators, per-root operation limits, and audit records.                                                                                                                                                  |
| Desktop plugin file access goes through Tauri broker commands, not raw plugin APIs.      | `apps/desktop/src/plugin-file-broker.test.ts` maps broker calls to dedicated Tauri commands and combines native resolution with broker scope checks; `tests/native/tauri-webdriver-smoke.mjs` verifies a real desktop Worker plugin reads/writes through the Tauri-backed broker.                                                                           |
| Plugin network access is permission-gated and brokered.                                  | `packages/plugin/src/network-broker.test.ts` covers permission denial, URL validation, origin allowlists, and audit records; `packages/plugin/src/runtime.test.ts`, `packages/plugin/src/isolation-worker.test.ts`, and CLI tests cover runtime/Worker/CLI broker routing.                                                                                  |
| Worker plugins cannot bypass broker policy through ambient network/code-loading globals. | `packages/plugin/src/isolation-worker.test.ts` blocks unbrokered `fetch`, `WebSocket`, `EventSource`, `XMLHttpRequest`, `eval`, `Function`, `importScripts`, `Worker`, and `SharedWorker`; brokered ambient `fetch` is verified when `network:access` is present.                                                                                           |
| Plugin actions expose permissions to Action Registry, CLI, and MCP.                      | `packages/plugin/src/runtime.test.ts`, `packages/cli/src/milkup.test.ts`, and MCP projection/server tests verify permission filtering and MCP metadata for file/network plugin actions.                                                                                                                                                                     |
| Destructive file operations require destructive action metadata.                         | `packages/plugin/src/runtime.test.ts` verifies `file:delete` plugin actions are destructive and require confirmation.                                                                                                                                                                                                                                       |
| Plugin document edits use transactions across isolation boundaries.                      | `packages/plugin/src/isolation.test.ts`, `packages/plugin/src/isolation-module-host.test.ts`, `packages/plugin/src/isolation-rpc.test.ts`, `packages/plugin/src/isolation-worker.test.ts`, playground e2e, desktop Worker smoke, and native WebDriver smoke verify serialized transaction mutation and undo/history behavior.                               |
| In-process modules are not the default production path.                                  | `packages/plugin/src/runtime.ts` rejects in-process plugin modules by default; `packages/plugin/src/runtime.test.ts` covers default denial and explicit trusted fixture opt-in with `allowInProcessModules`.                                                                                                                                                |
| Sidecar plugins are non-default and require explicit host-tier allowance.                | `packages/plugin/src/manifest.test.ts`, `packages/plugin/src/loader.test.ts`, `packages/plugin/src/runtime.test.ts`, and `packages/plugin/src/isolation-sidecar.test.ts` cover `host: "sidecar"` parsing, default loader/runtime rejection, explicit allowance, RPC command execution, and lifecycle cleanup.                                               |
| Desktop sidecar process path is natively verified.                                       | `apps/desktop/src/plugin-sidecar.test.ts` covers frontend Tauri endpoint behavior; Rust tests cover absolute executable policy and event payload shape; `tests/native/tauri-webdriver-smoke.mjs` launches a real stdio sidecar from the running Tauri app, verifies RPC command execution, serialized transaction insertion, and process exit after unload. |

## Verification Commands

- `pnpm --filter @milkup/plugin test`
- `pnpm --filter @milkup/plugin typecheck`
- `pnpm --filter @milkup/plugin build`
- `pnpm --filter @milkup/cli test`
- `pnpm --filter @milkup/cli typecheck`
- `pnpm --filter @milkup/desktop test`
- `pnpm --filter @milkup/desktop typecheck`
- `pnpm --filter @milkup/desktop build`
- `cargo +stable-x86_64-pc-windows-gnu test`
- `cargo +stable-x86_64-pc-windows-gnu fmt --check`
- `cargo +stable-x86_64-pc-windows-gnu check`
- `pnpm --filter @milkup/desktop tauri build --debug --target x86_64-pc-windows-gnu`
- `pnpm test:native:desktop`
- `pnpm lint`

## Deferred Outside This Baseline

- Plugin signing and marketplace trust.
- Packaged sidecar distribution and install/enable approval UI.
- Per-domain network allowlists in plugin manifests.
- Process sandboxing beyond normal OS process boundaries.
- Manual OS file dialog verification and MSVC toolchain coverage from M6.
