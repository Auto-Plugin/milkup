# Isolated WebView2 startup ETW investigation

Completed capture and analysis results: [webview-etw-startup-results-2026-11-13.md](webview-etw-startup-results-2026-11-13.md). The plan below preserves the original execution design; the capture is now complete.

No application logic, Defender, network configuration or system security policy changes. No Release. The purpose is to explain, rather than merely repeat, the previous 14–15 second navigation-to-Wry-callback tail.

## Actual capability result

- Official guidance: https://learn.microsoft.com/microsoft-edge/webview2/concepts/performance and https://github.com/MicrosoftEdge/WebView2Feedback/blob/2efb0bcf349c5bbb2040df78eb36e851cb6853d7/diagnostics/etw.md.
- Unmodified recommended CPU profile at that revision: SHA-256 `becbf3e4638e5f458e16a8fb7e7b14ae15dcdfe06bdb3d89a86c58412b2b062a`.
- Run **43512040812**, commit `4b5430654f711468126ed198837c8ee1aa828838`: capability probe passed on `win25-vs2026`, image `20261103.298.1`, OS `10.0.26100.0`.
- Existing tools all have valid Microsoft signatures: WPR `10.0.26100.33648`, WPA/WPAExporter `11.7.395.48728`, Xperf `10.0.26100.9457`, tracerpt `10.0.26100.1`. No toolkit install or security-policy change was needed.
- WPR start/marker/stop exit codes all 0. Two-second non-product probe produced 13,631,488 bytes; 100 sample records were readable. Full recording/event-loss integrity was not inferred from this sample. Raw probe trace was deleted on runner; only allowlisted metadata uploaded.
- Earlier run43511763764 failed before probe because full repository checkout hit Windows long paths. Sparse checkout fixed it. Run43511996235 detected changed profile hash caused by checkout newline conversion; `-text` now preserves original bytes. Neither failed run is product evidence.

## Controlled capture

Capture run **43513112486**, candidate **`0c3e71e90891267cc8c2e438ff4e869c3e401e32`**, is separate from later analysis preparation commits. At the time this plan was written it was still compiling, not a completed trace result.

Its application/packages/plugins/vendor/dependency files are byte-identical in Git to prior diagnostic `29551c34300b1a0ffb3a3fdabe26b8cbec914692`. A new binary will be built once and its exact hash retained; it is not claimed to be the same executable bytes as the previous build. All compared launches within this run must use the same verified executable, runtime image and ordinary synthetic test document.

Reuse the established eight-trial A-new/A-reuse/B-new/B-reuse/A-reuse/C-new/C-reuse/B-reuse sequence under a genuinely non-elevated temporary standard account, with unchanged profile-generation, catalogue, normal UI close, process-identity and resource-release gates. No existing user profile or document is touched. The recorder runs in the already-elevated CI coordinator; the product account is granted no tracing privilege.

Record using a unique named WPR instance from before the child launch. Stop on harness completion, 180 seconds, or 512 MiB intermediate recording files. Budget stop is explicitly recorded and does not imply that subsequent trials were captured. Only this instance is stopped/cancelled. Stop/merge and subsequent analysis have bounded waits. Correlate native `unixMs` phase markers with ETW UTC times; PID alone is insufficient, so constrain every association by the existing creation FILETIME and launch interval.

## Privacy and reproducible analysis

Original ETL, event XML and any native report tables are never uploaded in plaintext. The retained bundle uses per-file AES-256-GCM with RSA-OAEP-SHA256 wrapped keys, authenticated header and atomic output publication. Only a public retention key is committed. The original private key remains in the authorized local workspace. Tests cover roundtrip, tampering, truncation, wrong recipient and preserving existing destination/partial files.

The capture candidate retains the complete encrypted ETL plus WebView event XML. Later `f6b96c81` additionally prepares Xperf CPU/disk/process exports, but is **not** included in the running capture. To avoid another application run, `webview-etw-analyze.yml` is prepared to analyze the exact retained run43513112486 artifact in disposable Windows:

1. Verify source SHA, artifact contents, encrypted file size/hash and authenticated original ETL size/hash.
2. Generate a one-run recipient key. Publish only its public half.
3. Locally verify the exact analysis run/public-key artifact, then rewrap only this trace's AES key for that recipient. The envelope binds run ID, sealed trace hash and recipient hash. Commit only the encrypted envelope; no original private key or plaintext trace enters the repository.
4. Export `tracestats`, `process`, `cpudisk`, `diskio`, `profile` and `marks` using signed Xperf. Retain all native output in an encrypted bundle and only exit codes/counts/hashes in the public summary. No product is launched by this workflow.
5. Delete the analysis private key and plaintext after sealing. Keep failed/partial exports explicit.

## Required interpretation

Before attributing the long tail, establish a normal and a reproduced slow launch in the same captured interval; verify event-loss/rundown completeness, account and process-generation linkage, WebView navigation events, CPU sampled/ready/wait intervals and disk activity. Report the overhead of tracing and the resolution of clock alignment. Aggregate or classify paths; do not publish raw command lines, URLs, profile contents or trace payloads.

If no comparable slow launch occurs, or decoding/drop/rundown limits prevent attribution, report that limitation. A successful recording alone is not a root-cause finding or a performance improvement. No product optimization is justified until a controllable bottleneck and before/after benefit are demonstrated.
