# Large File Editor Phase 9 Evidence Status - 2026-07-08/09

This report records the current retained evidence for `docs/large-file-editor-plan.md` Phase 9.

It is intentionally conservative: supporting file-scan reports are not desktop editor benchmarks, and pre-existing native 256 MiB / 1 GiB reports were produced before the current working-temp native edit path. The current implementation now has fresh retained desktop WebView and native working-temp benchmark reports from 2026-07-09.

## Source Snapshot

- Repository: `D:/me/project/milkup`
- Snapshot command: `git rev-parse --short HEAD`
- Snapshot observed during this report: `95c1661`
- Working tree state: dirty; this report covers the in-progress large-file editor branch state, not a committed release artifact.

## Current Implementation Under Test

- Desktop large-file open path: metadata policy routes large/ultra-large files to `open_large_text_file`.
- Frontend large-file view path: `SourceDocumentView` + `LargeDocumentSource`.
- Visible-window editing path: `LargeEditSession` maps visible edits to `apply_large_text_file_changes`.
- Native edit storage: working temp file plus original-file hash conflict guard.
- Native save path: `flush_large_text_file` atomically replaces the original file only when the original hash still matches the open snapshot.
- Native large-file Save As path: `flush_large_text_file_as` writes the current original-or-working snapshot to the selected path without materializing the full text in the frontend; choosing the original path preserves the external-change conflict guard.
- Native large-file reload path: clean external modifications can be reloaded by reopening the same path through the metadata policy and native line-window service, without reading the full text into the frontend.
- Background large-file parse warmup: `SourceDocumentView` can asynchronously prewarm current and adjacent Markdown line-window parse cache entries after source-backed viewport renders; the desktop large-file path enables this so live-window switches and nearby live scrolling can reuse cache without blocking open.
- Native temp cleanup: app startup and same-path large open clean marked Milkup working temp files.

## Retained Evidence

| Requirement                          | Current retained evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Status                                                                                                               |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 175 KB real plan file report         | `docs/desktop-editor-interaction-benchmark-175kb-10mib-2026-07-09.json` records a real Tauri WebView run for `docs/coding-plan.md`: normal mode, full DOM, 1,735 rendered lines, 1,200.80 ms open, 65.80 ms middle selection, 72.10 ms tail selection, 211.80 ms click-to-cursor, 899.20 ms single-character input, and 1,157.50 ms search-first-result. Supporting scan and jsdom reports remain in `docs/large-file-node-scan-coding-plan-175kb-2026-07-08.json` and `docs/large-file-view-dom-benchmark-2026-07-08.json`. | Complete for Phase 9 evidence; numbers show measurable live-mode cost, so public wording must not call this instant. |
| 10 MB memory/virtual renderer report | `docs/desktop-editor-interaction-benchmark-175kb-10mib-2026-07-09.json` records a real Tauri WebView generated 10 MiB run: incremental mode, virtual DOM, 49 rendered lines after interactions, 1,605.40 ms open, 10.60 ms middle selection, 5.40 ms tail selection, 21.90 ms click-to-cursor, 357.60 ms single-character input, and 30.90 ms search-first-result. Supporting scan/jsdom reports remain in `docs/large-file-node-scan-10mib-2026-07-08.json` and `docs/large-file-view-dom-benchmark-2026-07-08.json`.       | Complete for Phase 9 evidence.                                                                                       |
| 100 MB large-mode report             | `docs/desktop-editor-interaction-benchmark-100mib-2026-07-09.json` records a real Tauri WebView generated 100 MiB run: large mode, viewport DOM, 51 rendered lines after interactions, 6,980.90 ms open, 56.40 ms middle scroll, 47.70 ms tail scroll, 29.50 ms click-to-cursor, 221.60 ms search-first-result, 6,538.10 ms visible edit, 1,476.70 ms flush, and marker verification after flush.                                                                                                                            | Complete for Phase 9 evidence.                                                                                       |
| 256 MiB native report                | `docs/native-large-file-benchmark-working-temp-256mib-2026-07-09.json` records the current `native-line-index-working-temp` path: 256 MiB fixture, 18,392.10 ms open, 5.90-8.00 ms line-window reads, 16,700.90 ms apply, 3,823.10 ms flush, and head/middle/tail marker verification.                                                                                                                                                                                                                                       | Complete for Phase 9 evidence.                                                                                       |
| 1 GiB native report                  | `docs/native-large-file-benchmark-working-temp-1gib-2026-07-09.json` records the current `native-line-index-working-temp` path: 1 GiB fixture, 69,682.70 ms open, 6.60-8.80 ms line-window reads, 70,123.70 ms apply, 16,316.00 ms flush, and head/middle/tail marker verification.                                                                                                                                                                                                                                          | Complete for Phase 9 evidence and public GB-scale command-path wording, with the measured latency caveats.           |

