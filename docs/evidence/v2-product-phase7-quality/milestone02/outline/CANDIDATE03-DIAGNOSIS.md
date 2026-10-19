# Candidate03 outline remeasurement and diagnosis

2026-10-19. These are new candidate03 measurements, not reused candidate02 results. Product sources and M01 evidence were not changed. Raw failures remain in place.

## Frozen inputs and completion semantics

ELF: `milestone01/candidate-production-03/milkup-desktop`, SHA256 `341d12999d07ba0b7116d463ebacde4bb52ead97279a33ad588ab599d2ddb7a2`.
Independent outline 1.3.2 archive: SHA256 `c4f1bc3b3333fc8ae8919487cd2c20e59b622af98c97ce26e14ff9fdaf3b0f0f`. Public SDK 0.3.7. Frozen production harness SHA256 `b8ccb4322a8068496ffac252245150f7bb3811a1258f90e6773ac61f29534258`; full provenance is in `preparation.json`.

Fresh dedicated profiles, real UI installation and input, complete fixtures, no truncation. Index/fold completion requires actual DOM rows consistent with the expected total/range and stable frame observations. Navigation requires the real editor cursor and outline active row. Scroll includes all ten trusted wheel inputs and viewport coverage, including cached-range operations. Source hashes and dirty state are checked. Full-index n=3 includes initial open and subsequent reloads within one fresh profile; these are not three separate cold-process measurements. Timing includes input dispatch and final frames.

- Large: 26,018,029 bytes, 40,001 lines, 8,775 headings; source SHA256 `2dd5c4721f1600a3bd8c2b5acd34c19eb35eb5ab7dae1f1169ad26f7ba36dc03`.
- Dense: 36,001 lines, 18,000 headings; source SHA256 `997d1c7361e2a53082a935070c6f4f38b9668235744fdde5b16b8257c7d2d757`.

## Production measurements

Raw runs: `runs/p7-candidate-m02-outline-large-01` and `runs/p7-candidate-m02-outline-dense-01`. Both functional completion records pass, source hashes remain unchanged. Budget misses below remain failures. `candidate03-summary.json` retains each ordered sample; nearest-rank p95 is used only for n=20.

| Fixture / operation | n | min / median / max (ms) | p95 (ms) | budget |
|---|---:|---:|---:|---|
| Large full index | 3 | 8282 / 9267 / 9635 | — | full distribution; first rows 213/180/210 ms |
| Dense full index | 3 | 9380 / 9580 / 10544 | — | full distribution; first rows 254/173/180 ms |
| Large collapse | 20 | 35 / 63 / 354 | 152 | p95 ≤250; one >250 retained |
| Large expand | 20 | 75 / 101 / 218 | 161 | p95 ≤250 |
| Large editor cursor follow | 20 | 85 / 142.5 / 275 | 227 | FAIL 200 |
| Large real outline click | 20 | 148 / 191 / 520 | 482 | FAIL 200 |
| Dense collapse | 20 | 131 / 211 / 614 | 545 | FAIL 250 |
| Dense expand | 20 | 99 / 135 / 838 | 558 | FAIL 250 |
| Dense editor cursor follow | 20 | 89 / 116 / 368 | 359 | FAIL 200 |
| Dense real outline click | 20 | 103 / 129 / 176 | 166 | p95 ≤200 |
| Dense ten-wheel burst | 20 | 121 / 155.5 / 689 | 658 | FAIL 200 |

Editor cursor follow is Ctrl+Home/End followed by active-row synchronization. It is distinct from clicking an outline heading/public revealLine. Full-index ordered samples are large 9267/9635/8282 and dense 10544/9580/9380 ms. First visible rows meet the 1s target; completing the full index remains much longer. Dense middle collapse/jump/expand single samples are 169/142/155 ms, not a distribution.

Environment qualification: `environment-overlap.json` records two unrelated single-file formatter invocations while native work was reserved; only the second is known to fall inside the dense-owned interval (143/145 ms formatter self-time; complete shells 0.367/0.282 s). Only the second write UTC is known (13:14:05.411531Z); the first cannot be reconstructed. Small report/hash writes occurred at 13:14:29.440448Z. No concurrent tests/builds were reported. We do not claim absolute CPU idleness or attribute slow samples to these commands, and did not discard or repeat samples to remove them.

## Separate diagnostic observations

`diagnostic-preparation.json` pins the original-package Worker RPC/DOM observer harness. Runs `large-diag-01` and `dense-diag-01` use the same candidate03 ELF and original 1.3.2 archive, one full index and three operation samples per group (six wheel bursts). They are diagnostic, not replacement performance distributions. Constructor/postMessage proxies preserve arguments/results; only bounded protocol/method/timing/length/viewport metadata is recorded, not source text, titles, storage keys or values. Both traces have zero dropped events. Mutation-observer callback accumulated time was 163/175 ms; observer and Proxy overhead is nonzero. UTF-16 counts are not wire bytes.

