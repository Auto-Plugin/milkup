# Measured performance changes after the initial quality checkpoint

Baseline source: `ef221deb1bde9b56b6bc5faf09105d5bcbd059d7`.
Application remains beta.10. Outline changes from 1.3.3 to 1.3.4 so different plugin
bytes are not shipped under the previous package version.

## Mermaid: stop unnecessary re-rendering on document returns

The service previously kept only eight off-window fence results even when small
validated PNGs were far below the existing byte and fragment limits. The existing
32-fence fixture visits two separate 12-diagram windows: 24 initial renders became
28 after returning to the first window, solely because four affordable images
had been evicted. Repeated returns caused more rendering, not a syntax failure.

Authenticated PNG history now retains at most 32 off-window entries. Generic,
selection-dependent providers retain their old eight-entry history. This uses
more of the existing cache budget; it does **not** raise the 64 MiB encoded plus
intrinsic decoded-pixel accounting limit, the 128-fragment cap or the separate
PNG resource authority limits. The 32-entry history also leaves more allocation
headroom than retaining the full fragment cap as history. Active windows retain
their existing protection against eviction during progressive rendering.

The regression now observes **24 renders before and after returning**, rather
than 28. This is an engine-call count in the real presentation service with
fixture PNG renderers, not a measured Mermaid.js/Windows wall-clock improvement.
The strengthened tests also prove:

- Bounded 32-entry authenticated history, recent-entry hits and oldest-entry
  eviction; independent response ownership survives eviction and clear.
- Unchanged eight-entry generic-plugin bound.
- At most three 2048×2048 cached images under the original 64 MiB cost limit,
  with correct disposal and re-render after actual byte-pressure eviction.
- Existing source/render/mixed strategy, caret/in-flight reuse, owner revocation,
  theme/identity/width invalidation and image cleanup checks still pass.
- Speculation is still limited to the nearest eight units and 256 lines per
  pass. No generic plugin is speculatively invoked. Existing prefetch tests pass.

No global editor modes, editor toolbar or status-bar controls were changed.

## Outline: reduce index construction allocation work

`Visibility.refresh` ran on index append/fold and mapped each leaf into an array
of up to 128 temporary `Summary` objects. The replacement iterates the existing
primitive depth/cover arrays directly; internal-node aggregation, page format,
cache capacity, read concurrency, transaction budgets and fold semantics remain
unchanged.

A repeatable paired experiment is included:

```sh
node tests/performance/outline-append-comparison.mjs \
  ef221deb1bde9b56b6bc5faf09105d5bcbd059d7 /tmp/new-outline-comparison
```

It loads the old and working-tree implementations into one Node process, retains
one warm-up pair, then runs eight measured pairs in alternating order. All trials
are retained; no fastest-run selection. Each trial indexes 18,000 headings,
checks every title/position and collapsed-root result, and asserts identical
persisted index bytes and read/write transaction counts between implementations.
Source and fixture hashes are in `outline-append-paired.json`.

Measured append/finish median: **138.66 ms before → 118.65 ms after (14.4% lower)**.
These are in-memory CPU/index timings. They omit native scanning, real storage,
IPC, input and painting, and do not close the native dense-fold 250 ms p95 gate.
The 40 Outline correctness/lifecycle tests pass. The new 1.3.4 plugin was also
built outside the checkout using only copied plugin sources and the packed public
SDK 0.3.8, and all 40 tests passed there. Hashes and the reproducibility boundary
are in `outline-public-build.json`; no host-source alias was used for that build.

## Final local checks

- Desktop: 1,032 Vitest cases + four bootstrap Node cases passed.
- View DOM: 1,001 cases passed.
- Windows Mermaid source/GUI harness contracts: 314 cases passed on Linux, not
  Windows GUI execution.
- Outline: 40 cases passed both in workspace and independent public-SDK build.
- Workspace typecheck passed; production desktop Vite build passed with the
  existing large-chunk warning.
- Modified files formatted; version consistency and diff checks passed.

## Explicitly still open

First-process Mermaid cold start has **not** been timed on the final candidate.
The exact approved owner already begins fixed-engine preparation when its plugin
activation publishes. It would be speculation to change sandbox startup or its
watchdogs without native measurements. Caret-movement repeat rendering is covered
by current passing service/view tests; the changes here address history eviction,
not a newly reproduced caret bug. Native source→decoded latency distributions,
Windows installed-product regressions, system IME/DPI/screen-reader acceptance
and actual Outline end-to-end p95 remain required. The browser socket restriction
recorded in the initial checkpoint still prevents local browser execution.
