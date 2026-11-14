# P7 outline candidate, before native comparison

This supplements BASELINE.md; original executions and failures remain unchanged.

## Index

The first I/O regression produced 36 reads against the proposed ≤24-transaction budget (`index-io-red-01.log`). The candidate selects at most 16 visible ranks together, prefetching through the existing four-page calls and 24-page shared cache. No persistent full heading/title array or page directory is added. Full document coverage, exact title/from/line oracle, randomized folds, lazy epochs, append-through-tree-growth, stale navigation and cancellation still pass: **25 tests**, `index-io-green-01.log`.

`index-candidate-01/results.json`: 18,000-title collapsed root presentation reads **20 instead of 36**; 8,775 reads **12 instead of 18**. Reset remains zero I/O. This is a transaction reduction, not a native latency claim. All raw elapsed samples remain available; three samples do not justify p95.

The independent 1.3.2 package and SDK closure are documented in `external-1.3.2/README.md`. It uses only public SDK 0.3.7 and document:read.

## Keyboard

The host recognizes an unambiguous public wrapper row containing a navigation button and matching expansion button. Navigation gets the treeitem role/level/state and one roving Tab stop. Arrow folding goes to the separate toggle, without invoking heading navigation. This is generic semantic matching, not an outline ID/command/class exception. Legacy ambiguous wrappers remain unchanged.

Virtual Home/End and boundary Up/Down now calculate **visible ranks**, requesting a bounded public virtualViewport range (160–500 rows; fewer if the entire visible tree is smaller). The host keeps only one pending keyboard focus intent. Delayed ranges must match the latest request, mount, document and version; focus departure resets the public range and invalidates obsolete renders. No focus restoration requires an aria-label when a valid text-named keyboard target exists.

Regression evidence:

- `virtual-keyboard-red-01.log`: initial cross-window requests absent, 2 failures.
- `virtual-text-name-red-01.log`: generic text-named treeitem lost focus at End.
- `virtual-focus-race-red-01.log`: initial insufficient two-microtask wait gave a false green; preserved as harness evidence.
- `virtual-focus-race-red-02.log`: complete event-loop wait reproduced both races: same-tree Heading 1 moved to Heading 17841; changed document version still accepted the distant slice.
- `virtual-keyboard-review-green-01.log`: **43 host tree/UI tests passed**, including latest End→Home response ordering, same-tree departure, outside Tab, document change, teardown and folded visible ranks.
- `desktop-types-final-02.log`: exit 0. Earlier type-check failures are retained.

Current whole-document keyboard coverage is Home/End and Up/Down across slices. Left/Right preserve ordinary visible parent/child and separate collapse/expand behavior; finding an off-slice parent requires further native assessment and is not inferred from Home/End success. DOM tests are not native keyboard or screen-reader proof.

## Native measurement harness

`tests/native/tauri-p7-outline-performance.mjs` uses a fresh profile, exact binary/archive hashes, normal catalog install/approval/activation and native input. `run-baseline.sh` binds immutable fa530 binary + independent outline 1.3.1. Default per fixture is 3 complete index samples and 20 collapse/expand/navigation samples. `ordinary`, `large` (8,775) and `dense` (18,000) are separate runs. Keyboard is a separate phase so a baseline failure cannot erase performance results.

Measurements capture trusted input to matching DOM plus two animation frames; index timing begins when the newly opened source is visible and no longer opening. File-picker time is excluded. Repeated index builds are warm rebuilds in one fresh profile, not OS-cache cold boots. Dense manual scroll is explicitly a **30-key PageDown/PageUp burst**, reported separately from single-input navigation. It must not be presented as a single-wheel latency result.

The harness preserves source SHA, version, native catalog, actual files, screenshots, failure records and script snapshot. Preflight does not run UI. Actual native results must be added after root serially allocates the display and heavy CPU jobs have stopped; none are implied by this document.

## Subsequent review and native baseline

After the initial host freeze, checkpoint21 reproduced four more identity/intent regressions and fixed the shared success/rejection guard. Exact inputs and RED/GREEN/type evidence are in `virtual-request-lifecycle-manifest.json`. This follow-up is distinct from the earlier 43-test result; candidate01 ELF predates it and is not the final candidate.

Actual native baseline outcomes, including failed budgets and harness failures, are now in `NATIVE-BASELINE.md`. New measurements separate `editor-cursor-follow` from true `outline-click`. Scroll now uses trusted XTest wheel input and waits for changed scrollTop and visible real rows fully covered by the current public range; cached-range scroll need not change revision; old Page-key results are retained but are not valid scroll latency evidence. The standalone `lifecycle` phase is prepared for the candidate large fixture and has not yet run.
