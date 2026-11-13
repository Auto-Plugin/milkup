# Follow-up: retained WebView startup trace, I/O and scheduling

This investigation reprocesses the original ETL from capture run **43513112486**, SHA-256 `4ca45baaa69c468edddca6499f110608e4a788268b3dd5f52678d94a2faec13b`. No additional Milkup startup, product modification, security-setting change or Release is part of this follow-up. Original capture identity and eight-trial controls are in [the preceding report](webview-etw-startup-results-2026-11-13.md).

**Result:** most of B's cookie-worker delay is synchronous NTFS I/O and resource acquisition, not CPU scheduling. First A is predominantly cold hard-fault reads during DLL/resource loading, with overlapping cookie flush work. Both involve guest storage waiting, but the trace does not establish a common underlying service, filter or physical-storage cause.

## B: distinguish waiting from CPU scheduling

The selected interval is trace-relative **57.591606–66.750606 seconds**. Product PID 3140 owns browser PID 872, whose network-service child is PID 1788. The cookie initialization worker is thread 528, created at **59.642749 seconds**, 2.051143 seconds after the interval begins. Its measured waiting therefore cannot explain the first approximately 2.05 seconds; this earlier initialization/task-dispatch gap remains separate.

Using `CSwitch.TimeStamp`, `Old TID`, `OldState`, `Wait Reason`, `New TID`, and `ReadyThread.TimeStamp`/`Rdy TID`, pair each switch-out with the next switch-in for this thread lifetime. For a waiting state require a unique intervening ReadyThread event; a Ready state is already runnable at switch-out. Clip to the interval above. Ambiguous/missing readiness is counted as unresolved, not assumed waiting.

| Thread 528 component | Duration |
|---|---:|
| Total observed off-CPU time | 7,090.285 ms |
| Not yet ready to run | 7,084.746 ms |
| Ready, waiting for CPU | 5.480 ms |
| Readiness unresolved | 0.059 ms |

This strongly rules out CPU scheduling starvation as the main explanation for this worker's observed delay. It does not identify every synchronization object or account for time before thread creation.

## B: disk completion and thread wake-up

Join disk events by bounded process/thread lifetime and compare completion timestamps with the same thread's ReadyThread and CSwitch. `DiskWrite.TimeStamp` is completion, `ElapsedTime` gives the recorded request duration, and `FileName` is classified privately. All 26 Cookie/Cookie-journal writes match the isolated B profile. Example fields (microseconds):

| File category | Disk completion | I/O elapsed | ReadyThread | Runs again |
|---|---:|---:|---:|---:|
| Cookies-journal | 63,998,752 | 887,654 | 63,998,755 | 63,998,778 |
| Cookies-journal | 64,869,187 | 627,573 | 64,869,189 | 64,869,202 |
| Cookies | 65,995,528 | 598,877 | 65,995,531 | 65,995,553 |

The corresponding not-ready waits are 887,653 / 627,570 / 598,878 μs. Completion precedes readiness by 2–3 μs, followed by only 13–23 μs to execution. This is direct evidence of I/O-related blocking, not merely similar long aggregate timings.

Intersect the union of recorded request lifetimes (`completion - ElapsedTime` to completion) with the worker's off-CPU intervals; do not sum overlapping requests:

| Request category | Overlap with off-CPU intervals |
|---|---:|
| Cookies / Cookies-journal | 4,076.779 ms |
| NTFS metadata ($Mft / $LogFile) | 1,059.365 ms |
| Other/unresolved file identity | 542.264 ms |
| Union of all categories | 5,678.408 ms |

These are overlaps, not an exclusive causal partition of the complete navigation delay. The remaining approximately 1.412 seconds of off-CPU time is not assigned to these recorded request lifetimes. `WrResource` waits occur as well; their resource owner is not established by the wait-reason label alone.

The context-switch **resume** stacks further classify these off-CPU intervals. A CSwitch stack is attached to its new thread, so the stack at the matching switch-in is used; a nearby stack from switch-out or another thread is not substituted. B's complete symbol-export attempt timed out before the relevant interval. Instead, kernel addresses from its complete earlier dump were matched only to unique, identical module/address pairs resolved in A from the **same original ETL/boot**; user-mode addresses were left unresolved. This recovers the following kernel paths without representing B's timed-out export as complete:

