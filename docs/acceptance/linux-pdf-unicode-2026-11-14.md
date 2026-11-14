# Linux PDF original Unicode and radical counterexamples — 2026-11-14

**Status: still failed; no production repair claimed.**

The unchanged b877 source-equivalent DEB was reused on Ubuntu 26.04.1 as uid 1001,
with default sandbox policy and system WebKitGTK 2.52.6. Tested harness commit:
`940d4a039c6f40705ed8dff96b4acbe636ea3e2c`.
[Run 43560107745](https://github.com/Auto-Plugin/milkup/actions/runs/43560107745)
finished with the expected exact-Unicode failures, not a build/prerequisite failure.

Package SHA-256:
`4941f3a1ab85b7c7ed1d96edf4807c388a7c883240a2aa32ee13c062661fc813`.
This is the new exact-source rebuild from run 43558261633, not the separately
preserved original b877 DEB.

| Check | Actual result |
| --- | --- |
| Open / edit-save / reopen | Passed, 2331 / 1257 / 1252 ms |
| Normal closes | Passed, 108 / 156 ms; no force |
| A4 portrait | 6 pages, 595 × 842 pt; all 100 BODY markers in order |
| Letter landscape | 8 pages, 792 × 612 pt; all 100 BODY markers in order |
| Original + intentional radical, same font | Failed both papers: `文⽂` → `⽂⽂`, similarly 风/⻛, 又/⼜, 月/⽉ |
| Bold / NotoColorEmoji fallback | Failed both papers; emoji survives, original CJK characters alias to radicals |
| Long line / later page / link label | Failed both papers; no Unicode normalization was allowed |
| Clickable hyperlink | Baseline PDFs contain zero link annotations; not passed |
| Source file integrity | Saved expected SHA unchanged after export |

The native PDFs contain identical adjacent codes under the same font for each
original/radical pair. This proves a whole-font ToUnicode remap cannot distinguish
those occurrences. Global replacement negative controls fail against the original
fixture; no replacement is applied to actual PDFs.

[Evidence manifest](./linux-pdf-unicode-2026-11-14/43560107745/retained-evidence.json)
retains the exact source, expected Unicode, raw reports, both PDFs, text/font
extraction, adjacent-code proof and independent review. Full CI artifact
`14100245429` has 625,600 bytes, SHA-256
`57170a7d57ee8581e023640dac569a38746fb1aaa7db9c87b821302e16238ce6`, and expires
2026-11-21 05:10:58 UTC. The checked-in evidence subset and local full download are
separate from that expiry.

A [review-only WebKit source patch](../../research/linux-pdf-unicode-20261114/README.md)
now carries source characters through local glyph drawing/display-list/Skia paths
for a guarded one-scalar-per-glyph LTR subset. Its actual metadata implementation
passes compiled sanitizer tests and the upstream patch applies/reverses exactly.
**Full WebKit was not built; the patch was not loaded in this native run.** Remote
IPC, complex shaping and a reliable matched-runtime distribution remain open. No
system WebKit, security setting or application code was changed; no release was
published. Physical printing, PDF-viewer clipboard UI and general rich-content
fidelity are not covered by this result.
