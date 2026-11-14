# Independent Mermaid product rebuild — 2026-11-03

For the final platform results, exact tested candidates and unresolved items, see
[Current acceptance and limits](CURRENT-STATUS.md). The sections below retain the
chronological investigations; statements about a next run describe that earlier
point in the investigation, not the latest status.

This is a new implementation in an independent worktree, **not recovery of the
missing uncommitted files** from the offline engineering environment. That
environment was not reset, archived, replaced, or used to start another process.

The verified product baseline is `5ea31846e0cd72d52ca6c9ae83a77a695861acaf`.
The separately retained prototype baseline is
`ea5ebcc69d83a6c8eecf4edc73aabd6445b8dac4`. Both were fetched and checked out
separately. Original engineering thread `01a1396a-156f-7138-8cdb-3a3673f27090`
could not be read through a cross-thread tool; Personal Context returned
unavailable. Readable room history confirms earlier test-count reports but
contains no complete uncommitted patch. Those historical 30/133 counts are not
claimed as this candidate's verification. The prototype's product acceptance
catalog contains 17 prepared cases, not executed passing results.

## Rebuilt behavior and boundaries

- Exact manifest and content hashes authenticate the reviewed Diagrams Worker
  1.3.0 package; permission fingerprints alone do not authorize the native engine.
  Dispatch also requires current published catalog generation, committed
  activation epoch, enabled runtime and renderer contribution. Same-ID packages
  cannot obtain the private service. Public plugin SDK/RPC output remains unchanged.
- Native jobs bind the caller main webview, owner and request. The unchanged
  original deadline includes queue/start/render/cleanup. Retirement cancels work,
  waits for pending completion and releases late output; uncertain cleanup fails.
- PNG is a private typed resource authenticated by object identity, validated
  before use, and decoded before source is hidden. Failed/deferred/stale output
  releases owned resources. Aggregate old-plus-new budgets apply. Errors retain
  exact source with a diagnostic. Export retains the existing restricted renderer.
- Wide graphs retain natural size and scroll. C4 labels sit above connectors with
  theme-aware backing; C4 raster bounds use actual content plus 16px padding.
- Linux and Windows use fixed embedded Mermaid 12.2.0. Linux/Windows bundle the
  reviewed Worker 1.3.0; macOS retains its existing DOM package. Receipt migration
  recognizes exact 1.1.1 and 1.2.0 histories and preserves disabled/removal intent.
- No old Fixed Runtime run, runtime installation, main merge, release publication
  or installer delivery is part of this rebuild. Windows compilation is a separate
  isolated candidate workflow and is not Windows pixel/IME/cleanup acceptance.

## Verified so far

The logs below describe actual new executions, not inherited prototype claims.

| Check | Result | Evidence |
| --- | --- | --- |
| Desktop complete Vitest suite | 71 files, 978 tests pass | `logs/desktop-full-tests.log` |
| Isolated module bootstrap | 4 tests pass | same log |
| Desktop ownership/catalog focused checks | 132 tests pass; subset of full suite | `logs/desktop-mermaid-unit.log` |
| Desktop TypeScript and production Vite build | pass | `logs/desktop-typecheck.log`, `logs/desktop-production-build.log` |
| Diagrams Worker existing compiler/renderer | 56 tests pass | `logs/diagrams-worker-tests.log` |
| Exact package identity/tampering | 4 tests pass; native Rust catalog hashes match | `logs/package-seals-test.log`, `logs/native-seal-probe-result.json` |
| Linux desktop Rust type check | pass | `logs/linux-engine-check.log` |
| Fixed bootstrap in installed local Chromium | 112 checks pass, including 50 fixtures × 2 themes | `logs/bootstrap-chromium.log`, `bootstrap/corpus-results.json` |
| C4 text contrast correction after the corpus run | 18 checks; 12 C4 examples / 88 leaf labels, minimum nominal contrast 5.6168:1 | `logs/c4-contrast-chromium.log`, `c4-contrast/c4-contrast-results.json` |
| Core private PNG and existing core regressions | 202 tests pass | `logs/core-tests-retained.log` |
| View PNG and related presentation/decoding checks | 187 tests pass | `logs/view-png-tests-retained.log` |
| Linux native backend corpus | 50/50 PNGs generated, decoded, retained; 50 exit and directory checks | `native-linux-helper/README.md` |
| Linux product editor end-to-end | 11/11 operations pass on four self-authored documents, DPR 1 / light theme | `product-linux/evidence/mermaid-private.json` |

