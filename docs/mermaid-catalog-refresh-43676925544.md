# Catalog-ready preservation: exact-package Windows evidence

One bounded, manually dispatched run [43676925544](https://github.com/Auto-Plugin/milkup/actions/runs/43676925544), job `132699018825`, tested and built **42277c9a7d9eecaf056296ef7497a300ba6ba541**. Product fix: **3c658aa49f39263c7a0fdb9867b5d20a1b251194**. The run failed its independent warm-control prerequisite; it is not an overall acceptance pass. Initialization preservation, isolated cursor movement and normal close have positive native evidence. No second run was dispatched.

## Product change and local gates

The final plugin-catalog-ready callback previously cleared the document presentation service and rebuilt the ordinary editor even when its active renderers had not changed. Baseline [43675503357](https://github.com/Auto-Plugin/milkup/actions/runs/43675503357) captured two actual renders of the same source and replacement of image 1 by image 2 with no input, aligned with this callback.

The fix records an opaque editor scope, current document identity and rendering signature when its presentation provider begins. Only the final catalog-ready callback may retain the existing view/cache/pending work, and only when that receipt, current document, renderer declarations, host activation epochs, authenticated Mermaid identity, theme, plugin mode, presentation settings and installed renderer/syntax bindings still agree. Recording before await permits pending work to finish. Explicit refresh/invalidation, enable/disable, failure, mode/configuration and real package/epoch changes still use the previous clearing path. SourceDocumentView and large-document preview are excluded from this optimization. Plugin UI contributions still sync.

No renderer architecture, plugin strategy, editor global controls, persistence guarantee, sandbox, security or production configuration changed. Mermaid remains the authenticated pure frontend owner. This does not change intentional mixed-mode source visibility.

Local regression gates passed: 206 desktop tests (including pending-request retention/revocation, changed identities and concurrent/repeated shutdown), 105 view-dom tests (including selection-dependent presentation and PNG lifecycle), desktop TypeScript, 25 observation/frontend Node contracts, 21 distribution/recovery/provenance contracts, PowerShell parser and failure-finalization contracts. The exact Windows job independently passed its 206 desktop tests, TypeScript, observation contracts and real sandboxed browser layout fixture before building. Local unit tests do not substitute for a full installed plugin-toggle/configuration matrix.

## Package and process identity

- Installer: `milkup-2.0.0-beta.10-windows-standard-42277c9a7d9e.exe`, 7,256,086 bytes; SHA-256 `7e37d954b1ba47bd4775ca45d24b0f6fd08cf4f3fa711a2eb0902c0212f72b48`.
- Installed executable SHA-256: `db0dcc79daa32f9626ebbb1e1288cad0fe7a4e3704c9c591419e05f76ce73b98`; version `2.0.0-beta.10`.
- NSIS silent install exited 0 under a verified pure standard account, medium integrity 8192, no Administrators group, no inherited parent environment.
- Product PID 9876, creation FILETIME `134391911782374032`, UTC `2026-11-15T04:39:38.2374032Z`. Edge/WebView2 and matching Microsoft-signed driver `156.0.4314.58`.
- This is a newly built, unsigned standard candidate, not the old `383c0712` installer. Missing Runtime provisioning, offline installation, upgrade and dual-account matrix were not repeated.

## Native observations

| Check | Exact result |
| --- | --- |
| No-input initialization | Passed. Observer attached before catalog ready and before any admission; zero input. Exactly one admitted/started/finished request, `e2444d184deb4975a27f7e29e608479f`. |
| Actual rendering | Started Unix 1794717582726, finished 1794717583095: 369ms. Source SHA `ed6c1c45e641854fc978b72aef8b7f3e55c38b8d11fc4e8f961e042367bb71fa`, PNG SHA `b28f3895c9d7255d97cadf07d95c98fcfeca566c4160740ed010ba7e6e279a1e`, same source/PNG as the old baseline. |
| Catalog boundary | Layout-decoded at performance 2570.6ms; catalog ready at 2598.9ms. Image identity 1 and one cache entry retained through catalog ready and the subsequent quiet interval. No second render. |
| Stable cursor | Passed. After catalog readiness and >1.5s quiet, real pointer focus and 40 ArrowRight/ArrowLeft moves: admissions/renders/finishes remain 1/1/1; image identity remains 1. |
| Independent cold entry | Valid offscreen-to-visible observation, not ready before entry. Six source-visible rAF samples, 94.5ms visible-source-to-decoded, maximum sampling gap 17.8ms; actual renderer 36ms. Source exposure persists. |
| Independent warm control | Rejected: `Independent warm source must not already be prepared`, actual 1 versus required 0. No warm entry measurement was made. |

The warm source finished at Unix 1794717594242; document-ready observation was 1794717594296 and observer began approximately 1794717594309.6. First layout sample was genuinely offscreen, but preparation had already finished 67.6ms before attachment. Diagnostics report `prefetchRenders=1`, `prefetchReady=1`; this is evidence of preparation, **not** a measured offscreen-preparation-to-entry control. It must not be represented as zero latency or no flash. A retained prior scroll window is a plausible source-level explanation (the bounded prefetch range is relative to the current presentation window); this run did not capture that window's exact line range, so the specific trigger remains an inference.

The next measurement correction should establish/record the initial viewport before opening the independent warm file, or attach the read-only observer before that document can prepare. It must retain the already-prepared rejection and prove an offscreen interval plus subsequent actual target entry. Merely increasing the fixture's line count or accepting a pre-ready result is insufficient. This task dispatched no follow-up run and changed no product behavior to manufacture a cold control.

## Timings and limits

Process creation to first layout-visible decoded image: **4882.6ms**; frontend initial-document-ready to that image: **1263.4ms**. Initial source was observed for 79 rAF samples / 1231.0ms, maximum gap 36.5ms; its beginning was left-censored. The old same-document baseline was 6299.6ms process-to-image, with a 979ms first renderer. These different sessions show removal of a redundant render; they do **not** establish that the platform cold-start long tail improved. No repeated controlled latency distribution, physical-paint/no-flash guarantee, or OS-cold-cache claim is made.

The raw `baseline.sameImage=false` compares the initial null image to the final image and does not indicate replacement. The independent evidence uses the complete observed non-null identity set `{1}` plus actual request records. The derived `readyBeforeFirstInput` field in this harness also includes readiness/attachment conditions beyond its name; use raw timestamps and the stricter comparison classification, not that field alone. Neither ambiguity changes the startup result or the rejected warm stage.

## Failure-preserving close and retained evidence

The warm-stage assertion remained failed. The observer handed off to native finalization: actual UI close, exit 0, stdout/stderr EOF true, overflow false, forced cleanup false. Independent offline replay of the exact PID+birth ledger passed all 53 records, three completed requests and one released owner with no pending work. PNG hashes and all three original document byte hashes match. No external Mermaid renderer dispatch was accepted. Frame removal still does not prove synchronous hard termination (`hardTerminationProven=false`).

`mermaid-visible-verify.json` explicitly reports `frontendAudit=complete-and-released`, but fails `All observation stages must pass`; the outer message `Final complete frontend audit failed` combines that functional contract with the audit. It is not a missing EOF/release failure. Uninstall did **not** execute after the failed observation contract. Supervisor account/profile/staging removal succeeded with no cleanup errors, independently of proven product close, and is not an uninstall substitute.

Raw evidence artifact **14147685201**, 47,136 bytes, SHA-256 `d1e52ee26b907b14bc6da22c4ac6e3f50aaa79832e21f480150f086d5c336d51`, expires `2026-11-22T04:39:58Z`. Original candidate artifact **14147610326**, 7,257,546 bytes, SHA-256 `47edded6271e418f53c9669511774cf8d00edaee08c782397d799bfa11b612cb`, expires `2026-11-22T04:39:59Z`. ZIP CRC, archive digest, original installer digest and offline ledger were rechecked. Temporary originals, expanded evidence, metadata, workflow log and independent review are under `/workspace/milkup-visible-native-43676925544`; persistent retention identity is recorded below once saved.

No main merge, release, public distribution, personal notification or system security changes. The product fix has a positive targeted installed observation; the complete requested comparison still has a rejected warm control, persistent cold source exposure, and no long-tail resolution claim.

Persistent private copy: Library `libfile_fde3_f-ba42aaf02638819185fa94e8d9a54620_0ca5afc9150881919eb83108db749c2b`, `/milkup-catalog-refresh-evidence-43676925544.zip`, version 0, 7,328,776 bytes, SHA-256 `bf915439879b056394b652ddee2f0e49480b946b1a6bd101b1492df33d6c54d7`. Save succeeded and local Library identity attributes were applied. The bundle contains both untouched original artifact ZIPs (including the tested installer), metadata, full workflow log, separate offline review and this report before this self-referential paragraph. Temporary workspace copies alone are not persistent retention.
