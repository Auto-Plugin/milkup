# User-reported cursor, startup and mode-entry follow-up

Status: Windows product follow-up verified; corrected complete source and installed-candidate acceptance pending.

## Reproduced cause

Selection-only changes invalidated presentation jobs and cache keys. Restoring source disposed decoded PNG owners even when the authenticated Mermaid input was unchanged. A pending frontend render could therefore be discarded and requested again. The bottom status select showed only its current value and did not expose the other two modes.

The candidate gives only host-authenticated, selection-independent renderers an explicit reuse authority. Source/version/width/configuration and activation identity remain checked. The same PNG owner survives caret movement and temporary source editing; pending work is retained. Other providers retain their selection-dependent behavior. Source and render mode semantics are unchanged.

A named document-mode toolbar exposes all three modes. The exact enabled bundled Mermaid owner prepares its fixed engine after activation, in parallel with remaining catalog work; no diagram is admitted before boundary validation. Startup marks separate catalog and decoded-image timing.

## Evidence before Windows

- The new cursor tests failed against the previous presentation implementation with additional provider calls, then passed after the change.
- PNG owner suite: 25 passed, including regular/windowed reuse, in-flight selection, scroll retention and disposal.
- View suite before the final scroll assertion: 995 passed; existing selection-dependent scroll reset tests retained.
- Related desktop catalog/service tests: 145 passed; desktop TypeScript passed.
- Frontend browser security/corpus suite: 21 passed, including production fixed-script loading, forged messages, malicious labels, cancellation, budgets and release.
- Product harness tests: 84 passed.
- Real Chromium UI at 1028 and 480 pixels: named mode buttons visible and clickable. This is not Windows/DPI acceptance.

Original delivered run 42148997347 first ready timestamp minus recorded launch start was 11162 ms (pure standard) / 3034 ms (filtered admin). Engine connection-to-ready was 821 / 611 ms. These are single-run stage observations, not a benchmark or proof of a speed improvement. New Windows reports record startup performance marks for comparison.

The real Windows product harness additionally requires six caret visits inside/outside the fence with no new render admissions, the same decoded DOM image outside source editing, unchanged file/version, and all three public mode buttons usable at a 640-pixel native window and 100%/125% native WebView zoom. Native zoom does not claim a system DPI matrix.

The prior delivered installer remains unchanged. No new installer or user-site fix is claimed until the corresponding candidate and installed-package runs complete.

## Real DOM scroll correction

A native Chromium DOM probe found a gap not modeled by jsdom: removing/reappending the same image viewport reset scrollLeft from 640 to 0. The follow-up captures the owned viewport before source DOM replacement and restores its offset only after final reattachment. The packaged browser regression now proves natural mode and the same image/provider invocation survive outside → inside → outside caret moves, with scrollLeft 640 restored outside. Ordinary provider contracts are unchanged. The Windows wide-view test now also drives real heading-caret keys after horizontal wheel scrolling and requires the same owner, offset and admission count.

Full view run after the original change: 996/996. Follow-up targeted PNG + presentation tests: 100/100; packaged browser suite: 23/23. These do not substitute for the follow-up Windows run. Run 42177287963 is the earlier 8d6d13c5 candidate and does not include the native scroll correction.

## First Windows evidence, not final acceptance

Run 42177287963 / 8d6d13c5 product artifact 13484735259 was verified against its GitHub ZIP digest `0067062b284469f1c7e69b355917b6c2df417306c006824818b9ec401ef8faa0`. Both accounts passed the initial preview and the visible three-mode controls at native 640x600 and 100%/125% WebView zoom. Both retained image instance 9 and six total admissions for the first two outside-caret visits.

Both then failed the harness's exact caret target: it counted whole-source graphemes, while live arrow navigation skips fence delimiter lines (`codeFenceArrowTarget`). Target 41 reached 53; no document mutation occurred. The corrected harness observes each real native key movement, requires strict forward progress and the exact reachable target, and avoids CRLF-interior targets. It preserves the no-new-render/same-image assertions.

Startup remains unresolved: timeOrigin→first decoded was 2387.1 ms / 14667.1 ms; filtered-admin's earliest inline HTML mark was already 11221.3 ms. Those observations do not isolate a native/browser startup cause. Further reports include navigation/resource timings to distinguish pre-HTML loading from module/catalog/render stages. No speed improvement is claimed from these differing cold starts.

