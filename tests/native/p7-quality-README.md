# P7 Linux production keyboard and appearance harness

`tauri-p7-quality.mjs` drives a frozen production binary using existing native-production and native-updates-fixture helpers. It does not start a driver, build an application, install plugins, invoke IPC or mutate private editor state. Root owns serial driver/application execution. Do not run alongside performance samples.

Required for fixture-only preparation:

```bash
MILKUP_P7_CASE=keyboard \
MILKUP_P7_ROUTE=both \
TAURI_APP_PATH=/absolute/frozen/milkup-desktop \
MILKUP_NATIVE_EXPECTED_BINARY_SHA256=<exact-binary-sha256> \
MILKUP_NATIVE_EVIDENCE_DIR=/absolute/new/run-directory \
node tests/native/tauri-p7-quality.mjs --preflight
```

Preparation creates an exclusive run lock, copies the script and all four helper inputs plus the shipped open-policy sources with SHA-256 hashes, and writes deterministic per-mode source files. Use a fresh output directory for an actual run; a preflight directory is intentionally not reusable. Ordinary fixtures have 60 source lines. Windowed fixtures use the P6 structure of 60,000 appended three-line groups, giving exactly 180,060 source lines. They contain the same P7 table, emphasis, task and long-code header; no P5 export fixture or independent archive chain is required.

For execution omit `--preflight` and additionally supply:

- `MILKUP_P7_BINARY_CONFIRMED=1`, `MILKUP_NATIVE_EXCLUSIVE_DISPLAY=1`;
- `DISPLAY`, `TAURI_DRIVER_URL` for the already running exclusive driver;
- `MILKUP_NATIVE_PROFILE_ROOT` and `XDG_DATA_HOME`, `XDG_CONFIG_HOME`, `XDG_CACHE_HOME` strictly inside that dedicated profile.

Use `MILKUP_P7_CASE=keyboard|matrix` and `MILKUP_P7_ROUTE=ordinary|windowed|both` (default `keyboard`, `both`). The script opens subsequent fixtures through the native GTK picker. Each source/live mode has a separate fixture file. Every fixture verifies exact bytes against the frozen 128 KiB performance / 256 KiB native threshold, shipped document ID/open-stage DOM diagnostics and nonempty rendered line/offset metrics. The SourceDocumentView class alone does not establish a native backend; windowed content must carry finite nonempty virtual bounds. Native Ctrl+End must reach the exact full UTF-16 length, not a truncated prefix.

The keyboard case collects independent samples for Tab, Shift+Tab, F6/Shift+F6, menu Tab/Escape and Unicode clipboard history/save. Each includes before/after state and a screenshot. A Tab-induced edit remains a failed sample; the script performs actual UI Undo/Save and checks the original file hash before proceeding. Menu focus returning to its opener is a P7 experience target: earlier menu-to-editor behavior is an existing contract being improved, not a newly introduced regression. Helper `.focus()` calls are explicitly recorded as setup assistance, never represented as a Tab trajectory.

The matrix visits light/dark via the preinstalled preferences plugin's details approval/enable controls and actual theme select/save UI. Each theme runs 1280×800 and 760×520 native windows at 100/125/150/200% application zoom (Ctrl+0, then Ctrl+=), in source/live modes on each requested route. Each cell collects separate selection, table, emphasis, task and code-End screenshots plus DOM geometry/styles. Live checks cover delimiter alignment, unbroken cell text remaining in its own column, nested emphasis/following normal text, a single semantic task checkbox, actual click/save/undo bytes, and long-line caret visibility/scroll. Source mode records the raw source geometry without requiring live decorations. Display-only operations and final files must preserve exact hashes.

`execute()` only reads DOM or installs bounded read-only event listeners; it never dispatches editing events or sets source, theme, zoom, scroll or selection. Wheel scrolling and clicks use X11 input. The listener retains at most 128 events and reports trust, input type, composition flags and two-frame DOM proxies without clipboard/body text. Two `requestAnimationFrame` callbacks are rendering proxies, not physical screen latency. Old events may be dropped with an explicit counter; this is not a performance benchmark.

`samples.json` preserves every sample failure and screenshot name; `operations.json` distinguishes native keys, pointer/wheel operations, GTK open and helper focus. `completion.json` is successful only if every sample and final file hash passes. Unexpected failures are retained in `fixture-failures.json`; no Node-side overwrite repairs an edited document. Root should archive failure runs before applying product changes.

