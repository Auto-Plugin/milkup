# Windows cold-start ETW result — 2026-11-13

The requested capture is feasible and has been executed. It narrows the reproduced pre-Wry delay to WebView's new-profile cookie-store/storage initialization path. It does **not** establish the underlying Windows service/driver responsible, or demonstrate a safe application optimization. No product logic or security settings changed and no Release was published.

## Exact evidence

- [Capability run 43512040812](https://github.com/Auto-Plugin/milkup/actions/runs/43512040812): existing Microsoft-signed WPR/WPA/WPAExporter/Xperf, successful bounded test recording. Official unmodified `WebView2_CPU.wprp`, SHA-256 `becbf3e4638e5f458e16a8fb7e7b14ae15dcdfe06bdb3d89a86c58412b2b062a`, recommended by the [WebView2 ETW guide](https://github.com/MicrosoftEdge/WebView2Feedback/blob/2efb0bcf349c5bbb2040df78eb36e851cb6853d7/diagnostics/etw.md).
- [Capture run 43513112486](https://github.com/Auto-Plugin/milkup/actions/runs/43513112486), candidate `0c3e71e90891267cc8c2e438ff4e869c3e401e32`: eight launches in one disposable, non-elevated standard account. Recorder was in the already-elevated CI coordinator. This was a startup diagnostic, **not** full product/dual-account GUI acceptance.
- Same executable SHA-256 `5636badf936b4582ba35d549d152eef5f8a6dffc6d5c0683890c9b610b7c5ce8`, WebView2 `156.0.4314.58` SHA-256 `8b6fabdf9f4ebb331cb7325bb9947e4e3f9a2b5345602feeacf277b1f9f355be`, ordinary synthetic document SHA-256 `44a8730d312bc8410af28ae6c6b8cce657767c65e861146f909407ac2c9b0ecf` throughout. Application source equals diagnostic `29551c34`; this is a newly built executable, not the previously accepted installer.
- ETL covers **21:51:51.2083945–21:53:33.3323263 UTC**, including all eight launches. WPR start/stop both exit 0, no budget-triggered stop. ETL 550,502,400 bytes, SHA-256 `4ca45baaa69c468edddca6499f110608e4a788268b3dd5f52678d94a2faec13b`; Xperf reports **0 lost events / 0 lost buffers**.
- [Encrypted trace artifact 14080227264](https://github.com/Auto-Plugin/milkup/actions/runs/43513112486/artifacts/14080227264). ZIP SHA-256 `7d962c072b925a785308e4eb4b07bc7901c126d9fc3dcde2bb8de8252427e90f`. Authenticated encryption and original ETL hash were independently verified after download.
- Offline processing of those **same ETL bytes**, without launching Milkup: [43515322201](https://github.com/Auto-Plugin/milkup/actions/runs/43515322201) exports aggregate process/CPU/disk/loss data; [43515829392](https://github.com/Auto-Plugin/milkup/actions/runs/43515829392) exports complete WebView events, the slow interval and thread CPU data. All requested exports exited 0, none timed out. Reports remain encrypted in Actions.
- All launches produced decoded PNG, closed through product UI with exit 0, retired their exact process identity, and had zero remaining WebView processes in their account. ETW process start times align with creation FILETIME within 5 ms. PID 6764 was also used earlier by PowerShell: association used image, birth and interval, not PID alone.

## Same-trace timing

Times below are milliseconds. First decoded observation includes harness observation latency; it is not exact paint time. “Built→setup” is the native phase gap. “Navigation→Wry” ends at the first Wry request callback.

| Trial | Temporary profile | First decoded observation | Built→setup | Navigation→Wry | Wry callback work |
|---|---|---:|---:|---:|---:|
| 0 | A new | 14,935 | 10,619 | 13 | 5.010 |
| 1 | A reuse | 4,052 | 1,028 | 4 | 14.920 |
| 2 | B new | 13,465 | 1,017 | **9,159** | 3.384 |
| 3 | B reuse | 3,874 | 951 | 3 | 28.183 |
| 4 | A reuse | 3,327 | 767 | 3 | 12.083 |
| 5 | C new | 4,605 | 1,635 | 701 | 2.588 |
| 6 | C reuse | 3,425 | 770 | 3 | 10.218 |
| 7 | B reuse | 3,120 | 722 | 3 | 11.532 |

This reproduced a substantial delay in the same pre-Wry phase, **not the full prior 14–15 seconds**. A-first has a different 10.619-second pre-setup delay and is not silently attributed to B's mechanism. First A additionally initializes the plugin catalogue. Tracing overhead has not been quantified by an untraced matched experiment; no performance improvement is claimed.

## What the trace adds

The slow B launch is product PID 3140, WebView browser PID 872, and its network-service child PID 1788 (`network.mojom.NetworkService`). Process creation/parent relationships and the bounded launch interval establish this chain. The source FILETIME and trace-relative times are preserved in the companion JSON.

1. The app's navigation begins at trace-relative approximately **57.591606 s**. The first Wry callback is approximately **66.750606 s**. Browser navigation timing independently records request start at 5.4 ms and response start at 9,267.2 ms relative to navigation.
2. Network-service thread **528** records `SQLitePersistentCookieStore::Backend::FinishedLoadingCookies` at **66.753081 s**. The product's first `ICoreWebView2WebResourceRequestedEventHandler` event follows at **66.753941 s** (0.860 ms later on the ETW clock).
3. That same thread performs **26 disk-write records** to `Cookies` or `Cookies-journal`, all privately checked to match temporary profile B. Several waits end immediately after their I/O completes. Examples:

| File category | I/O completion (trace seconds) | Total I/O elapsed | Reported disk service time | Thread resumes after completion |
|---|---:|---:|---:|---:|
| Cookies-journal | 63.998752 | 887.654 ms | 1.321 ms | 26 μs |
| Cookies-journal | 64.869187 | 627.573 ms | 2.575 ms | 15 μs |
| Cookies | 65.995528 | 598.877 ms | 1.329 ms | 25 μs |

4. Thread 528 is off CPU for **7,090.285 ms** within the 9,159 ms phase interval, with repeated `Executive` and `WrResource` waits. This is an observed off-CPU total, not a claim that all of it is cookie I/O. The product's main thread uses only **25.437 ms CPU**, browser main thread **177.297 ms CPU**, and all network-service threads **118.760 ms CPU** during that interval. The main HTML and Mermaid module have not run yet during most of this delay.
5. Across each network-service process lifetime, new B has **198 writes** and **35.722 s summed I/O elapsed** versus reused B's **7 writes / 22.840 ms** (and later reuse **9 / 20.506 ms**). Summed I/O includes concurrent requests and is **not wall time**. Reused B finishes cookie loading before the first document resource callback.

These observations support a **proximate storage-wait bottleneck in WebView's new-profile initialization**, rather than repeated Mermaid rendering or slow Wry callback execution in this sample. They do not identify why I/O completion is delayed. Disk 0 is busy and a system service also consumes CPU, but that is not sufficient to assign causality. Stack addresses were captured; symbolic function-level wait attribution has not been completed. No claim about Defender or a specific filter driver is justified.

## Decoding and privacy boundaries

The initial `Get-WinEvent` XML export was capped at 50,000 records and **all 50,000 contain decoding error 15003**. It is not evidence of decoded WebView behavior. Signed Xperf successfully decoded the complete retained provider stream; critical cookie/event schemas were checked for ambiguity. The detailed kernel export is intentionally limited to **56.5–68 seconds**, explicitly covering B's slow interval; it is not represented as a whole-trace kernel dump.

Only allowlisted timing, process IDs, aggregate metrics and file **categories** are published here. Raw command lines, URLs, user SIDs, profile paths, event payloads and stacks remain in private workspace/encrypted artifacts. No original private key is committed or uploaded. Offline analysis uses a fresh recipient key and a run/hash-bound wrapped-key envelope, then removes its key and plaintext. No Defender, network, runtime or security settings were changed; no real user data was used.

## Remaining executable analysis

Do not repeat ordinary startup trials to obtain these tables: the full original trace is retained. In an authorized isolated Windows analyzer, decrypt the exact artifact, verify the ETL hash above, open it in WPA, and select **57.591606–66.750606 s**. Correlate PID 1788/thread 528's precise CPU/wait stacks with Disk Usage (I/O start, queue/dispatch, completion) and the cookie-store events. Compare profile B's retained launch at **72–76 s**. Resolve Microsoft symbols if needed, retaining all payload privately. Examine first A's **33.123606–43.742606 s** pre-setup interval separately.

The next decision needs symbol/queue evidence establishing a controllable cause, then a same-environment before/after experiment. Existing normal-user WebView profile reuse is already present; sharing profiles across users, disabling durability or changing security policy is not proposed. No application optimization is justified by this one recording alone.
