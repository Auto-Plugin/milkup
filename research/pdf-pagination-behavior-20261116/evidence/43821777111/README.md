# Root trailing margin: native correction and retained counterexamples

Run [43821777111](https://github.com/Auto-Plugin/milkup/actions/runs/43821777111)
tested **0b886192967983a962f43dff3ecf7683f7c7cd95**, not a later evidence commit.
The only new behavior is `root-margin.patch`, SHA-256
`af26a4bce4633196c5e7fb7fcc7a8d1c161171cff5932f9ba3a0da657afe72c8`.
Original fragment/header behavior patch remains
`660f13b8e61ed2e6af4a1bec7602e08755b4deb685e4af9d6c639053286f210f`.
Read-only tail observation remains
`b8f8b952215bb0f7a626aeea9a9900c6bc43fd998b2770f6357119e2136d27f5`.

This is a targeted **research runtime** pagination pass on the exact installed
application helper and guard. It is not a default-distribution runtime pass,
combined Unicode/URI acceptance, or a production delivery claim.

## Baseline, cause, correction

Stock controls in [43817256321](../43817256321/README.md) used the exact original
package, guard, inputs, GTK 12mm margins and actual 1024x768 allocation. Stock
Letter portrait/landscape had 8/11 pages without blank tails, but lacked repeated
headers. Original A4 calibration reproduced all 693 words and coordinates.

[43818472547](../43818472547/README.md) established the new candidate's actual
Letter-portrait cause: last paragraph/body content ends at 6994.8125 CSS px.
The HTML root consumes a 16px collapsed trailing margin and becomes 7010.8125,
snapped document height 7011. RenderView adds zero. With 875px page height,
page nine is only an 11px white background segment. No explicit break or
child content/visual overflow requires that page.

The correction limits a positive trailing margin of the horizontal, paginated
printing document element to the remaining page space. It does not reduce
content height, alter the table-fragment behavior, rewrite a PDF, remove a page
after output, or suppress intentional forced breaks or actual visual content.
The existing original seven content/header/clipping contracts are unchanged.

Actual corrected root transition is **6994.8125 -> 7000**, consuming 5.1875px
instead of 16px. Final documentRect is `[0,0,651,7000]`. Native PDF has eight
Letter portrait pages. All original words, ordering and their coordinates on
those pages are exactly unchanged from the previous nine-page candidate.

## Native cases

| Original case | Pages | Content/orphan/clipping | Repeated table headers |
|---|---:|---|---|
| A4 portrait, tight long table | 8 | pass | pass |
| A4 portrait, tight short table | 5 | pass | pass |
| A4 portrait, roomy long table | 7 | pass | pass |
| A4 portrait, roomy short table | 4 | pass | pass |
| A4 landscape | 12 | pass | pass |
| Letter portrait | 8 (previously 9) | pass | pass |
| Letter landscape | 11 | pass | pass |

All seven input hashes, package, binary and guard hashes equal the preceding
observation run. The original heading/first-row and independent page-edge,
row-order/content contracts remain applied. Every PyMuPDF word record,
including coordinates, equals its prior page record; only the previous empty
Letter page is absent. `offline-summary.json` records the comparison. This is
additional evidence alongside the native Poppler-based content contract, not
a substitute for it.

Two separately labelled additions to the original short-room HTML test the
opposite behavior. They are not exceptions applied to the seven original cases:

- `forced-blank`: six pages, deliberate page five retained, marker on six;
  the empty page has zero non-white raster pixels.
- `real-overflow`: seven pages, 1900px gray box starts on five and end marker is
  on seven; the text-free sixth page retains **413695 non-white pixels**, over
  half its page raster. It is not mistaken for a removable blank page.

All nine cases completed in **23.884 seconds**. The native result is explicitly
`targeted-pagination-passed-not-product-acceptance`.

## Process, cache and budget evidence

All nine captures bind both layout record streams to the actual mapped
WebKitWebProcess using kernel sender credentials, held pidfd and process birth
identity, with exact private library paths/bytes and lineage to the owned
installed helper. Actual UID is 1001, CapEff 0, NoNewPrivs 1, Seccomp 2.
Every guardian exits 0, every test private directory is removed, and the
owned test package is uninstalled. System library hashes before/after match.
No sandbox or system runtime substitution occurred.

The proven six-field object bundle **14199955883** from **43808221193** was
restored with the existing source/compiler/flags identity and cross-process
first-hit proof. This does not claim restoration of a new seven-field bundle.
The original four-TU evidence was inherited after matching the exact source
gate; three actual unified object commands compiled the affected candidate
translation units. Full cached continuation completed in **697.434s**, with
**3234 hits / 29 misses**, within 2400s/160-miss limits. No cold fallback.

New seven-field object artifact **14206535194** is retained but **has not been
restored across jobs**. ZIP is 558074217 bytes, SHA-256
`dae97a3725f5a5ac5987f4f84988d3bde7e0d473be3d4d387b88016a0009d412`.
It contains bound compiler objects, not a runtime. Its expiry is
2026-11-23 07:31:34 UTC. Do not feed it to the six-field restoration flow.

## Original evidence retention

The following unchanged ZIPs are retained here, with byte length, SHA-256 and
ZIP CRC independently verified. Build ZIP was selectively extracted locally
because of disk constraints; its original bytes remain complete.

- Native artifact **14205463878**, 16348588 bytes, SHA-256
  `51617e8109a1e288227f300015d574d47d3b3d0a527a02d2a5f96e670bad9c8b`;
  expires 2026-11-23 07:32:38 UTC.
- Build artifact **14205598370**, 5356484 bytes, SHA-256
  `a82a93ad5b570137b4d65a11f5012c59b00959dcdd2a368398e6fa4674bd4b23`;
  expires 2026-11-23 07:32:40 UTC.

Original failed candidates and stock controls remain in their own evidence
directories; they have not been replaced by this result.

## Remaining release gates

This runtime still fails exact extraction of `中文春风又绿明月` and emits no URI
annotation for the diagnostic link. Intentional radicals and the ASCII WRAP
sequence in this fixture extract correctly; that does not replace the separate
Noto digit substitution discriminator or complex-text negative contracts.
Previously validated Unicode/digit/link research patches have not yet been
tested together with this pagination correction. `COMBINED-GATE-PREPARATION.md`
records their shared observer integration boundary. Native PDF/printing output
and original acceptance strength remain required.

A maintained distribution backport or equivalently accountable, securely
updateable isolated application runtime still needs a viable delivery and
supported installed-candidate validation path. No research prefix is added to
the product; no release, main merge, upstream posting, production update/key,
notification or safety configuration change was made.
