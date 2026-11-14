# Dense outline folding: read-only diagnosis before candidate measurements

Scope: inspect current outline 1.3.2 candidate and host paths; reuse existing evidence only. No changes, test runs, new tracing, UI, build, SDK changes, or cache/budget relaxation. Candidate native results remain pending; this report identifies checkable costs, not a measured bottleneck or promised fix.

Inspected source hashes:

- `plugins/outline/src/plugin.ts`: `374e800592fac5e6ad85b47c87b4422330bbf3cc323cbd932020b16b7ef0d009`
- `plugins/outline/src/outline-index.ts`: `623bc1ce194fdcd0cbbd0105002b12d4fd508eb5d847d51dce220e8cab072e77`
- `apps/desktop/src/desktop-plugin-ui.ts`: `39b19b1c14055d383a5a40cb00bc07075e245ab7b949c2b91f84cc1384645cc4`
- `apps/desktop/src/plugin-temporary-storage.ts`: `b5fdd25b966978b7e35e103b7fc5819d6c98ba0e46f8c8556a3cfbb1d870bdfe`

## Baseline evidence must keep its measurement limitation

`../native-ui/runs/p7-outline-baseline-dense-01/measurements.json` contains 20 collapse and 20 expand measurements, with historical reported p95 610 / 348 ms. The whole run later failed `scroll-burst-30-2`; its failure must remain intact.

`collapse-1` is explicitly premature: elapsed 197 ms, `virtualStart=0`, `virtualEnd=160`, `virtualTotal=20`. The old fold predicate checks the completed-index label and new total, not the actual row count or validity of the returned interval. It can accept new fold metadata while old rows remain. Collapse 2–20 have metadata `[0,20)` / total20; this does not prove actual DOM row consistency because the old run did not record that count. Do not relabel the remaining 19 samples as a corrected p95 or claim complete DOM convergence. Root/plugin owner is tightening the predicate separately; old raw files remain unchanged.

## Work is bounded by tree pages and returned rows, not a full 18,000-row reset

`collapseAll` / `expandAll` enqueue `changeFold(..., persist=false)`. `resetCollapsed` calls `Visibility.reset`: increment epoch, set the collapsed default, normalize only the root. It does not loop over all headings or write/flush every metadata page. Nodes are normalized lazily when read. Each internal node has at most 32 children; each leaf at most 128 covers. For 18,000 records the root is level 2 (128×32 capacity per child), with five child summaries. Root normalization is therefore small. The existing offline reset-only operation has zero read/write calls.

After reset, `rowsDirty=true`; refresh uses a zero-delay timer and the existing serial session queue. `prepareRows` obtains the active ordinal/metadata/rank, optionally walks at most the heading ancestor chain, then calculates a bounded visible interval. `records.rows` is capped at 500 records; the current benchmark normally requests 160. Global collapse produces only 20 visible roots. No observed path materializes all 18,000 rows in the host DOM.

Within `rows`, the candidate walks ranks in groups of 16. `Visibility.selectRange` groups ranks by tree branches, prefetches needed child pages in batches of four, then recursively visits selected branches. It replaces repeated individual selection walks; it does not prefetch the complete tree. `Pages` keeps 24 shared visibility/metadata/title pages, evicts eight on pressure, and retains the existing 64 KiB page / 256 KiB batch limits. Epoch normalization and tree sibling scans recur per visited node/group; CPU work is proportional to bounded pages/ranks and tree height, not an unconditional O(N) pass.

## Why collapse can require more storage requests than expansion

The dense fixture has a root every 900 headings. Collapsing to 20 roots selects ordinals 0, 900, …, 17100: twenty distinct visibility leaves and twenty distinct metadata pages (128 records/page), plus dispersed label pages and internal nodes. These selected data exceed the 24-page shared cache working set. In contrast, the initial 160 expanded records occupy adjacent pages. Cache eviction and sequential batches therefore remain concrete potential costs even when the rendered collapsed list is smaller.

The existing offline `index-baseline-01/results.json` / `index-candidate-01/results.json` verify this distinction for the same 18,000-heading fixture hash `af6d31cc293ab6ca7f7aa0d6803c941d21e060ee122883f6c80b24f0eb4791ad` (normal labels, repetition 1):

