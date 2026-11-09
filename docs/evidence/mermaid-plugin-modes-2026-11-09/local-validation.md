# Mermaid plugin strategy correction and bounded prefetch

Base: `4c2a43aab3f97f608149df0127da774c4c682716` (`dot/mermaid-stability-20261104`).
Candidate branch: `dot/mermaid-plugin-modes-20261109`.

## Scope and cause

The prior implementation exposed document-wide source/preview/live controls while the request concerned Mermaid alone. This change removes only the newly added document mode bar and status-bar select, restores their previous layout, and keeps the original editor mode toggle and shortcuts.

Mermaid strategy now lives in the diagrams plugin's details. It is host-owned, persisted separately from document mode and the signed plugin manifest, defaults to mixed for absent/invalid historical data, and applies immediately. Source suppresses Mermaid rendering; render shows the authenticated image without making the document read-only; mixed exposes the focused Mermaid source while editing. Original whole-document source/preview behavior still applies. Ordinary Markdown and other plugin output do not receive the per-image override.

Rendering was prepared only from the currently loaded presentation window, with a 300 ms quiet-scroll delay before another request. The new host-only preparation scans a maximum 256-line nearby window starting up to 48 lines before the foreground window's end, admits at most eight previously uncached authenticated fence renders per window, and reuses the existing cache. It never runs arbitrary text/mixed providers speculatively. Cache accounting retains the existing 64 MiB encoded/decoded-cost ceiling and aggregate fragment limit. Foreground work remains prioritized, stale document/theme/activation work is revoked, and source mode pauses pending speculative work. Pure authenticated PNG views use a 16 ms scroll debounce; mixed generic providers keep their prior 300 ms scheduling policy. No unbounded whole-document rendering was introduced.

## Local validation (Linux, 2026-11-09)

Passed against the final candidate implementation:

- `pnpm typecheck`: all 14 workspace projects.
- `pnpm --filter @milkup/desktop build`: production Vite build. Existing large-bundle warning remains.
- `pnpm --filter @milkup/desktop test`: 1,029 Vitest cases plus 4 native-bootstrap Node cases.
- `pnpm --filter @milkup/view-dom test`: 1,001 cases.
- Focused Windows harness/source-receipt tests: 311 cases passed using `node --test tests/windows/mermaid-product-e2e.test.mjs tests/windows/mermaid-gui-regression.test.mjs tests/windows/mermaid-gui-startup.test.mjs scripts/ci/verify-mermaid-source-acceptance.test.mjs scripts/ci/prepare-mermaid-trial-payload.test.mjs`.
- Modified-source Prettier check, `git diff --check`, and `node scripts/check-versions.mjs` passed.

New unit coverage proves an off-window fence is prepared before a later visible request, that arrival and caret movement reuse its render, that a 10,000-fence document initially prepares only eight, that unrelated providers are not speculated, that a full 256-line foreground still prepares beyond its end, and that pause/clear releases or prevents background work. Both ordinary and windowed views test per-image source/render/mixed behavior without changing their existing editability or source text and without a second decode.

Expanded Windows helper checks had 412/413 pass. The one failure is the pre-existing `tests/windows/plugin-offline-delivery.test.mjs:135` prohibition of `alias:` in `verify-public-plugin-builds.mjs`; the unmodified base already includes the SDK alias at line 215. That gate is not claimed passed or changed by this patch.

## Required Windows acceptance, not yet run

The existing real source and installed-product workflows were extended, not replaced. The product harness uses native pointer/keyboard input for the plugin setting, verifies legacy default and persistence, and requires unchanged Markdown, Math, document version, dirty state and editor mode. Existing read-only, copy, undo, image/caret, observer, ownership, normal-close and cleanup gates remain.

The twelve-grammar syntax fixture now begins below 130 lines and has 1,000 trailing lines. Before scrolling, the renderer must finish at most eight speculative diagrams, and the cache must remain within 64 MiB. A real wheel gesture and animation-frame observations require the first visible image to use a renderer request completed before scrolling and to decode within 100 ms of first visibility. This threshold is an unexecuted acceptance criterion, not measured performance. Existing audit/report limits were not raised.

