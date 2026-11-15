# Trusted Mermaid render-mode loading: exact Windows candidate

Run [43680250007](https://github.com/Auto-Plugin/milkup/actions/runs/43680250007) passed the targeted native contract on candidate **8e0ce998f71b2360829368e85506dd45b2f2c3a1**. Independent replay of the original reports and complete frontend ledger also passed. Explicit Mermaid render mode now presented loading instead of sampled source in both tested cold and warm entries. This is a presentation handoff result, not a cold-start latency or physical no-flash claim.

## Product scope and local checks

Product commit **bb1e5084d2099a202d40165013b08679d994ee24** is separate from QA commit **8e0ce998**. The existing initialization-refresh fix remains included. After native verification, the seven product/test files were cherry-picked with provenance onto the clean `dot/release-quality-integration-20261112` branch as **8f7fefdfcdf88f0179721c98215b1e0c9afe8452**, from `0e6ed9d3`. No experimental QA or workflow changes were integrated; main was untouched. Both commits use LarryZhu-dev <larryzhu@foxmail.com> as author and committer.

Only an active host-authenticated Mermaid renderer, explicit plugin `preview` policy, and locally parsed complete Mermaid fence can receive pending presentation. No plugin HTML is accepted. Hidden source nodes remain intact in a `display:contents` wrapper; an accessible status label is positioned without changing line height. Matching mounted images take priority. Source/mixed modes, untrusted providers, non-Mermaid or incomplete fences do not enable this behavior. Existing input, preparation, image-decode, ownership, permission and resource limits remain.

Pending nodes are restored on renderer rejection, decode failure/timeout, disable, source/theme/config invalidation and destruction. Virtual line replacement cannot resurrect stale nodes. Late decode cannot revive a disabled or closed generation. This is a host view state, not more prefetch, a document-wide mode or a new renderer.

Local results: **1,036 view-dom tests**, **207 targeted desktop tests**, **30 Node observation/frontend contracts**, desktop and view-dom TypeScript, formatting/diff checks, PowerShell wiring (positive and five negative native-result cases) and five failure-finalization cases passed. The new source-edit regression initially used an invalid test transaction shape; it was corrected to a real `ChangeSet`, then the whole view-dom suite passed. No product failure was suppressed.

Windows reran 207 desktop and 49 image/pending tests, the Node contracts, and both real-layout browser fixtures before packaging. Existing sandboxed Edge **156.0.4314.58** ran the actual production pending class. A wrapped 48px-high, 300px-wide source line retained scrollHeight 728 and scrollTop 170 through pending and restoration. The fixture confirmed original-node restoration, source exposure after controlled failure, and distinct loading versus decoded-image observation. This controlled layout fixture is not a full installed-app error-flow acceptance; native malformed-Mermaid error recovery was not separately rerun here.

## Immutable package and ordinary-account execution

Exactly one new manual run was dispatched after checking for equivalent active runs. No original-package matrix, Linux build, upgrade matrix, ETW or repeated initialization/cursor experiment was dispatched.

- Installer: `milkup-2.0.0-beta.10-windows-standard-8e0ce998f71b.exe`
- Size: **7,258,784 bytes**
- Installer SHA-256: `9a9993bc12fd6b2d887da103d3c86b1b9c49428b4ed30eef7a99fc7544113997`
- Installed executable SHA-256: `7f3dd66cbf08e869692b0f2f810c6e3f226e3e3115248db77efd813665fbf1b7`
- Product PID 7304, birth FILETIME `134391939346308816`, creation UTC `2026-11-15T05:25:34.6308816Z`
- Existing WebView2/driver **156.0.4314.58**; verified ordinary account, no privilege/security-policy changes.

The immutable packaging receipt still says `built-not-installed`/`installedAcceptance:not-run`: that is its original build-time boundary. The separate installation, native observation and supervisor reports are the evidence for this run's targeted installation/entry/close/uninstall acceptance; the receipt was not rewritten to imply broader acceptance.

The harness selected Mermaid `preview` through the actual plugin details UI and pointer/keyboard input, verifying the stored plugin preference. The editor's existing global mode stayed `live` throughout. It armed the observer before opening each exact independent document. Prior-document content was ignored; both sources had zero admissions at arm. Cold and warm classification gates remained strict.

## Measured native handoff

Times below are Unix milliseconds aligned from the page performance clock. The alignment is millisecond-resolution, not a hardware paint clock.

| Event | Cold entry | Independent warm entry |
| --- | ---: | ---: |
| Observer armed | 1794720341429.1 | 1794720344454.8 |
| First target offscreen sample | 1794720344223.0 | 1794720346424.2 |
| Actual renderer start | 1794720344345 | 1794720346428 |
| Source preparation ready | 1794720344379 | 1794720346465 |
| Real target-entry input | 1794720344287 | 1794720346525 |
| First visible loading sample | 1794720344319.9 | 1794720346569.6 |
| First visible decoded image | 1794720344394.4 | 1794720346601.5 |
| Source-visible samples | **0** | **0** |
| Loading-visible samples | **5** | **1** |
| First visible loading → decoded image | **74.5ms** | **31.9ms** |
| Input → decoded image | **107.4ms** | **76.5ms** |
| Maximum sampling gap | **25.0ms** | **31.9ms** |

Cold request `c48b8e26b11244f8bf3f2b53b972676a`, source SHA `0db1b6651674fc7a29b2dee19bb6d927a3ec5badd0b38f0307dbc8874e7e7f84`, actual render interval 34ms. Warm request `439919f0670a41baa8c74403726a94eb`, source SHA `3cc82ca734d1dfa46cb65b9f232b1b50916dea466b704c6971395fd07a1a24e5`, interval 37ms. Both accepted PNG hashes match the exact process-generation ledger.

Warm order was independently observed: offscreen sample → actual render → ready → entry input → visible loading → decoded image. It was not left-censored. Across warm entry `renders` stayed **4→4**, while `cacheHits` rose **0→1**. This verifies the cached-data handoff as well as the newly rendered source.

The prior original-package run [43678889464](https://github.com/Auto-Plugin/milkup/actions/runs/43678889464) observed **4/2 source frames**, with **62.6/30.0ms** source-to-image intervals. The new run changed those sampled source frames to loading; it did **not** establish faster image delivery. These are separate single runs, not a latency distribution or controlled tail-latency improvement. `noFlashProven` deliberately remains **false**: rAF cannot establish physical paint, overlays or sub-frame absence, especially across the recorded sampling gaps.

## Close and remaining boundaries

Normal application UI close exited **0**, stdout and stderr EOF were true, overflow false, no forced product cleanup. Offline replay verified **56 frontend records, four requests and one fully released owner**, with no pending work. All three document hashes were preserved. Owned uninstall exited 0, application removal/document preservation and temporary account/profile/staging cleanup passed. Outer cleanup was not substituted for product cleanup.

This run did not repeat the settled 40-cursor input test or initialization causal comparison; their earlier evidence remains separately identified. Nor did it establish dual-account, high-DPI/multi-monitor, missing-Runtime/offline, upgrade, full malformed-document/native failure, long-document matrix, physical printing, whole-release acceptance or synchronous hostile-code hard termination. The standard package is unsigned, uses an existing Runtime here, and has no configured production update channel. No global UI/mode, sandbox, system/security, personal notification, production configuration, main merge or Release changed.

## Evidence retention

Both original ZIPs were checked against GitHub byte counts and SHA-256, CRC-tested and expanded under a bounded path-safe check. Internal installer bytes match the receipt and package manifest.

- Native evidence artifact **14148063265**, 42,411 bytes, SHA-256 `c7057df3c932dc629ade5000cd8b7b28791a882b8a3ff39d29782fbfaeade910`, expires `2026-11-22T05:25:53Z`.
- Original package artifact **14148675947**, 7,260,244 bytes, SHA-256 `3a531691365f27ba970245464d6136ced43af14f78ccd01dd1c84d4824387908`, expires `2026-11-22T05:25:54Z`.
- Workspace evidence: `/workspace/milkup-pending-native-43680250007`, including original archives, expanded artifacts, run/jobs metadata, workflow log, local test logs and independent review. Workspace retention is temporary.

Integration follow-up: before applying, the local and remote integration heads both matched `0e6ed9d3`, with no uncommitted edits and no difference from the product commit parent under `apps`, `packages`, `plugins`, `vendor` and the update-channel file. After applying, those complete product trees are byte-equivalent to the actual Windows build candidate `8e0ce998`; root build inputs and `scripts/release/build-candidate.mjs` also have no differences. Remaining branch differences are experimental CI/QA and reports. Integration's 49 pending/image tests, one fence test and both TypeScript checks passed. No rebuild was dispatched solely for integration. The tested installer remains identified by **8e0ce998**, not by the new integration commit.

Private persistent snapshot: Library **libfile_fde3_f-bf88663a508c8191990a29edbfd13964_0ca5afc9150881919eb83108db749c2b**, `/milkup-render-pending-evidence-package-43680250007.zip`, version 0, **7,335,822 bytes**, SHA-256 `f9b60dfc13b2632a8ed5d6d2af965e34a49d1ed24d5bd477cbb04131ae3aaada`. Save succeeded and local Library metadata was applied. This snapshot was saved before the integration follow-up; it contains the original tested package ZIP, textual/JSON raw evidence, run metadata, logs, independent review and report. Browser screenshots and the original screenshot-containing evidence ZIP remain in the temporary workspace and original CI artifact only; they were not saved to Library. No external distribution or Release.
