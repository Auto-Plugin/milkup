# P7 outline matched native comparison — candidate02

All four final matched baseline runs and corresponding candidate performance/scroll runs completed functionally. Keyboard and active indexing lifecycle also passed on candidate02. Performance acceptance is **not complete**: long-document navigation, dense collapse and scroll bursts retain budget misses. Original failures and earlier metadata-only samples remain unchanged.

## Exact scope

- Baseline ELF `f15c476a4f6e7b5f254e325692d57e9bfaa798580441dd3554f6c4fe1e9d802e`, independent outline 1.3.1 archive `7eea6ffb5bba53155b3c256c6e35d95b04a93199ebbbd04636ee9c7ec5f6f712`.
- Candidate02 ELF `8deacbf470f699ad9b0a6c2c2937adbfc7ef6194c38e8f61e707a70bdfc5f9b2`, independent outline 1.3.2 archive `c4f1bc3b3333fc8ae8919487cd2c20e59b622af98c97ce26e14ff9fdaf3b0f0f`.
- All matched timing runs use harness `e2bfe3679b86cf2035119c5cd1447b4440cf3b731000dccaa4e831f90e4edabf`, fresh profiles, serial CPU/GUI slot, DISPLAY :127. No concurrent builds/browser/tests. This is candidate02 evidence, not later candidate03 evidence.
- Every successful run retains identical original/final source SHA. Fixtures contain 8 / 8,775 / 18,000 headings, without truncation. Fold/index completion requires expected total, valid range, actual row count, correct fold states, unchanged row identity across at least three distinct animation-frame observations.
- Index starts after opened source becomes visible; picker latency excluded. File opening initially uses Live. Fold/navigation/scroll timing runs explicitly switch to Source afterward. First and repeated indices share each fresh profile; repeated runs are warm rebuilds, not OS cold-cache claims.
- Native WebKit GTK measurements are trusted input-to-DOM plus frame proxies, not physical display latency, system DPI, screen-reader or cross-platform validation.

## Matched p95 (20 samples each, milliseconds)

| Fixture            | Group                | Baseline p95 | Candidate p95 | Budget | Candidate result     |
| ------------------ | -------------------- | -----------: | ------------: | -----: | -------------------- |
| ordinary           | collapse             |           49 |            60 |    250 | PASS (20/20 ≤200 ms) |
| ordinary           | expand               |           52 |            69 |    250 | PASS (20/20 ≤200 ms) |
| ordinary           | editor-cursor-follow |          307 |            93 |    200 | PASS (20/20 ≤200 ms) |
| ordinary           | outline-click        |           65 |            64 |    200 | PASS (20/20 ≤200 ms) |
| large              | collapse             |           74 |            73 |    250 | PASS (20/20 ≤200 ms) |
| large              | expand               |          117 |           106 |    250 | PASS (20/20 ≤200 ms) |
| large              | editor-cursor-follow |          419 |           233 |    200 | FAIL (17/20 ≤200 ms) |
| large              | outline-click        |          648 |           387 |    200 | FAIL (9/20 ≤200 ms)  |
| dense              | collapse             |          282 |           298 |    250 | FAIL (11/20 ≤200 ms) |
| dense              | expand               |          131 |           205 |    250 | PASS (18/20 ≤200 ms) |
| dense              | editor-cursor-follow |          354 |           221 |    200 | FAIL (18/20 ≤200 ms) |
| dense              | outline-click        |          150 |           162 |    200 | PASS (19/20 ≤200 ms) |
| dense              | wheel-burst-10       |          600 |           619 |    200 | FAIL (12/20 ≤200 ms) |
| dense-scroll-fresh | wheel-burst-10       |          889 |           680 |    200 | FAIL (15/20 ≤200 ms) |

The editor-cursor-follow group measures Ctrl+Home/End followed by outline aria-current synchronization. It is separate from actual outline-click (public heading command plus editor cursor movement). Dense collapse did not improve in native p95 despite reduced offline read transaction counts; do not claim the offline change resolves native folding latency. A passing p95 can still contain outliers (dense actual click: one 485 ms sample).

Wheel-burst-10 measures first trusted wheel event through a 10-notch XTest burst, driver completion acknowledgement, covered visible virtual range and subsequent frames. It is not single-notch latency or proof smooth scrolling has completely settled. Cached-range scroll legitimately keeps its revision; all final runs observed real scroll movement and later cross-slice range changes. No pixel-animation or isolated renderer-time claim.

