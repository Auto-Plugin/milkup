# Explicit plugin render-mode entry: original-package Windows result

Run [43678889464](https://github.com/Auto-Plugin/milkup/actions/runs/43678889464) passed its **measurement and lifecycle** contract. It reproduced source exposure in explicit Mermaid render mode, including after successful offscreen preparation. This is not a source-flash fix or a performance threshold pass.

## Integration and immutable input

- Product fix `3c658aa49f39263c7a0fdb9867b5d20a1b251194` was cherry-picked with provenance as **0e6ed9d332be1f83d0e7c27272c109dd14338de7** on `dot/release-quality-integration-20261112`. Its working tree was clean and the five affected files matched the original parent before applying. No conflict or other editor's changes were overwritten.
- Only the product implementation and its regression tests were integrated. Experimental workflows, observation scripts and one-off evidence remain on `dot/mermaid-visible-latency-20261115`.
- Integration's 206 targeted desktop tests, desktop TypeScript and diff checks passed. The five changed files are byte-equivalent to the product commit. Product trees `apps`, `packages`, `plugins`, `vendor` and `release/update-channel.json` match the already built **42277c9a7d9eecaf056296ef7497a300ba6ba541** candidate. Integration itself was not rebuilt; the tested package continues to be identified by its actual build SHA.
- This run used harness **89daa0911ef8f5594ca48e6199c0d504fbe35c3a**, package from run **43676925544**, original artifact **14147610326**, artifact SHA-256 `47edded6271e418f53c9669511774cf8d00edaee08c782397d799bfa11b612cb`.
- Installer `milkup-2.0.0-beta.10-windows-standard-42277c9a7d9e.exe`, 7,256,086 bytes, SHA-256 `7e37d954b1ba47bd4775ca45d24b0f6fd08cf4f3fa711a2eb0902c0212f72b48`. Installed executable SHA-256 `db0dcc79daa32f9626ebbb1e1288cad0fe7a4e3704c9c591419e05f76ce73b98` matches the previous run. No rebuild or Runtime provisioning.

## Prerequisites and scope

Exactly one manual run was dispatched after checking no equivalent active run. Job `132704982444` used the existing sandboxed Windows Edge to pass the real layout fixture before installing the application. The fixture verified clipping, visible source, old-document exclusion and pre-armed offscreen→new decode→real wheel entry. The local Linux Chromium sandbox failure was not bypassed.

The app ran under a verified ordinary account, PID 6640, creation FILETIME `134391922885974558`, creation UTC `2026-11-15T04:58:08.5974558Z`; existing Edge/WebView2/driver `156.0.4314.58`. The native picker retained PID+birth/image checks.

The harness waited only for the catalog prerequisite. It did **not** repeat no-input initialization, 40-cursor-move testing or a process-to-first-image latency measurement. It opened the real Diagrams details UI and chose `preview` with pointer/keyboard input. Both select value and persisted plugin preference became `preview`; the editor's existing global mode stayed `live`. Each entry recorded the same explicit plugin preference. No storage injection, global mode control or product mutation hook was used.

Local pre-run checks passed: 30 Node receipt/observation/frontend tests, PowerShell syntax including workflow blocks, five native-result rejection fixtures and five failure-finalization cases. These remain distinct from native evidence.

## Exact entry evidence

All times below are Unix milliseconds, aligned from the document's performance time origin `1794718691819.3`; alignment is millisecond-resolution, not a hardware paint clock. Both sources had zero admitted requests at arm. The observer ignored the previous document until the exact target path and loading state matched.

| Event | Cold source | Independent prefetched source |
| --- | ---: | ---: |
| Observer armed before opening | 1794718695427.0 | 1794718698743.3 |
| First target offscreen sample | 1794718698517.1 | 1794718700668.6 |
| Actual renderer start | 1794718698632 | 1794718700675 |
| Successful source preparation | 1794718698659 | 1794718700705 |
| Real target-entry input | 1794718698584 | 1794718700786 |
| First visible source sample | 1794718698608.7 | 1794718700827.7 |
| First layout-visible decoded image | 1794718698671.3 | 1794718700857.7 |
| Source-visible samples | **4** | **2** |
| Visible-source-to-decoded interval | **62.6ms** | **30.0ms** |
| Maximum sampling gap | 17.4ms | 19.9ms |

Cold source `0db1b6651674fc7a29b2dee19bb6d927a3ec5badd0b38f0307dbc8874e7e7f84`, request `6e366980061a40eeab20d7090677ed73`, actual renderer interval 27ms. Warm source `3cc82ca734d1dfa46cb65b9f232b1b50916dea466b704c6971395fd07a1a24e5`, request `be7d108b8f984e2ea70b85beddf2c145`, actual renderer interval 30ms. Both resulting PNGs were independently hashed and matched the exact process-generation ledger.

The warm file completed preparation before the native-picker acknowledgement, but this time the observer was already attached: first target offscreen sample precedes actual renderer start, preparation finishes before real entry input, and the first visible sample follows that input. It is therefore a valid offscreen-preparation comparison, not a left-censored ready image. There was exactly one actual request for that source. Across warm entry, service `renders` remained 4 while `cacheHits` rose 0→1, with one cache entry retained. **The two source frames were not caused by a second Mermaid execution.**

This supports a pending presentation/mount/decode problem even when PNG data is cached. It does not separately time the scroll quiet timer, context read, DOM insertion and browser decode, or prove which one accounts for every frame. More prefetch alone cannot guarantee no source exposure for this observed cached case. A narrowly authenticated render-mode pending presentation remains a product change to implement and test; mixed/source editing behavior must remain intact. No global hiding or wider speculative budget was introduced.

## Close, preservation and limits

Normal application UI close exited 0. stdout/stderr EOF true, overflow false, no forced product termination. Offline replay independently verified 56 complete frontend records, four requests and one released owner with zero pending work. The additional initial-document render is permitted by the explicit policy change; this run was not an initialization duplication comparison. Native renderer dispatch remained forbidden. Frame removal still does not establish hard termination of synchronous hostile code.

Owned uninstall exited 0, application removal and document preservation were confirmed. All three fixture document hashes remained unchanged. Temporary account/profile/staging cleanup passed independently and was not substituted for product close or uninstall.

This is one ordinary-account render-policy observation with an existing Runtime, not a dual-account matrix, upgrade, high-DPI/multi-monitor test, offline/missing-Runtime deployment, overall beta acceptance, no-flash proof or long-tail latency result. Cold and warm source flashes remain open product issues. The previous rejected warm comparison in `43676925544` remains failed and preserved.

Original evidence artifact **14147069034**, 48,778 bytes, SHA-256 `33a034ca6837e8128fd844c482b842a17bc3391702a04769cca777f54f7246a5`, expires `2026-11-22T04:58:28Z`. ZIP digest/CRC and bounded expansion were verified. Unmodified artifact, expanded evidence, run/jobs metadata, workflow log and derived offline review are at `/workspace/milkup-visible-native-43678889464`. The original tested installer remains privately retained in Library bundle `libfile_fde3_f-ba42aaf02638819185fa94e8d9a54620_0ca5afc9150881919eb83108db749c2b`.

No main merge, Release, production configuration, personal notification or security changes. No further run was dispatched after this result.

Persistent private evidence: Library `libfile_fde3_f-b1cc562e37bc8191bb4de712b7ad0f12_0ca5afc9150881919eb83108db749c2b`, `/milkup-render-entry-evidence-43678889464.zip`, version 0, 63,027 bytes, SHA-256 `89af37fb7e19f09495426dfd1b76f85000af2d3a432c1c78d0ef4139eaf59474`. Save succeeded and local Library metadata was applied. This includes the original artifact ZIP, metadata/logs, independent review and report before this retention paragraph; workspace copies are temporary.