The bootstrap PNGs in this folder are **local Chromium 154 renderings**. They do
not establish product editor integration, WebKitGTK/WebView2 pixel fidelity,
native scale/IME behavior, Windows same-login cleanup, or installer acceptance.
The corpus source is retained in `fixtures/`; `fixtures-manifest.json` is copied
from the verified prototype baseline. Root review inspected the wide and C4
examples, including the cropped component image; the 100-image automated decode
check is not a claim that a person visually accepted every image.

The later C4 contrast correction uses each shape's actual fill to select black
or white label text, including grouped Person and custom backgrounds. The full
100-image corpus was not rerun for this C4-only correction; its selected C4
cases and wide controls have separate retained images and hashes. Root reviewed
the final light Component image. Core/view implementation/test commits are
`45618c99` and `02b852a6`; native results remain separate.

## Native status and remaining acceptance

Linux real native helper rendering now passed (fixed assets → official Mermaid →
WebKit snapshot → complete PNG decode/nonuniform pixels → lease release), as did
cancel/cleanup followed by a fresh render. See
`logs/linux-helper-native-evaluation.log` and
`logs/linux-helper-native-cancel-mounted.log`. These exercise the actual backend,
not the product editor. Early attempts failed at WebKit's sandbox setup and
missing runtime paths; temporary mappings now retain the sandbox without system
installation changes. Actual code errors also surfaced and were fixed: response
Content-Type was missing under nosniff, and JavaScript dispatch returned a Promise
that WebKit's native evaluation API could not serialize. Native directory cleanup
now reports deletion failure instead of silently ignoring it (`688fc89a`).

Linux product editor end-to-end execution passed 11/11 operations on candidate
`688fc89aad6c6b4b54cdec87ffa66179e5dd0def`, binary SHA-256
`01487ea1f1fcf22f6c9557b7e0c85d14bd93942d9bbc26c30ace8e6fce5af746`.
This is a custom-protocol debug binary with embedded production assets, not an
installer/release build. The native harness used an independent empty profile,
real keyboard/pointer/GTK file operations, and DOM observation only. It verified
initial pending/disabled state, enable, actual PNG decode, source/caret behavior,
edit+save, replacement image, exact undo/CRLF/Unicode bytes, disable/re-enable,
natural-size wide graph, C4, invalid-grammar fallback, and final unchanged files.
The first attempt failed because the harness expected an active generation before
initial activation; the corrected test explicitly checks pending first and active
after enable. It did not change the product to satisfy that assumption.

Root reviewed actual system screenshots 04, 08 and 09: `XDraft 草稿` changed in the
image, wide nodes remain readable with a horizontal scrollbar, and C4 black text
is visible on light blue shapes. The source and diagnostic are visible for the
invalid fixture. The final report, 22 screenshots, complete evidence hashes and
post-namespace process/port/display cleanup checks are retained in `product-linux/`.
The actual runner, namespace mapping and initial failed-harness evidence are in
`product-linux/reproduction/`; their machine-specific assumptions are explicit.
This establishes only those four documents on Linux WebKitGTK 2.52.6, light/DPR1;
it does not establish all 50 diagrams in the editor, dark/high-DPI/Windows/IME or
installer behavior.