No Windows run, signed package, installer hash, or real-machine performance result is established by the local tests. Do not deliver a new installer or call this correction accepted until the exact source and subsequent installer runs pass and their original artifacts are inspected. Follow `tests/windows/README-mermaid-installer.md` for the two-phase, exact-SHA push path. No main merge or official release is requested or performed.

## Received-patch validation and first Windows evidence

The exact 89,074-byte patch was received through Library with SHA-256 `b0c5597b0aa0f92e572ebfc4fc88fc0e3ef0a2d27974afc2891f04fd7d57432f`, applied unchanged to the stated base in a separate worktree and committed as `7d889b4a1b9b1306213ae7ed1aaae584375a9360` (tree `d0a5082958f713cd3923cede49e4a7a683bcfdd6`). Original worktrees were preserved. Independent local checks reproduced desktop 1,029, view-dom 1,001, bootstrap 4 and related Node 311 passes, plus desktop TypeScript and production Vite build. Missing local dependency links initially prevented test collection; existing dependencies were linked only inside this isolated worktree, without lock/source changes.

Windows source run 42553871741 captured that exact commit. Early product artifact 13647270950 ZIP SHA `b9d929efb11d658f225972e3ee63dbe56cb0b7b536508617432230c15ec5dc56` was checked before extraction. Both accounts passed the initial default preview, then failed `02-enable-and-exact-bytes` with `Timed out: Source fallback without image` at the mixed-strategy check. Both had already recorded successful source and preview strategy transitions with unchanged document mode/version/dirty state, Markdown and Math, and correct persisted strategy. The failing snapshots have cursor 38, editor mode live, **editorFocused=false**, and a decoded visible image. The final real input closed plugin settings; it did not resume editing. Mixed mode's documented behavior intentionally shows the image while editor focus is elsewhere. This failure did not reach the offscreen/prefetch measurements or later product steps. Independent GUI was still running when these early reports were examined.

The harness correction first captures and asserts unchanged editor mode/version/dirty state immediately after the setting change, then uses existing real pointer/keyboard positioning to resume editing inside the fence. It requires editor focus and records the pre-normalization mode so normalization cannot conceal a plugin mode leak. Regression cases reject missing focus and changed pre-normalization mode. Both ordinary and windowed DOM tests now explicitly move focus to a settings button and back, proving mixed mode shows/hides the same image without a new decode. Focused checks: 90 harness and 30 DOM tests passed. No application behavior or acceptance threshold was changed for this correction; a new exact-candidate Windows run is required.

### Independent first-run GUI and bounded load diagnostics

42553871741 finished failed. Complete artifact 13646304677 ZIP SHA `d4928346304a564e518d13e7b60629a7c8b6adfae5864075e57bb5e2517946a5` was verified. Pure-standard GUI reports all eight steps passed, including twelve-chart scroll/returns and idle/busy close, with complete window observer, positive control and no overflow/visible consoles. Filtered-admin GUI fails `open-ordinary-stable` with `Frontend connection failed at frame-load`; subsequent scenarios were blocked. Its window observer is independently complete, not a rendering success.

Filtered native metadata: owner `17f2edcf20ec441bbeb8facae0aa934b`, process 3648 / creation FILETIME `134386679290474774`; assets-read at Unix ms 1794194331412, frame-load 1713, native frame 5 created 1716, fixed-document navigation permitted 1727. There is no DOM-content-loaded, frame hello or renderer admission. Navigation completes unsuccessfully at 1794194341399 with webErrorStatus 9, frame destruction at 1408, failed connection at 1412, owner release at 1735. The roughly 9.7-second interval ends at the existing connection deadline; the evidence does not establish whether the fixed-document protocol handler had received or returned the request. It must not be relabeled as a syntax error or hidden by a later successful run.