Complete candidate 35885076 (including scroll restoration and caret harness correction) runs as 42178558327. Superseded queued runs 42177815953 and 42178254754 were cancelled before execution. Installed and old-profile tests still depend on complete candidate acceptance.

## Selection-dependent companion providers

Math enables a selection-dependent text renderer, so the original all-renderers-independent fast path deliberately did not apply. The follow-up separately retains only authenticated host PNG owners while removing stale companion output and requesting its current-selection result. Pending authenticated fences now share one computation across cancelled selection consumers, bounded to eight pending entries, with the first computation's original deadline. Source/version/renderer epoch changes, clear/close and a different visible-fence set cancel the corresponding pending work. Completed output still obeys the existing byte/pixel cache limits; each consumer holds its own reference and late revoked output is released.

Local coverage: view suite 999/999; presentation service 50/50 including aborted consumers, result reuse after every waiter cancels and late-result release on invalidation/clear; packaged browser 24/24 including native DOM scrolling while companion providers refresh; desktop TypeScript passed. The Windows product fixture now includes an actual inline formula, enables the real bundled Math plugin, exercises cursor movements inside/outside both formula and Mermaid, checks formula visibility against selection, and requires no new Mermaid admission or decoded image replacement. It disables Math afterward to preserve later cases' initial conditions. This combination remains pending Windows verification.

Run 42177287963 final GUI artifact 13484429356 ZIP SHA `60ae55d2a4a860a9fce8f9e66307b16f74f26cf9eccc5a86c216356e425f4059` was checked. Both accounts' eight GUI steps passed, including 12-diagram compact/scroll visits and idle/busy close. Both observer summaries are complete with positive controls, no overflow and zero product/unattributed visible console windows. That evidence belongs only to 8d6d13c5 and does not prove the later companion-provider changes.

## Measured hidden-frame encoding delay

A diagnostic against the actual packaged fixed frame (real Chromium, same diagram, five sequential requests) measured Mermaid layout at 17–20 ms, SVG image decode at about 2 ms, and HTML canvas.toBlob at 985–1001 ms on warm requests. OffscreenCanvas.convertToBlob was evaluated and rejected as the solution: after its first request it still took about 989–991 ms. It is not in the candidate.

The candidate uses the native synchronous PNG encoder only for validated rasters up to 1,048,576 pixels, retaining the prior asynchronous encoder for larger rasters. It checks the PNG data prefix and encoded byte ceiling, preserves the existing axis/pixel/PNG limits, and clears canvas pixel storage in finally on success or failure. No renderer worker, native renderer command or external resource was added.

Under the same local diagnostic, the bounded PNG encode took 0.3–0.4 ms; total requests after preparation were 198.5 ms cold-render and 31.7 / 25.5 / 23.5 / 24.2 ms warm-render. These measure the diagram request, not application cold startup. The known pre-HTML cold-start variation remains unresolved pending Windows navigation timing evidence.

Packaged browser suite 26/26 passed: actual use of the bounded encoder, larger-raster asynchronous path, invalid encoder output rejection/recovery, 12 syntax families, malicious input, isolation and resource release. Windows timing and installed-package validation remain required.

## 42178558327 result and natural-size harness correction

Candidate 35885076 completed with failure. Product artifact 13485154150 ZIP SHA `2fb6d9f9d25191b5e952b2f68393f2a9e25fa267f5d6202c35c8d06c95dd0daa` contains two passed 11-step reports. Both accounts retained the same decoded image outside the fence across six caret visits, including inside→outside, with admissions unchanged at six. Actual Windows screenshots show the named three-button toolbar. Time-origin→first decode was 3761.1 / 2129.2 ms; recorded process start→first decode was 9020.1 / 4801.7 ms. These are single-run observations, not a cold/warm benchmark.

Final GUI artifact 13485917659 ZIP SHA `a6ae2c9bc989be3eb5b42b8e5d93db8cae41ebad0287687d1b2b6b5721f85a2a` was verified. Both failed only `open-wide-stable`: after natural-size rendering and horizontal wheel scrolling, the new caret case called the default `settle` validator, which requires fitted geometry. Its `Finite measured CSS and intrinsic dimensions` assertion rejected the scrolled image's negative left coordinate. The saved wide observation is natural, 3528×113, instance 2, scrollLeft 2578 and two admissions; the failure screenshot still shows the natural image. The first caret observation was not persisted because the fit-only validator threw first. Thus this run does not prove the complete new caret/scroll or return-to-fit case.