## New Supporting Reports Generated

### `large-file-node-scan-coding-plan-175kb-2026-07-08.json`

- File: `D:/me/project/milkup/docs/coding-plan.md`
- Size: 175,366 bytes
- Lines: 1,734
- SHA-256: `dd887595be9db6b3955ed85195c41b824d9ad03fd9d726b19d8cfd635756214d`
- Scan time: 15.31 ms
- Sample reads: 0.68 ms, 0.15 ms, 0.12 ms

### `large-file-node-scan-10mib-2026-07-08.json`

- File: `D:/me/project/milkup/.tmp/benchmarks/milkup-10mib.md`
- Size: 10,485,760 bytes
- Lines: 156,531
- SHA-256: `934b9e42114b047945cb1a213ecaa26eb338e3a0ccff13399e29442919a5d420`
- Scan time: 532.83 ms
- Sample reads: 0.39 ms, 0.13 ms, 0.10 ms

### `large-file-node-scan-100mib-2026-07-08.json`

- File: `D:/me/project/milkup/.tmp/benchmarks/milkup-100mib.md`
- Size: 104,857,600 bytes
- Lines: 1,543,023
- SHA-256: `708fe1783038334e8d0a44ff8521d4c63fccf927c18e8d23316096d75d65658f`
- Scan time: 4,072.24 ms
- Sample reads: 0.62 ms, 3.45 ms, 0.21 ms

These reports prove deterministic fixture generation, filesystem scan throughput, line-count scale, and random sample-read latency in Node. They do not prove UI first paint, desktop open policy, virtual DOM latency, search latency, visible edit latency, native flush latency, or peak memory.

## View-DOM Renderer Report

### `large-file-view-dom-benchmark-2026-07-08.json`

Environment:

- OS: Windows 10.0.22631
- CPU: Intel(R) Core(TM) i7-6700HQ CPU @ 2.60GHz
- Node: v24.18.0
- DOM: jsdom/27.4.0

175 KB `docs/coding-plan.md` live-mode result:

- Bytes: 175,366
- `MemoryTextDocument` line count: 1,735
- Create and initial render: 3,198.10 ms
- Selection update near middle: 244.68 ms
- Single-character update near middle: 2,575.36 ms
- Rendered line nodes: 1,735

Interpretation: this is retained evidence that the 175 KB full live-render path still has measurable jsdom cost. It supports keeping Phase 0/1/2 instrumentation and desktop WebView timing gates; it should not be described as "instant" based on this report.

10 MiB virtual source result:

- Bytes: 10,485,760
- Line count: 156,532
- Create and initial render: 592.30 ms
- Tail scroll window update: 12.56 ms
- Tail cursor ensure-visible: 21.72 ms
- Single-character tail update: 645.35 ms
- Rendered line nodes: 44
- Rendered line window after tail edit: 149,055-149,098

Interpretation: this is retained renderer evidence that the virtual source path keeps DOM bounded for a 10 MiB memory-backed fixture. It is not a native desktop/WebView benchmark and does not cover large-file source-backed save/search behavior.

## Native Benchmark Harness Update

`tests/native/tauri-large-file-benchmark.mjs` now records an `implementation` section in future reports:

- `mode`: defaults to `native-line-index-working-temp`
- `expectedNativePath`: the native large-file Tauri command sequence
- `expectedEditStorage`: working temp file with original-file conflict guard
- `frontendPath`: desktop `SourceDocumentView` / `LargeDocumentSource`

The harness also now emits clearer setup errors when the debug Tauri binary or `tauri-driver` is missing.

## Desktop Interaction Benchmark Harness Update

`tests/native/tauri-desktop-editor-interaction-benchmark.mjs` now records future real WebView reports for:

- `coding-plan`: the 175 KB `docs/coding-plan.md` normal editor path.
- `10mib`: a generated 10 MiB desktop memory/virtual editor path.
- `100mib`: a generated 100 MiB large/source-backed editor path with visible edit and flush verification.

