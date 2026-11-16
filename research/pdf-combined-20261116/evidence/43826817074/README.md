# 43826817074: actual compilation passed, continuation wiring failed

Run: https://github.com/Auto-Plugin/milkup/actions/runs/43826817074

Tested SHA: `de04c40f1e7a100e6da03762c3bef56c23eef55a`.
Created 2026-11-16 07:52:01 UTC, terminal failure 08:07:14 UTC.
Only one combined dispatch was made. No successor is dispatched by this report.

## Exact executed boundary

- Source, compiler, configure flags, generated headers and command database
  matched the existing strict identity. The original four-TU evidence was
  reused only under its unchanged-input gate.
- Six-field objects from 43808221193 / 14199955883 were actually restored.
  Two separate ccache process samples each hit once with zero misses.
- The combined patch is exactly
  `21eef8e16614a44cfe0be023812617b17865cbd29fce66b172905bef7b052008`.
  All 13 selected source files were covered by **11 unique actual unified TU
  commands**, all successful with ccache disabled, totaling 287.302 seconds.
  RenderTable/RenderTableSection share one TU; RenderBlockFlow/RenderBox share
  another. A source count is not the unique compiler invocation count.
- After that uncached compilation, the exact historical FontCascade and
  GraphicsContextSkia first ccache invocations each hit once, zero misses,
  in 0.067 and 0.036 seconds. This is actual reuse evidence, not a full-build
  completion prediction.
- The continuation failed **before** setting `engineBuildAttempted=true`.
  Its old `uniqueObjectCommands in (1,2,3)` assertion rejected 11. This old
  assertion is reproduced against the unchanged retained real receipt.
  `pagination-continuation.json` has `engineBuildAttempted=false`,
  `nativeAttempted=false`, `samples=[]`; it is not a resource timeout or a
  compiler/link failure. The old handler stored an empty AssertionError
  message, so the diagnosis uses the exact source path and real receipt too.
- No full engine, private installation, installed application, WebProcess
  identity, native PDF, geometry, Unicode, digits or URI combined result was
  obtained. Native artifact upload correctly found no files. Cleanup was a
  no-op because this run never installed the application.

## Preserved raw evidence

`preflight-original.zip` is byte-identical to artifact **14207199050**:
6,776,017 bytes, SHA-256
`a2527986b0e897ded6a15c10346fa92083dc02348f09fa78992f134e1fb50db2`.
ZIP CRC passed; the complete archive contains 162 original evidence files.
`selected/` contains unchanged selected members for review. The archive remains
the complete source, including actual command lines, source hashes and logs.
GitHub original expiry: 2026-11-23 08:07:09 UTC; this repository copy retains
the failed evidence independently of that expiry.

Object artifact **14207682020** is 546,716,485 ZIP bytes, uploaded digest
`318c3e809632ea3309991ee427f3e960f3d9620fc5aa8611075f28b6984476b8`,
expiry 2026-11-23 08:06:51 UTC. It contains compiler objects only, no runtime.
Its seven-field key is
`pagination-behavior-objects-v1-291268b111a071ddbd1d2d34982605c35985f7047c2cf9e5e5204caaea4ecac9`.
This large archive was not downloaded into the nearly full local filesystem
and is **not cross-job-restored/proven**. Do not send it through the six-field
restore path or describe it as newly built runtime evidence.

## Corrected local wiring, not a new native pass

The next harness uses a shared source selection and `candidate_gate.validate`
in both actual-TU production and continuation. It requires exact source sets,
source hashes, configured database identity, identical shared-TU commands,
one successful hashed compile result per unique command, and the unchanged
explicit object budget. It derives 11 from the actual command graph instead
of replacing the stale constant with another permissive count. The genuine
receipt passes unchanged. Missing/extra sources, missing/duplicate samples,
wrong hashes/database/input, nonzero compile exit and enlarged budget fail.
The continuation now preserves bounded traceback and exception type too.

Local focused results: 22 behavior tests plus 8 combined/auditor tests pass.
The combined patch, all behavior patch hashes, native fixtures, PDF thresholds,
identity/sandbox checks and original input/output path are unchanged. No
product behavior fix was inferred from this harness failure.

The next possible native run still requires dedup and one explicit bounded
continuation: proven six-field restore 14199955883, exact source gates,
2400 seconds / 160 new misses, resource/stagnation stops, and 550-second
native batch. No automatic retry or cold fallback is introduced. The current
failure remains a failure and every combined behavior claim remains untested.

Delivery limits are in ../../DELIVERY-BOUNDARY.md. #255 is queued for a future
already-needed installed-candidate regression; no extra build or CI was run.
