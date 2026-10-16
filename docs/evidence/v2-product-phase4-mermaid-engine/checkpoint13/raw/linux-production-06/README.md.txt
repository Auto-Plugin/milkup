# Production06 preparation — static only

Purpose: build the real Linux deb and run the five existing generic DOM lifecycle cases after the document-presentation ResizeObserver callback is coalesced through requestAnimationFrame and cancelled on destroy. The parent reports this as the sole product change from production05; the active browser suite and full repository gates are not captured by this preparation.

Prerequisites before source capture/build: parent confirms targeted GREEN, full browser35, applicable repository typecheck/test/lint/build gates, stable final product inputs, and exclusive CPU/native authorization. Actual production06 executable SHA remains pending. This directory currently contains only preparation scripts and records.

The ten scripts are copied from completed production05. Changes are production05→06 paths/run names and two descriptive strings in finalize.py. The exact diff is from-production05.diff. Python AST and bash -n checks are recorded in static-checks.json. No script was imported or executed for these checks.

After authorization, execute capture.py before, build.py, then freeze-build.py. Build uses the existing main repository apps/desktop/src-tauri/target/release, never the diagnostic stage cache. The extracted deb executable is install/usr/bin/milkup-desktop; its actual identity and artifact/source equality must come from provenance.json after the real build. Do not reuse prior artifact identities. No cache has been removed; report any needed rebuildable-cache cleanup before doing it.

Run once, serially, with fresh profiles: lifecycle-p06-timeout-01, lifecycle-p06-disable-01, lifecycle-p06-remove-01, lifecycle-p06-wm-close-01, lifecycle-p06-app-sigkill-01. For each case use launch-driver-reaping.py, run-case.py, and stop-driver.py with its exact run name and case. Recheck Xvfb :126 PID/birth/argv, empty ports 4626/4627, and exclusive ownership before runtime. Preserve original 2s render and 10s initialization deadlines, sandbox, fixture, assertions, exact PID/birth cleanup, and private-directory checks. First failure stops the sequence; do not retry. finalize.py runs only after all five cases pass. Full official Mermaid UI validation is a separate later gate.

Expected unchanged identities (parent handoff; independently checked by build/freeze):
- Rust process source: c6540ffc4d11e61050379d68bad0342c0cfaf8ec4a6fe60075b18ddecd851702
- Native guard: 5b1082768123b9ac1923eb8ef3f6f8c0bd05ffd5d66b8b2a023f75b69106c44c
- Official archive: 27db9bdefb9b241b03da2f3536f7e50d334117f928f963cfe290543f650b6239
- SDK: 1717c0114aa165fa3e48a1bfa7687ffd0d9b2e5392d33e99d8b2dc59a1f3ad4f

No Windows builds, uploads, releases, product edits, active e2e freeze, native sessions, or source capture are part of this preparation.
