# Identity-bound native pagination diagnostic

Run [43808221193](https://github.com/Auto-Plugin/milkup/actions/runs/43808221193)
tested **db2218fb230ba8504cc0b507de28bd484499dc0c**, manually dispatched once.
It completed successfully on 2026-11-16, 05:07:48–05:17:25 UTC. This is
**diagnostic success, not product acceptance**. The original heading orphan
and missing repeated headers remain failures. No product/layout fix was made.

## Reused inputs and bounded execution

The unchanged observation patch is
`3a84a75ae9aad83e8f93940c4d55b886c6cf2cba069ca087893fa2efe2e443c8`.
The four-TU acceptance was inherited under exact input comparisons, not
recompiled as another gate. Prior object artifact **14195679258**, from
43794564331, was restored in a new job after complete entry/identity checking.
Both first actual compiler calls hit the restored cache. Runtime reconstruction
completed in **135.297 seconds**, **3263 hits, zero new misses**, 3263 completed
objects. The limit was 1200 seconds / 64 new misses, within a 180-minute job
with a 3600-second retention/native reserve. No cold-build fallback occurred.
New object-only artifact **14199955883** retains the same 549,393,041 entry
bytes with the canonical header-inventory identity. No runtime is in that
archive. It was not downloaded into the low-space local workspace.

The original installed deb, binary and embedded guard were reused exactly:

* deb: `9e71e2b6f6c5cd030f7307d35679ded1d4f5605127d77320db1d455d90c1ddde`
* binary: `42394c4bdcaeea078c7d553acbe6edc7a75f13b16ce5b70cba2d0a3a02176ed6`
* guard: `296131695cb15814252edd02e76e111fef293b7585c4e7597101d8ec05b852fa`

12 mm print settings, the owned 1024×768 window, original HTML and native PDF
path remain unchanged. All four processes exited normally and removed their
own temporary profiles. No system runtime or sandbox policy was replaced.

## Identity and records

Every diagnostic line is bound by kernel SCM_CREDENTIALS + SCM_PIDFD to its
live, captured WebProcess generation, exact executable and WebKit/JSC mapped
files. The ancestry passes through two bwrap processes to the owned renderer
and original guardian. All four WebProcesses have NoNewPrivs=1, Seccomp=2,
CapEff=0. UI maps cannot satisfy this test.

| Case | WebProcess PID / birth | pidfd identity | Records | PDF pages / words | Maximum coordinate delta |
|---|---|---|---:|---:|---:|
| baseline-baseline | 41858 / 57466 | 6:42325 | 177 | 8 / 693 | 0 pt |
| baseline-short-edge | 41944 / 57787 | 6:39529 | 187 | 5 / 486 | 0 pt |
| baseline-long-room | 42033 / 57950 | 6:39564 | 163 | 7 / 540 | 0 pt |
| baseline-short-room | 42122 / 58163 | 6:39598 | 121 | 4 / 333 | 0 pt |

The offline recheck independently verifies every line hash and sender,
sequences/final pages, exact ordered PDF words and coordinates against the
preserved stock controls. All coordinates are exactly equal, stricter than
the unchanged 0.5-point acceptance threshold. Window probes initially returned
not-found (35/4/4/5 records), then captured the owned window; there are no
collector errors outside window probing. These transient records are retained,
not omitted. Threads stopped and raw record streams are complete.

The new collection path resolves the missing-identity gate without changing
the engine, sleep duration, ancestry or acceptance rules. The old run still
cannot reveal which synchronous hash/X-tool call consumed its sampling window;
this is a demonstrated collection repair, not a retrospective timing proof.

## Pagination evidence and source interpretation

All five original source-lock hashes were verified before reading the attached
`matched-source-excerpts.txt`. The following is limited to the observed path:

* Baseline heading has `break-after: avoid` (`after=1`). At seq 22–25,
  `applyAfterBreak` returns 31 unchanged, with 11.3125 layout units remaining.
  Its matched source only implements forced `alwaysPageBreak` / column breaks;
  an unchanged return there does **not** prove an already-computed keep was lost.
* The table's recursive relayout is observed at seq 33–36. No positive strut
  reset is recorded inside that call. Heading and table selected struts are 0.
* The wrapper is `break-inside: avoid`, with height 3006.046875 against page
  height 937. Its adjustment at seq 52–59 selects strut 0 and returns 873.25
  unchanged. `adjustForUnsplittableChild` explicitly returns unchanged when an
  unsplittable child exceeds a uniform page. This explains why whole-wrapper
  avoidance cannot keep a long table together.
* In the short-edge control the wrapper height is 202.4375. Seq 58–60 selects
  and consumes 42.3125, moving 873.25 → 915.5625, followed by normal relayout.
  Heading, header and first row all end on page 2. Both roomy controls put them
  on page 1. This is a real contrast, not a CSS or row-count adjustment.
* Baseline final heading is on page 1, header and first row on page 2. The
  long table lacks repeated header identity on pages 3–5; roomy-long lacks it
  on pages 2–4. Both original product failures remain recorded.

The observed/source evidence supports missing effective sibling keep handling
on this legacy print path plus the whole-wrapper over-height limit. It does
**not** support the narrower hypothesis that a positive keep strut was created
and then discarded by the table recursion. There may be uninstrumented paths;
no claim is made that all WebKit fragmentation engines lack this feature.

A behavior patch would need a bounded first-fragment keep calculation (heading,
header and first row) at the actual sibling/table pagination boundary, allowing
the remainder to fragment, plus separate repeated-header handling. This report
does not implement or approve such an algorithm. It must preserve short/long,
oversized first-row, margins, forced breaks, content, semantics and repeated
headers before another native test is justified. No new CI was dispatched.

## Preserved evidence and remaining limits

* [Native artifact 14199118814](https://github.com/Auto-Plugin/milkup/actions/runs/43808221193/artifacts/14199118814): original ZIP 11,774,654 bytes,
  SHA-256 `ad0c7ca107256ab7f49f0e57936d12dea1207591ffa5b4b356df27c6c3d0da7a`.
* [Build artifact 14199811355](https://github.com/Auto-Plugin/milkup/actions/runs/43808221193/artifacts/14199811355): original ZIP 3,928,381 bytes,
  SHA-256 `01a6ed97d2c7c832712dcc1109952ea66c8e606d8c686de30edb73fae28ddec7`.
* Both original ZIPs, summary, exact native report and cache receipts are kept
  here in the research branch. They contain synthetic fixtures/CI diagnostics,
  no user documents, private keys or runtime libraries. The prior failed ZIPs
  remain in the sibling 43794564331 directory.

No further infrastructure blocker was encountered in this run. The original
Linux PDF product failures, maintained runtime delivery, and other release
gates remain open. A private research prefix is not a distributable product or
proof of production compatibility. No main merge, release, notification,
production configuration or security setting changed.