All 50 native backend PNGs were separately inspected using actual image views.
The two per-image review records are in `visual-review/`: 41 pass, 9 warnings,
no severe clipping/blankness/missing glyphs. Warnings include small or low-contrast
labels in Gantt, timeline, Venn, treemap and Wardley; Sankey name/value spacing;
packet's possibly intentional half-row blank area; Cynefin's center divider; and
C4 component relation backing touching a border. These are recorded observations,
not a declaration that every visual issue is resolved. The nominal shadow fixture
contains no actual shadow/filter and does not prove shadow-overflow handling.

Windows run `41630133039` at candidate `ca10c4e1` passed the compile/test/link
steps (private engine 11 tests; desktop 228 pass / 3 ignored), but the overall run
**failed** at the final clean-checkout gate. Its original PowerShell conditional
consumed the changed-file list without printing it. Follow-up run `41630161068`
was **skipped**, not passed.

Exact-source diagnostic replay `41632477668` checked out the same full candidate
`ca10c4e17fa1b8114ba65bd32da8082d625fbe16`, independently of instrumentation
`8b9adfe551593bac125cd867f72e49f621f14a79`. Checkout, dependency restoration,
plugin staging, frontend build and private engine checks/tests were clean. The
first dirty status appeared after desktop `cargo check`: only
`apps/desktop/src-tauri/gen/schemas/desktop-schema.json` and
`apps/desktop/src-tauri/gen/schemas/windows-schema.json`, both ` M`. All captured
text diffs against HEAD were empty and Git reported LF-to-CRLF conversion warnings.
Desktop tests/link passed again; the strict final gate **failed** again. The
original logs, per-phase empty diff files and structured analysis are retained in
`windows/original-source-replay/`. Its path enumeration missed status-only paths,
so raw schema-byte hashes were not captured in that replay. The subsequent
controlled Windows experiment `41635596471` closed the mechanism: original
checkout CRLF (125,620 bytes / 2,411 CRLF pairs) versus HEAD LF (123,209 bytes);
a same-content LF rewrite reproduces the two dirty status entries with no text
diff, and index refresh does not resolve it. Only the two schema paths with
explicit `text eol=lf` stay clean throughout. See `windows/eol-diagnostic/` for
raw logs, byte/index hashes, generator-source provenance and the earlier
experimental limitations. `.gitattributes` now aligns these two checkout paths
with Tauri's LF output. No source gate has been relaxed and no build output was
restored to hide drift. Actual candidate build/UI verification follows below.

Actual Windows product workflow `41635937295` at candidate
`87bfeaf281ace926c54662d9508e88fd896c7cf0` independently passed frontend staging,
private Windows checks/tests (13 pass), desktop checks/tests (228 pass / 3 ignored),
production-asset binary link and the **unchanged strict clean-source gate**.
Checkout, desktop-check and final snapshots all show the two schema HEAD/index/
worktree byte hashes equal, LF, and completely empty raw Git status. Binary
SHA-256 is `56b5e222408084d8131ed20e18a789198ffe3e19d218454d41983477a66851e6`
(29,960,192 bytes). This closes the build-drift correction with a real build.

The overall run still **failed** in the test wrapper before account creation:
PowerShell found two Node executable paths and concatenated them. No standard
account, product process or diagram was started. The runner's interactive desktop
was observable and existing Evergreen 156.0.4314.50 plus its signed matching driver
were found; this does not establish access from the intended standard account.
The owned staging directory was removed, with no cleanup errors. Commit `16c2a422`
selects the first resolved executable for Node/PowerShell; a two-match local
regression reproduces the original bug and verifies the scalar result. The next
attempt must still pass every source, identity and cleanup gate.