New opt-in native diagnostics record fixed-document request receipt and response construction using only fixed stage names, allowed boolean and body byte count, with a 128-record fail-closed bound and the existing writer/evidence limits. They retain no URI or source and provide no owner/readiness/release proof. Frontend callers cannot inject the native event through the audit command. Eight frontend contract tests pass, including rejection of malformed metadata and refusal to substitute response diagnostics for boundary or release proof. A native budget/forgery regression is added but cannot run locally because this executor has no Rust compiler; Windows must compile and test it. Request allowlisting, immutable body, CSP, navigation guard, deadlines and cleanup gates are unchanged. Focus-corrected source run 42555197153 captures 8a9b43d0 and does not contain this later diagnostic change.

## 8a9b43d0 product evidence and bounded report transport

Run 42555197153 reached real product execution in both accounts. The first eight
steps passed, including real-focus plugin source/render/mixed transitions, hot
enable, unchanged editor mode/version/dirty, Markdown and Math. The syntax step
retained twelve PNG observations and offscreen prefetch measurements, but neither
product report completed: final serialization threw `Structured evidence exceeds
1 MiB coordinator budget`. This is a failed product run, not completed acceptance.

Each initial offscreen pass prepared eight charts with no pending work and about
4.9 MiB of cache. First-visible to decoded rAF samples were 0 ms / 0.1 ms. Both
matched a renderer request completed before scrolling. These are sampled partial
observations, not cold startup timings or a complete run verdict. Later scrolling
admitted additional bounded prefetch work; initial eight does not mean eight total
requests for the entire document.

The follow-up stores oversized reports as a lossless gzip envelope within the
unchanged 1 MiB file ceiling. Expanded JSON has a separate 4 MiB ceiling, bounded
streaming decompression, compressed/raw byte lengths and SHA-256, and original
step/launch/audit/input counts. The coordinator restores all fields before existing
identity/status checks; migration receipts and artifact staging use the same
contract. No state, event, PNG proof, or failure record is discarded. Generic JSON
inputs keep their existing limit. Readiness/scroll diagnostics are retained before
assertions so threshold failures remain inspectable.

Local checks: 338 Node source-workflow contract tests passed; 124 PowerShell wrapper
fixture cases passed (including actual Node encoder → PowerShell decoder and
corrupt/truncated/missing/hash/count/expanded-bound failures). PowerShell fixtures
do not execute Windows native APIs or installers. Synthetic final-state expansion
of the retained reports round-tripped byte-equivalent JSON objects: 1,094,955 →
124,209 stored bytes and 1,089,785 → 123,797. Those expansions are codec fixtures,
not missing final Windows evidence. Real Windows verification remains required.

## cfc58132 product failure follow-up

Run 42557620900 passed the real Windows Rust/build gates. Its retained product
artifact 13648975371 has ZIP SHA-256
`0d86d5ac622d3497c6072ddd457accc074853cf279667f2c8597320bf6c26a2f`.
Both reports now persist final failure states successfully; lossless decoding and
hash checks succeeded. This does not make either product run pass.

Pure-standard completed steps 01–06, then a WebDriver HTTP request timed out
30 seconds after attaching the wide-document process, before windowRect and
initial-document-ready were recorded. No Mermaid owner/connection or fixed-document
request existed for that process. The empty driver native log and overwritten
lastRequest cannot distinguish the timeouts command from window/rect; this is not
evidence of a Mermaid syntax/render timeout. The process later closed normally
with exit 0. Preserve the unresolved startup failure rather than attributing it to
the historical fixed-frame load failure.

Filtered-admin completed 01–06, wide and C4. The new readiness diagnostic called an
undefined `iso()` helper on entering syntax. This harness defect is corrected to
the existing explicit Date timestamp pattern. Its teardown interrupted engine-load;
that secondary failure is not an independent syntax rejection. Failed WebDriver
commands are now retained before teardown overwrites lastRequest, including bounded
route/fixture/timing metadata without scripts or document arguments. No deadlines,
retry behavior, or product acceptance assertions changed.

The installed-package final verifier also now restores the same product transport
before its existing identity/PNG/cleanup checks. Added fixtures prove an intact
compressed report passes and corrupt hashes or a wrong candidate still fail.
All 339 Node source-workflow contract tests passed locally. Windows rerun required.

