# Observation-build budget review — 2026-11-16

No Actions dispatch, product behavior change, TU recompilation, PDF run, or
upstream submission was performed for this review. The research branch remains
separate from the product integration branch.

## Exact stop, graph and cache evidence

Run [43789957637](https://github.com/Auto-Plugin/milkup/actions/runs/43789957637),
SHA `992d70091a497067cede46227deb27653fff29b3`, stopped at **717.278 seconds on
the 65th new cache miss**, exceeding its 64-miss limit. Its time limit was
**1,200 seconds**, not 717 seconds. No compiler error was reported. All four
changed real translation units passed separately; those passes are retained,
not rerun or reclassified as native PDF acceptance.

`reconcile.py` reads the actual current build completion log, actual retained
full Ninja log and three historical Ninja timing logs. `reconciliation.json`
retains each input hash and every unmatched object's historical observations.
It distinguishes compiler objects from generation and linking steps:

| Quantity | Evidence |
| --- | ---: |
| Prior full graph / current CMake compile-command count | 3,263 / 3,263 |
| Distinct completed objects in current continuation log | 2,374 |
| Objects absent from that log | 889 |
| Of these: WebCore / WebKit / MiniBrowser | 400 / 481 / 8 |
| Historical timing observations available | 889 / 889 |
| Sum of each object's longest retained historical duration | 30,950.764 s |
| Ideal four-way division of that sum | 7,737.691 s (129 min) |
| Illustrative two-times allowance | 15,475.382 s (258 min) |
| Objects whose longest observed duration is below 5 s | 101 |

The four separately compiled objects may appear in the unmatched set; this is
conservative bookkeeping. `2608/3616` is mixed Ninja progress, not 72% of cold
compiler work. The previous complete graph has the same object names/count,
but **the current full build.ninja / compile_commands.json / .ninja_log were
not retained**. Four selected real command graphs and the compile database
digest were retained. The report must not be read as recovering a missing
current full dependency graph.

Historical runs changed scalar/URI headers and include cache hits. The 101
short observations are not established cold timings. Dividing by four ignores
dependency serialization, link contention and runner variation. The 129- and
258-minute figures are planning scenarios, **not completion upper bounds**.

`cache-inventory.json` records the actual API lookup. The latest available
baseline is still the 439,993,725-byte archive keyed:

```
webkit-u2604-2526-edc7e59917fbad8635b3c87f62416989f35aec8ac8591b557de19ffcbd3ecd76-43672149274
```

No observation-baseline cache key was found. Cache key names alone cannot prove
content. That old cache has positive first-invocation evidence for two bmalloc
objects and 2,309 continuation hits; it does not prove the remaining objects
are reusable. The 65 new misses were not saved. The four TU object hashes do
not mean their object bytes were retained either.

## Capacity decision and stopping conditions

The existing pagination job has a **75-minute** hard workflow timeout. Its
previous runner had 4 CPUs, 16,365,628 KiB total memory and 88,466,731,008 bytes
free at the stop; memory and disk did not cause it. This local environment has
only about 549 MiB free and no compiler/ccache: no local build was attempted.

The same authorized runner type has previously run the separate research job
with a **355-minute** workflow timeout. That is a possible scheduling envelope,
not proof a new observation build will fit. A 258-minute scenario plus 20 min
setup and 35 min installation/print/cleanup/evidence reserve totals 313 min,
but the missing cold timings and cache/graph details prevent treating 313 min
as conservative assurance. **No new run is dispatched on that assumption.**
Repository-wide in-progress and queued run queries both returned empty.

A later continuation needs all of the following before dispatch:

1. Either a verified observation-compatible object baseline, or reliable cold
   measurements / compiler-work bounds for the still-unmeasured objects, and
   the exact complete current graph. Preserve the original source, ABI,
   compiler and observation patch; do not add old behavior patches for cache
   reuse.
2. Fit the chosen budget within the already available runner hard limit,
   reserving **35 minutes** for private installation, native diagnostics,
   owned cleanup and evidence. Hard-stop compilation before that reserve.
   Stop on <2 GiB available RAM, <8 GiB free disk, or 30 minutes without a
   completed Ninja edge; always stop/reap the owned compiler process group.
3. Inherit the four unchanged real-TU results only after binding exact source
   archives, patch, compiler bytes, actual commands, ABI and generated inputs.
   Do not run the four TU acceptance again just to recreate a green gate.
4. Retain the current graph/commands/Ninja log, per-object cache diagnostics
   and bounded compiler objects on controlled stop as well as success, before
   runner destruction. Capture success is separate from build success. A
   hard runner termination can prevent any finalizer; it is not a retention
   guarantee.
5. Only after a complete runtime and verified private load run the existing
   original-package native diagnostic once. Keep all original PDF contracts
   and failure controls. No CSS trials, application rebuild or new matrix.

## Locally validated retention preparation, not an existing cache

`object_bundle.py` prepares a bounded store of **selected completed ELF64
ET_REL `.o` files only**. Keys bind six input digests: authenticated source
archives, observation patch, compiler bytes, full configure arguments, full
compile database, generated-header manifest. Object bytes and actual command
arguments have independent hashes. The caller must stop/reap its compiler
group first; no active build should be snapshotted.

No recursive workspace capture, environment dump, runtime, executable, archive,
PDF, source tree or credentials are selected. Symlinks, hardlinks, traversal,
extra files, unknown graph targets, wrong input identity, truncation and size
overflow fail. Limits: 4,000 selected objects, 64 MiB/object, 2 GiB total.
Exceeding a limit leaves no complete receipt; it does not silently omit objects.

Eight local positive/negative tests passed. These use synthetic ELF envelopes,
not real WebKit compilation. This preparation is **not connected to Actions,
does not upload, and cannot restore into a build**. It neither salvages the
destroyed 65 objects nor validates the remote ccache format. Later reuse must
still obey Ninja/ccache dependency validation; a matching receipt alone never
authorizes skipping compilation. Its current value is a testable retention
boundary and content-key contract, ready for review before workflow wiring.

## Independent upstream / isolation preparation

The maintained `upstream-review-draft.md` remains local. For the pagination
case the evidence package should contain: exact stock source/flags/font and
12 mm GTK allocation; original HTML and failed PDF hashes; title/table/first
row coordinates; four passed real-TU commands; and the **not-yet-observed**
keep/break/strut/re-layout timeline as an explicit missing item. The mechanism
is not established, so no behavioral patch or causal bug description is ready.

The original application/package/guard binding and private-prefix load checks
in `native_probe.py` remain the alternative isolation gate: verify mapped
WebKit/JSC bytes, process ancestry and sandbox, run exact original printing,
and compare independent final-layout/PDF coordinates. This is research-only;
no system-library replacement or supported product-delivery claim follows.
No new upstream issue/comment/PR was sent. Stock runtime delivery, text/URI
and pagination release requirements remain open.
