# Private fixed Mermaid engine

This is newly implemented product integration based on the reviewed fixed-code
prototype; it is not recovery of missing uncommitted files. The engine embeds
exact official Mermaid 12.2.0 bytes and the product bootstrap. `build.rs` verifies
the 5,494,801-byte script and SHA-256
`a8a6a6f805b074a8261a2825c86f99c8054acb3b35f50bb7e24a4f9f2c3c3b9f`.
Upstream MIT licensing is retained in `assets/MERMAID-LICENSE`.

The main product webview alone can invoke these private commands. The desktop
TypeScript adapter must authenticate exact active package contents, published
catalog generation and renderer activation before assigning `ownerId`. IDs from a
plugin are never authorization. These commands are absent from the plugin SDK.

- `private_mermaid_render({ request: { requestId, ownerId, source, width, theme,
  look, remainingMs } })` returns `{ leaseId, requestId, ownerId, pngBase64,
  width, height, sha256, engine }`.
- `private_mermaid_cancel({ ownerId, requestId })` signals cancellation and
  releases matching output. It does not claim that native cleanup has finished.
- `private_mermaid_release({ ownerId, leaseId })` releases only that owner's PNG.
- `private_mermaid_retire_owner({ ownerId })` permanently retires that owner,
  cancels its jobs and releases its outputs. Later work cannot revive it.

Every association includes the invoking webview label. Only `main` is accepted.
No document paths, executable paths, URLs, JavaScript, HTML, modules, arbitrary
configuration or native command proxy are accepted. Width is 160–8192, theme is
`default` or `dark`, look is `classic` or `neo`. Source is at most 50,000 UTF-16
units / 256 lines and the fixed child JSON is at most 64 KiB. External diagram
modules, icon registration, arbitrary configuration and remote resources remain
outside the contract. “Full Mermaid” means the pinned built-in engine, not every
possible extension or an exhaustive guarantee for all grammar productions.

The caller supplies the remainder of its original preparation deadline (1–30,000
ms). Executor dispatch, queue admission, startup, rendering, cleanup and PNG
validation all consume it. Each registry job uses one monotonic deadline. One
native job runs at a time, at most eight may be admitted. Cancellation wakes the
queue; native backends observe the same control throughout execution and tear
down only their owned descendants. Native work remains counted until backend
cleanup returns. Uncertain cleanup disables subsequent launches until restart.
Cancellation and request/owner tombstones are retained for this registry's
lifetime, bounded at 65,536 each; exhausting them fails closed.

Output uses actual PNG bytes, never a disguised SVG node. The validator checks
signature, complete chunk framing and CRCs, terminal IEND, no APNG, exact metadata
dimensions and full bounded decode, and rejects blank uniform captures. Each PNG
is at most 16 MiB, each axis at most 8192, and total pixels at most 16,777,216. This
is a new product transport budget, not the prototype's 256 KiB budget. Retained
native leases count old and new outputs together: at most 32 leases / 128 MiB PNG
bytes / 32 million reserved decoded pixels. Native retained byte leases have a
60-second fallback expiry, reaped on subsequent render admission/publication;
normal frontend decode/disposal explicitly releases them. Frontend Blob URLs and
decoded images have their own owner and budget. ImageReader's allocation limit
is not a whole-process memory limit.

The Windows coordinator runs in the product login, creates a zero-capability
AppContainer, pins its executable copy, binds the child to a non-breakaway Job at
creation, verifies child/browser user SID, token and Job membership before
releasing text, and owns bounded IPC and teardown. Only an existing Evergreen
Runtime is discovered; no fixed runtime, download or installation path is
included. The reviewed pure-standard-user requirement remains: filtered
administrator and elevated contexts are rejected without privilege changes.
Windows execution, native visual acceptance, same-login profile cleanup and
installer delivery require actual Windows evidence and are not established by
Linux checks. Historical error 5 is not claimed fixed.

Linux uses the product's dedicated subreaper guardian, ephemeral sandboxed
WebKitGTK context and fixed native request guard. It permits only the existing
three in-memory asset URLs and has no plugin/native bridge. Linux has no claim of
Windows Job-equivalent committed-memory limits. Neither platform's browser
request controls establish OS-wide network denial after a browser exploit; the
previously disclosed UDP/browser-vulnerability residual remains.

`assets/bootstrap.test.mjs` exercises the actual pinned engine in an installed
local Chromium using a private temporary profile. It fixes natural SVG sizing
(wide diagrams scroll at readable scale), expands viewBox/content bounds with
padding, and moves C4 relationship labels above lines with theme-correct backing.
These local browser images do not establish WebView2/native scale/IME acceptance.

For an explicitly launched Windows acceptance harness only,
`MILKUP_MERMAID_NATIVE_AUDIT=1` enables bounded stderr ownership records. The
`started` record follows actual browser PID/token/Job validation. `finished`
records contain exact owner SIDs, owned PIDs, Job emptiness, IPC completion,
profile/tree deletion, cancellation/deadline observations and PNG hash/length.
This opt-in diagnostic copies a closed field list; it omits source, renderer
errors, paths, credentials and resource URIs, and adds no plugin capability.
A `successful` native record precedes host PNG validation/publication; the
acceptance harness must also match its hash to a decoded image in the actual UI.
