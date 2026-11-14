# Candidate03 → candidate04 final outline comparison

Four candidate04 runs passed functional assertions; dense collapse still misses the 250 ms p95 budget. No sample was discarded or repeated. All numbers below are milliseconds. n=3 indexes and single middle/keyboard observations have no p95. Full per-sample DOM/range/frame proofs, counts above 100/200/250 ms, fixture/input/screenshot hashes and cleanup records are in `candidate03-vs04.json`.

## Frozen inputs

- 03 ELF `341d12999d07ba0b7116d463ebacde4bb52ead97279a33ad588ab599d2ddb7a2`, independent outline 1.3.2 `c4f1bc3b3333fc8ae8919487cd2c20e59b622af98c97ce26e14ff9fdaf3b0f0f`.
- 04 ELF `fb767f5a06555681c99323e5f2c5e763cfb4c6333f62f634e06405601ddfc9d2`, independent outline 1.3.3 `80a9ce947c4abf2998eb72c36c327d5d826f0d30fa22dad61f903ff4713ca5c6`.
- Original harness `b8ccb4322a8068496ffac252245150f7bb3811a1258f90e6773ac61f29534258`; 04 copy `584a50dddaf3be64f826ccb06de8242fc579f447b12b5bdf1669b0b40b686356`. `candidate04-harness-fixture-only.patch` changes only fixture reuse and exact original-byte validation. Timed operations and completion predicates are unchanged.
- All titles are retained. Large is 26,018,029 bytes / 40,001 lines / 8,775 headings. Dense is 36,001 lines / 18,000 headings. Performance/keyboard reuse original M02 sources read-only; lifecycle uses its own writable /tmp copy. All final SHA values match the originals.

## Complete index and first visible rows

Each profile has 3 sequential full indexes, initial open then reloads; these are not 3 cold processes. Full completion is distinct from first visible rows.

| Fixture |03 full index ordered|04 full index ordered|03 first rows ordered|04 first rows ordered|
|---|---|---|---|---|
|large|9267/9635/8282|4962/4461/5120|213/180/210|197/180/192|
|dense|10544/9580/9380|6561/5641/4901|254/173/180|275/173/220|

## Same-condition production distributions

Fold budget is p95≤250; follow/click/ten-wheel burst budget is p95≤200. Over-budget counts are shown against the corresponding threshold; all >100/>200/>250 counts also remain in JSON.

|Fixture/operation|n|03 min/median/max|04 min/median/max|03 p95|04 p95|03 →04 over budget|04 result|
|---|---:|---|---|---:|---:|---|---|
|large/index|3|8282/9267/9635|4461/4962/5120|—|—|not a distribution budget|descriptive only|
|large/collapse|20|35/63/354|43/52/84|152|72|1/20 → 0/20 (>250)|PASS p95|
|large/expand|20|75/101/218|76/89/125|161|117|0/20 → 0/20 (>250)|PASS p95|
|large/editor-cursor-follow|20|85/142.5/275|86/131/205|227|180|3/20 → 1/20 (>200)|PASS p95|
|large/outline-click|20|148/191/520|140/156.5/199|482|199|8/20 → 0/20 (>200)|PASS p95|
|dense/index|3|9380/9580/10544|4901/5641/6561|—|—|not a distribution budget|descriptive only|
|dense/collapse|20|131/211/614|135/174/260|545|256|7/20 → 2/20 (>250)|FAIL p95|
|dense/expand|20|99/135/838|112/135.5/164|558|162|3/20 → 0/20 (>250)|PASS p95|
|dense/editor-cursor-follow|20|89/116/368|65/111.5/179|359|159|3/20 → 0/20 (>200)|PASS p95|
|dense/outline-click|20|103/129/176|105/130/167|166|165|0/20 → 0/20 (>200)|PASS p95|
|dense/middle-collapse|1|169/169/169|194/194/194|—|—|not a distribution budget|descriptive only|
|dense/middle-jump|1|142/142/142|117/117/117|—|—|not a distribution budget|descriptive only|
|dense/middle-expand|1|155/155/155|128/128/128|—|—|not a distribution budget|descriptive only|
|dense/wheel-burst-10|20|121/155.5/689|113/147.5/262|658|167|6/20 → 1/20 (>200)|PASS p95|

Candidate04 residual slow samples: dense collapse has 2/20 over 250 ms (max 260, p95 256); large editor follow has 1/20 over 200 ms (max 205, p95 180); dense wheel has 1/20 over 200 ms (max 262, p95 167). These remain in raw records. No further tuning or repeat was performed. Combined 04 changes include progress coalescing, bounded page-read concurrency and generic virtual-scroll scheduling; this comparison does not attribute every gain to a single change.

## Keyboard and lifecycle functional evidence

`p7-candidate-m02-outline04-keyboard-01`: trusted Shift+F6 then 3 Tab presses enter the tree. End focuses rank 17999 with range 17840..18000 / 160 actual rows (130 ms); Home focuses rank 0 with range 0..160 / 160 rows (150 ms). Document version remains 0 / dirty false, exact source SHA unchanged. These are single functional timing observations, not p95 or a screen-reader test.

`p7-candidate-m02-outline04-lifecycle-01`: first partial index 25 headings / 256 scanned lines was observed. Immediately before real Source input, index was still incomplete at 823 headings / 8192 of 40,001 lines. Input creates version 2 then 3 and the changed first heading; latest-version full index has 8,775 headings. Undo/save yields version 4 / savedVersion 4 / dirty false, original first heading and exact original disk SHA. A separate incomplete scan is switched to empty before completion; the empty document remains 0 rows through a 2000 ms observation window. Reopen completes 8,775 headings, with one 6339 ms index observation. This proves cancellation through document replacement and stale-response isolation; it is not a separately instrumented helper teardown measurement.

## Evidence and environment

All 04 run paths start `runs/p7-candidate-m02-outline04-` (large-01,dense-01,keyboard-01,lifecycle-01). Each has completion, plan, original harness, installed catalog, document probes, measurements and final PNG. Final-screen PNGs do not substitute for intermediate DOM/focus assertions. `candidate03-vs04.json` lists exact inputs and screenshot hashes.

Candidate04 CPU/GUI slot had no concurrent test/build/formatter/archive work by other agents; Root performed lightweight reads/document writes. This is coordinated scheduling, not guaranteed machine-wide isolation. Candidate03 dense had the separately disclosed formatter overlap in CANDIDATE03-DIAGNOSIS.md; no slow sample is attributed to it. No diagnostic Proxy/instrumented plugin is used in this table.

All 4 owned drivers stopped using exact PID/birth checks; last stop 14:08:13.421427Z. CPU/GUI released to Root; Root subsequently reported exact PID/birth cleanup of this round’s Xvfb 127 at 14:10:14 UTC. Display 126 was not touched. M01 evidence remains frozen. No claim of per-helper instantaneous cancellation cleanup follows from driver stops.
