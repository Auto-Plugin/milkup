# First-failure deletion diagnostic (prototype only)

**Current result: three bounded Windows runs passed; historical OS5 remains
unreproduced and unrepaired.** Eighteen tests passed in each run and 15 native
render/cleanup cases passed in total (13 diagnostic,2 original std). The runner
has only Runtime 156.0.4314.50; it does not supply the 155.0.4283.62 used by the
latest historical failure. No new Windows PNG bytes or product package were
retained. Full Mermaid product integration remains unfinished.


Base: `5c8f9b8949923e95adeb3ce6b1d15da55def5733`.
Native candidate: `0a40abfb1eb571f9c67099fca775dfabcd758c29`.

Run 39939237277 rendered gitGraph but failed private-tree cleanup with OS5.
The later seven access-open probes could not identify the failing delete API.
This candidate records the first API failure and terminal propagated failure
inside an isolated adaptation of the locked Rust 58cf8f9c deletion algorithm.
It is not instrumentation of the linked standard library and is not a product
replacement deletion implementation. Extra allocations/observations can affect
timing. The actual CI compiler and installed Runtime versions must be recorded;
a newer compiler does not establish equality with its current std implementation.

The reviewed mode runs only the existing flowchart-v2 canary followed by one
existing gitGraph fixture. A canary failure stops before gitGraph. No automatic
full matrix, PNG export, artifact upload, toolchain/Runtime install or installer
execution is added. The ordinary mode remains on std::fs::remove_dir_all.
The fixed engine, inputs, Cargo files and account supervisor remain at 82fb49e9.
Token gates, Job ownership, AppContainer profile deletion and failure cleanup
rules remain in place. Product integration and its changed trust boundary remain
outside this prototype authorization.

The adaptation preserves root access/share/flags, relative NtOpenFile with
OBJ_DONT_REPARSE, empty-name Unicode ABI, 1024-byte enumeration and stack/restart
semantics, consumed-handle closing, disposition flags and fallback only for
87/50/1. Inner retries remain 50 yields for sharing/dir-not-empty; existing outer
32/33-only bounded retries and independent root-absence verification remain.
OS5 is not retried. Native first/last outer attempts are retained (at most two),
with explicit omitted intermediate count. Each report is capped at 8 KiB and
relative path display at 256 UTF-16 units with full length/hash. The PowerShell
log projection suppresses a diagnostic exceeding 20 KiB.

Primary sources (MIT notice retained in RUST-DELETE-LICENSE-MIT):
- https://github.com/rust-lang/rust/blob/58cf8f9c35b355199727627d07ae34a4e2846d67/library/std/src/sys/fs/windows/remove_dir_all.rs
- https://github.com/rust-lang/rust/blob/58cf8f9c35b355199727627d07ae34a4e2846d67/library/std/src/sys/fs/windows.rs
- https://github.com/rust-lang/rust/blob/58cf8f9c35b355199727627d07ae34a4e2846d67/library/std/src/sys/pal/windows/api.rs

Historical local preflight, before the Windows CI runs below: seven Linux tests passed on existing rustc 1.99.0 after restoring
locked build crates; initial offline fetch failed because image was uncached.
No package/lockfile/dependency change. Six new Windows-specific tests await
actual CI: empty root/Unicode ABI, nested Unicode and directory buffers, real
sharing conflict, missing/wrong-type inputs, inert mapped copy of this test EXE
(no execution) producing disposition denial, and bounded first/terminal reports.
Independent review corrected empty Unicode MaximumLength and retention of the
last outer attempt. Local Windows target, PowerShell and rustfmt are unavailable;
no Windows execution or formatting pass is claimed here. Adversarial junction
execution remains untested. New CI results must be appended without erasing
failures or converting a non-reproduction into a fix.

## First actual Windows run: 41612414152

Source 6421ea767aeb85e701fbb2e4f1363542ff125dcf: all 18 Windows tests passed,
including six new diagnostic tests. Canary and gitGraph both rendered and
completed native/outer cleanup. Historical OS5 was NOT reproduced; this is not
a repair. Both deletion traces contained benign ERROR_FILE_NOT_FOUND entries
from the locked traversal, with no terminal failure. Actual compiler remains
58cf8f9c/1.99.1; installed WebView2 EXE FileVersion is now156.0.4314.50 rather than
155.0.4283.62 from the last failure. No Runtime was installed by this task.
Structured evidence: evidence/windows-delete-2026-11-03/run-41612414152.json.
PNG bytes were not retained and no new visual acceptance is claimed.