These are Linux WebKit/X11 tests. Native application zoom is not system DPI. X11 clipboard paste is not real IME composition/candidate selection, and DOM semantics are not a screen-reader test. The matrix fixtures use LF; this harness does not claim CRLF preservation coverage. Static/preflight success alone is not native acceptance.

## P7 all plugins inactive

`tauri-p7-all-plugins-disabled.mjs` adapts the existing P1 acceptance flow without changing that historical script. It requires the same frozen binary SHA, dedicated profile/display and confirmation variables as the quality harness, plus `MILKUP_P7_CANDIDATE_PROOF=/absolute/candidate-*/proof.json`. It does not require `MILKUP_RECOVERY_PROFILE`: recovery is derived from the dedicated XDG data home. Add `--preflight` for input freezing without launching the application; preparation and execution need different output directories.

The candidate proof must record a successful, drift-free build and the matching frozen ELF. Its `inputs` map supplies every embedded `.milkup-plugin` archive. Current archive bytes must match those input hashes before being copied into the run's `inputs` directory and parsed for exact expected IDs/versions; the script never assumes a version or a fixed plugin list. A changed bundle causes preparation to stop rather than silently test another inventory.

The profile must have no existing native catalog. After native startup settles, any enabled plugin is disabled through its details UI. Never-approved prepared candidates stay unapproved. At every checkpoint the script reads the native catalog from disk and requires all expected IDs, `enabled=false`, `startAttempt=null`, no trial and no tombstone. Prepared candidates are allowed. Approval fingerprints must remain unchanged from the settled initial catalog. The localStorage active-only mirror is auxiliary and may legitimately omit pending candidates. Both native and mirror observations, catalog raw SHA and the recorded envelope checksum are retained; this harness does not replace Rust checksum validation with JavaScript JSON serialization.

The acceptance flow opens the CRLF/Unicode fixture through GTK, types ASCII prefixes using native keys, performs Undo/Redo/Save and checks exact UTF-8 bytes; closes the OS window normally and reopens; creates a durable unsaved host checkpoint, kills only the identity-verified owned application, relaunches and restores through the existing recovery UI. It verifies the recovered copy and unchanged original, and audits every plugin's inactive details after both restarts. This is three launches in one dedicated profile. Each launch preserves its own production-origin evidence and WebView screenshots; X11 screenshots and catalog/result snapshots are at the run root. `diagnostics:false` preserves the native Worker constructor. This flow tests Unicode/CRLF preservation, not real IME input.

## Candidate execution and pixel review

Root confirms the frozen candidate ELF/proof and hands over the exclusive GUI slot after outline/performance runs. Execute these three fresh driver/profile runs serially, using the candidate runtime wrapper and the same candidate ELF/SHA:

1. `MILKUP_P7_CASE=keyboard MILKUP_P7_ROUTE=both node tests/native/tauri-p7-quality.mjs`: require 24 collected samples and independently check all four final fixture hashes against `preflight.json`. Preserve any failure run before changing code or script.
2. `MILKUP_P7_CASE=matrix MILKUP_P7_ROUTE=both node tests/native/tauri-p7-quality.mjs`: require 64 cells, 332 samples and 32 additional checked-task screenshots, zero fixture failures, and all four original file hashes restored. Preferences activation belongs to this dedicated matrix profile.
3. `MILKUP_P7_CANDIDATE_PROOF=/absolute/candidate-*/proof.json node tests/native/tauri-p7-all-plugins-disabled.mjs`: require three launches, native catalog inactivity and unchanged approvals throughout, exact saved/recovered bytes, and `completion.json.passed=true`. Use a new profile, not the matrix profile with preferences approved.

For each run, stop its owned driver before starting another. The candidate wrapper `run-env.sh RUN BINARY SHA` supplies the dedicated XDG profile, display, driver and evidence paths; `MILKUP_P7_BINARY_CONFIRMED=1` is still explicit. Root owns the driver start and slot handoff; these scripts never launch a driver themselves. Candidate preflight can run without the GUI slot, but a preflight directory is not reusable for execution.

After execution, create labeled contact sheets from the actual PNGs, grouped by route/mode/theme/window/zoom. Inspect every cell's visible table, emphasis, task and code screenshots at contact-sheet scale, then open original pixels for every failure and each narrow 200% combination. Contact sheets are navigation aids, not substitutes for originals: inspect normal/checked task and selection/caret screenshots together, and compare the keyboard opener-focus shots with baseline failure originals. Retain an explicit image-review manifest listing inspected files and any visible limitation. A passing DOM assertion alone does not establish visual quality; native zoom is not OS DPI and Linux output cannot establish Windows behavior.