| Operation | Baseline store read calls | Candidate store read calls | Candidate keys / bytes | Writes |
| --- | ---: | ---: | ---: | ---: |
| reset only | 0 | 0 | 0 / 0 | 0 |
| collapsed visible rows | 36 | 20 | 66 / 400,233 | 0 |
| expand and first 160 rows | 6 | 6 | 6 / 26,442 | 0 |

The previously discussed 18→12 reduction concerns the separate 8,775-heading fixture. These are in-memory store-call counters from an offline benchmark, **not native RPC/IndexedDB elapsed times**. The offline fixtures/cache history differ from alternating native clicks. Do not convert their call counts into a claimed millisecond saving. In particular, the dense candidate still has twenty sequential store calls in this offline state; it does not reduce the 66 keys/400,233 bytes.

Each public store call crosses Worker storage RPC and broker validation to the host temporary-store adapter. `getMany` opens a readonly IndexedDB transaction, verifies ownership/meta, and reads pages serially while enforcing the aggregate cap. There is no Tauri filesystem IPC in this adapter path. IndexedDB's underlying disk/browser-process costs are not recorded by these artifacts. Do not call these counters “native file reads” or weaken ownership/quota checks to reduce overhead.

## Host rendering and possible repeated work

The return path is `prepareRows` → `host.ui.requestUpdate` → UI RPC/broker → `DesktopPluginUiController.invalidate` → `renderUi` RPC → controlled output processing. The worker builds output for the returned rows only. The host computes a JSON signature, creates bounded controlled nodes, reconciles form state (outline has no form fields, so normal body replacement), decorates tree roles/focus, restores focus/scroll and configures virtualization. These are O(rendered output size) passes; they may be repeated, but are not O(total headings).

Two concrete repeat paths are worth distinguishing if the real candidate still misses:

1. Revision and one-shot `preparedFollow` metadata are part of `controlledOutputSignature`. Otherwise identical row content with changed metadata may bypass the same-signature early return and cause another bounded DOM rebuild. This is not by itself a bug: navigation/focus/scroll metadata must still be applied.
2. Focus/blur lifecycle calls send `renderUi` output that the lifecycle caller discards. Controlled replacement and restored focus can produce such calls. Pointer rendering protection can drop an intermediate result and request a fresh render after release. Separate invalidations and viewport updates can overlap; sequence guards reject obsolete commits but do not necessarily avoid all work already begun. Source inspection shows these routes exist; the baseline has no request/phase timeline proving their count for any slow fold.

The general main viewport 240 ms scheduler and host virtual-scroll 160 ms scheduler exist, but direct global fold refresh itself uses a zero-delay timer. There is no evidence that either fixed scheduler is on every global-fold critical path. Do not “fix” folding by reducing either delay or the acceptance budget.

## Narrow diagnostic points if the candidate still fails

First use the corrected completion predicate and existing candidate measurements. If another investigation is authorized, the minimum discriminating points are:

1. Command receipt → session queue start → reset complete: distinguish queued prior work from the inexpensive epoch operation. Record epoch/generation and request ID, not document content.
2. Refresh queued → `prepareRows` start/end: separately count cache hits/misses/evictions, `get`/`getMany` calls and keys/bytes for visibility vs metadata vs labels. Preserve existing limits. Reuse an offline deterministic store counter for algorithmic questions; it does not prove native latency.
3. `requestUpdate`/host `renderUi` request and response → controlled DOM commit: count committed/skipped/stale/pointer-deferred renders for the same fold generation, and resulting rows/start/end/total. This separates repeated bounded rendering from storage latency.
4. Target DOM convergence → existing two-rAF proxy: retain this presentation proxy separately, not as native CPU time.

No new instrumentation was added here. Do not sample full rows, introduce hidden warmup, expand caches, coalesce away required gestures, loosen SDK isolation or alter Rust recovery. A cache/request optimization should be selected only after one of these bounded stages is shown to dominate. Until then the measured dense-fold issue remains open and the candidate's effect is unproven.