The next bounded reproducibility run keeps the same exact native candidate and
fixed inputs: one canary then up to 10 independently owned runs of ONLY gitGraph.
Every result carries a distinct execution name; any native/outer failure stops
dispatch immediately under existing cleanup gates. This samples an intermittent
failure in the previously failing fixture, not the 50-case diagram corpus. It
uses an explicit repeat marker; default mode still runs one target. It changes
no native deletion behavior and does not establish a fix if all attempts pass.

## Bounded repeat run: 41613240830

Source b63014dc527277a7e92a2e944d1f0f96ecb0df4d: 18 Windows tests, canary,
and 10 independently owned gitGraph executions passed; all native and outer
cleanup checks passed, zero artifacts. Each trace had no terminal failure.
Rust remained 1.99.1/58cf and Runtime EXE 156.0.4314.50. This is 11 more successful
executions in the current environment, not evidence that historical OS5 is fixed.
Structured evidence: evidence/windows-delete-2026-11-03/run-41613240830.json.

One final bounded control retains the same exact native source (binary hashes are compared separately) and fixed corpus
(canary plus one gitGraph), but passes the original --run verb so cleanup uses
std::fs::remove_dir_all rather than the diagnostic adaptation. An explicit
std-control marker rejects repeat/visual combinations. Read-only inventory of
already installed Runtime directory versions is included; no installation or
selection change. This distinguishes current original-path behavior from an
observation-path timing effect. A pass still cannot establish the historical
fault's cause or attribute improvement to a Runtime version.

## Original std control: 41614042604

Source b530e0ebb80f0c726e94b35cb4993b723604320f: 18 Windows tests plus canary
and single gitGraph passed. Both records have privateTreeDeleteDiagnostic=null,
confirming the original std cleanup path was used. All native Job/profile/tree
checks and outer account/profile/stage cleanup passed. Artifact API returns 0.
Installed Runtime inventory contains only 156.0.4314.50; no 155 installation is
available. Compiler is still 58cf8f9c/1.99.1. Structured results and hashes are in
[evidence/windows-delete-2026-11-03](evidence/windows-delete-2026-11-03).

All runs use native source 0a40abfb1eb571f9c67099fca775dfabcd758c29, but recorded
binary SHA values differ across runners. This is a source/behavior control, not
a byte-identical executable comparison. The changed Runtime and timing also
prevent attributing current success to any particular environmental cause.

## Remaining blocker and next concrete choices

The adapter can now capture a real first/terminal failing relative path, API,
Win32 error and directNtOpen NTSTATUS. Its deterministic own-file tests actually
produced both share denial and mapped-image disposition denial. Those tests
validate diagnostic behavior; they do NOT establish the cause of run 39939237277.
No real rendering cleanup failed in the three new bounded runs, so there is no
new historical-fault path or API to report. No guessed cleanup repair was made.

To investigate the old failure comparably, the minimum resource is an already
installed 155.0.4283.62 disposable Windows environment with the same standard-user
conditions, or separately approved acquisition/use of that specific Runtime.
Current tests neither install/downgrade Runtime nor inspect third-party lock
holders, change firewall/UAC/privileges, or replay an unlimited matrix. Even a
matching Runtime alone will not reproduce every old machine condition.

The alternative development direction is to evaluate current-runtime support
explicitly, while keeping old-runtime reliability unresolved. Product acceptance
would still require the remaining actual Windows pixels/grammar matrix, the
same-login cancellable coordinator (CI's different-SID supervisor is not a
product design), stale-result and PNG lease ownership, readable width/theme/DPI,
plugin migration and normal non-elevated administrator compatibility. The current
gate rejects filtered administrator tokens; this checkpoint does not relax it.
The disclosed UDP/browser-vulnerability residual remains. Prototype authorization
does not authorize integrating/distributing that changed product trust boundary.
A specific integration-and-delivery scope can be reviewed together; no repeated
approval is needed for the already authorized prototype and evidence work.

No product files, SDK/IPC entry points, installer layout, production endpoints,
signing keys or dependencies changed. Beta7's historical artifact has expired;
this checkpoint is diagnostic source and evidence, not a new downloadable app.
