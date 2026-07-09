# Large File Benchmark Protocol

This protocol defines the evidence required before making public GB-scale claims.

## Evidence Rule

Do not claim GB-scale support until a benchmark report records:

- The exact app commit or source snapshot.
- OS, CPU, memory, disk type, Rust toolchain, Node version, and WebView/WebDriver versions.
- Generated fixture size and checksum or retained file path.
- Open/index time, chunk read latency, line-window read latency, local edit apply time, flush time, peak memory, and observed UI responsiveness.
- The command output or manual notes proving the run used the native Tauri large-file path, not only the in-memory `MemoryDocumentStore`.
- The implementation mode under test, especially whether edits use the current source-backed / working-temp native path or an older full-text-backed native snapshot.

## Fixture Generation

Use the project harness to create deterministic Markdown fixtures:

```powershell
pnpm bench:large-file -- --size-mib 1024 --out D:\tmp\milkup-1gib.md
```

For a quick local dry run:

```powershell
pnpm bench:large-file -- --size-mib 16
```

The harness prints JSON with generation throughput, scan throughput, line count, and random-read samples. That output is supporting evidence only; it does not by itself prove the desktop editor can handle GB-scale files.

## View Renderer Run

Use the view-dom benchmark for retained renderer evidence that does not require a native Tauri driver:

```powershell
$env:MILKUP_VIEW_DOM_BENCHMARK_REPORT = "docs\large-file-view-dom-benchmark-<date>.json"
pnpm bench:view-dom
```

This report records jsdom `EditorView` construction/update timings and bounded DOM counts for `docs/coding-plan.md` and a 10 MiB virtual-source fixture. It is useful renderer evidence, but it is not a substitute for a real desktop WebView benchmark.

## Native App Run

Use the native WebDriver benchmark harness for the Tauri command path:

```powershell
$env:TAURI_NATIVE_DRIVER = Join-Path $env:TEMP "milkup-msedgedriver-149.0.4022.98\msedgedriver.exe"
$env:MILKUP_NATIVE_LARGE_FILE_MIB = "1024"
$env:MILKUP_NATIVE_LARGE_FILE_REPORT = "docs\native-large-file-benchmark-<date>.json"
pnpm bench:native:large-file
```

For a quick native dry run:

```powershell
$env:MILKUP_NATIVE_LARGE_FILE_MIB = "1"
pnpm bench:native:large-file
```

The native harness launches the debug Tauri app through WebDriver and calls the dedicated `open_large_text_file`, `read_large_text_file_chunk`, `read_large_text_file_line_window`, `apply_large_text_file_changes`, `flush_large_text_file`, and `close_large_text_file` command path from inside the WebView.

Current working-temp implementation reports should set:

```powershell
$env:MILKUP_NATIVE_LARGE_FILE_IMPLEMENTATION_MODE = "native-line-index-working-temp"
```

## Desktop Editor Interaction Run

Use the desktop interaction harness for retained real WebView evidence for the editor path selected by file metadata:

```powershell
$env:TAURI_DRIVER = "$env:USERPROFILE\.cargo\bin\tauri-driver.exe"
$env:MILKUP_DESKTOP_INTERACTION_BENCHMARK_REPORT = "docs\desktop-editor-interaction-benchmark-<date>.json"
pnpm bench:desktop:interaction
```

The default target set is `coding-plan,10mib,100mib`. To run one target:

```powershell
$env:MILKUP_DESKTOP_INTERACTION_BENCHMARK_TARGETS = "100mib"
pnpm bench:desktop:interaction
```

The report records the real desktop open policy, first editor summary, rendered line count, middle/tail selection or scroll latency, single-character input or visible large-file edit latency, search first-result latency, large-file flush latency, checksums, and process memory. It complements the native command harness: this proves the desktop editor surface uses the intended memory or source-backed path, while the native large-file harness proves the lower-level 256 MiB / 1 GiB command path.

When running manually without the harness:

- Open the fixture through the native desktop large-file path.
- Record time to first visible window or first readable line window.
- Read beginning, middle, and tail line windows.
- Apply a small edit near the beginning, middle, and tail.
- Flush to disk and verify the changed file content.
- Record process peak memory before open, after index, after edits, and after flush.

## Completion

Only mark the M9 GB benchmark checkbox complete after the report is added to `docs/` and the numbers demonstrate acceptable native behavior for at least one 1 GiB or larger Markdown file on a documented machine.
