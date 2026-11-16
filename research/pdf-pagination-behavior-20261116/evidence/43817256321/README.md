# Exact stock Letter controls — 43817256321

Run: https://github.com/Auto-Plugin/milkup/actions/runs/43817256321
Tested harness: `f9b48c1f1661302c21605e1b9d7572fd9e38956e`.
Completed 2026-11-16 06:32:33 UTC. Native batch 12.685 s. Workflow correctly
failed the original pagination contracts; **all three diagnostic cases ran**.
No application or engine build, cache restore, private runtime, or output rewrite.

| Stock case | Pages | Blank pages | Original content gate | Repeated headers |
|---|---:|---|---|---|
| A4 portrait | 8 | none | original orphan heading reproduced | absent pages 3–5 |
| Letter portrait | 8 | none | passed | absent pages 3–5 |
| Letter landscape | 11 | none | passed | absent pages 3–7 |

A4 matches the retained original eight pages and all **693** words, order and
four coordinates exactly (zero difference). Each case retains 18 prelude,
72 table and 100 code rows, expected ordering and independent raster clipping
checks. This does not erase Unicode/URI limitations or make stock acceptable.

A4 and Letter portrait HTML are byte-identical to the corresponding inputs in
43813631229, including the same IDs/title. Paper settings are the existing
native and CSS matching declarations; GTK's original 12 mm and actual
1024×768 owned output window are unchanged. Original deb SHA-256:
`9e71e2b6f6c5cd030f7307d35679ded1d4f5605127d77320db1d455d90c1ddde`.
Binary and embedded guard identities are in `stock-controls.json`. All three
actual WebProcesses have held pidfd+birth ancestry, mapped official library
inode/hash evidence, UID 1001, NoNewPrivs=1, Seccomp=2, CapEff=0, normal guardian
exit 0 and removed private directories. Stock has no layout records; the
collector truthfully records `live-stock-webprocess-bound`, not instrumented
kernel-sender attribution. Owned package removal passed.

The candidate's Letter portrait ninth blank page is **not present in this
matched stock control**. Stock body/background ends at CSS y=6803; candidate
ends at y=7011. Final link underline is at y=6782 vs y=6990: a 208 CSS-pixel
shift, while the background extends 20 px beyond the underline bottom in both.
Candidate crosses the eighth-page boundary y=7000 by 11 px. This establishes
an output difference and a useful margin/overflow hypothesis, **not** the cause
of the extra height. Actual final root/body/last-block margin and overflow
records are still needed before changing behavior. Letter landscape candidate
remains untested; no inference from its stock control is a candidate pass.

Raw ZIP artifact 14202767701 is retained unchanged as `original.zip`:
11,731,016 bytes, SHA-256
`e80e9a3cb5975dc1b2c1bae427589f24fc7bcfdc9ffa1e605acd9217d586c324`.
All entry CRCs checked before extraction; original PDF, HTML, native results,
process maps/identity, audits, reference artifacts and dependency logs remain
inside. GitHub copy expires 2026-11-23 06:32:28 UTC; this committed copy does
not depend on that expiration. `offline-summary.json` retains per-case bounds.
No personal/user document data is involved.
