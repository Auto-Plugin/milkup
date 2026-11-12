# Release quality integration — 2026-11-12

This is candidate evidence, not a release approval. Integration branch:
`dot/release-quality-integration-20261112`, based on
`ef221deb1bde9b56b6bc5faf09105d5bcbd059d7`. No Release, tag or main merge.
Original worktrees are preserved. Commit author and committer are
LarryZhu-dev <larryzhu@foxmail.com>.

## Integrated work

- Editor quality: original `8f02ff66`, `8f07fc00`; integrated as `a0b152f4`, `aca9defe`.
- Distribution: `84d9e6a5` → `8d1431d3`; signed manual recovery preparation → `cad6b0cf`.
- Windows PDF/print: `742d0637` → `69fa85d3`, `8107bc5b` → `9c9eafd9`,
  `c49fe3fc` → `7f10b28d`; review fixes → `7afd13c2`; native fixtures → `66256214`.
- Mermaid retained image history and Outline 1.3.4: `7def1399`, `31c27aed`.
- Integration fixes preserve preview image ownership across focus/viewport changes
  (`fdcf3e6c`), and prevent already-observed scroll/resize events dismissing a
  freshly opened context menu (`18711cfd`). Real geometry changes still dismiss it.
- The original editor source/live control is retained. Mermaid's source/rendered/
  mixed policy is a separate plugin setting, not a global three-mode editor control.

## Windows PDF and print: exact tested candidate