`windows/product-attempt-41635937295/` retains the raw log, run metadata, original
artifact ZIP and all four reports plus artifact manifest. The ZIP digest matches
GitHub, and every artifact file size/SHA was verified. No PNG was produced in this
attempt. These results do not establish Windows product rendering, same-login
teardown, scale/theme or installer upgrade/rollback.
Run `41637412776` attempt 1 was cancelled before any job executed. GitHub's
annotation explicitly reports a higher-priority waiting request for the shared
`mermaid-rebuild-windows-compile` concurrency group. Attempt 2 was then rerun
individually on the same exact candidate `518125977a5424aa7bd5b7f04a6612b74a5c2526`.
Its build/tests/link and strict clean-source gate all passed again. The original
cancellation metadata and page annotation are preserved with the second attempt.
Commit `13f198b1` adds `queue: max` to the four private Windows workflows,
retaining the same serial concurrency group and `cancel-in-progress: false`;
waiting marker-selected work is no longer replaced by another pending workflow.
The setting is documented in GitHub’s [concurrency guidance](https://docs.github.com/actions/writing-workflows/choosing-what-your-workflow-does/control-the-concurrency-of-workflows-and-jobs).
Local YAML validation is retained; remote validation awaits the next candidate.

Attempt 2 reached a real standard user: no administrator group (including deny-only),
no SeDebugPrivilege, WinSta0/Default in session 2. Read-only PID/SID/session/image/
creation-time observations matched Node, EdgeDriver and the launched product.
However, the wrapper did not wait for Node completion; reading the unset
`$LASTEXITCODE` failed while the Node report was still `running`, with zero
completed UI steps and zero native audit/PNG records. The outer cleanup stopped
five remaining owned processes and confirmed an empty Job, then deleted the exact
new account, profile and stage without cleanup errors. This is explicitly **not**
product inner-cleanup or pixel acceptance. No existing ACL/UAC or runtime was changed.

`windows/product-attempt-41637412776-2/` retains the original ZIP, all 15 manifest
files, full log and verification. ZIP digest and each file size/SHA match GitHub
and the retained manifest. The actual binary hash is
`26d5532b432aeb0e2d1cd3b3015cc4f2de1c7f5cdd05d5804b9bb8ed2a696103`.
Commit `c6a4bfb1` replaces the PowerShell implicit launch with a held process
handle, explicit exit/EOF waits and actual exit code, while concurrently retaining
bounded stdout/stderr. Four real-process local regressions passed: delayed exit
37 with complete dual-stream output, success, timeout with exact-process cleanup,
and over-budget output rejection. This local check does not replace the next
Windows product execution; no absent exit code is converted into success.

Run `41639710787` on candidate `81ac628c3d80f8912bed734ff119a69cb70de41b`
passed build/tests/link/strict-source checks again. All other marker workflows
were skipped normally; the new queue setting was accepted remotely. The corrected
waiter observed Node's actual exit code 1 after 11,539ms, complete stdout/stderr
EOF, and no forced Node termination. Before outer cleanup the Job was already
empty; the exact account/profile/stage were subsequently deleted without errors.

The product loaded the real document and its menu, but the first UI assertion
did not wait for asynchronous plugin initialization: the Diagrams card was
absent (`cards=[]`), not explicitly disabled. Its source was visible, no native
renderer audit existed, and zero UI steps passed. The retained two PNGs are actual
product menu screenshots, **not Mermaid renders**. Root inspected the failure
image and confirmed the empty list and legible Chinese menu text. Both complete
PNG decodes match the browser's recorded RGBA hash. `windows/product-attempt-41639710787/`
contains the original ZIP, 19 hash-verified manifest files, raw log and root review.

The archives are Vite eager `?raw` imports embedded in the production JavaScript;
they are not missing EXE-side resources. The window/document-ready path is separate
from `desktopPluginManager.ready`, which renders the plugin list asynchronously.
Whether that card eventually appears still requires the next actual run. The
harness must wait a bounded time for the exact card before continuing to check
its disabled state and version; a missing card is never accepted as disabled.
Commit `bc83602f` adds that bounded DOM wait, preserves exact initial-disabled and
version assertions, and retains readonly status-notice diagnostics on timeout.
Three async readiness regressions were added; all 14 local harness tests and
syntax checks passed. Product initialization/IPC/catalog code was not changed.

Run `41642093459` at candidate `9e12638dca09ede0251ec410c92423ac19af10ae`
again passed build/tests/link and the unchanged source gate. The card readiness
wait worked: step 1 passed, including actual Diagrams 1.3.0 details and disabled
state. Step 2 enabled the real switch and native work was admitted, but the test
aborted on its overly broad assertion that every later card retain the same Y.
Original WebDriver responses prove that Diagrams itself stayed at Y=202.59375;
its height changed from 178 to 157 after the pending-version line disappeared.
Every following card retained its ID/order and shifted up exactly 21 pixels.
The corrected geometry test must still verify target anchoring, full order and
height-consistent downstream spacing; it must not accept arbitrary card movement.

This failed attempt also exposes a test cleanup defect: failure closed the
product by force before its admitted render completed. Only an `admitted` audit
was retained, no native completion or diagram PNG. Outer cleanup found two live
owned processes, then obtained an empty Job; exact temporary profile deletion
subsequently failed with Win32 32 (sharing violation). Account and stage deletion
succeeded, but `profileDeleted=false` and the cleanup error remain failures.
The failed profile was `C:\Users\mkme0b98d3013ee14f` (the exact SID and
action are in `profile-cleanup-blocker.json`). The completed hosted runner has
no accessible execution channel here, so later residual state is uncertain;
no claim is made that this old profile was subsequently removed.
No inner-cleanup or pixel pass is claimed. Failure cleanup must first allow a
bounded native drain and normal UI close, retaining any failure; external forced
cleanup cannot substitute for product cleanup. Profile retries, if added, must
remain bounded to the exact new SID after confirmed process emptiness.

`windows/product-attempt-41642093459/` retains all 20 verified manifest files,
three actual product UI screenshots, original ZIP/log, extracted geometry and
root image review. The current Windows output remains **not accepted**.

Commits `4807c4b9`, `60b3d2bb` and `90bae1a2` correct the harness's
geometry and failure teardown, and strengthen exact-profile cleanup. The actual
ten-card geometry replays successfully; 25 local harness tests pass, including
reorder/anchor/spacing rejection and asynchronous close-confirm handling. Both
success and failure paths now drain native jobs for a bounded 45 seconds, request
real UI close, observe exit/stdio and verify final native cleanup. All errors are
retained, and an identity-verified forced fallback can never satisfy acceptance.

Profile cleanup observes the exact new SID's processes without changing them,
rechecks PID/SID/session identity, and retains the account if observation or
profile removal is incomplete. Only Win32 32 permits up to six bounded delete
attempts. Registry/path/hive and loaded-profile diagnostics are retained, including
the first sharing violation. Account deletion requires independently confirmed
profile removal. Ten local mocked profile cases and ten SID-classification cases
pass; these are not actual Windows cleanup proof. The original runner's failed
profile remains unverifiable. Local reports are in
`windows/reflow-teardown-profile-regressions/`; the next real Windows run must
supply actual pixels and cleanup results.

Run `41646316340` at candidate `e727fbbe4cd3333657ed70aff8ae0b35eacf1f22`
passed private Rust tests (13), desktop tests (228 passed / 3 ignored), linking
and every strict source snapshot. The standard-user Node harness returned actual
exit 1 after 44,353ms, with drained streams and no forced Node termination. Its
specific product failure cannot be established: evidence copying rejected an
unexpected or oversized file before copying any child report, log or PNG. The
error omitted the rejected filename/size. No retained evidence supports either
render success or native inner-cleanup acceptance. An unbounded driver protocol
log is a possible source of the size violation, not a proven historical cause.
The original ZIP, four verified manifest files and raw workflow log are retained
in `windows/product-attempt-41646316340/`; missing child evidence is not recreated.

This run does independently prove its own outer/account/profile cleanup: the
outer Job was already empty, exact-SID observation was complete with zero matching
processes, and the first DeleteProfile call succeeded. Final ProfileList/path/HKU
were absent and Win32_UserProfile had zero matches; account and stage removal
also succeeded, with no cleanup errors. This fresh runner/account cannot establish
that the failed profile from run `41642093459` was subsequently removed.

Commit `6da36701` fixes a separately reviewed exit-observation race: a late
WebDriver query response could falsely classify a timely application exit as
late. Child exit-event monotonic time and the original abort/deadline now govern
queries and owned-fixture discard actions. The unchanged 15-second budget still
rejects late exits; synchronous deadline checks prevent late action dispatch even
when timer callbacks are delayed. All 32 local helper tests pass and the original
code fails the new targeted regression, retained in `windows/exit-budget-regression/`.
These pure callback tests do not establish Windows product acceptance.
Commit `c309dd43` requests driver WARNING-level diagnostics to avoid repetitive
protocol bodies; complete product/native reports and their limits are unchanged.
The option is supported by the [Selenium Edge documentation](https://www.selenium.dev/documentation/webdriver/browsers/edge/)
and [Chromium driver logging source](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/chrome/test/chromedriver/logging.cc).
It is not a claim that the missing historical oversized file has been identified.

Commit `187a9c31` retains approved in-budget child evidence when a different
file is rejected, prioritizing reports/logs before PNGs. Exact names, original
2-MiB/32-MiB per-file and 126-MiB child-total limits remain enforced; unknown names
are represented only by hashes, with no unknown contents read. Rejection records
and their hashing work have explicit budgets. Copies are hashed and validated;
partial copies are removed only when this invocation actually created them.
Original child failure remains the primary error. Incomplete evidence forces
outer failure, enforced again by the artifact staging check (`06e6a525`).

Six actual local PowerShell collector scenarios and ten Node staging cases passed,
including oversized/unknown/invalid files, bounded hash omission, preserving good
reports, and rejecting a preexisting destination collision without deleting it.
PowerShell output was fed through the real artifact stager. The collision case
correctly fails staging, while ordinary incomplete collections can be retained
only with failed status. Scripts and actual outputs are retained in
`windows/partial-evidence-regression/`. No Windows APIs or remote UI were exercised
by these local collector regressions; the next product run remains necessary.

Run `41649755144` at candidate `27b46adf5de00a1b64c57af726d2f0999ee45943`
passed compilation/linking and every strict source snapshot. It then passed seven
actual UI operations: initial disabled source, enable, edit/save/replacement,
undo, redo, disable/re-enable, and wide rendering. All 13 retained PNGs fully
decode and match recorded browser RGBA hashes; six diagram PNG hashes match
successful native completion records (ordinary 448×102, wide 3528×126). Root
inspected the actual edited graph, enabled output and wide product screenshot:
Chinese labels/arrows are legible, the edit appears, and wide nodes retain their
natural size with a horizontal scrollbar. These are real Windows outputs.

Overall acceptance still **failed** on closing the wide document. Ten native
requests were admitted; nine completed successfully with verified owned-Job,
IPC, profile and private-tree cleanup. Ordinary-window UI close was verified.
For the wide window, the drain completed at 14:11:09.084Z, but another request
was admitted at 14:11:09.121Z during close; the product exited at 14:11:09.345Z
without that request's completion record. The final gate correctly rejected this.
C4, invalid syntax and final-disable steps were not reached. The collector retained
all 26 child files with zero rejections; its 31-file artifact manifest, original ZIP,
raw log, exact timeline and root visual review are in
`windows/product-attempt-41649755144/`. Outer Job, exact account/profile/stage
cleanup all passed independently; none substitutes for the missing native result.

Product investigation identified that confirmation dismissal restores editor
focus and may schedule rendering, while the old close path disposed temporary
plugin storage then destroyed the window without awaiting Mermaid owners.
Frontend fix `b286014b` synchronously closes new-render admission, awaits current
and previously failed private-owner retirements, and invokes a main-only native
shutdown before window destruction. Cleanup failure retains the window and can
be retried; persistent plugin enable/approval preferences are unchanged. Three
new manager regressions cover late admission, pending work, prior failures and
retry. The complete desktop suite passes 981 tests plus four module-bootstrap
tests, and TypeScript passes. Native shutdown and fresh platform UI verification
remain necessary before claiming the fixed candidate passes.

Native commits `498753e3` and `10d12798` complete the proposed close path:
registry admission closes under the render-registration lock, owned jobs are
cancelled and awaited, and uncertain cleanup refuses success. Repeated close
attempts keep the first shutdown wait deadline; each render retains its original
deadline. The separate shutdown wait includes six seconds for existing bounded
teardown operations, not additional rendering time or a claim that synchronous
Windows APIs have hard duration guarantees. Native admission evidence now starts
when CREATE_NEW establishes an owned private root; earlier preflight failures
own no native resources. Every later cancellation follows the same checked cleanup.

A bounded audit barrier drains completed records before exit; dropped records or
writer failures remain explicit failures. Cancelled/expired work cannot be logged
as a successful published result. The main-only shutdown command and native exit
fallback both await this boundary. All 22 portable Rust tests pass, including
active/queued cancellation, late admission refusal, original deadlines, retry,
uncertain cleanup and audit backpressure/failure handling. Linux desktop Rust
checking also passes. These logs and the 981+4 frontend results are retained in
`shutdown-regression/`. New Linux and Windows product runs are required to validate
the combined implementation; prior binaries are not relabeled as this build.

Run `41653312849` at candidate `0e3912db3f2cc4d77dd73513ce73d5440ec36f54`
passed all build/link/source gates but failed during the second UI operation,
waiting for an actual decoded PNG. The initial disabled-source step passed.
Its one native request has complete admitted/started/finished records: same-SID
standard coordinator and zero-capability AppContainer/browser proofs are present,
but `successful=false`, `cleanupUncertain=true`, and no PNG was published. Job
active count was zero, IPC threads completed, and profile/private tree deletion
both succeeded; cancellation and deadline expiration were false. The exact
cleanup error was omitted from the original closed audit and cannot be recovered
from this run. Current code narrows possibilities to IPC join/cancellation or
protocol/read errors, but none is claimed as the proven cause.

The new close gate refused to destroy the window after uncertain native cleanup.
The test subsequently used its identity-verified fallback after its UI-close
budget, so normal UI close did **not** pass. Outer Job, exact profile/account/stage
cleanup all passed separately. The collector retained all 15 child files with zero
rejections (20 artifact-manifest files); three decoded PNGs are UI screenshots,
not diagrams. Root saw the original source plus failure notice. Full original
ZIP, raw logs, verification and review are in `windows/product-attempt-41653312849/`.
C4/invalid/final-disable were not reached. The next change adds bounded closed
cleanup-stage diagnostics while preserving the existing 50ms/250ms join behavior
and every acceptance gate; it must not relabel this historical failure as fixed.

Diagnostic commits `f842abac` and `da41762f` add only closed native evidence:
cleanup-stage enums, per-stream join duration/cancellation/termination, stdout
read/schema/channel/trailing-data classification, and directly observed Win32
codes. The stop-request flag is sampled when an error is observed; it is not a
claim about when a kernel error originally occurred. Renderer status and captured
byte count before cleanup are separate from actual published PNG bytes. No raw
error text, source, stderr contents or private paths enter the audit. Sanitizers
reject unknown fields/enums and malformed numeric codes. The original 50ms I/O
cancellation threshold, 250ms join bound and error-to-uncertainty rules are unchanged.

The final portable Rust suite passes 29/29. An earlier diagnostic test incorrectly
matched the legitimate field name `privateTreeRemoved` while searching for injected
private text; its assertion was corrected to check the injected value. Initial
and final outputs are retained in `windows/cleanup-diagnostics-regression/`.
Actual Windows compilation and product execution of these new diagnostics remain
the next check; no specific historical cleanup cause has yet been established.

Historical cleanup error 5 has not been reproduced or declared fixed.

The inherited Git hook calls `npx lint-staged`, but the v2 baseline has no matching
dependency/configuration. Commits used that hook's documented
`SKIP_SIMPLE_GIT_HOOKS=1` switch; actual package checks, formatting and tests were
run separately. No relevant product check was represented as passing without
execution.