| Stack-associated off-CPU category | Duration |
|---|---:|
| `NtFlushBuffersFile` → cache flush → `NtfsWaitOnIo` | 5,140.787 ms |
| NTFS resource acquisition (`ExAcquireResource*`, `WrResource`) | 1,389.800 ms |
| `NtWriteFile` path with I/O wait | 542.297 ms |
| Other short intervals | 17.401 ms |

These intervals include the separately measured small ready-to-run portions; they are not extra time added to the 7,090.285 ms total. The flush stacks contain `NtfsCommonFlushBuffers`, `MiIssueSynchronousFlush`, `NtfsNonCachedIo` and `NtfsWaitOnIo`. Resource waits include `NtfsAcquireExclusiveFcb` during file lookup/create and resource acquisition in `NtfsFlushFcbFileRecords`. This supports synchronous flush/write and file-system resource waiting, but identifies neither the FCB/resource owner nor a culpable minifilter. FLTMGR is a normal layer in these paths; its presence alone is not a filter-duration measurement.

## What disk and service fields do not prove

The previous report quoted Xperf's `DiskSvcTime` as a reported metric, not independently measured physical-device time. In the long writes above it is 1,321 / 2,575 / 1,329 μs. Across the checked long writes, it equals the gap since the previous same-disk completion within 1 μs. It must **not** be subtracted from I/O elapsed and the remainder labeled “filter-driver time.” The guest trace cannot by itself separate all software queueing, virtual storage throttling and physical device work.

During the three long requests, respectively 196 / 156 / 123 other same-disk requests complete. That establishes concurrent storage activity, not which request or process caused this delay. Several ReadyThread records name a system-service thread in their logging context, but they also carry `InDPC`; a DPC running in that context is not proof that the named service owns the awaited work.

The existing B dump has **62,224 FileIoOpEnd** records, all with inferred ThreadID 0, FileObject 0, ElapsedTime 0 and Type Unknown. The official CPU profile enables FileIO but not FileIOInit. Consequently these records cannot provide a complete file-API entry/exit timeline or per-filter duration. Disk events and context switches remain usable; higher-level file-operation attribution has this concrete gap.

## First A and symbolic stacks

The independent A delay is **33.123606–43.742606 s**, 10.619 seconds from application-built to setup-enter. ETW divides it into distinct observable stages:

| Stage | Trace-relative interval | Evidence |
|---|---|---|
| Before first WebView creation event | 33.123606–36.761205 s | Product main thread 3316: **3,565.635 ms** off CPU with hard-fault read stacks. HardFault events attribute **3,513.528 ms** of request elapsed time to `EmbeddedBrowserWebView.dll`. |
| WebView client creation | 36.761205–41.612344 s | Browser process starts at 37.637122 s. Browser main thread 8304: **2,517.332 ms** off CPU with hard-fault read stacks in this stage, including locale/resource initialization. HardFault elapsed sums include `en-US.pak` **1,007.652 ms**, `icudtl.dat` **930.170 ms**. |
| Renderer readiness before setup | 41.612344–43.742606 s | Renderer main thread 1100: **1,916.588 ms** off CPU with hard-fault read stacks. HardFault elapsed sums: `ffmpeg.dll` **1,417.481 ms**, `v8_context_snapshot.bin` **274.005 ms**, `resources.pak` **226.761 ms**. |

HardFault elapsed sums and context-switch off-CPU totals are independent measurements, not numbers to add together. Threads overlap, so their durations are not presented as a full critical-path sum. The three selected primary-thread stages have respectively **7.822 / 27.516 / 16.259 ms** ready-to-run time, again much smaller than the observed read waits.