Large index: scan.next 156 calls / 6828 ms summed duration; ui.requestUpdate 155 / 5712 ms; renderer 160 / 1301 ms; temporary writes 30 / 1133 ms. Dense index: next 150 /2725 ms, updates145 /6708 ms, renders151 /1476 ms, writes53 /2227 ms. These intervals overlap and must not be added. They support investigating frequent progress feedback, not claiming append serialization is the dominant cost.

Dense collapse1 (617 ms): early response at +88 ms reports total20 but old range0..160; actual final range0..20 appears at +581 ms, target predicate +582, stable completion +617. Twenty temporary reads span this operation (summed434 ms, max296); rAF gap max232. Collapse3 (319 ms) has 19 temporary reads from approximately +6 through +255 ms; final DOM +272. Sparse page retrieval is a concrete separate fold bottleneck. This does not establish that all delay is plugin CPU or that progress coalescing will fix warm folds.

Dense wheel3 (679 ms): actual wheel times +0,17,17,22,33,42,47,61,65,77 ms; driver acknowledgment +96. First range RPC +459; old slice remains visible +504; new range response +544; final 374-row DOM +613; target first satisfied +614; stable completion +679. Four render RPCs total67 ms, five page reads total21 ms, update76 ms; max rAF gap109. The largest observed segment precedes the first range RPC. Actual scroll events were not logged, so this cannot all be assigned to the 160 ms trailing scheduler: smooth scrolling and main-thread scheduling remain possible contributors. Five cached-range bursts take127–179 ms without RPC; they have no MutationObserver target event because scrolling alone need not mutate DOM. Original strict viewport predicates still apply.

Large true-click diagnostic samples210/172/142 ms have revealLine RPC97/56/61 ms, command112/63/68 ms, UI update48/27/36 ms, with additional editor/DOM/final-frame time. These overlapping samples do not explain every production520 ms outlier; no causal claim beyond observed intervals is made.

## Internal one-index diagnostic and preserved failure

`runs/p7-candidate-m02-outline-large-internal-01` uses the same ELF and independent diagnostic-only archive 1.3.2-p7diag.1 SHA256 `504153854d2be3bf85d4e3a6f63ba70f098a2be6f11ce01fbdec3427e0183dfb`. This is not a deliverable product package. Its fixed panel-title summary introduces instrumentation overhead; see its separate build proof and README.

One complete index: 9134 ms, first rows231 ms, all8775 headings/40001 lines. `internal-first-complete.json` records:

| phase | completed calls | summed ms | max ms | in flight |
|---|---:|---:|---:|---:|
| append queue wait |123|161|44|0|
| append work |123|1367|221|0|
| refresh queue wait |146|626|115|0|
| refresh work |145|4931|175|1|
| updatePanel |144|4865|175|1|
| prepareRows |145|58|13|0|
| scan.next |145|6750|421|0|
| pages.flush |30|1313|216|0|
| setMany |30|1284|215|0|
| serialize/encode |275|13|2|0|

Rows preparation and append waiting are small compared with UI-feedback intervals. The final refresh is still in flight when the first complete summary freezes, so these are partial terminal totals, not a complete idle accounting. No timings are added across nested/overlapping spans.

Post-measurement dump FAILED: harness scoped the visible command button under `.plugin-detail`, but host markup places commands in the sibling `.plugin-contribution-summary`. `failure.png` visibly contains the command; `completion.json` retains the timeout. No command was invoked through private APIs, no final idle snapshot was obtained, and the run is not labeled overall PASS. We did not repeat the complete index merely to erase this harness failure. Source SHA was independently rechecked after failure and still exactly matches; `internal01-review.json` records this and driver stop provenance.

## Narrow next experiments, not claimed fixes

1. Independent plugin progress-only bounded coalescing (~100 ms), preserving first rows, completion/error/cancel and user interactions immediately. Retain shared queue ordering, full scanning, 24-page cache and 500-row cap. Current evidence favors reducing repeated feedback; it does not justify predicted additive savings.
2. Sparse page reads: evaluate at most two concurrent four-page read batches, then allSettled and original-order cache insertion. No concurrent cache mutation/flush, no detached reads after failure, no larger resident cache. Eight pages imply at most512 KiB serialized UTF-8 response payload instead of256 KiB; actual JS heap is not measured by this limit. Require RED tests for concurrency bound, complete labels/ordinals, sibling read draining on failure and retry, then uninstrumented native validation before claiming improvement.
3. Generic virtual-scroll scheduling: investigate bounded leading/trailing dispatch with latest-wins/focus/document guards. The trace supports a scheduling gap but does not isolate it to one constant. Separate host tests and actual input timing are needed.

All five owned driver records have stoppedUtc; the last is PID347630/birth12010212, stopped13:26:22.487869Z. Xvfb127 is retained for the next authorized owner. CPU/GUI release was sent to Root/checkpoint21. These driver records are not a claim of separately sampled instantaneous plugin-helper teardown.
