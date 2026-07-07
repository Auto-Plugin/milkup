# Native Large File Benchmark Dry Run - 2026-07-06

This report records a small native dry run of the Tauri large text file command path. It is evidence that the benchmark harness and native command path work, but it is not GB-scale evidence and does not satisfy the M9 public GB-scale acceptance criterion.

## Command

```powershell
$env:TAURI_NATIVE_DRIVER = Join-Path $env:TEMP "milkup-msedgedriver-149.0.4022.98\msedgedriver.exe"
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
$env:MILKUP_NATIVE_LARGE_FILE_MIB = "1"
pnpm bench:native:large-file
```

## Environment

- OS: Windows `10.0.22631`
- CPU: Intel(R) Core(TM) i7-6700HQ CPU @ 2.60GHz
- CPU count: 8
- Memory: 17,096,855,552 bytes
- Node: `v24.16.0`
- WebView user agent: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36 Edg/149.0.0.0`
- Native driver: `%TEMP%\milkup-msedgedriver-149.0.4022.98\msedgedriver.exe`
- App binary: `apps/desktop/src-tauri/target/x86_64-pc-windows-gnu/debug/milkup-desktop.exe`
- Source snapshot: not a Git repository

## Fixture

- Requested size: 1 MiB
- Size before run: 1,048,576 bytes
- Size after run: 1,048,620 bytes
- SHA-256 before run: `4fdf4b3f366d3391e81a2cd91060f7e416b1e14d5c942f931ca662511c9282b8`
- SHA-256 after run: `b9a29f5ade3454e2d4da69a63912f26ebc87eab2f2c3280b21f1d2720af85aaa`

## Native Command Timings

These timings came from the desktop WebView calling the dedicated Tauri large text file commands through `runDesktopLargeTextFileBenchmark`.

| Operation     |     Time |
| ------------- | -------: |
| Open/index    |  60.7 ms |
| Head chunk    |  10.2 ms |
| First window  |   8.6 ms |
| Middle window |   7.2 ms |
| Tail window   |   5.6 ms |
| Apply changes | 221.7 ms |
| Atomic flush  |  33.2 ms |

The run verified that `<!-- head -->`, `<!-- middle -->`, and `<!-- tail -->` markers were flushed back to disk.

## Optimization Note

An earlier 1 MiB dry run before the line UTF-16 index optimization measured middle and tail line-window reads at roughly 701 ms and 1265 ms. After adding per-line UTF-16 start offsets, the same native command path measured middle and tail windows at 7.2 ms and 5.6 ms.

## Remaining Gap

The current Tauri large text file service still stores full text in memory after open. A real M9 GB-scale claim requires a retained report from at least a 1 GiB native run and acceptable memory behavior per [large-file-benchmark-protocol.md](./large-file-benchmark-protocol.md).