Resolved stacks include `LoadLibraryExW` → loader/page fault → `MiIssueHardFaultIo` → `NtfsCommonRead` → `NtfsWaitOnIo`; browser locale initialization reaches ICU/resource loading; renderer initialization reaches `EdgeEnsureFfmpegLoaded` and FFmpeg DLL initialization. Some paths include `WofPreReadCallback` / `FileProvReadCompressed` before the NTFS read. This proves involvement of compressed-file read paths, not that WOF CPU decompression or a particular filter caused the long storage response.

A's network-service cookie worker (PID 2604/thread 4804) also has **1,869.140 ms** of off-CPU synchronous-flush stacks between its initialization work and `FinishedLoadingCookies` at 43.536986 s. Its user-mode stack resolves `sqlite3PagerCommitPhaseOne` / `syncJournal` → `sql::Sync` → `winSync` → `FlushFileBuffers`, then the NTFS/cache-manager flush path. This overlaps renderer loading. The product main thread meanwhile waits in `GetMessageA`; that is expected while asynchronous WebView initialization progresses, not evidence that the UI thread is executing Mermaid slowly.

Thus A and B share **storage-backed initialization waits at a broad level**, and both contain cookie flushing. They are **not the same narrow bottleneck**: A includes substantial first-load DLL/resource hard faults; B's observed long phase is dominated by the cookie worker's flush/write and NTFS resource waits. Existing evidence does not prove that one system service, filter or host storage policy causes both.

## Offline analysis status and limitations

[Run 43517089223](https://github.com/Auto-Plugin/milkup/actions/runs/43517089223), candidate `fae2d48a`, used only the original ETL. It is **partial-analysis / failure**, intentionally:

- A's non-symbolic 33–44 s dump and reused B's 72–76 s dump both exited 0.
- A's Microsoft-symbol dump exited 0 and covers 33–44 s. Symbol requests used the official Microsoft symbol endpoint and a temporary cache; no system configuration changed.
- B's symbol dump hit the **180-second bound**, exit -1; its last event is 57.502937 s, before the selected slow interval. No critical-interval claim uses that partial file.
- All original/derived trace data remain encrypted in [artifact 14082370229](https://github.com/Auto-Plugin/milkup/actions/runs/43517089223/artifacts/14082370229). Artifact ZIP SHA-256 `e5183405a72326eef1941385e69ac65c36f208752ba7df6118806e13bf941dcc` and authenticated decryption were verified; raw trace identity remained unchanged. Runner plaintext and temporary keys were removed.

The current provider set has no usable complete file-operation start/finish linkage or minifilter callback duration records, and no host/hypervisor physical-storage timeline. Therefore it cannot divide all latency into file-system locks, filter delays, guest storage queueing and physical-device service. A specific service cannot be blamed from an interrupted DPC's process context. Product private symbols are also absent; public Windows/WebView symbols suffice for the named paths above, not every application frame.

## Minimal incremental capture, only if needed

Use the same isolated CI, exact build/runtime/document, disposable account and fresh/reused temporary profiles. Do not alter the original official profile. First query the installed signed WPR's `-profiles`/`-profiledetails` and verify the available **File I/O activity** and **Minifilter I/O activity** profiles (their exact CLI IDs must come from that installation). Add file-operation starts and relevant I/O initiation stacks, plus minifilter pre/post/pended activity if supported, to the existing WebView/CPU/ReadyThread recording. The official [built-in profile list](https://learn.microsoft.com/en-us/windows-hardware/test/wpt/built-in-recording-profiles) documents these recording categories; [Filter Manager callback ordering](https://learn.microsoft.com/en-us/windows-hardware/drivers/ifs/filter-manager-concepts) explains why merely finding FLTMGR on a stack is insufficient.

Capture only one fresh-profile launch and its immediate reuse, stopping on completion, 120 seconds or the existing 512 MiB intermediate-file budget; retain explicit incomplete status if a limit is hit. Preserve the existing privilege, ownership, close, encryption and event-loss checks. For service attribution, retain a read-only bounded PID+birth→service inventory; for physical/virtual-device attribution, require supported storage dispatch/completion telemetry rather than inventing a partition from DiskSvcTime. No filter removal, exclusion, Defender change, cache flushing or system-policy change is proposed. Raw traces, paths and command lines remain private/encrypted.
