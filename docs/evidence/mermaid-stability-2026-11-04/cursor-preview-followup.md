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