## Rapid-scroll coverage added before installation

The prior 12-chart GUI traversal waits at each chart; it is not a rapid-scroll
stress test. The updated manyScroll round issues eighteen real W3C wheel actions
(35 ms per action, six up/six down/six up) before the final first-chart revisit.
Passive observers retain trusted/untrusted wheel counts, bounded actual scroll
positions, command duration and recovery time. The original 12 distinct PNGs,
1→12→1 return equality, three-second stability, complete audit and normal close
contracts remain. Missing events, no actual viewport movement, untrusted input,
observation overflow or recovery beyond the existing seek deadline fail acceptance.
No product state or scrollTop is assigned by the observer.

All 339 local source-workflow Node contract tests pass, including new negative
rapid-scroll fixtures. These are synthetic contract tests; real Windows rapid-scroll
results are pending. The older in-flight candidates do not contain this new test.

## Prefetch PNG retention and packaging binding

The old coordinator copy allowlist omitted `syntax-prefetched-first-diagram.png`.
In the retained 8a9b43d0 reports, its SHA-256 equals the later retained first syntax
PNG, but the separately named original file is absent. Do not claim that absent
file was retained. Added the exact filename to both bounded copy/staging allowlists
and to installed verification's PNG checks; a missing referenced prefetch PNG now
fails. Local checks: 190 related Node contracts and 125 PowerShell fixture cases
passed. No runtime application, engine, document, deadline or acceptance input was
changed by this follow-up.

This evidence-only follow-up may be packaged against the in-flight 2a075ffb source
receipt only after that run fully passes and the workflow's protected-application
`git diff --exit-code` succeeds. Report source acceptance SHA and packaging harness
SHA separately, and verify the resulting actual installer/binary hashes. The same
immutable installer must then be reused for old-profile lifecycle verification.

## Bound speculative cache churn before arrival

Run 42559758809 (2a075ffb) retained both internal 11/11 product reports, but
the outer audit rejected the omitted prefetch PNG filename. Thus its source
acceptance failed; it cannot authorize packaging. The exact filename retention
fix is 1a7dd884. GUI rapid-scroll evidence is still pending at this point.

The same raw product reports show eight initially ready prefetches, followed by
30 speculative renders after nearby scrolling. A controlled application regression
reproduced 40 renders where the nearest eight unchanged diagrams suffice. Counting
only new speculative renders let overlapping windows advance past cached entries,
evict the nearest images from the eight-entry off-window LRU, and render them again.

Background admission now selects the nearest eight total units, including cache
hits. Foreground rendering is unchanged, including documents with twelve or more
diagrams. The 256-line lookahead, eight-entry off-window cache, 64 MiB ceiling,
deadlines and resource release checks remain. The controlled regression is now
eight renders with the first arrival served from cache and zero resources after
clear. Real Windows product acceptance additionally rejects nearby-scroll churn
beyond one further eight-fence budget.

Local validation: desktop 72 suites / 1030 tests passed, service 56/56 passed,
desktop TypeScript passed, related Node harness 317/317 passed. One initial full
Vitest invocation also discovered a Node-native bootstrap test file and reported
no Vitest suite there; the correctly scoped src run passed. Windows behavior of
this application fix is not yet verified. It requires a new exact source receipt
before installer construction; the older receipts do not validate this change.

## 42559758809 complete GUI evidence and 42562621335 prerequisite failure

42559758809 / 2a075ffb finished failure solely at the product coordinator's exact
prefetch PNG retention gate described above. Both internal product reports were
11/11 passed. Both GUI reports satisfy the complete strict frontend contract,
including twelve compact and twelve spaced diagrams with 1→12→1 visits, stable
original-size/cursor ownership, and idle/busy exit 0 without forced termination.
Each observer is complete, positive control passed, no overflow, zero product or
unattributed visible consoles. The eighteen trusted real wheel inputs took
875.45 / 896.56 ms; subsequent first-chart recovery measured 41.88 / 67.00 ms.
This is recovery after a burst, not the cold-start metric. Untouched ordinary
launch birth→decoded was 6972.4 / 5813.1 ms (one sample per account, debugger
attached). Complete artifact 13650262273 has ZIP SHA-256
305440995bed5bf8d467f7dbd143ed355ca28992efc6957788d8d1b21ae5bbfa.

