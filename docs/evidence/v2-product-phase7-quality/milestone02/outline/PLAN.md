# P7 M02 — final candidate03 outline retest

Prepared only. Wait for Root's CPU/GUI-exclusive GO after the 197-case browser suite. M01 evidence is read-only; no product edit, dependency installation, build, package upload or commit/push is part of this task. Normal UI installation of the already frozen independent outline package into a dedicated fresh profile is authorized.

Inputs:

- Candidate03 ELF: `/workspace/milkup-p7-quality-evidence/milestone01/candidate-production-03/milkup-desktop`, SHA `341d12999d07ba0b7116d463ebacde4bb52ead97279a33ad588ab599d2ddb7a2`.
- Independent outline 1.3.2: M01 `outline/external-1.3.2/milkup.outline-1.3.2.milkup-plugin`, SHA `c4f1bc3b3333fc8ae8919487cd2c20e59b622af98c97ce26e14ff9fdaf3b0f0f`.
- Exact existing harness and three helpers copied under `inputs/`, hashes in `preparation.json`. Harness SHA `b8ccb4322a8068496ffac252245150f7bb3811a1258f90e6773ac61f29534258`. No production measurement changes.

First run only these two fresh profiles, serially:

1. `p7-candidate-m02-outline-large-01`, case `large`: complete original 26,018,029-byte / 40,001-line / 8,775-heading fixture; three full index observations, then 20 collapse/expand, editor-cursor-follow and real public outline-click samples.
2. `p7-candidate-m02-outline-dense-01`, case `dense`: complete original 18,000-heading / 36,001-line fixture; three indices, 20 of each fold/follow/click group, middle-root navigation and 20 trusted ten-notch wheel bursts (down then up).

Expect approximately four to five minutes after driver startup. Preserve every failure. A pure budget miss does not invalidate completed independent samples. No extra scroll run unless these results leave a specific unanswered question; no retry loop. Do not preflight-generate duplicate 26 MiB fixtures. The first large run creates one dedicated M02 fixture; any later separately authorized diagnostic must reference that M02 source plus SHA rather than copying it or hardlinking writable data to M01.

The existing completion predicates require complete heading counts, actual DOM rows matching valid virtual ranges, correct fold state, stable row identity across at least three animation-frame observations, exact cursor/current-heading for navigation, source SHA preservation and dirty false. Index/first-visible, editor cursor follow, actual outline click and wheel bursts remain separate groups. Report nearest-rank p95 only with at least 20 comparable samples; full indices have three samples and min/median/max. Do not use candidate02 timings as candidate03 acceptance.

Runtime wrappers write only M02 `runs/`, `logs/`, `control/` and fresh `/tmp/milkup-p7-m02-profiles/` paths. They retain the existing namespace/WebKit sandbox and verify the frozen binary proof/hash. DISPLAY :127 and driver ports 4477/4478 are exclusively owned only after GO. If :127 needs restarting, use M02's copied `runtime/xvfb-control.py` with its own new PID/birth record; never write M01 controls.

After GO (substitute each RUN/CASE above; ELF and SHA are fixed):

```bash
python3 /workspace/milkup-p7-quality-evidence/milestone02/outline/runtime/driver-control.py start "$RUN" /workspace/milkup-p7-quality-evidence/milestone01/candidate-production-03/milkup-desktop 341d12999d07ba0b7116d463ebacde4bb52ead97279a33ad588ab599d2ddb7a2
bash /workspace/milkup-p7-quality-evidence/milestone02/outline/run-performance.sh "$RUN" "$CASE"
python3 /workspace/milkup-p7-quality-evidence/milestone02/outline/runtime/driver-control.py stop "$RUN"
python3 /workspace/milkup-p7-quality-evidence/milestone02/outline/derive.py "$RUN"
```

Stop the exact owned driver even on failure. Start the next profile only after the previous driver stops. Preserve Xvfb for the next authorized task unless Root requests owned cleanup.

## Stage evidence and later diagnosis

`derive.py` reads existing timestamps only: total latency, input to final stable-target frame, subsequent frame proxy, first index rows, wheel burst/driver acknowledgement and post-ack completion. These are not independent worker/renderer CPU timings. The burst includes ten XTest notches and normal virtual-list scroll scheduling (currently 160 ms); do not label it single-notch latency or subtract an assumed constant to claim success.

Only if production results still miss budgets, propose one separately labelled diagnostic with bounded timings for scan.next, enqueue wait, append, flush, prepareRows and updatePanel, and public host request/response plus actual DOM commit. Complete index queue work can serialize prepareRows/updatePanel ahead of later append; this is a source-based hypothesis until traced. The plugin uses ui.requestUpdate, not document.invalidatePresentation, so the latter's 250 ms scheduler must not be assigned to this path. Diagnostic archive/source/instrumentation hashes and overhead must be recorded; never combine instrumented durations with the production distribution. Preserve complete titles, public SDK boundaries, cache/storage limits, recovery and cancellation semantics. Present the measured dominant stage and a narrow proposed change before product editing.
