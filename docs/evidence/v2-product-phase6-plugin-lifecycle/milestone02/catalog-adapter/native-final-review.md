# Native catalog final evidence review

Independent evidence review, 2026-10-19. No product or harness code changed and no native process was launched by this review. The findings below come from archived run completions, preflights, events, frozen harness inputs, and independent reads/hashes of actual output and owned-profile files. Machine-readable checks are in [native-final-independent-checks.json](native-final-independent-checks.json).

## Completion and binary scope

Production05 completed all 11 catalog cases across 18 real application launches. Every completion is `passed: true`, and every preflight identifies binary SHA-256 `be74587470a3c7d1600fb55bce370652a8ec092424c1e9af8203c8c3302d7abd`. Paths below are relative to `../native-ui/runs/`; each contains `completion.json`, `preflight.json`, `events.json`, screenshots and launch origin evidence.

| Run directory                  | Launches | Observed result                                                                                                                                                 |
| ------------------------------ | -------: | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| p6-final-manager-rollback-01   |        1 | Throwing 1.0.1 candidate aborted; approved 1.0.0 generation restored, enabled and freshly pinged.                                                               |
| p6-final-manager-hang-01       |        1 | CPU-bound 1.0.2 candidate timed out; same old generation freshly activated and pinged.                                                                          |
| p6-final-late-command-01       |        1 | Delayed command visibly started before disable; stale notification absent after its delay.                                                                      |
| p6-final-legacy-migration-01   |        3 | Automatic startup migration imported one valid candidate; two invalid rows quarantined; explicit approval/activation succeeded; later startup did not reimport. |
| p6-final-catalog-cas-01        |        1 | Concurrent same-ID transitions with one expected revision produced one success and one revision conflict.                                                       |
| p6-final-trial-restart-01      |        2 | Persisted interrupted trial recovered with pending removed and retained old generation disabled.                                                                |
| p6-final-startup-restart-01    |        2 | Persisted incomplete startup recovered disabled, attempt cleared, automatic retry suppressed.                                                                   |
| p6-final-mirror-restart-01     |        2 | Corrupt localStorage mirror did not replace native generation/hash/approval authority; native activation restored.                                              |
| p6-final-catalog-corruption-01 |        2 | Corrupt primary catalog recovered backup with activation disabled and approval requiring explicit review.                                                       |
| p6-final-remove-failure-01     |        2 | Permission-induced cleanup failure persisted disabled tombstone, retained data through restart, and allowed cleanup retry.                                      |
| p6-final-raw-api-01            |        1 | Actual Worker rejected tested raw APIs; dynamic-import candidate rejected, prior verified 1.1.0 stayed enabled.                                                 |

Production06 is a separate binary: `c1ff46f3bffea3cea3a85b07c14ea5753faba4622e8ffaaa46d579401c42aded`. Its comparison record (`../production06/compared-with-production05.json`) limits changed product inputs to the manager and its catalog test, and records no post-acceptance source drift; root describes the change as readable error reporting. Both targeted repetitions independently have successful completion records: `p6-final06-manager-rollback-01` and `p6-final06-manager-hang-01`. This review does **not** claim all 11 were rerun on production06.

## Hang recovery proves a fresh activation

Frozen fixture code uses a real synchronous `for (;;) {}` inside candidate activation. It is a public archive with a closed Worker bundle and a newer version, not a never-resolving Promise injected into the host. The harness checks recovery takes at least 9 seconds and less than 30 seconds, encompassing the 10-second activation deadline plus dispatch and observation overhead.

Production05 recovery took 10,586.827940 ms. `candidate-recovery.json` records old and restored generation both `bcba0912b45fcb29ec2f445b4012d1bd2b3ab24b79f56ac848d89daa1ef1708b`, while public activation nonce changes from `7bf631f9fd61c0851066107ac1679149` to `55d5c9aed1733c342e31525723a4424e`. A successful new ping demonstrates a fresh activation of that retained generation. The private host epoch number is not exposed; nonce change is behavioral evidence, not direct numeric epoch inspection.

Production06 repeats this result in 10,676.031401 ms: generation `f6d656ff823caaa433a9a2e00fb535f9d8c358a25a9970692f787a179483ae61` remains identical, and nonce changes from `a4e6c4a9609ebca6a8247f321a755c66` to `c35e083119e3b24b17f779dc5bcd3210`. Throwing-candidate recovery also passes on both builds (468.941 ms and 439.432 ms respectively).

