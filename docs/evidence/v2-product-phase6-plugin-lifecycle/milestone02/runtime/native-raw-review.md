# Independent native raw-capability review — P6 milestone 02

Reviewed existing artifacts only on 2026-10-19. No UI, browser, native process, build, or product edit was launched. Four original screenshots were opened with `view_image`; no regenerated or edited screenshots are used. This is a new review document; the earlier frozen runtime source/evidence indexes remain unchanged.

**Result: PASS for this specific raw-capability / dynamic-import rejection / Unicode-history case.** `p6-catalog-raw-02/completion.json` reports `passed: true`; the trusted launcher record `native-ui/control/p6-catalog-raw-02-command.json` records exit 0 at 09:12:23.233429 UTC. Production03 SHA-256 is `be389f84f182bc8e33280fc6c1d4dd6db3b54267e3ca0c399c38041f7e1f4346`, consistently recorded by preflight and the launch environment. This review checks the recorded binary identity, not an additional binary execution.

## Before/after and visible states

| Observation | Production01 / raw-01 | Production03 / raw-02 |
| --- | --- | --- |
| Initial base | 1.0.0 enabled | 1.0.0 enabled |
| Raw fixture upgrade | Failed; active 1.0.0 retained but `enabled:false` | Active 1.1.0 enabled; previous 1.0.0 retained; no pending transaction or runtime errors |
| Cleanup result | `Activation failed: Isolation cleanup incomplete; manual recovery required`; manager also records `Runtime cleanup failed` | This error does not recur in recorded events; upgrade completes and subsequent abort restores the existing 1.1.0 |
| Dynamic import candidate 1.2.0 | Not reached | Rejected: `Plugin Worker must be a single closed bundle without module imports`; active 1.1.0 remains enabled |
| Editor history/save | Not reached in failed stage | Save → undo/save → redo/save → undo/save exact-byte assertions complete; final original source restored |

Actual pixel review:

- [Old failure screenshot](../native-ui/runs/p6-catalog-raw-01/launch-1/failure-observation.png): 1.0.0, red failed badge, visible red cleanup/manual-recovery error panel, and Enable button. This is a real failure, retained as such.
- [New raw-fixture screenshot](../native-ui/runs/p6-catalog-raw-02/launch-1/raw-apis-blocked-in-worker.png): 1.1.0, green Enabled badge, Disable button, no red cleanup error panel. Plugin name, version and controls are readable and not obscured.
- [New rejected-dynamic screenshot](../native-ui/runs/p6-catalog-raw-02/launch-1/dynamic-import-rejected.png): the same enabled 1.1.0 and Disable button remain visible. The catalog diagnostics disclosure is collapsed in the screenshot, so the exact rejection message is established by recorded manager text/events rather than claimed visually readable there.
- [New Unicode-history screenshot](../native-ui/runs/p6-catalog-raw-02/launch-1/unicode-history-save.png): source editor shows the original Chinese/emoji/combining-accent/astral-character text and task line, with Saved state and 53 characters. No failed-plugin overlay or blank editor is visible. Pixel review establishes visible content; exact code-point preservation is established by byte checks below.

The dynamic-rejection event at 09:12:20.833 has a transient non-null `startAttempt`; the final Unicode-history event at 09:12:22.882 clears it, with revision 12, `pending:null`, `enabled:true`, active 1.1.0 and previous 1.0.0. The final catalog retains the expected historical `Candidate aborted; old installation retained` diagnostic; the mirror runtime errors array is empty. It would be inaccurate to describe this run as having no diagnostics at all.

## What the 14 probes establish

The actual saved `raw.milkup-plugin` is a JSON plugin archive containing an ordinary public `activate()` implementation. It sequentially awaits 14 probes, catches their rejection, and throws `P6_RAW_CAPABILITY_ESCAPED` if any resolves. Activation returns only after all 14 reject. Observed committed 1.1.0 therefore establishes completion of these fixture checks, not merely a screenshot label:

1. indirect eval
2. global Function constructor
3. intrinsic Function constructor reached through a function prototype (CSP route)
4. importScripts
5. Worker construction
6. raw fetch
7. prototype fetch lookup/call
8. replacing the immutable fetch guard
9. WebSocket construction
10. XMLHttpRequest construction
11. indexedDB access
12. caches access
13. navigator.storage access
14. BroadcastChannel construction

