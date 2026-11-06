# User-reported cursor, startup and mode-entry follow-up

Status: local verification only; Windows and installed-candidate acceptance pending.

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