The root command is:

```powershell
$env:MILKUP_DESKTOP_INTERACTION_BENCHMARK_REPORT = "docs\desktop-editor-interaction-benchmark-2026-07-08.json"
pnpm bench:desktop:interaction
```

The harness uses `globalThis.__milkupDesktopTest.runDesktopEditorInteractionBenchmark` inside the Tauri WebView and records the selected scale mode, render strategy, rendered DOM line count, open timings, middle/tail interaction timings, click-to-cursor timing, search first-result timing, checksums, and process memory. It is ready for the same local setup requirements as the native benchmark harness.

## 2026-07-09 Desktop Interaction Reports

### `desktop-editor-interaction-benchmark-175kb-10mib-2026-07-09.json`

- `coding-plan`: real `docs/coding-plan.md`, normal/full-DOM live path, 175,366 bytes, 1,735 lines, 1,200.80 ms open, 1,187.30 ms to first interactive focus from open-stage diagnostics, 211.80 ms click-to-cursor, 899.20 ms single-character input, 1,157.50 ms search-first-result.
- `10mib`: generated 10 MiB fixture, incremental/virtual-DOM source path, 169,271 lines, 46 rendered lines after open, 49 rendered lines after interactions, 1,605.40 ms open, 21.90 ms click-to-cursor, 357.60 ms single-character input, 30.90 ms search-first-result.
- Environment: Windows 10.0.22631, Edge/WebView 150, `tauri-driver v2.0.6`, debug Tauri app from source snapshot `95c16615f6ee85cf069f7cbfc456ddeaa9337632`.

### `desktop-editor-interaction-benchmark-100mib-2026-07-09.json`

- Generated 100 MiB fixture, large/viewport-DOM source-backed desktop path.
- 1,692,446 source lines after open and 1,692,447 after visible edit.
- 46 rendered lines after open and 51 rendered lines after interactions.
- 6,980.90 ms open, 56.40 ms middle scroll, 47.70 ms tail scroll, 29.50 ms click-to-cursor, 221.60 ms search-first-result, 6,538.10 ms visible edit, 1,476.70 ms flush.
- Verification confirms the active WebView path matched the fixture, selected `large` scale mode, rendered bounded DOM, and flushed `<!-- benchmark-visible-edit -->` to disk.

## 2026-07-09 Native Working-Temp Reports

### `native-large-file-benchmark-working-temp-256mib-2026-07-09.json`

- Generated 256 MiB fixture, 3,924,700 original lines.
- `implementation.mode`: `native-line-index-working-temp`.
- Open: 18,392.10 ms.
- Line-window reads: 8.00 ms first, 5.90 ms middle, 6.00 ms tail.
- Apply three marker edits: 16,700.90 ms.
- Flush: 3,823.10 ms.
- Verification confirms native command path and head/middle/tail markers persisted.

### `native-large-file-benchmark-working-temp-1gib-2026-07-09.json`

- Generated 1 GiB fixture, 15,574,996 original lines.
- `implementation.mode`: `native-line-index-working-temp`.
- Open: 69,682.70 ms.
- Line-window reads: 8.80 ms first, 6.60 ms middle, 7.00 ms tail.
- Apply three marker edits: 70,123.70 ms.
- Flush: 16,316.00 ms.
- Verification confirms native command path and head/middle/tail markers persisted.

## Public Wording Gate

Allowed today:

- The code has a source-backed large-file path with native line-window reads and visible-window edits.
- Retained desktop WebView reports exist for 175 KB, 10 MiB, and 100 MiB fixtures.
- Retained native working-temp reports exist for 256 MiB and 1 GiB fixtures.
- Public wording may claim measured current native working-temp command-path behavior through 1 GiB on the documented Windows machine, with the recorded open/apply/flush latencies.

Not allowed yet:

- Claiming perfect Typora-like live rendering for 1 GiB files.
- Claiming full-document AST, whole-document plugin transforms, or unlimited edit operations for large/ultra-large files.
- Claiming the measured desktop 175 KB live path is instant; the retained report shows meaningful parse/input/search cost.

## Phase 9 Release Gate Status

The Phase 9 retained-report requirement is now satisfied for the current implementation. Release wording still must point to the specific 2026-07-09 reports above and preserve the measured latency/degradation caveats.
