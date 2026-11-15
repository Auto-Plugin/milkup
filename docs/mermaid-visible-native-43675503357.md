# Same-package initialization versus cursor observation, 2026-11-15

One manually dispatched Windows run: [43675503357](https://github.com/Auto-Plugin/milkup/actions/runs/43675503357), job `132694641090`. Tested harness `1c56bd9b105737add120612b3e143f1d49863b71`; original application build `383c0712f21071467f2549d73a022b03db4b69aa` from run `43616134287`. No rebuild, ETW, full installation matrix, application change, security change, merge or release. Existing failure `43674323919` remains preserved.

The run and its observation/normal-close contract passed. Independent review establishes startup duplication without input and stable post-initialization cursor movement. It does **not** establish a complete offscreen-prefetch comparison or removal of the cold-start tail. The warm document was already visible at its first sample.

## Identity and prerequisites

- Original installer `milkup-2.0.0-beta.10-windows-standard-383c0712f210.exe`, 7,256,557 bytes, SHA-256 `6fe28bcd235dc04993b1889f3c4bb5086e4e86cc2ad06da0172098ba1f974902`.
- Installed executable SHA-256 `5845ef28a2c27d87c2cd459c0c583e6f984b4323518408cd073288b6426cc433`.
- Windows hosted runner; ordinary account, medium integrity 8192, no Administrators group, no inherited parent environment. Product PID 2580, creation FILETIME `134391894844925436`, creation UTC `2026-11-15T04:11:24.4925436Z`.
- Existing Edge/WebView2 156.0.4314.58 and matching Microsoft-signed driver. Real sandboxed browser layout fixture passed with the corrected text-node observer; it distinguishes an offscreen image and a preview mounted inside a source-line host. No browser sandbox fallback or Runtime provisioning.
- Local pre-run checks: 23 Node tests, PowerShell parser, normal-close/EOF positive and rejection gates, five finalization cases including observation failure followed by close/drain/audit, exact Node path, install-only and unchanged repair gates. Original native logs are authoritative for the Windows execution.

## No-input startup versus isolated cursor

No pointer, keyboard or wheel input occurred until Unix ms `1794715894747`. The observer attached before catalog readiness, with no diagram requests yet.

| Observation             | Evidence                                                                                                                                                                                                      |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| First actual render     | `00bcf36f56c941b496bbbe1fad47cd18`: admitted 1794715889784, started 1794715889793, finished 1794715890772                                                                                                     |
| First decoded DOM image | Image identity 1 at performance time 3952.8ms; cache entries 1, renders 1                                                                                                                                     |
| Catalog ready           | Performance mark 4672.4ms, time origin 1794715886852.6; Unix approximately 1794715891525                                                                                                                      |
| No-input replacement    | At 4729.5ms image absent, cache entries 0, renders 2; at 4791.9ms image identity 2 decoded                                                                                                                    |
| Second actual render    | `2214137a671541f19ae02c1c6f797c3d`: admitted 1794715891543, started 1794715891566, finished 1794715891608                                                                                                     |
| Isolated cursor         | After catalog readiness and a further stable interval over 1.5 seconds, real pointer focus then 40 ArrowRight/ArrowLeft movements; admitted/started/finished counts remain 2/2/2 and image identity remains 2 |

Both startup requests have source SHA `ed6c1c45e641854fc978b72aef8b7f3e55c38b8d11fc4e8f961e042367bb71fa` and PNG SHA `b28f3895c9d7255d97cadf07d95c98fcfeca566c4160740ed010ba7e6e279a1e`. This is genuine repeated Mermaid execution without cursor input, not merely a cached PNG decode or another graph. Identical PNG hashes alone do not identify which request produced an individual DOM blob; the execution counters and DOM identities are separate evidence.

Source corroboration: `apps/desktop/src/main.ts` marks `plugin-catalog-ready`, then calls `refreshPluginContributionsInViews()` after initial document open. That path calls `desktopDocumentPresentation.clear()`, replaces presentation configuration and can recreate the editor view. The no-input cache reset and image replacement align with this path. No disposal stack was captured; this evidence does not prove every historical user cursor report has the same cause.

**Minimal product direction selected:** inspect the final catalog refresh for redundant invalidation of an already authenticated, unchanged Mermaid renderer generation and image. Preserve real plugin changes, activation epochs, disable/error invalidation, Math and other selection-dependent providers. Do not remove all catalog refreshes or postpone first rendering until the whole catalog completes. This turn changes observation/exit wiring only; no product fix or performance benefit is claimed.

## Visible latency and independent documents

Initial document is a short, unchanged Markdown fixture. Two additional uniquely hashed documents were opened through the identity-held native file picker, with real SendInput and exact filename readback. No private application open hook or global mode switch was used. All document bytes remained unchanged.

| Sample                                                                       | Measured outcome                                                                                                       | Boundary                                                                                                            |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Process creation to first layout-visible decoded image                       | 6299.6ms                                                                                                               | One sample; not exact physical paint or a cold OS-cache benchmark                                                   |
| Frontend `initial-document-ready` to decoded visibility                      | 1838.3ms                                                                                                               | Initial source already visible at observer attachment                                                               |
| Observed initial source interval                                             | 113 source-visible rAF samples; first sample to decoded image 1762.7ms, maximum sample gap 38.6ms                      | Beginning of source exposure is left-censored; not an exact source-paint duration                                   |
| Immediate entry, independent document, graph beyond 256-line prefetch window | Initial offscreen sample, then 6 source-visible samples; decoded image 93ms after first visible source, max gap 17.1ms | Genuine not-ready-before-entry sample. Source exposure is observed; no-flash is not proven                          |
| Separate warm document                                                       | Successful source render before wheel; first observer sample already visible and decoded, 0 source samples             | **Left-censored, no offscreen sample. Not an accepted offscreen-prefetch comparison and not a zero-latency result** |

The actual first renderer started-to-finished interval was 979ms; duplicate startup render 42ms; immediate-entry render 37ms; warm document render 27ms. These are distinct from user-visible wait. Engine connection assets-read to ready was 534ms. Application-built to setup-enter was approximately 2465ms; navigation-start to main resource callback 807ms; Wry request handling 23.130ms. Catalog prepare 10 overlapped first rendering and took about 928.6ms. These measurements do not isolate scheduler versus disk/engine contention and justify no system or persistence change.

The earlier 4.35-second sample used a different document and coincident initialization/input; neither sample demonstrates that the historic 20-second tail is repaired.

The warm-control limitation was detected in independent artifact review even though the original run's contract passed. A follow-up **local-only** contract amendment requires a hidden/offscreen sample before entry, distinguishes visible-at-first-sample, attaches the entry observer before waiting for warm readiness and rejects an already-visible warm control. It does not modify the raw run or retroactively claim a new Windows pass. Node tests now 24/24. No second run was dispatched.

## Close and evidence

Actual application UI close succeeded with exit 0; stdout and stderr EOF true, no overflow, no forced cleanup. The final exact PID+creation ledger verified 56 events, four completed requests and one owner release with zero pending requests. Frame removal is explicitly not a hard-termination guarantee (`hardTerminationProven=false`). The owned uninstaller then exited 0, removed the application and preserved the initial document hash. Temporary account/profile/staging cleanup succeeded independently; it is not substituted for product close.

This was one ordinary-account session, not a dual-account/full native-window lifetime audit, missing-Runtime/offline install, upgrade matrix or broad Mermaid regression.

Raw artifact `14146471802`: 56,408 bytes, SHA-256 `3b136e0e70ebc53645387aaf16f9c089989d64b0d227d14b649da86bb8f41a74`, Actions expiry `2026-11-22T04:11:47Z`. Original ZIP retained unchanged at `/workspace/milkup-visible-native-43675503357/artifact.zip`; expanded evidence and derived `independent-review.json` are separate. Original stderr SHA-256 `f148b9218510ec299e73dd867fa53a8c582430778b5081746b32284d67eb40ca`; ZIP CRC, source hashes, actual PNG hashes, exact process ledger and release were independently rechecked offline.

Remaining work is a narrowly scoped catalog-refresh product fix with its own regression, and a valid offscreen warm comparison. There is no evidence yet to claim the platform startup tail fixed or a no-flash guarantee.

Persistent copy: Library file `libfile_fde3_f-e6a1ec3645408191a1bae4bef22fafc3_0ca5afc9150881919eb83108db749c2b`, `/milkup-visible-evidence-43675503357.zip`, version 0, 61,376 bytes, SHA-256 `488a9aa6875fbe5699d103e70ac16f21e8481aec3c49dd21d4145b16cdfc593e`. It contains the untouched original ZIP, run/job metadata, offline review, report and local test logs; the self-referential retention paragraph is only in this repository version. Save succeeded and local Library identity metadata was applied. Workspace files alone are temporary.

Product/build-input diff against `383c0712f21071467f2549d73a022b03db4b69aa` is empty for `apps`, `packages`, `plugins`, `vendor` and `release/update-channel.json`. The post-run stricter observation amendment is `91daee2bdff2e92b9d6478392dcd623e14c25b22`, local-only validated; it is not the Windows-tested harness.