## Full index and first rows (three samples; min / median / max, ms)

| Fixture  | Baseline full index | Candidate full index | Baseline first rows | Candidate first rows |
| -------- | ------------------: | -------------------: | ------------------: | -------------------: |
| ordinary |     139 / 142 / 144 |      105 / 150 / 186 |       93 / 95 / 107 |        40 / 90 / 117 |
| large    | 7260 / 7409 / 15834 | 9168 / 10060 / 10776 |     178 / 234 / 446 |      190 / 221 / 230 |
| dense    | 8185 / 8231 / 14214 |  9685 / 9724 / 14151 |     194 / 216 / 378 |      179 / 196 / 475 |

All first-row samples are below the 1,000 ms initial-visible budget. Full indices remain multi-second for large/dense documents; three samples do not support p95. No general full-index acceleration is established. Scroll-only fresh runs have one index each (baseline 10,277 ms, candidate 9,903 ms); middle collapse/jump/expand are also single observations, retained in JSON without p95.

## Keyboard and indexing lifecycle

- `p7-candidate-outline-keyboard-02`: real Shift+F6 then three Tabs reaches the first navigation item. End focuses rank 17,999 (127 ms); Home focuses rank 0 (133 ms); repeated Down crosses the initial 160-row slice and focuses global rank 160. Completion PNG shows the focus ring on Dense 160. These are single functional observations, not p95. Dirty remains false and source SHA unchanged.
- Preserved baseline `p7-outline-baseline-keyboard-02` is the actual RED: End shows the final slice but loses focus to Expand All. The earlier keyboard01 setup dirtied in-memory content via Tabs and is not valid End evidence.
- `p7-candidate-outline-lifecycle-04`: first rows while incomplete, Source mode confirmed, before-input scan at 6,656 / 40,001 lines (439 headings); trusted insertion advances version 0 to 3/4. Completed current index contains all 8,775 headings and exact first title `P7_LIFECYCLE_Large start`. Undo/save reaches version/savedVersion 5, dirty false, original source SHA.
- A second incomplete scan is interrupted by real File Open of the empty document. Read-only observer records switched=true and completedBeforeSwitch=false. Empty outline receives no old rows during the explicit 2-second observation. Reopen completes all 8,775 headings (single 9,571 ms observation); final file SHA matches. This proves document-switch cancellation, not an explicit Cancel scan button or helper-process cleanup.
- Lifecycle04 uses lifecycle-only harness `bda2138936812a488672c10719f264ede5d0148cb43ebaa13ae9941d0fb9979b`; measured performance/keyboard/scroll sections were not changed. Format and syntax checks passed.

## Preserved failures and limitations

- Lifecycle02 failed before editing: immediate probe cursor 0, subsequent failure observation cursor 2, Live mode, version 0/dirty false. Per-key event timing was not captured; neither lost navigation nor a Source race is established. Sequential readiness in the retry does not prove rapid-navigation ordering fixed.
- Lifecycle03 failed before editing: mode switch issued while the product reported document opening; final mode remained Live. Lifecycle04 waits actual incomplete outline rows before switching Source. Both failed runs retain completion, observations, screenshot and exact script snapshot.
- Earlier ordinary/large/dense metadata-only fold samples remain historical proxies, not strict DOM convergence measurements. Dense old collapse1 had total20/end160, proving premature completion. Remaining old samples had no actual DOM row counts, so they cannot be promoted to strong-render timings. Final matched03/02 runs above supply the new evidence.
- Original scroll01 used an unreachable new-revision requirement while scrolling inside a cached range; retained as incomplete harness evidence, not product failure.
- Every owned driver was stopped using its recorded PID/birth; see matched-native-cleanup.json. This is driver non-execution evidence, not unsampled per-plugin helper retirement proof. Xvfb127 was left for the next authorized task.
- No Windows/macOS, physical screen/DPI, screen reader, off-slice Left/Right parent navigation, or candidate03 performance claim. No product source changed during this native slot.

Raw runs: `../native-ui/runs/`; full values/provenance: `matched-native-comparison.json`. No prior raw file was overwritten.
