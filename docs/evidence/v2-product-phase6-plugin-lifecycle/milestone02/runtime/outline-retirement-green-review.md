# Native Outline retirement GREEN review

2026-10-19, independent read-only review of existing production04 artifacts. No UI/browser/native process or build launched, and no product or old evidence edited.

**PASS for the public Outline ordinary source-mode lifecycle represented by this fixture:** mounted panel → disable → edit/undo/save → re-enable → remove → edit/undo/save. This is the specific native recheck of the previous retirement failure, not full P6 acceptance or windowed-document coverage.

## Provenance and comparison

- Production04 ELF recorded by `plan.json`: `892089be0177d44e178bde43bd58711abfeed134c4e03ef6043631a22765e9d8`.
- `production04/compared-with-production03.json` lists only `desktop-plugin-manager.ts` and `desktop-plugin-manager-catalog.test.ts` as changed product inputs relative to production03 `be389f84…`. This matches the manager lifecycle correction; runtime/Worker code was not altered for this defect.
- Public Outline archive 1.3.1 SHA: `7eea6ffb5bba53155b3c256c6e35d95b04a93199ebbbd04636ee9c7ec5f6f712`; permission `document:read`, Worker host. Footnotes 1.0.1 remains independently enabled.
- `native-ui/control/p6-m02-outline-02-command.json` records exit 0 at 09:25:37.158658 UTC. `completion.json` has `automatedChecksPassed:true`; its historical `visualReview:pending` is left unchanged. This separate review supplies the actual visual inspection.
- Prior run `p6-m02-outline-01` remains FAILED: stop waited unsuccessfully, registry state became failed, and original screenshot visibly showed the red cleanup error. The manager RED test subsequently serialized the actual nested error `Renderer is not available: outline-panel`; see the earlier [retirement audit](outline-retirement-audit.md).

## Pixels actually reviewed

The new directory contains exactly two PNG screenshots, both opened using `view_image`:

1. [outline-live.png](../native-ui/runs/p6-m02-outline-02/outline-live.png): left sidebar visibly contains Outline, full-index-completed status (one heading, 12 lines), expand/collapse controls, and the selected Chinese heading `P5M6 单图 R1`. The adjacent source body, code fence, labels and end marker are legible. The editor is saved. No failure banner, clipping or obstructing overlay is visible.
2. [outline-removed.png](../native-ui/runs/p6-m02-outline-02/outline-removed.png): the Outline sidebar and its controls are absent; the original source body is visible in the wider editor, including its Chinese text, emoji, fenced Mermaid source and end marker. The saved indicator and 178-character count remain visible; no cleanup failure panel is shown.

There is **no separate disabled-edit screenshot** and no separate re-enabled screenshot in this run. Those intermediate states are established by structured observations and frozen harness assertions, not claimed as independently pictured. The Mermaid source is expected in source mode; this is neither a rich diagram-rendering test nor diagram export proof.

## State and exact-data checks

| Recorded event | Outline registry/catalog | Document result |
| --- | --- | --- |
| outline-live | enabled; no errors | source mode, nativeWindowed false |
| outline-disabled-edit-undo-save (09:25:31.458) | disabled, enabled false, empty errors/diagnostics, pending/startAttempt null; installed files unchanged | version = savedVersion = 2, dirty false, saved |
| outline-reenabled (09:25:33.965) | enabled, empty errors/diagnostics, pending/startAttempt null | version 2 preserved; harness waits for indexed panel |
| outline-removed-edit-undo-save (09:25:36.193) | no runtime registry record; native catalog tombstone true, enabled false, empty diagnostics, pending/startAttempt null | version = savedVersion = 4, dirty false, saved |

The frozen `harness.mjs.txt` confirms each `savedOriginalEdit` is an actual keyboard insertion of `X`, wait for dirty/cursor 1, undo, save, then exact original SHA verification. It does not test redo here. Disable asserts package files identical; removal asserts old installed generation path is absent. `outline-lifecycle.json` records `passed:true`, `finalRecord:null`, and the preserved source SHA. Independent hashing of both failure01 and success02 source files yields the same `4a5112399a0afcf9b634076263034d79cf1248d3388d3585cd0551a65bb16b41` (231 bytes / 178 UTF-16 units).

The shared observations `panel` field is empty even during `outline-live`; it is not used as evidence that the Outline was absent. The Outline-specific selector assertions plus the actual original screenshot establish presence/removal.

## Boundaries

This review confirms the ordinary public Outline source-path retirement regression is fixed in the recorded production04 run. The fixture is not native-windowed, does not establish all management matrix cases, and makes no separate OS-process proof for a JavaScript Worker. Physical printing, PDF fidelity, general malicious-code sandboxing, and the separate PDF Unicode/link/long-block limits are not covered or changed. No additional native diagnostics are needed for this narrow conclusion.

## Reviewed hashes

| Artifact (relative to milestone02) | SHA-256 |
| --- | --- |
| `native-ui/runs/p6-m02-outline-02/plan.json` | `da861ff8af01d94ba5305ba71aace2839c40b8546bd09ce5af64f772027b5866` |
| `native-ui/runs/p6-m02-outline-02/completion.json` | `a9c64ac418d4eb254e83474e1daca0a51d1a29421c05cee69dd082992d5eafb9` |
| `native-ui/runs/p6-m02-outline-02/observations.json` | `0e606572bf5111c6bf01320e18cfda6680cbfc1f65fb25a84b63d092a1a12aa0` |
| `native-ui/runs/p6-m02-outline-02/harness.mjs.txt` | `7623a5888b8110637d150d40b954de83efc6cc51497871c0ed7e56d3798c9da6` |
| `native-ui/runs/p6-m02-outline-02/outline-lifecycle.json` | `dae0c7a43592a5953b571c5fbc811adb980fb35c0b93188b0f79618bb2b0128d` |
| `native-ui/runs/p6-m02-outline-02/outline-live.png` | `def0812ca4a5893b3583c89b10a9ee04437a9a23494c6dc58c085c79051dd6fb` |
| `native-ui/runs/p6-m02-outline-02/outline-removed.png` | `7a50985760dc809846ce5e6652381eaa5ea2ad0c659b8624126b756e95a69590` |
| `native-ui/runs/p6-m02-outline-02/source.md` | `4a5112399a0afcf9b634076263034d79cf1248d3388d3585cd0551a65bb16b41` |
| `production04/compared-with-production03.json` | `bbccd9d0e804a113bf510fe6f875438c4f5c16ef77166f7f65caa749141a5c0a` |
| `native-ui/control/p6-m02-outline-02-command.json` | `7ab986c9a587b1661113137e0ca732cbf90b227922b2062aafda42b6ab3c90b6` |
| `native-ui/runs/p6-m02-outline-01/failure.png` | `ac3c874330bf3fc9e0e38d7f7d23899b6ad7af33d0a459ef7fc42c251a4260ba` |
| `native-ui/runs/p6-m02-outline-01/failure.json` | `8edebaaf2a077db5162013f394caa274f95287660b31d5bf45217bc5999ce297` |
