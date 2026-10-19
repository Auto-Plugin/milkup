# P7 outline native baseline

Immutable fa530 production binary and independent outline 1.3.1. Raw runs remain under `../native-ui/runs/`. Functional completion and performance budgets are independent. **Fold timing correction:** all old fold samples checked total metadata only, without actual DOM row counts. They are counter proxies, not full DOM convergence measurements. Dense collapse-1 is invalid even as a consistent-range endpoint (total20/end160); the remaining 19 have metadata consistency only, min/median/max 177/282/748 ms, and no p95 is claimed. Fresh matched runs will use the stronger endpoint. Timing is trusted native input to matching DOM plus two animation frames, not physical display latency.

## Ordinary, 8 headings

`p7-outline-baseline-ordinary-01` completed all observations with unchanged source SHA. Three warm rebuilds: 139 / 145 / 159 ms (sorted); no p95 claimed for indexing. Twenty collapse/expand counter-proxy samples reported p95 52/49 ms; actual DOM convergence was not measured, so this does not establish the fold budget. Twenty editor Home/End-to-outline-current samples p95 **319 ms**, all twenty above the 200 ms interaction budget: **navigation budget FAIL** despite functional completion.

Driver cleanup used its recorded PID/birth and confirmed no executing owned driver. These observations do not establish screen-reader behavior, system DPI behavior, or other platforms. Later sections record the completed large/dense groups and native keyboard failures.

## Large, 8,775 headings / 40,001 lines

`p7-outline-baseline-large-01`: complete full counts and unchanged source SHA. Three first-row samples: [200, 163, 170] ms; full index min/median/max 6,701 / 7,689 / 8,514 ms. Twenty collapse/expand counter-proxy samples reported p95 88/166 ms; actual DOM convergence was not measured and the fold-budget verdict is withdrawn. Editor Ctrl+Home/End → current-outline highlight p95 **457 ms**, all twenty >200 ms. Separately, twenty actual `outline.gotoHeading` clicks alternating the first two visible headings p95 **428 ms**, 15/20 ≤200 ms, maximum 571 ms: **both navigation groups fail their 200 ms p95 budget**. Click and cursor-follow observations are not merged.

## Dense, 18,000 headings / 36,001 lines

`p7-outline-baseline-dense-01` **ended with a scroll harness timeout**, not an overall pass. Prior complete groups remain usable (`dense01-derived-summary.json`): three full-index samples 11,805 / 13,218 / 14,858 ms; collapse-1 is excluded; the remaining 19 collapse counter proxies are min/median/max 177/282/748 ms. Twenty expand counter proxies are min/median/max 100/175/428 ms. Neither establishes full DOM convergence, so no fold-budget verdict is made from these groups. Editor-cursor-follow p95 686 ms. Actual outline-click p95 558.9999999999854 ms. Middle-root click was one 117 ms sample, not a p95. PageDown/PageUp burst 2 never changed the observed virtual range; native default Page-key behavior was not established as a container-scroll driver. The first burst is therefore not used as valid scroll performance either. A real wheel replacement is prepared; raw failure remains untouched.

## Initial keyboard harness failure

`p7-outline-baseline-keyboard-01` did not reach the outline tree: clicking a heading returns focus to the editor, where the old source-mode Tab behavior inserted indentation. The 600-key attempt advanced unsaved memory to version 599; the fixture on disk was unchanged and was never saved. This is not evidence that tree End ran or failed. The corrected fresh run starts with native Shift+F6 region navigation, then at most ten real Tabs with an immediate dirty guard; editor-to-shell Tab is covered separately by the P7 keyboard matrix.

`p7-outline-baseline-keyboard-02` corrects setup with real **Shift+F6 → Tab**. The first navigation item was reached with an unchanged, clean document. Real End scrolled to the final virtual region but lost the navigation focus to ExpandAll; the target-last-item assertion timed out. The actual screenshot and trusted-event measurement record this native keyboard RED. Home and boundary Down were not executed after the failure.

## Ordinary true-click supplement

`p7-outline-baseline-ordinary-02` completed unchanged source SHA. Twenty actual outline clicks p95 **67 ms** (maximum 95 ms), all within 100 ms. Editor-cursor-follow remains distinct: p95 **324 ms**, all twenty >200 ms. Collapse/expand counter-proxy p95 63/66 ms does not establish complete DOM convergence. Three full-index samples 130/137/146 ms. This supplements rather than replaces ordinary01.

## Scroll-only observer failure

`p7-outline-baseline-scroll-01` captured real wheel input but incorrectly required a new revision inside an already-cached range. See `SCROLL-01-ANALYSIS.md`. No valid scroll p95 is claimed. All seven owned drivers were stopped using their recorded PID/birth identities; this does not assert unsampled helper cleanup or physical display behavior.