Both remaining seven GUI phases passed, including 12-diagram compact/scroll visits and idle/busy close. Both native observer summaries are complete, positive controls passed, no overflow, zero attributed/unattributed visible consoles. The candidate remains failed overall.

The correction reuses the full existing wide-image validator with an explicit expected mode for caret settling, including decoded PNG dimensions/lease, intrinsic geometry, viewport overflow, admission count, no pending work, source fallback or document mutation. Ordinary settling and return-to-fit continue to require the original fitted contract. Pending observations are retained before validation. Positive/negative tests reject fitted-as-natural, natural-as-fitted, wrong dimensions/lease, new work, clipping, outer overflow and fallback. This harness correction still requires a new real Windows result.

## 42181547640 product evidence (308f2428)

Product artifact 13485783899 ZIP SHA `0d1a82595e9cc317094ff035bb541619f648c1c25cfdce4731f33107b9c8cc7d` verified. Both product reports and their outer wrappers passed 11/11. Both have 29 admitted and 29 finished frontend requests: 28 ready and the expected invalid-syntax error; no unmatched admission or timeout.

Each account passed six Diagrams-alone caret visits and ten visits with real bundled Math enabled. Every outside-fence visit retained the same decoded DOM image; inside the fence source editing hid and then restored that image. Math visibility followed its own current selection. The two continuous 40-key bursts also retained that image with unchanged admission counts (7→7 alone; 8→8 with Math). Pure burst durations were 167.6 / 200.4 ms; filtered 194.2 / 195.6 ms. These are input-action durations, not Mermaid-render durations.

Initial same-source Mermaid request: 236 / 263 ms. Subsequent same-source requests on already-used owners: pure 45,33,35,28,38,39,30,26 ms; filtered 43,35,34,28,38,56,27,23 ms. Across all 28 successful requests including different grammar fixtures, medians were 43 / 44 ms. This is a CI sample, not a controlled hardware benchmark.

Initial document-painted→first decoded: 984.4 / 891.5 ms. Navigation time-origin→first decoded: 2405.7 / 3396.8 ms. Recorded process start→first decoded: 8748.4 / 5440.0 ms. The process→navigation gap and filtered root HTML response ending at 2118 ms remain startup observations, not a proven application/OS root cause. Do not equate the warm diagram improvement with eliminating application startup latency.

The run still contains the known fit-only GUI caret-settling harness bug. Final GUI and installation acceptance must use 7bb507a1 or a later verified candidate; the product result alone is insufficient.

Final GUI artifact 13487351512 ZIP SHA `4dbde1a6bab625f39384e690144553f8d90ded41605ef1f70ac3b8a0373c109a` verified. Both accounts failed only the known fit-only validator in natural-size caret settling. The other seven phases passed, including 12-chart compact/scroll visits. Both observers complete, positive controls passed, no overflow, zero attributed/unattributed visible console windows. Both idle and busy closes exited zero without forced termination and proved inner cleanup; busy had one in-flight request at click. The overall run remains failure. Follow-up 42183423554 tests 7bb507a1 and is not yet accepted.

Build-profile boundary: the source workflow links `debug/milkup-desktop.exe` with `tauri/custom-protocol` and embedded production frontend assets (`dev-with-production-custom-protocol-assets`). The installer workflow builds a release NSIS package. Source-run timing must not be reported as installed release timing or used to infer that release cold startup has the same delay.

## Exact prior beta.10 upgrade preparation

The existing lifecycle matrix starts from beta.9. That does not directly test upgrading the frontend beta.10 package the user actually installed. The extended harness separately pins that historical installer (`d6d02410…d1e91`), installed image (`c58cb0f5…89192`) and application source (`40c66b69…ce94`), and uses the frontend audit contract with strict launch identity. It prepares enabled/explicitly-disabled choices through the real UI and observes them after an input-free restart before upgrading. The legacy beta.9 four-case matrix is retained; no historical bytes or profile are silently relabeled.

The planned full matrix is 12 isolated cases: two account kinds × four legacy cases, plus two account kinds × enabled/disabled from the actual prior beta.10. All use one future accepted new installer. The new package pins remain to be filled from its verified build artifact; no new-package lifecycle run has occurred yet.

Local verifier tests: 291 Node cases and 123 PowerShell wrapper cases passed; workflow YAML and all four embedded PowerShell blocks parse. These are contract tests, not Windows installation evidence. The receipt checks reject wrong baseline image/source, native-vs-frontend audit substitution, missing strict launch audit version and profile mutations for the historical beta.10 cases.
