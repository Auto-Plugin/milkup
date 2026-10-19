# P7 candidate serial quality execution (prepared, not executed)

GUI ownership is a root-controlled gate. Wait for explicit GO after six input-performance cases and outline. Candidate02 name is provisional until root supplies artifact/proof/SHA; do not infer readiness from a file appearing. All three stages use the same confirmed frozen ELF and separate unique driver names/profiles/output directories. Do not start another GUI or heavy test while a performance sampler owns the slot.

For each stage, root's candidate runtime driver-control.py start takes `UNIQUE_RUN BINARY SHA`; run-env.sh takes the same three values. Driver launch requires the previously authorized namespace execution, never a WebKit sandbox override. Always retain the driver record and log. Stop the exact owned run after the harness completes, including failure; never clean or reuse its directory/profile.

Stage order and gates:

1. keyboard: `MILKUP_P7_CASE=keyboard`, `MILKUP_P7_ROUTE=both`, `MILKUP_P7_BINARY_CONFIRMED=1`; execute tests/native/tauri-p7-quality.mjs. Require 24 samples, no fixture/fatal failures, all four final source hashes unchanged. This stage must address baseline menu-opener, windowed Tab and Shift+Tab failures without losing Unicode history checks.
2. matrix: same harness with `MILKUP_P7_CASE=matrix`, both routes, fresh profile. Require 332 samples, 64 distinct cells × five feature samples, 32 extra checked-task shots and exact restored four fixture files. Do not drop source/live, light/dark, width/zoom cells. Actual preferences UI approval/activation is confined to this profile.
3. alloff: tests/native/tauri-p7-all-plugins-disabled.mjs with `MILKUP_P7_CANDIDATE_PROOF` and confirmed P7 environment, new profile. Require candidate-derived exact bundle inventory, three launches, all native catalog entries inactive/no attempt/no trial/no tombstone, approval fingerprints unchanged, original CRLF/Unicode save/recovered-copy bytes exact.

Run the entire stage's independent sample collection as implemented; if a product failure appears, preserve the original run, report root and stop before the next stage. Do not fix product or weaken assertions. Distinguish actual product failure from harness/setup failure with source/DOM/screenshot evidence. Any approved harness correction uses a new run and preserves the former failure. No candidate pass may erase baseline evidence.

After every stage, with driver stopped:

```
python3 /workspace/milkup-p7-quality-evidence/milestone01/quality-review-tools/prepare-review.py RAW_RUN NEW_REVIEW_DIR
```

This command reads the raw run and writes only derived evidence in NEW_REVIEW_DIR. It preserves failures in independent-checks.json; command success means report generation, not application success. It creates original SHA/dimension index, per-cell contact sheets and pixel-review-pending.json (all entries unreviewed). For matrix, independently inspect all 64 cell sheets and every original in the 760x520@200% queue (44 original images when all samples exist), plus every failed sample original and any other sheet with uncertain pixels. Inspect selection, checkbox before/checked/undo state, overlapping cell text, nested emphasis markers and code-End caret. A contact sheet is a navigation aid; it does not substitute for original pixels. Write a separate completed review manifest with filenames, image hashes, concrete observations and residual uncertainties. Do not mark any file inspected without opening its pixels.

Preflight validation used existing baseline p7-keyboard-baseline-01 read-only: 24 originals, four contact sheets, eight failure-image tasks; independent check correctly keeps reported completion and sample-pass gates failed. This is a tool self-check, not a candidate run. The baseline's exact final source hashes remain independently passing.

Linux native application zoom is not OS DPI; native X11 clipboard is not real IME; no Windows, screen-reader, installer, upload or release claim follows from these runs.