42562621335 / 42769e5a stopped before desktop linking or real product/GUI work:
Rust 236 passed, one failed, three ignored. The exact failure was workspace
atomic_sibling_save_preserves_file_entry_but_invalidates_old_directory_cursor,
workspace.rs:1733: an old directory cursor was accepted after a sibling rename.
No Mermaid behavior result is inferred from this unexecuted round.

Windows Stamp compares identity/size/last-write time (changed is zero); a rapid
same-name replacement can retain that stamp. Add a nonrecursive directory change
notification for each of the existing at-most-16 cursors, installed while the
validated directory/ancestor handles remain held and before enumeration starts.
Poll nonblocking before and after a page; any signal or API failure rejects the
cursor. Keep all identity/timestamp and traversal checks. Notifications are
explicitly noninheritable and closed using FindCloseChangeNotification on drop.
The Windows regression restores the exact old directory last-write time after
atomic rename and proves the old cursor is still rejected; another test checks
noninheritance and actual handle closure on cursor cancellation. No sleep, test
retry, weaker assertion or larger timeout substitutes for invalidation.

API reference: https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-findfirstchangenotificationw
The notification supplements existing checks; this does not claim new guarantees
for remote filesystems where Windows documents notification limitations.

Local validation of this prerequisite fix: rustfmt and diff checks pass; the exact
DirectoryChanges production block cross-typechecks against windows-sys 0.61.2 for
x86_64-pc-windows-msvc. Full local desktop cross-check is blocked at ring's native
build because this Linux environment lacks MSVC lib.exe; it does not establish
Windows test success. The next real Windows workflow must compile and execute
both new tests and the original failing test before product/GUI acceptance.

## Exact source acceptance and installer tool availability

42563952707 / 9e7b825a completed successfully. Independent raw verification:
Windows desktop Rust 239 passed / 3 ignored; both product reports 11/11 and outer
product audits passed, including exact PNGs and frontend launch identities. Both
GUI full contracts passed, twelve compact and twelve spaced diagrams plus returns,
eighteen trusted rapid wheel inputs, and normal idle/busy closure with internal
cleanup. Window observers complete without overflow, positive controls passed,
zero visible product or unattributed consoles. Prefetch renders stayed 8 -> 8
across the nearby scroll (seven further cache hits), rather than the earlier 8 ->
30 churn. Cold ordinary process-birth -> decoded was 8072.6 / 3407.8 ms, one sample
per account with debugger attached; 5131.4 / 488.0 ms preceded navigation. This
single pair does not establish the cause or distribution of startup variability.
Complete artifact 13651681542 ZIP SHA-256:
3561dd378d0d8da29317f6d43038af0f984a9630775a67c5b6a6d95de2401643.

Installer run 42566346681 attempts 1 and 2 both compiled the release executable,
then the official NSIS ZIP download returned HTTP 504. No installer or installed
validation was produced. Move this build prerequisite ahead of compilation: use
exact official GitHub release asset IDs, uploaded metadata, byte lengths, SHA-256
and the unchanged locked Tauri 2.11.4 SHA-1 checks. Allow at most three requests
only on explicit upstream 502/503/504; permission, authentication, timeout, budget
and integrity failures stop immediately. No alternative/unverified binary is
accepted. Extract into fresh bounded staging with safe paths and plain required
files, then let Tauri perform its normal checks. Retain the receipt with packaging
evidence. Application source remains identical to accepted 9e7b825a.

Local verification: exact official NSIS ZIP downloaded through its public asset
API, 2361546 bytes, 441 entries, 7134287 uncompressed bytes, all CRC/path/mode
checks passed; hashes match both pins. Seven new negative/positive tool-download
tests and the packaging suite passed (56 total); PowerShell AST parses. The new
Windows preparation/build and actual installations remain to be executed.
