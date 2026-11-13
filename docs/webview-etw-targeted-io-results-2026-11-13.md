# Targeted I/O diagnostic: completed once, attribution remains insufficient

Run [43522696501](https://github.com/Auto-Plugin/milkup/actions/runs/43522696501),
candidate `f4f7bcc036bd477045866fe9babb6d2db3c7c9a9`, completed successfully.
There was **one actual WPR recording**, two temporary-profile application launches,
and no additional capture. The two earlier workflow failures stopped before WPR
start (`recordingAttempts=0`), as detailed in the [plan](webview-etw-targeted-io-plan-2026-11-13.md).

The existing signed Microsoft recorder enabled the pinned official WebView CPU
profile plus existing FileIO, Minifilter and DiskIO configurations. Full configuration
comparison passed. Recording lasted 60.203 seconds, reported zero lost events and
buffers, and stopped normally before the 120-second limit. WPR start/stop both
returned 0. No bounded-stop trigger fired. Final merged ETL size was 1,630,535,680
bytes; the 512 MiB watcher threshold applies to intermediate files, not final
merged size. No claim of a 512 MiB final artifact cap is made.

| Same-run temporary profile | Startup to first decoded-image observation | Built → setup | Navigation → Wry callback | Wry response |
|---|---:|---:|---:|---:|
| Fresh A | 7,252 ms | 3,644.276 ms | 12 ms | 34.308 ms |
| Reused A | 4,497 ms | 1,065.744 ms | 5 ms | 10.852 ms |

Both launches used the exact same binary, runtime and document, closed by real UI
with exit code 0, retired their verified process generations and left zero owned
WebView processes before reuse. The account, profile and stage were deleted with
no cleanup errors. This is a startup diagnostic, not full product acceptance.
Observed image timing includes harness identity verification/attachment and polling;
it is not an exact first-paint timestamp or an uninstrumented performance benchmark.

The earlier **~9.159-second post-navigation critical-path delay did not recur**.
Consequently this run does not identify the cause of the previous 5.141-second
synchronous-flush wait or 1.390-second NTFS-resource wait. It also does not prove
that all background I/O waits were short. Different CI machines and additional
instrumentation prevent a causal speedup comparison against the earlier capture.

## Evidence and limits

- Native Xperf aggregate exports (`tracestats`, process, CPU/disk, disk I/O,
  profile and markers) completed without timeout. They do not establish a unique
  per-request file-operation → minifilter callback → storage dispatch/completion
  chain or an NTFS resource owner.
- The WebView XML export contained 26,993 records, all with processing error 15003.
  It is not decoded WebView evidence. Enabling a provider is not proof that its
  individual callback durations have been successfully correlated.
- The ETL merge finished at 23:01:50 UTC; the outer audit finished at 23:10:04 UTC.
  Most of the long outer step occurred after capture, in diagnostic postprocessing.
  No finer allocation among exports/compression is established by these timestamps.
- No further application comparison or capture will be run under this task.
  No new remote analysis recipient key was created or relayed. Existing local
  authenticated decryption verified the retained ETL SHA. The full encrypted ETL
  remains available for future authorized offline inspection, but no additional
  attribution is claimed now.
- Findings describe this disposable hosted **CI environment only**. They do not
  identify Defender, another filter/service, physical storage or a user's machine
  as the cause. No product, persistence or security settings were changed.

## Retention

Encrypted artifact [14083464711](https://github.com/Auto-Plugin/milkup/actions/runs/43522696501/artifacts/14083464711)
expires **2026-11-20 23:10:08 UTC**. ZIP SHA-256:
`9fd70efed038e4022f460a667d4c98237528ad9dd5813a88838803a44b731713`.
Original ETL SHA-256:
`1e2a8c447a9c2205be7d39c522b0633e76b2173a66b7ed4d5888db7484d5edf1`.
The private local copy is under `/workspace/milkup-targeted-io-results-43522696501`;
this is temporary workspace storage, not a durable backup. Raw trace payload is
not committed or published.

The [separate retention check](webview-etw-retention-check-2026-11-13.md) confirms
that all four earlier private bundles remain readable and decryptable with the
existing key, including the original ETL hash fixed in the earlier report.