[Run 43141132432](https://github.com/Auto-Plugin/milkup/actions/runs/43141132432)
passed at `0ccc4c4cafc7e69acfd2d551bec230075ab925d0`:

- 20 output contracts passed; four opt-in tests were ignored by that first invocation.
- A separate opt-in test actually rendered all four PDFs using installed WebView2.
- A separate real print-dialog test guarded Printer Properties and cancelled the
  controlled dialog without submitting a job. This is not positive queue or physical printing.
- Original artifact `13909458608`, ZIP SHA-256
  `48935663333ee88eb19bd8b608de52359be86eba39458b833897ac47c69ad94a`.
  Retained until 2026-11-19. Its `summary.json` records `releaseReady: false`.

Independent `pdfinfo` examination:

| PDF              | Dimensions (points) | Rotation |
| ---------------- | ------------------- | -------- |
| A4 portrait      | 594.96 × 841.92     | 0        |
| A4 landscape     | 841.92 × 594.96     | 0        |
| Letter portrait  | 612 × 792           | 0        |
| Letter landscape | 792 × 612           | 0        |

All samples are one page. Text extraction from A4 retained Chinese, emoji,
typographic quotes and the sample combining character. This is limited sample
evidence, not complete multilingual, multipage or visual fidelity acceptance.

### Failures retained and actual fixes

The earlier landscape fixture forced A4 portrait CSS while asking the API for
Letter landscape. The fixture now matches the real serializer's paper/direction
CSS; a deliberately contradictory portrait case remains a negative control.

Earlier real network tests detected an iframe TCP connection even with CSP and
awaited CDP offline setup. A reset connection is still a connection and was a
failure. `0247439d` adds an HTML-token validation boundary before launching the
output helper and inside it: browsing contexts, preconnect links, base changes,
refresh directives and malformed input are rejected. `0ccc4c4c` also rejects
comments to avoid raw-text parser ambiguity. This validator accepts the controlled
static serializer; it is not an arbitrary-HTML sanitizer. Escaped code samples remain accepted.

On the passing real run, all five image/script/frame/style/preconnect listeners
for all four paper cases reported `WouldBlock` with no connection. The disallowed
frame/preconnect/refresh samples are rejected before navigation; the allowed
static output still runs through the browser's network restrictions.

Run 43140477351 at `0247439d` passed three papers but failed the fourth while
removing the private profile: Win32 sharing violation 32. `0ccc4c4c` retries only
sharing/lock errors 32/33 within the existing two-second cleanup deadline;
other errors fail immediately and successful return requires actual removal.
Tests cover delayed release and a handle held beyond the deadline. The later
passing run did not bypass this cleanup requirement.

## Performance and public plugin packaging

All eleven public plugins were rebuilt and verified, including export-print 1.0.1
and Outline 1.3.4. Historical manual-trial gates pinned to Outline 1.3.3 are not
evidence for these packages.

A paired 18,000-heading CPU/index benchmark against `ef221deb` measured medians
94.014 ms before and 82.374 ms after, a 12.38% reduction. It excludes native scan,
storage, IPC, input and paint; it is not a native cold-start or UI p95 claim.
The Mermaid cache change retains the shared 64 MiB/128-image limits and bounded
prefetch; current Windows long-scroll acceptance is tracked separately below.

## Current platform gates

| Gate                        | Exact run/candidate                                      | Status at this checkpoint                                                                                                                               |
| --------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dual-account source         | 43141649677 / `bf8a2d50`                                 | Failed before product/GUI execution: wrapper exact-ref whitelist omitted the integration branch. Rust checks passed.                                    |
| Dual-account retry          | 43143354426 / `988a0f735a7e10b5cd66c1848eeb482cbfa8efe3` | Both product accounts passed initial preview and plugin strategy observations, then timed out at the stale global-preview assertion. GUI still running. |
| Earlier three-package build | 43139149455 / `66c6fe3c`                                 | Offline Windows and Linux deb built; standard NSIS built but failed the older network gate. Whole run failed; no installation acceptance.               |
| Three-package build         | 43141877202 / `bf8a2d50`                                 | In progress. This candidate does not contain `18711cfd`'s menu fix.                                                                                     |
| Latest three-package build  | 43143356894 / `988a0f735a7e10b5cd66c1848eeb482cbfa8efe3` | Pending behind the running build.                                                                                                                       |

The installation workflow downloads the original artifacts from a successful,
exact-SHA distribution run and checks receipt, size and SHA-256 before execution.
It does not rebuild the tested package. Windows smoke checks install, owned native
window, normal close, actual NSIS uninstall and unchanged fixture; Linux smoke
checks dpkg installation/removal. These are narrower than full installed GUI,
old-profile migration, absent-Runtime provisioning or recovery acceptance.

## Browser checkpoint

The first complete integrated Linux Chromium run finished with 293/294 passing.
The remaining context-menu failure was reproduced with actual Worker RPC traffic:
requests `editing-10`, `editing-11`, `editing-12`, `editing-18` were cancelled after
the host posted snapshot responses; cancellation no longer found an active RPC.
Those unaccepted snapshots remained allocated, and `editing-19` returned `busy`.

`5d79147a` retains the originating RPC identity until the captured snapshot is
consumed or released, so a cancellation during response transit releases it.
The new controlled-delivery test failed before the fix and passes twelve
consecutive cancellations after it, exceeding the unchanged eight-snapshot limit.
Unknown cancellation cannot release the current accepted snapshot. The plugin
package's 623 tests and TypeScript check passed; eight real Worker repetitions
passed without instrumentation. A subsequent complete browser run passed
**294/294 in 4.9 minutes**, including production-CSP controls. This is Linux
Chromium, not native Windows/WebKit or system IME evidence.

Windows product tests are being aligned with the user-requested plugin boundary:
the original document button switches source/live, while Mermaid has three
strategies. The old test incorrectly required a third global preview state. The
replacement keeps exact caret, decoded PNG, hot enable, source preservation and
trusted native copy checks, and requires the editor to remain editable.

## Historical issues and remaining verification

- [#255](https://github.com/Auto-Plugin/milkup/issues/255): current browser cases type
  English/digits inside parentheses, wait 2.5 seconds, verify the caret and type
  another character; another case checks single-space headings after an image.
  They passed in the integrated browser suite. They are not yet rerun in this
  exact installed Windows candidate.
- [#252](https://github.com/Auto-Plugin/milkup/issues/252): the current browser test
  reads actual clipboard HTML with editable table structure and exact plain-text
  Markdown; source mode offers plain text. It passed. No Word 2016 executable is
  available in this Linux environment, so actual Word paste/editability is open.
- The July Windows IME report is useful historical evidence, not acceptance for
  this candidate. Synthetic composition tests cannot replace a real candidate
  window, candidate selection, commit, cancel and undo through the system IME.
- Linux WebKit PDF text/fidelity remains open. No complete matching WebKit
  2.52.6/2.54.2 source or configured build tree exists in this environment.
- Fresh signed recovery preparation has contract tests, but actual installation,
  restart health and old-profile recovery remain unverified. Recovery is manual;
  automatic application rollback has not been implemented.
- Formal signing, release channels, physical printing, printer-job cancellation,
  native DPI and full current installed Windows/Linux GUI remain separate gates.

No package in this checkpoint is declared a completed formal release.

## Later installation/build checkpoint

`43141877202` at `bf8a2d50` completed successfully for all three variants. This
predates the menu and editing-RPC fixes. Original installer SHA-256 values:

| Variant          |     Bytes | SHA-256                                                            |
| ---------------- | --------: | ------------------------------------------------------------------ |
| Windows standard |   7247357 | `50d658b124376c9841bc9813bd6e066097c01afc72846d86ed641885db464b03` |
| Windows offline  | 225029557 | `8784d59e804991bffd65b0dc12126f9e917cd28226ff13f1d7c02c5809057642` |
| Linux deb        |   9830948 | `d51c3b28df336f43ce0881ee67fe4aa743833bb6f3f16d6a9323821104e7aee0` |

Installation run `43146097590` used these original artifacts. Its standard
Windows installer exited 0, but the test selected `Process.MainWindowHandle`
133.4793 ms after launch with an empty title, then normal close timed out at 15 s.
Forced cleanup is recorded; uninstall did not execute. Artifact `13910774883`
retains the original failure. The later test enumerates and validates the unique
visible, unowned `Tauri Window` titled `milkup` for the exact PID, process birth
and image before posting close. Both the 45 s startup bound and 15 s normal-close
bound remain unchanged. Real Windows outcome is still required.

That standard runner reported no Word executable and only `en-US` / `0409:00000409`.
This confirms missing environment for the requested Word 2016 and Chinese IME
cases on that runner; it is not a failed product behavior test.

Latest source acceptance `43145964546` and package build `43145985835` are bound
to `5d79147ac0c27be58f4e3697b127b6c2d98561df` and remain pending at this update.
The superseded `03ced613` source run was cancelled while pending with no job;
no running verification was cancelled.

## Verified original-package installation results (03:19 UTC)

All results below install the original `bf8a2d50` artifacts from successful build
`43141877202`; none substitutes a rebuilt package. They do not cover the later
`5d79147a` application change.

- Windows standard and offline passed in run `43146827839`, using installation
  harness `7f3e488a`. Four real native identity/target negative checks passed first.
  Both installers exited 0, the exact owned Tauri window was observed, normal
  application close exited 0, and the actual NSIS uninstaller exited 0. The
  application binary was removed and the fixture document SHA was unchanged.
  `forcedCleanup` is false in both original reports.
- The standard startup snapshots distinguish an empty-title `Tao Thread Event
Target` at 161.6981 ms from the later `Tauri Window` titled `milkup`. This confirms
  why selecting `Process.MainWindowHandle` at startup was insufficient. Measured
  launch-to-owned-native-window time: standard 5021.4523 ms, offline 4693.7097 ms.
  These are two separate samples, not first-paint or Mermaid-render latency.
- Standard artifact `13912640712`: ZIP SHA
  `2bb3f8173ad40843b896d626611ded2fdd0766dfb24f8198013da365ea7d4ea6`.
  Offline artifact `13911977772`: ZIP SHA
  `87de2e5d1943a3f49ab7b48495ab0909cda03020c5d215b8d515e6d09ab68a48`.
- The first Linux attempts failed resolving dependencies because the hosted
  runner's stale APT index referenced superseded packages (HTTP 404). `fb130427`
  refreshes signed repository metadata before installing the exact local deb;
  it does not skip dependency checks. Linux-only run `43147155565` passed native
  installation, installed executable verification, dpkg removal and unchanged
  fixture. Artifact `13911822643`: ZIP SHA
  `472dcbf00c6369d0564c212d5e7bcaaecbe2d0e2f5cf11744bdb81c917635f41`.
  This Linux run does not launch the GUI.

## Source GUI audit boundary

The original report from `43143354426` at `988a0f73` is retained in artifact
`13911354015` (ZIP SHA
`1ffa9b12738556e1334d655f4f7edc778cb47cd74629f6ac58be7a564595b667`).
Both accounts completed all eight GUI steps, including 12-diagram visits and
idle/busy normal close. Filtered-admin final contract passed. Pure-standard final
contract failed because one child SHOW lacked unique lifetime proof; there was
no overflow. Its compressed evidence was reassembled with every chunk length,
chunk SHA and restored raw SHA verified.

The unresolved pure-standard event is SHELLDLL_DefView `0x1028a`, SHOW sequence
389, native tick 783750 and processing tick 783765. The initial processing read
saw a live child, but both post-parent-destroy continuity reads found it gone.
`doubleReadMatched` is false. Held PID/thread identity is not sufficient to fill
this window-generation gap. The audit remains incomplete; a zero console count
is not evidence that no console appeared in that run.

Latest `5d79147a` source run `43145964546` is executing product acceptance; its
build `43145985835` is still pending behind the already-running `988a0f73` build.
The latest source/package conclusions remain open. No running verification was
cancelled, and no formal release has been published.

## Second product harness correction (03:26 UTC checkpoint)

Run [43145964546](https://github.com/Auto-Plugin/milkup/actions/runs/43145964546)
at application candidate `5d79147ac0c27be58f4e3697b127b6c2d98561df` passed product
steps 01 and 02 in both accounts, including the corrected independent Mermaid
policy, hot enable, original source/live toggle, real copy and cursor checks.
Both then failed step 03 with `Timed out: Rendered mode with undo history`:
a second obsolete assertion still expected the original toggle to enter global
`preview`. Product artifact `13912187105` was downloaded and verified (ZIP SHA-256
`885217ffa73708956b7dce799f32e94f11a4eb9cb71ba3a879a0892752861aa6`).
The independent GUI stage is still running; this is not a passing source run.

The correction removes that obsolete global-readonly assertion and instead
requires real Ctrl+Z in editable `live` mode while the Mermaid plugin policy is
`preview`: version increments exactly once, original file bytes and decoded
original pixels return, then redo must restore edited bytes/pixels. The installed
product verifier also requires the new proof; missing fields, readonly/global-mode
leakage, unchanged history and inexact source are rejected. All 259 relevant Node
contract tests pass locally. Actual Windows execution remains required.

No application bytes changed after `5d79147a` in this correction. Its exact
three-package build [43145985835](https://github.com/Auto-Plugin/milkup/actions/runs/43145985835)
is pending behind the earlier `988a0f73` build. Earlier `bf8a2d50` installation
successes above cannot establish acceptance of this newer application.

Correction commit `d9f627be2366e7b78f03e431a23f6b4dc03865c1` is pushed; its
[Windows run 43148218776](https://github.com/Auto-Plugin/milkup/actions/runs/43148218776)
is pending. This commit changes acceptance and its evidence only, not application
source. Both author and committer are the requested LarryZhu-dev identity.

## Actual same-version missing-file repair (03:32 UTC)

[Run 43148634413](https://github.com/Auto-Plugin/milkup/actions/runs/43148634413)
passed using harness `ae5930d466875982153b652c648c5bf3322c351a` and the unchanged
standard installer from `bf8a2d50` build `43141877202`. Original artifact
`13913255309` was downloaded, its 4937-byte ZIP checked against SHA-256
`db1e04217134666aafdcfa23793ebf8f8aa1cd48fca910983110f1fafcfe0f0e`, and its
`installation.json` examined independently.

After an initial normal close, the test backed up the exact owned executable,
removed only that file inside the newly created ephemeral installation, and
proved it absent. It rechecked the original installer's SHA before same-version
installation. Installer exit was 0 and the restored application SHA exactly
matched the original:
`9cad2223566f6cfdbc7a9fbeae53a6a5f36e4773129dd105f0e2b15e8c96575c`.
The fixture document was unchanged. Repair startup reached the exact Tauri root
in 925.849 ms (initial launch: 3997.5772 ms), then normal close and actual NSIS
uninstall both exited 0. There was no forced cleanup. These two window timings
are not document-ready or renderer timings.

This proves the installer repair mechanism for missing executable bytes, not
full recovery health. Document open/edit/save after repair, actual plugin/config
restoration, older-version migration and signed recovery authorization are not
verified. The checked-in channel has `endpoints: []` and `publicKey: null`; the
real channel validator returns `Production update channel is not configured`.
No test key or unsigned candidate is substituted for the formal trust gate.
Automatic rollback remains unimplemented.

The same Windows runner again reported no Office/Word executable at the checked
Office16 locations and only the en-US input method. Current native Word 2016 and
Chinese IME coverage therefore remains open. Local Linux has no DISPLAY/Xvfb,
no installed tauri-driver and no system webkit2gtk-4.1 pkg-config entry. The older
sysroot's WebKitWebDriver alone does not establish a runnable native GUI; browser
Chromium results and dpkg success do not substitute for it.

Application source correspondence was checked between `5d79147a` and harness
`ae5930d4`: apps, packages, plugins, lockfile, root package and distribution build
script have no differences. Git tree IDs are respectively
`d04d68f9f88f02c62c035a27279c182cf3a99d3e`,
`5d601750e638bca562b821ef0e2956973725c1bd`, and
`2e2e9ad49080431a73d96a8eb7a9e582f4ccec03` for apps/packages/plugins on both commits.
This establishes source equality only; exact installer receipts and original
package hashes must still be verified for the pending `5d79147a` build.

## Completed GUI evidence and queue diagnosis

`43145964546 / 5d79147a` finished with overall failure from the previously recorded
obsolete product assertion. Both independent GUI reports passed all eight steps.
The original final artifact is `13912913400`, 1,475,382 bytes, ZIP SHA-256
`a77d545169ea81f32a18bd2f6cca65ac5cd0eb4dd2e836868bcde441359f237f`.
Both gzip window reports were independently restored, checking each chunk length,
chunk SHA, combined length, raw length, raw SHA and newline count. Raw SHAs:

- pure-standard: `2cf5464d4a71735a1bab3b07a8d531f472224f759b2cf9d83346312f59e02911`;
- filtered-admin: `a033935c4b168e04db92dcf31a9160b933c0430119016317d464b34ea349d139`.

Each account resolved 103 SHOW records (56 child, 47 root), with complete=true,
no overflow, positive control passed, and zero observed product/unattributed
visible consoles. Both compact and spaced documents contain 12 diagram offsets,
include visits/revisits and 18 trusted rapid wheel events, with unchanged source.
Idle and busy closes have pending counts 0 and 1 respectively, real UI close,
exit 0, no forced termination, and verified inner cleanup. This later success
does not erase `988a0f73`'s retained pure-standard lifetime-proof failure.

The source queue is explained by the explicit shared concurrency group
`mermaid-rebuild-windows-compile`; `43148218776 / d9f627be` started at 03:36:25 UTC
once the prior source run ended. The distribution queue is also explicit:
`distribution-candidate-${ref}` and matrix `max-parallel: 1`. The `988a0f73` run
`43143356894` completed all three builds successfully at about 03:39 UTC, and the
latest `5d79147a` build `43145985835` then began. This is observed serial execution,
not evidence of unavailable Windows runners. Neither active run was cancelled.

The `988a0f73` original build receipts report these exact package hashes (not
installation acceptance, and not the later application candidate):

| Variant          |     Bytes | SHA-256                                                            |
| ---------------- | --------: | ------------------------------------------------------------------ |
| Windows standard |   7243492 | `df820ce92727130a7ed55c6b1bbfd4215b322d1ef65706d571911e6f51aac6b9` |
| Windows offline  | 225027394 | `a8a89159ac302acc52d85d771f3c67d6bc6641185b0019c23f2c3b72213953ba` |
| Linux deb        |   9831208 | `1b76fa6ea5c80853a45a09ccea8928d6775af2ab02c0aabd2e25f4cbc2b3123a` |

## Repair health extension: first protocol failure retained

`961c105d` adds optional real installed edit/save and Diagrams switch persistence
checks before/after same-package repair, through W3C input and read-only shipped
DOM observations. Each phase has a 180-second total bound. The first run
`43149596177` failed before inputs: EdgeDriver rejected the `detach` option during
session creation. Artifact `13912998024`, 6456 bytes, SHA-256
`074b74a69a50bb8ac1796e02d2e6591cb56b69f882a6d9fd86e65b234e16c74f`, preserves that
failure. It is not a document-editing or recovery-product failure.

`53667c84` now uses the same WebView2 capabilities as the established dual-account
suite (`browserName: webview2`, `ms:edgeChromium: true`, debugger address only).
Run `43149872319` tests this correction against the original `bf8a2d50` installer.
The new health checks are not yet accepted. They do not represent complete
configuration migration, formal signed recovery or dual-account isolation.

## Subsequent dual-account evidence and startup gate

`43148218776 / d9f627be` has finished. Pure-standard product passed 11/11,
including real undo/redo under the independent Mermaid policy. Filtered-admin
product never entered a test step: after a successful WebDriver attach at
3376.70 ms, GET `/session/.../window/rect` timed out at 30009.47 ms. Failure
observations still showed an empty untitled document. Normal failure-path UI
close, stdio close and inner cleanup succeeded without forced termination.
This is not evidence that the filtered account completed product acceptance.

Both independent GUI suites passed eight steps and their final contracts.
Original artifact `13914247685` is 1,725,048 bytes, SHA-256
`6dca82fe28b8411cde6803fc8edb518e912cea9034cd881b9a08d41a08f5bf02`.
Both compressed window reports were independently restored with chunk/raw
length, hash and newline checks. Pure-standard raw SHA is
`a9fafbbeea277e461d95caac1326b70944674b35ea44bf597227c3f2aea2a2e0`
(103 SHOW records); filtered-admin is
`6c220ed919361cb90de880e60bdcfe237744496bb9f913e7ce9d31f6416ae039`
(104 SHOW records). All SHOW records resolved, complete=true, overflow=false,
positive control passed, and zero visible product/unattributed consoles were
observed. These GUI results do not replace the failed product startup gate.

`f7efe4ef / 43151150510` is testing a startup ordering mitigation: first wait
for the exact initial document, then query native window geometry. The 640x480
and bounded request gates remain. New geometry-start/observed timestamps are
part of the checked startup stage list. Its result remains pending; this order
change is not yet a proven fix for the earlier stall.

## Latest native output build evidence

The Windows standard job of distribution run `43145985835 / 5d79147a`
succeeded. Original PDF artifact `13913981937`, 207,353 bytes, SHA-256
`65424d9de3a0e4c9a03a2060eae3171ac17af5e55046d52a07f2299a094d9162`
was downloaded and verified. `pdfinfo` confirms A4 portrait/landscape
594.96x841.92 / 841.92x594.96 pt and Letter portrait/landscape 612x792 /
792x612 pt, all Rotate=0. All 20 document-network listener checks recorded
WouldBlock (no connection); real print-dialog cancellation passed. Physical
printing, positive queue submission, general visual fidelity and Linux output
are still not accepted. Offline and Linux package jobs were still pending at
this checkpoint; the full build must finish before immutable-package installs.

## Repair-health environment and coordinator failures

The original `bf8a2d50` same-version missing-executable repair remains passed
in `43148634413`; editing/configuration health is a separate unfinished check.
The direct elevated-host attempts did not reach document/plugin inputs:
`43149872319` timed out attaching, and `43150254458` could not observe the debug
endpoint within 45 seconds. `43150941247` then measured the coordinator token
as elevated, integrity RID 12288. It rejected that environment before installing.
The missing endpoint is consistent with the Runtime 150+ elevated-host debug
hardening described in MicrosoftEdge/WebView2Feedback issue 5645. No HKLM,
UAC, desktop ACL or debug-policy bypass was introduced.

`28973785` adds a fresh, owned pure-standard account coordinator using the
existing held-Job/token/SID/session gates, a credential-free child environment,
read-only staged code/input and exact profile/account cleanup. The first run
`43151667708` failed before account/install creation because raw .NET parent
DirectoryInfo objects do not have PowerShell's PSIsContainer decoration.
`73b08219` switches to the actual DirectoryInfo type while preserving every
ancestor's reparse rejection. Its run `43152150613` reached account creation
but Windows rejected the 59-character description (48-character maximum).
Original artifact `13914208154` is 3,961 bytes, SHA-256
`6741dc19cc5941493fb41e3278c8066a00a551988f289467163f320351124a32`;
no account or product was created. `bff604e1` shortens the unique ownership
marker to 46 characters. These are retained harness failures, not successful
installed health checks or product failures. A fresh actual Windows run tests
the corrected coordinator; the original installer bytes are unchanged.

## Completed latest distribution build (04:10 UTC)

All three jobs of `43145985835 / 5d79147a` now passed. Exact original receipts:

| Variant | Bytes | SHA-256 |
| --- | ---: | --- |
| Windows standard | 7243882 | `9e94706c2b144d92dad5d0f65a7b6b3ffa014de7e61d698a59a1d1813cde687c` |
| Windows offline | 225033696 | `bd7e9db7d7ff464b8b39faf2abe7d93aedf19c0d5ef7422602cff2affc05f5c1` |
| Linux deb | 9830936 | `32ad2b5d0f52cac501212f14389e1b7e8bf5039d07b02d1bea6b7a8d1bdae41c` |

Original package artifact IDs are `13913767237`, `13913364273`, `13915005041`.
The standard ZIP was independently downloaded, its archive hash verified, and
its installer was checked using the canonical verifier against the exact SHA.
No later application/package source changes exist through `ca39599b`; that
later harness commit is not falsely identified as the package build commit.
An all-variant installation run was dispatched only after the entire build
succeeded. Windows additionally exercises same-version missing-file repair;
Linux only installs/removes the deb. Acceptance is pending.

Standard-account health run `43152343045 / bff604e1` verified the pure-standard
token (RID 8192), inherited existing interactive desktop, exited with an empty
Job and removed its profile/account/staging root. It failed before installation
because direct driver-version invocation produced no captured stdout.
Artifact `13913598974` SHA-256 is
`e85d9ee3ab784bf0bcea890aa7192dd48214a7e0e0d711325df00bd29a9dcbd1`.
Explicit stream capture in `32b80f69 / 43152659497` produced exit 0 and
`Microsoft Edge WebDriver 156.0.4314.58 (...)`; the strict banner matcher wrongly
expected only `MSEdgeDriver`. Its artifact `13914323449` SHA-256 is
`75c225d5c1c1944233a8743dce4d177eaf5a229fc7fc6a6dda7b3644bb680468`.
`ca39599b` recognizes both explicit banners while retaining signed Microsoft
binary and exact installed Runtime version checks. `8fdad5c2` also moves child
Node receipt/health execution onto the established bounded stream/EOF capture
helper. Run `43152924203` validates these corrections against the unchanged
`bf8a2d50` package; installed editing/configuration health is still pending.

## Latest installs, newly found close defect, and next application candidate

`43153087839 / ca39599b` used only the original `5d79147a` packages. Standard
Windows install, normal close, missing-executable same-package repair, second
normal close and actual NSIS uninstall passed, no forced cleanup. Restored EXE
SHA is `4ff93b8dd448243426a5faf3a095fa94cc84dc1cc1a206df0093ab4f9f174a9e`.
Artifact `13914469011` SHA is
`c83ecfedb2dff5c27d08416eb196ef869abf2cd6564da664def53434210c6a1a`.
Linux package installation/removal also passed (GUI not exercised).

Offline Windows failed **after repair**, not during installation: installer and
repair each exited 0, initial close exited 0, restored EXE SHA matched
`09d30998758c26b8a978a6c7dab4e28def9dc65d6a8ec0e32200f4640144fbca`.
The repaired process exposed its owned Tauri window after 655.21 ms. The real
native close request did not exit within the unchanged 15-second budget;
forcedCleanup=true and uninstall was not reached. Artifact `13914722195` SHA is
`597f1e51991e0a7cbcb42ad9f248c70317bbe65a265d09949aad626e411e1a77`.
This failure is retained; neither the standard pass nor a later rerun erases it.

Inspection found a reproducible application defect consistent with this timing:
main prevents native close, then documentTransitions.request silently returns
while loading/saving is busy. `8a537208` retains one pending window-close intent,
rechecks the current document after loading/saving/transition completion, keeps
ordinary unsaved-change confirmation and cleanup, and clears the intent on
cancellation. No close timeout, save or cleanup requirement was loosened.
69 transition/workspace tests, desktop TypeScript checking and three real
Chromium UI tests passed (including save failure followed by unsaved-content
confirmation). The first browser invocation could not start within nested
bubblewrap; the approved retry outside bubblewrap retained Chromium's sandbox
and passed. This is not Windows validation. Actual offline failure causality
still requires the next native installation run.

Application/source candidate `8a5372080f1ce72426d90a370796c87a40bb3ac9` now has
source run `43154244097` and distribution run `43154244021`. Previous `5d79147a`
package/source results must not be assigned to this changed application.

## Startup-order mitigation product result

`43151150510 / f7efe4ef` original product artifact `13915150383` is 1,088,691
bytes, SHA-256 `f73a340c1480477c34a4b91ce2f0a2b07087a44e820fe1604a0d5443704349b8`.
Both product reports were independently restored after validating packed/raw
SHA and lengths; both passed 11/11 and both external account audits passed.
Both did reach the initial-document-ready observation before native geometry;
geometry then took about 3.81 ms / 3.41 ms, avoiding the earlier 30-second stall
in this run. Independent GUI is still running at this checkpoint.

This is **not** a uniform startup performance pass: pure-standard first decoded
image was 17,493.1 ms after navigation (about 20,634 ms after process start),
filtered-admin 2,722.2 ms after navigation (about 3,434 ms after process start).
Pure-standard shell-created-to-first-paint was about 4694 ms, multiple initial
IPC requests took about 1195-1199 ms, and catalogue preparation also had slow
calls. These observations do not isolate a single cause or establish a p95.

## Repair-health harness now reaches the installed UI

`43152924203` identified that child Node name lookup was unavailable. The next
exact-image attempt `43153242826` exposed the specific cause: Get-Command
returned two Node installations, coerced into one invalid path. `4bafc426`
selects the first resolved executable and binds its absolute path/hash through
the read-only child spec, as the established account wrapper does.
`43153859562` then installed `5d79147a`, attached to the production WebView,
opened the exact document and changed the real Diagrams switch true -> false.
It failed trying to click a nonexistent zero-numbered source line; no editing
or repair health is claimed. Artifact `13915720275` SHA is
`d413f7814f1902bcb50ffad667fe3f14e6e3aa91635550edeb72d9ebc3fab5a2`.
`d4cca75a / 43154235678` selects an actually visible source line, sends Enter as
a real WebDriver key, and preserves failure DOM/screenshot evidence. It still
uses the original `5d79147a` package; the new close fix is not in those bytes.

## Real installed repair editing/configuration health passed

`43154235678 / d4cca75a` passed against the **original standard package built
from `5d79147a`**, SHA `9e94706c2b144d92dad5d0f65a7b6b3ffa014de7e61d698a59a1d1813cde687c`.
Artifact `13915581051` is 60,887 bytes, independently verified ZIP SHA-256
`b63535f2a3d4180bfab9ae42a99649fa1e34208cc26471e5d89f779ccf35c73d`.
Both real-input reports and the final supervisor/installation reports passed:

- Before repair: exact installed document opened, actual Diagrams switch true ->
  false, real keyboard appended REPAIR-BEFORE and saved exactly 132 bytes,
  SHA `e73aa5bc78a4b8660cc54f10d21c1aa20ad08bf4fec116ff843eccb4f998a83d`.
- Same-package missing-file repair restored exact EXE SHA
  `4ff93b8dd448243426a5faf3a095fa94cc84dc1cc1a206df0093ab4f9f174a9e`.
- After restart: saved document SHA unchanged and Diagrams remained disabled.
  Real switch false -> true, then real edit/save yielded 145 bytes,
  SHA `5776941db374510f0d0ad9eeb2d006e909e02b7fd2581b035a63e5de597538ac`.
  Without another restart, a nonuniform 448x95 decoded diagram appeared,
  pixel SHA `c704f6bd68116bb15b17bbb2542cd7138353aeb6dbbf8034e656140a4bd3af2c`.
  The actual screenshot visibly contains the diagram and both saved edit lines.
- Both actual native closes exited 0, NSIS uninstall exited 0 and preserved the
  edited document. forcedCleanup=false. The child coordinator exited 0 with
  activeBeforeOuterCleanup=0, Job empty, and no cleanup errors; exact temporary
  account, profile and staging were removed. Existing desktop ACLs/security
  policy were unchanged, and the child token was verified pure-standard.

This proves this one plugin choice and document's same-version repair health;
it does not establish all configuration migration, signed update recovery,
automatic rollback, filtered-admin repair health or acceptance of the later
`8a537208` application. That later candidate still requires its own package tests.

## f7 complete native acceptance and cold-start breakdown

`43151150510 / f7efe4ef` completed successfully at 04:30:41 UTC. Full original
artifact `13915227891` (2,301,250 bytes) has verified ZIP SHA-256
`79d42c866547cfb0c91543e3f6328e8bd8ae0b6d71483ea8d69d528e74adb14d`.
Both accounts passed all eight GUI steps including 12-diagram scrolling/revisit
and real idle/busy closes; final contracts passed. Both original compressed
window reports were independently restored with each chunk length/hash and raw
length/hash checked. Each has 103 resolved SHOW records, zero unresolved,
complete=true, positiveControlPassed=true, overflow=false, no observer errors,
and zero attributed or unattributed visible consoles. Raw report hashes:

- pure-standard: `44e043ec586e8f3dd39bfeef7c6c43326a0c223208fb8eca194c6aed04a783f2`
- filtered-admin: `ed17a3d7d88981c3d0524727a35714b5b7a427d19d829cde783ed186ac9cfae0`

The initial ordinary document was observed without input in each fresh account.
The first diagram was decoded about 20,634.2 ms / 3,433.6 ms after process start
(pure / filtered); these are individual cold samples, not a p95 or cache revisit.
Process-to-navigation was 3,141.1 / 711.4 ms. Native-audited frontend milestones,
relative to process start, separate the remaining work:

| Milestone | Pure standard ms | Filtered admin ms |
| --- | ---: | ---: |
| Frontend engine assets read | 18331 | 2530 |
| Opaque frame loaded | 18575 | 2752 |
| Engine ready, boundary checks complete | 19802 | 3111 |
| First render started | 19814 | 3121 |
| First render finished | 20621 | 3423 |
| First decoded observation | 20634.2 | 3433.6 |

Thus actual first render was about 807 / 302 ms, with about 13.2 / 10.6 ms
until decode observation. Most of the outlier predates engine loading. Existing
marks show a 4694 ms shell-create/paint gap and slow initial IPC/catalog calls;
they do not yet distinguish synchronous startup work from scheduling or native
I/O. The next diagnostic adds fixed startup checkpoints and at most 128 paired
native catalog call marks (plus an explicit limit marker), no paths/settings or
package contents, while preserving exact calls, failures and authorization.
The engine already prewarms on its approved activation epoch; no duplicate
prewarm or speculative security/timeout change is being introduced.
