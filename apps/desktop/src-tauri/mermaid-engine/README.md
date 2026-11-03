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
included. Standard-user hosts remain supported. Normal, non-elevated filtered
administrator tokens are accepted only when the actual primary token is UAC
Limited, non-elevated, medium integrity, has no UIAccess, retains Administrators
as exactly deny-only, and holds only the closed ordinary-user privilege set.
The audit distinguishes `filtered-admin` from `pure-standard`; the original
`hostPureStandard` field remains false for filtered administrators. Elevated,
unfiltered or unknown token contexts are rejected before native admission.
No linked token is selected for execution, no privilege is adjusted, and no
alternate process-creation API is used. A Limited sandbox token's linked handle
is queried only for its token type and impersonation level, then immediately
closed. The returned handle is not claimed to have query-only access: the
separate fixed diagnostic observed `0xF01FF` and successful handle duplication,
but all returned targets remained Identification-level impersonation tokens.
Both suspended helper and actual WebView2 browser must retain the same user and
session, low integrity, no UIAccess, no administrative authority, only
`SeChangeNotifyPrivilege` and `SeIncreaseWorkingSetPrivilege` (if present), the
fresh AppContainer SID and zero capabilities. IncreaseWorkingSet adjusts
residency; it does not change the owned Job's committed-memory limit. This is
not an RSS hard-limit claim. Every other privilege, including disabled presence,
remains rejected.

Default sandbox tokens have no linked association. Limited sandbox tokens are
accepted only when the actual caller has no impersonation token and the linked
query succeeds with target type `TokenImpersonation` (2) and level
`SecurityIdentification` (1). Unknown/error/missing observations, primary
targets, and other impersonation levels are rejected. The current execution
token's restrictions are never replaced by the linked target's properties.
Microsoft documents that an Identification impersonation token cannot be raised
to a more powerful level or converted to primary. The linked-authority check
performs no handle/token duplication, impersonation, or privileged launch.
The existing separate code-ancestry negative-access check still duplicates and
temporarily impersonates the low-privilege AppContainer child token, then reverts;
it never uses a returned linked token. That existing check is unchanged.

Four native observations precede the first source byte: the coordinator checks
the suspended helper and held actual browser, while the helper independently
checks itself and that browser under its AppContainer caller context. Only
native queries populate the compact Ready proofs; JavaScript cannot supply
them. Helper/browser PID, user, session, fresh AppContainer identity and owned
Job binding are checked before source delivery. The creation-time Job,
three-handle allowlist, original deadlines, 4 KiB Ready limit and 8 KiB audit
limit are unchanged. Cancellation during Job sampling preserves the original
Ready evidence without publishing a `started` proof that was never emitted.

Cleanup diagnostics retain the final owned-tree OS error, actual removal-call
count, elapsed time, terminal phase and independent absence observation. At most
31 failed attempts leave the audit as numeric `[attempt, error]` pairs; a null
error never means success. Fixed elapsed checkpoints distinguish skipped Job,
pin and profile operations from completed calls. Each IPC join records its
native operation/completion state at entry, at cancellation if requested, and
at return. These observations do not change handle lifetimes, the 50/250 ms
join rules, the three-second tree retry bound, or cleanup acceptance. Error 995
remains an I/O failure, including after a captured image; it is not EOF.

Run 41692476025 provided the motivating real failure: pure-standard captured
2606 bytes but had cancelled pipe reads and an unremoved private tree, so no PNG
was published. Its exact tree deletion error was not present in that earlier
audit and remains unknown. Filtered-admin passed its product steps and cleanup
in that run; the required complete two-account acceptance remains pending.

Run 41699494037 isolated another failure: ordinary-user re-enable captured a
PNG, all IPC threads ended normally, but the first owned-tree removal returned
OS error 5 without an absence check. That run remains failed; the denied subpath
and underlying cause are unknown. The next candidate retries exactly Windows
errors 5, 32 and 33 within the existing 31-call, 100 ms pause and three-second
budget, repeating the same removal operation without changing ACLs or file
attributes. Persistent denial, failed absence verification, or any earlier
cleanup error still prevents success. This change does not address the earlier
pipe error 995 and does not establish complete two-account acceptance.

Actual token diagnostics passed in both account kinds on run 41683336878. Full
Windows product rendering and cleanup acceptance for this new conditional
policy remains pending its dedicated product run; policy tests, cross-compiling
and token observations alone do not establish WebView2 compatibility. The
previously delivered beta.8 artifact and its historical evidence are unchanged.
See [token diagnostic scope](TOKEN-DIAGNOSTIC.md) and Microsoft's
[impersonation-level constraints](https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/ntifs/nf-ntifs-zwduplicatetoken),
[working-set API](https://learn.microsoft.com/en-us/windows/win32/api/memoryapi/nf-memoryapi-setprocessworkingsetsizeex),
and [Job committed-memory limits](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-jobobject_extended_limit_information).
The distinction follows Microsoft's [token elevation types](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ne-winnt-token_elevation_type)
and [deny-only SID semantics](https://learn.microsoft.com/en-us/windows/win32/secauthz/sid-attributes-in-an-access-token).
The Windows-only ignored test
`launcher::tests::elevated_host_is_rejected_before_native_resources` requires
`MILKUP_MERMAID_ELEVATED_REJECTION=1` and
`MILKUP_MERMAID_ELEVATED_REJECTION_RUNTIME` set to an absolute, already-installed
Evergreen directory containing `msedgewebview2.exe`. It fails unless the actual
host token is elevated, then tests the real launcher's rejection before native
admission. This is an explicit negative native test, not elevated GUI support.
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