The fixture records completion rather than individual exception identities; rejection includes unavailable-native-entry-point outcomes. It does not prove every rejection came from a particular wrapper. The dynamic candidate separately contains a real `import('data:text/javascript,...')` and is rejected by closed-bundle validation before publication. `production-origin.json` records `tauri://localhost`, built asset scripts, and no development probe. Its `csp:null` observation is not affirmative CSP-header evidence; the intrinsic constructor rejection is the relevant behavioral observation. No complete malicious-code sandbox, exhaustive browser API coverage, or network packet-capture claim is made.

## Unicode and provenance

The frozen harness copy used by this run checks exact SHA equality after each native clipboard edit/save, undo/save, redo/save, and final undo/save; all must finish before completion is written. The added text includes Chinese, 😀, 𠮷 and decomposed `e\u0301`. The final file independently hashes to the original declared SHA `1704d1855305b320d9d8f316d69a90a9c734ac8a242faf6e39ab575f87687bd6`. Its bytes retain `e` + U+0301 and U+20BB7 without normalization. The final document event records version/savedVersion 4, dirty false and notice Saved. This covers editor history/save, not PDF text extraction or glyph fidelity.

This comparison supports the observed retirement-race correction; it does not prove arbitrary cleanup failure recovery, all late callbacks, or full catalog acceptance. Dedicated tests and other native stages provide those separate claims. Known PDF Unicode/link/pagination limits are unrelated and remain open.

## Reviewed input hashes

| Input (relative to milestone02) | SHA-256 |
| --- | --- |
| `native-ui/runs/p6-catalog-raw-01/events.json` | `57fe7fd960c8bb8633c568d8f2a58309433e5bcaa4cbfb276175c9a0282b4931` |
| `native-ui/runs/p6-catalog-raw-01/completion.json` | `4130959514c38bb1f906aa6b1bb87a80c9a47d9d50980c5b36094f13738ce190` |
| `native-ui/runs/p6-catalog-raw-01/launch-1/failure-observation.png` | `1ed0a580298c40335e447a61b1e8cd93f7e363b9e9faac2fdf9d4e6038f5373b` |
| `native-ui/runs/p6-catalog-raw-02/events.json` | `8d0c9c2d1c868bfce3adf0eb4104822648cf7a8a0155772cc7d47578c7e4b33f` |
| `native-ui/runs/p6-catalog-raw-02/completion.json` | `fd733ad3e315ba520722db9bfbe76aa4e1f01b18e14b3ee05276d2b1a702aaa9` |
| `native-ui/runs/p6-catalog-raw-02/preflight.json` | `2c4690a10298c2a11779ffa2168d6ed0632c5bc2ecf0271f531569c7585b6a89` |
| `native-ui/runs/p6-catalog-raw-02/raw.milkup-plugin` | `c078568571a3111462fc257c1d6778d6b736cda12ca7879ca418318bcd28454b` |
| `native-ui/runs/p6-catalog-raw-02/dynamic.milkup-plugin` | `0477c15d812811ea2cdc8c8f221115f451f795ed48f0d9739ccdd27aa9dd99b4` |
| `native-ui/runs/p6-catalog-raw-02/source.md` | `1704d1855305b320d9d8f316d69a90a9c734ac8a242faf6e39ab575f87687bd6` |
| `native-ui/runs/p6-catalog-raw-02/launch-1/raw-apis-blocked-in-worker.png` | `9b8a465c08fa2e6e5027587bac16a365af4795c3ef77b69c95d7d9c0c9fc553a` |
| `native-ui/runs/p6-catalog-raw-02/launch-1/dynamic-import-rejected.png` | `da4b4d3d026567e48adbc2b13ef09c790fb0cf05d06d7e6bfa2d230ab0fdbd13` |
| `native-ui/runs/p6-catalog-raw-02/launch-1/unicode-history-save.png` | `9a16f2cbd647666fc591018eb163846cbdbf5e80ab29d5f8d3ba2095c62e50a0` |
| `native-ui/control/p6-catalog-raw-02-command.json` | `9b945920a01284b60e81d4813032460d96ed6fb66be3d2cced799db5d04e9d0e` |
| `native-ui/control/p6-catalog-raw-02-inputs/tauri-p6-catalog.mjs.txt` | `e20a7c12a330cd3b597c8920658ca8f1d1351eb303c8436466dea91cadc8bbd6` |