## Late command was running before disable

The archived final late-command harness waits for visible `P6_DELAYED_COMMAND_STARTED` before clicking the shipped disable control. The fixture awaits that first notification, waits two seconds, then attempts `P6_STALE_COMMAND_MUST_NOT_APPEAR`. After disable the harness observes native `enabled: false`, waits 2.5 seconds, and asserts the stale marker is absent from the page. The event `delayed-command-after-disable` retains the started marker and a disabled native entry. This rules out a false pass from disabling before the command starts. It covers delayed publication across owner disable; it does not establish reversal of completed external effects or cancellation of an already delivered native RPC.

## Migration used three launches and preserved exact raw bytes

The first launch initializes an isolated profile. Its native primary/backup catalogs are preserved and parked inside that owned profile to represent a pre-catalog installation. The harness writes synthetic historical localStorage plus legacy package/data directories: one valid record, one invalid manifest, and one invalid record. The second real startup executes automatic migration. The harness never invokes `plugin_catalog_migrate` to substitute for that startup path.

The valid row initially becomes an unapproved, unverified pending candidate with no active generation and disabled state, despite its historical enabled/approved claims. Invalid manifest/record rows remain absent and generate diagnostics. Shipped UI approval and activation then produce a working ping. Before a third startup the same historical raw mirror is reintroduced; the durable native receipt prevents another import or revival of invalid rows. The resulting single imported generation is `dbfd22620a02a9cbbf51ca49172bd6c13d829d3c733bc64d26760026bbe569a3`. Ping nonces differ across startup (`dbb666f9a57ae6b289b847193be51f8f` → `9c7ad986a84685c7a89e4ca6c2dca1a9`).

Independent byte hashes of `legacy-registry-original.json`, archived `native-legacy-raw-backup.json`, and the actual profile's `plugins/legacy-registry-<receipt>.json` all equal receipt `7c209c633e0706062ee62842b6c74209b30ccd5bfa34be7c158def597b54a4b7`. All six original legacy package files and all three data sentinels, including the invalid rows' data, independently match their recorded initial hashes. `legacy-migration-result.json` records exactly one generation directory and one raw backup, with both invalid IDs absent. This is a synthetic historical-input test on real startup, not a survey of arbitrary historical installations.

## Unicode and retained data

Every case finishes the native editor sequence edit/save → undo/save → redo/save → restore/save using Chinese, emoji, non-BMP and combining-mark text. Harness assertions check physical file bytes along that sequence. All 13 final physical `source.md` files (11 production05 plus two production06 repeats) were independently rehashed: each is `1704d1855305b320d9d8f316d69a90a9c734ac8a242faf6e39ab575f87687bd6`, matching the initial fixture. Final events record ready source mode, version/savedVersion 4, clean state and no save in progress.

For remove-failure, the persisted tombstone survives real restart, and the data sentinel remains exactly `P6 user data 中文 😀`. Independent post-run inspection also finds the generation directory empty after retry, with data/storage directories retained. The historical cleanup-failure diagnostic remains; a passing retry does not imply that history was erased. Permission fault injection was limited to the exclusive test profile and the harness restores the original mode.

## Trust boundaries and remaining coverage limits

These are Linux production WebKit runs at `tauri://localhost`, not Windows validation. Installation, candidate approval/activation, ping, delayed command and disable use shipped controls/public plugin fixtures. WebDriver runs in the trusted host document for catalog inspection and targeted existing IPC transitions: CAS, persisted interrupted-state preparation and cleanup retry are trusted-host probes. They do not show that ordinary plugin code can invoke those IPC commands, and add no production test hook.

Restart cases use actual process close/relaunch around deliberately persisted states; they do not simulate arbitrary power loss or every filesystem failure point. Raw-API tests execute inside the real isolated Worker and check the enumerated API/CSP failures, while dynamic import is rejected as a non-closed bundle. They are concrete regression coverage, not proof of a complete malicious-code sandbox. This catalog review does not extend support to unsupported host/package types or replace separate management UI, unit, Rust and platform acceptance evidence. Within the stated Linux scope, no blocking discrepancy was found between final completion claims and the independently inspected evidence.
