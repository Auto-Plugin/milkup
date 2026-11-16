# Small-document external reload: late-result protection

Base: v2 integration `491089e8e35d3e21327c8e39126e82127e42fd64`,
branch `dot/release-quality-integration-20261112`. Its remote ref was verified.
This candidate preserves the integration branch's Mermaid pending-preview,
catalog-refresh and file-conflict fixes. It does not copy the older research main.ts.

## Defect and change

`reloadExternalDocument` checked eligibility before awaiting the native read.
It then replaced the editor state before the bridge validated the returned
document identity. Edits or document switches during that await could therefore
replace the current document even when bridge validation subsequently threw.

Capture the admitted view, immutable text document, document ID/version, file
path and disk snapshot. Immediately before commit, require the newest admitted
request, the same identities, a clean modified-external session and no open/save/
close transition. Superseded results do not touch notices/focus; invalidated
same-document results retain content and report cancellation without refocusing.
Selection-only movement still permits normal reload. Validate the native response
with the existing bridge before mutating editor state. Existing cancellation,
read errors, large-document confirmation and normal reload behavior remain.

## Reproducible regression

Node 24:

```
node --test tests/native/external-reload-contract.test.mjs
# equivalently, with the repository package manager:
pnpm test:desktop:external-reload
```

The test extracts the actual production function and actual bridge validation/
line-ending functions, strips TypeScript types with Node, and controls only the
asynchronous native-read boundary plus UI collaborators. It does not duplicate
the reload implementation. The same contracts executed against the exact base
had 4 passes / 17 failures; the candidate has 21 passes / 0 failures / 0 skips.
Raw local outputs are retained beside this report.

Covered: normal commit and CRLF, late edits, document switch, view disposal,
version/path/disk snapshot/text identity changes, dirty/external state, busy/save/
close transitions, selection-only changes, both duplicate completion orders,
newest cancellation suppressing an older read, read rejection, and native identity
mismatch before any editor mutation. Existing conflicting documents admit no read.

Local disk returned ENOSPC when creating a preparation directory. Only this
task's redundant test log and redundant backup were removed after verifying
their complete existing copies; no original history or evidence was deleted.
The candidate was prepared in memory from the exact GitHub source blob and
saved through authorized repository APIs on a new isolated v2 branch.
The normal full desktop typecheck/build, browser and installed native regressions
were NOT run. This is not an installed/native pass or a release-readiness claim.
No CI dispatch, runtime rebuild, package install, main merge, release, production,
security or notification change is part of this fix. Run 43890194973 is untouched.

## Integration validation (2026-11-16)

Product parent is `491089e8e35d3e21327c8e39126e82127e42fd64`; product fix is
`a09bc855167c7c21b66e8797ced818c33a1f620e`. Its `main.ts` is unchanged by this
validation commit. Remote integration was still exactly the parent before promotion.
A `/tmp` tmpfs now has usable space independently of the full `/workspace` overlay.
An isolated exact checkout and matching locked existing dependencies were used;
1253 tracked source/build inputs were verified against Git blob identities. Neither
original worktree nor unique evidence was removed or replaced.

Full desktop `tsc -p apps/desktop/tsconfig.json --noEmit` passed without altered flags.
Desktop file service/transition/open/conflict/save/recovery: 75 tests; bridge
session/close/save/watch: 42 tests; historical watcher conflict: 1 test; actual-function
reload and test-only native transport gate contracts: 28 tests. All 146 passed.
Prettier and syntax checks passed. See raw logs and `validation.json` for hashes.
The first extra watcher invocation used the wrong package working directory and
failed import resolution before running tests; the original error is preserved.
The successful invocation used its existing workspace links/config in
`tests/regressions`, without changing product or test semantics.

Review confirms native document/path validation now occurs before any editor
mutation. The normal path retains large-preview cleanup, open policy, session metadata
(including CRLF/read-only), recent-file recording, file watching, view application,
notice and focus, in their original relative order. Selection-only movement remains
allowed. Real changes, pending close/save/navigation and superseded reads cannot
replace current content. Large-document routing is unchanged.

## Next same-package native gate (prepared; NOT executed)

`tests/native/tauri-external-reload.mjs` is the executable installed-app entry,
exposed as `test:native:external-reload`. Add it to the next already-planned ordinary
Linux installed daily-use batch after the same package is installed and its native
driver is ready, **not** to the current WebKit build or a separate new matrix:

```sh
timeout --signal=TERM --kill-after=5s 240s node tests/native/tauri-external-reload.mjs
```

Use the existing isolated ordinary-user display/profile and close helper. Required
variables are `RUNNER_TEMP`, `DISPLAY`, `TAURI_APP_PATH`, `TAURI_DRIVER_URL`,
`MILKUP_NATIVE_PROFILE_ROOT`, the five `XDG_*_HOME`/`XDG_RUNTIME_DIR` paths,
`MILKUP_NATIVE_EXCLUSIVE_DISPLAY=1`, `MILKUP_NATIVE_EVIDENCE_DIR`,
`MILKUP_NATIVE_PACKAGE_MANIFEST`, `MILKUP_NATIVE_EXTRACTED_APP`,
`MILKUP_NATIVE_EXPECTED_BINARY_SHA256`, and `MILKUP_NATIVE_CLOSE_HELPER`.
The manifest uses the existing `{sourceSha, installer:{name,bytes,sha256}}` shape;
package bytes, installed/extracted executable bytes, process birth/executable/window
ownership and production origin must match. The evidence subdirectory must not exist.
No installation, driver startup, profile reuse, CI dispatch or cleanup-by-name is
performed by this entry.

Cases: normal clean external reload; real keyboard edit while a reload result waits;
new document plus real keyboard edit while the old result waits. The original file
is synthetic, and its independently written external bytes must survive every case.
The actual native read must finish and its identity/timing must be recorded **before**
input and delayed delivery. Only its unchanged Promise result delivery is held,
not application editor/session state or native response contents. This is explicitly
a deterministic fault-injected transport schedule, not a claim of natural read latency.
The gate passes unrelated IPC through unchanged, has a 15-second bound (expiry fails
the acceptance), and restores/releases on cleanup. Local gate tests cover real-result
identity, forwarding, errors, early cleanup, repeat cleanup and the hard timeout.

Each case must retain the expected full visible text/path/revision/dirty state and
external disk bytes, then exit through the actual normal window-close protocol.
Only the synthetic unsaved edits are explicitly discarded through the normal prompt;
this is not recovery/save-as acceptance. Cleanup failure remains failure with evidence;
no forced exit can satisfy the gate. The isolated runner remains responsible for its
existing bounded supervisor/collection on a failed cleanup.

Current host lacks DISPLAY, tauri-driver, WebKitWebDriver and xdotool. Therefore no
installed result, normal-close proof, save/reopen race proof, Windows result, or
new package is claimed. The existing native conflict/recovery evidence is not reused
as proof for this new race. No CI was dispatched, and run `43890194973` was untouched.
