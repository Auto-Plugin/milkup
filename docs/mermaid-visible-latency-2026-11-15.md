# Mermaid visible latency: evidence boundary and measurement correction

Base `0252c9d6da993d7d4e1668be0ae4467408d12fe1`, isolated branch
`dot/mermaid-visible-latency-20261115`. No application, plugin, packaging, runtime,
security or persistence change. Product remains the 46c754b8 composite candidate;
this work is a measurement change, not a speedup or an accepted new package.
No active or queued GitHub run existed at both initial read-only checks. No new
CI job, ETW capture, engine build or installation matrix was dispatched.

## Existing observations, kept separate

- Installed/source first decoded samples have ranged from roughly 3 seconds to
  20 seconds. One recorded standard-user case was 20,634.2 ms from spawn, but the
  actual renderer interval was about 807 ms and decode followed about 13.2 ms
  later. See the original [integration report](release-quality-integration-2026-11-12.md).
  A decoded image need not yet be visible; attachment/polling also contributes
  to harness observations. These are individual samples, not p95 or a user-machine
  diagnosis.
- Existing profile comparisons already reuse the app's normal persistent WebView
  profile and a single frontend Mermaid owner. There is no per-diagram helper to
  remove, and no new reuse optimization justified by these data.
- ETW 43513112486/analysis 43515829392 associated one 9.159-second pre-Wry wait
  with a cookie thread's storage work: 7.085 seconds not-ready, including 5.141
  seconds synchronous NTFS flush and 1.390 seconds resource wait. First A had
  separate hard-fault waits. This is hosted CI evidence, not proof of Defender,
  a specific filter driver, physical storage, or an actual user's cause.
- The single targeted increment [43522696501](https://github.com/Auto-Plugin/milkup/actions/runs/43522696501)
  did not reproduce the critical delay. Fresh/reused first-decode observations
  were 7252/4497 ms; the bounded capture stopped without further attribution.
  [Original result](https://github.com/Auto-Plugin/milkup/blob/9c6bef0b446c055ecb9184dfab7df58a6909dfe4/docs/webview-etw-targeted-io-results-2026-11-13.md).
  No repeat capture or speculative product/security/durability change is made.
- Prior real cursor gates retain the decoded DOM image and require unchanged
  admissions through individual moves, 40-key bursts and concurrent Math behavior.
  Those gates remain intact. They do not establish cold first-visible latency.

## Concrete gap corrected in the measurement

The syntax test explicitly waited for offscreen preparation to finish **before**
scrolling, then tested the window rectangle only. It did not clip the image to
its editor/scrolling ancestors, record exposed source frames, or distinguish an
already-decoded image when sampling began. Its <=100 ms threshold is not a
zero-flash claim and must not be called a cold-entry measurement.

`tests/windows/mermaid-visibility-observer.mjs` now supplies the exact same
self-contained, read-only observer to the harness and browser probe. It records:

- Exact fence offsets; no document text or filenames. Every scrolling/clipping
  ancestor, both axes, hidden styles and document visibility participate.
- First layout-visible source/block, decoded visible image, source frame count
  and first/last source timestamps; at most 64 state transitions.
- Sampling gaps, 60-second/3600-frame independent bounds, overflow and terminal
  reason. A deadline, frame-budget stop or overflow cannot report complete.
- `decodedAtFirstSample` explicitly identifies a left-censored measurement.
  There is no claim of compositor/physical paint, overlay occlusion, transformed
  clipping precision or absence of sub-frame flashes. Large sample gaps remain
  evidence, not interpolated away.

The actual product harness installs a separate `document-open` observer after
its verified file-open stage and before native geometry polling. Existing startup
marks, engine audits and exact process birth identities remain separate clock
sources. Installation/read input counts and editor/persisted-plugin-policy/caret
context prevent a later mixed-mode source reveal from silently being called a
cold render stall. Missing stored policy remains null, not assumed enabled.
First PNG read and step finalization retain available observations, including
failure/capture errors. A late WebDriver attachment cannot recover earlier paint.
The warmed prefetch gate uses a separate observer and keeps its existing <=100 ms,
PNG ownership, cache and bounded-work requirements; no threshold was relaxed.

## Checks and actual environment blocker

`node --test tests/windows/mermaid-visibility-observer.test.mjs
 tests/windows/mermaid-product-e2e.test.mjs tests/windows/mermaid-gui-startup.test.mjs`
passed 109 tests (8 new deterministic observation-contract cases). They cover
clipped decoded images, source visible for two frames despite a <100 ms eventual
wait, hidden ancestors/document, sampling gaps, timeout without rAF, record budget,
replacement cancellation and late attachment. These are controlled DOM/clock
models, not native rendering or a performance result. Log is under
[acceptance](acceptance/mermaid-visible-latency-20261115/node-tests.log).

The first broad run also found an obsolete existing fixture requiring a push
trigger, although the reviewed workflow is manual-only. The test now requires
exact `workflow_dispatch` and still checks equality of job and wrapper branch
allowlists. No workflow triggers or notification settings were changed.

A local sandbox-enabled Chromium preflight failed before a page existed:
`The SUID sandbox helper binary was found, but is not configured correctly`;
Crashpad also reported a missing database directory. No --no-sandbox retry,
helper chmod, system/security change or product failure is inferred.
`tests/browser/mermaid-visibility.browser.mjs` is a runnable, bounded real-layout
probe for an existing sandbox-capable browser (system Edge on Windows). It uses
self-authored geometry and native wheel input, not Milkup/Mermaid, so passing it
would validate only the observer. It has been syntax checked, **not executed**.

## Smallest useful native follow-up

1. Run that real-layout probe on an existing supported browser without installing
   or disabling a sandbox. It must reject clipped images and preserve the forced
   source-exposure control; do not call its times product measurements.
2. Reuse the exact composite Windows installer from build 43616134287:
   `milkup-2.0.0-beta.10-windows-standard-383c0712f210.exe`, SHA-256
   `6fe28bcd235dc04993b1889f3c4bb5086e4e86cc2ad06da0172098ba1f974902`.
   The current InstallOnly workflow does not execute these browser observations;
   it cannot substitute for this test. A narrow ordinary-user installed harness
   still needs wiring to its retained process/close/provenance gates.
3. One bounded session: open the unique ordinary document, then a fresh-source
   offscreen document and scroll immediately **without** waiting for prefetch.
   Record `cold-entry` plus actual admission/start/finish IDs. Compare a separate
   `prefetch-ready` entry of the same source, preserving the cache distinction.
   Stop on failure, retain original evidence, and normally close the product.
   Do not flush OS caches, modify the user profile or repeat until green.
4. Only after this distinguishes pre-ready startup wait, engine work and visible
   source exposure should a minimum product change be selected. Existing engine
   preparation/cache retention means duplicating prewarm is not justified now.

This patch has no new Windows native or real-browser result and does not claim
the user's slow first diagram is fixed. The narrow installed-session wiring is
still outstanding; no main merge, release, production channel or upstream send.
