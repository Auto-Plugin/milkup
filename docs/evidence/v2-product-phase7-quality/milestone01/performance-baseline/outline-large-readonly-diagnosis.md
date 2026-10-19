# P7 native large outline: read-only latency review

Input: `../native-ui/runs/p7-outline-baseline-large-01/{plan,measurements,observations,completion}.json`, frozen `harness.mjs`, and corresponding driver log. Baseline ELF SHA `f15c476a4f6e7b5f254e325692d57e9bfaa798580441dd3554f6c4fe1e9d802e`; outline 1.3.1 archive SHA `7eea6ffb5bba53155b3c256c6e35d95b04a93199ebbbd04636ee9c7ec5f6f712`. No code, tests, UI, instrumentation or build changes made for this review.

The 26,018,029-byte / 40,001-line fixture has 8,775 outline headings. Three index completions took 7,689 / 8,514 / 6,701 ms; first rows 200 / 163 / 170 ms. Indexing was in Live mode. Subsequent folding and navigation measurements switched to Source mode. Do not attribute the navigation tail to Live Markdown parsing. The final document remained version 0, clean, with the original SHA.

## Distinct interactions

- Twenty editor Ctrl+Home/End follow samples: 325–775 ms, median 360.5, p95 457, all over 200 ms. These alternate document extremes. Their semantic-completion callback candidate is separate from clicking the outline.
- Twenty actual `outline.gotoHeading` clicks: 132–571 ms, median 167.5, p95 428, 15/20 at or below 200 ms. The existing public `revealLine` route already requests immediate viewport refresh after navigation.
- The real clicks alternate **line 4 / line 1**, cursor 1730 / 0. Before the loop the harness returns to Home and waits for the first active outline heading. Every captured click result has virtual range `[0,160)`; the preceding keyboard loop already visited document start repeatedly. These are repeated local clicks, not cold distant-heading/page navigation.

| Click | Elapsed ms | First observation of any existing rows, ms | Remainder to final observed target, ms |
| --- | ---: | ---: | ---: |
| 1–8 | 184,164,132,151,159,153,174,167 | 29–46 | 103–147 |
| 9 | 428 | 103 | 325 |
| 10 | 264 | 42 | 222 |
| 11 | 218 | 49 | 169 |
| 12 | 571 | 244 | 327 |
| 13–14 | 180,149 | 62,36 | 118,113 |
| 15 | 203 | 36 | 167 |
| 16–20 | 168,149,155,142,174 | 4–36 | 113–164 |

The first eight are all below 200 ms. Four of five misses cluster at clicks 9–12; click 15 is the fifth. A “cold first page/cache miss only” explanation is inconsistent with that order. This does **not** prove every repeated click was a cache hit: no page-cache event counters exist in this run, and intervening queued work could evict data.

`firstRowsMs` is easily misread. The harness sets it at the first sample where *any* outline item exists; the old 160-row list already qualifies. It is not the target cursor time, new slice arrival, result-render time, or a storage/IPC boundary. At clicks 9 and 12, even this observation occurs 103/244 ms after trusted click capture; another 325/327 ms passes before the target cursor and active row satisfy the harness through its rAF proxy. These are the only measured subintervals available. They identify delayed observation before completion, but cannot separate event-loop scheduling, plugin command queue, source navigation, storage, DOM rendering, and frame callback delivery.

Both slowest click snapshots have `virtualFollowActive=false`; all others have true. Baseline plugin code distinguishes `followActive` from `preparedFollow`, resets the former after row preparation, and can update the latter on a user virtual-range request. A final false flag is therefore a correlation, not proof of unwanted scrolling or a second refresh being the cause. The final slice and target are correct in both cases. Do not infer a new scroll bug without an event sequence.

## Existing diagnostics and implementation constraints

There is no separate `diagnostics.json`, per-call native trace, Worker timing, page-read timing, cache-hit count or frame-gap timeline for this run. The small driver log contains GTK `WIDGET_REALIZED_FOR_EVENT` warnings during earlier setup/opening (last 11:03:54.096); it supplies no timestamped navigation-stage evidence for the later click tail. Final native catalog has outline 1.3.1 enabled, revision 6, diagnostics empty. That confirms no retained lifecycle diagnostic, not absence of transient performance stalls.

Baseline outline uses a bounded 24-page shared cache, metadata pages of 128 records and batched public temporary-store reads. `prepareRows` reuses the visible rows when the requested interval is unchanged and rows are clean, while still computing active ordinal/rank. SourceView source-mode navigation uses a bounded versioned line-window cache, but still renders the visible window/cursor. Neither fact yields measured hit/miss or cost for these samples.

The index batching candidate may improve indexing or repeated preparation, but this baseline cannot establish that it fixes click-navigation p95. Re-run the same twenty true clicks after candidate changes and report all samples before making that claim. Preserve the 200 ms target, native safety/recovery, bounded caches and public isolation. No additional product patch is justified by this read-only evidence alone; the click-navigation tail remains an independently measured gap.
