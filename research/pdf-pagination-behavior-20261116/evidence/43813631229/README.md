# Native first-fragment/header improvement; Letter terminal page still fails

Run [43813631229](https://github.com/Auto-Plugin/milkup/actions/runs/43813631229)
tested **7a218c4cac16b9b8ba1e92cd42b8b1e47eb62402**. It was the single explicitly
authorized follow-up to 43811419661; no automatic retry was dispatched.
Repository queued/in-progress checks were empty before dispatch.

The behavior patch remained
`660f13b8e61ed2e6af4a1bec7602e08755b4deb685e4af9d6c639053286f210f`.
It keeps the laid-out heading/header/first-row prefix, not the entire table,
and separately reserves continuation-header space before painting that header.
The old first-fragment and repeated-header failures remain retained in
43808221193. No application HTML, output engine, guard, sandbox or installed
package bytes were substituted.

## Actual execution

- Exact observation object artifact **14199955883** restored and first-call
  hits proved. Three changed source files covered two actual unified compiler
  commands; those and the final engine build passed.
- Reconstruction: **451.327 seconds, 3,235 hits, 28 misses, 3,263 object targets**.
  This matches the prior 28-miss scale, below unchanged 2,400-second/160-miss
  limits; no cold fallback or expanded budget.
- The corrected seven-field schema passed the real synthetic transfer test and
  saved the full compiler-object bundle. The receipt explicitly retains
  `behaviorInputs`, with its distinct key; no identity was dropped.
- Original beta.10 `58c78973101a` package installed, helper/guard hashes checked,
  native PDF batch executed for 12.127 seconds, and test package removed.
- Every one of the six executed cases has a held kernel pidfd-bound WebProcess,
  exact private mapped libraries, bwrap ancestry, UID 1001, NoNewPrivs=1,
  Seccomp=2 and effective capabilities=0. All log lines bind to that same
  process generation. All guardians exited 0 and removed their private data.
  The native report's runtime-manifest SHA matches the build receipt exactly.

Exact package SHA-256:
`9e71e2b6f6c5cd030f7307d35679ded1d4f5605127d77320db1d455d90c1ddde`.
Binary: `42394c4bdcaeea078c7d553acbe6edc7a75f13b16ce5b70cba2d0a3a02176ed6`.
Guard: `296131695cb15814252edd02e76e111fef293b7585c4e7597101d8ec05b852fa`.
Private WebKit library: `a0215323234293fc00406881c568179b7cde8732d38803c1e2ec1e50c2636461`.
All other runtime hashes and paths are in `pagination-continuation.json`.
The installed original package is unchanged; this private runtime is research,
not a production/default-runtime acceptance result.

## Independent PDF results

| Case | PDF pages | Heading / first row | Header on every table-data page | Result |
|---|---:|---|---|---|
| A4 portrait, original long/tight | 8 | both page 2 | pages 2–5 | targeted contract passed |
| A4 portrait, short/tight | 5 | both page 2 | page 2 | targeted contract passed |
| A4 portrait, long/roomy | 7 | both page 1 | pages 1–4 | targeted contract passed |
| A4 portrait, short/roomy | 4 | both page 1 | page 1 | targeted contract passed |
| A4 landscape, original long | 12 | both page 2 | pages 2–7 | targeted contract passed |
| Letter portrait, original long | 9 | both page 2 | pages 2–5 | **failed: blank page 9** |
| Letter landscape | — | — | — | **not executed after first failure** |

The original A4 long case changes from heading page 1 / first row page 2 to
both page 2. Its real layout trace consumes **42.3125 CSS pixels** and returns
wrapper top **915.5625** from **873.25**. There is no observed positive strut
reset in recursive table layout; that old hypothesis is not revived.

The tight and roomy short controls preserve every ordered word and coordinate
exactly (486 / 333 words, max delta 0). All executed long cases retain all 72
table rows, 100 code lines and 18 prelude paragraphs (roomy has its original one
paragraph). Existing uniqueness, row order/alignment, no out-of-page words and
172 repeated body/code raster guards pass. Offline independent header review
also passes for Letter portrait despite the earlier blank-page assertion.
Each header label's ink width/height is identical across its repetitions at
144 dpi; these are bounded literal controls, not arbitrary glyph fidelity.

## Earliest remaining failure, investigated without changing output

`letter-portrait: page 9: blank page` is genuine. Page 9 is 612×792 pt, has no
text, images or non-white pixels, and one white fill. Its raw content is retained
in `letter-blank-tail.json`: the final document background paints an **11 CSS
pixel** tail starting at y=7000, after eight 875-CSS-pixel page intervals.
The final visible `LINKDIAGNOSTIC` text remains on page 8; no source marker is
lost or duplicated.

Matched source `PrintContext::computePageRectsWithPageSizeInternal` computes
page count from `ceil(documentRect.height / pageLogicalHeight)`.
`RenderView::documentRect` comes from snapped layout overflow. Block-flow code
clamps before-margin crossing at a page edge, while after-side handling can add
or propagate a trailing margin. These facts narrow the next check to final
document/root/body/last-paragraph geometry and its after-margin/overflow origin.
They **do not prove** that this particular 11-pixel tail is caused by the final
margin. Those boxes were not among the six recorded table roles. Nor is there
a matching unpatched Letter-portrait PDF, so this report does not call it a
newly introduced regression.

No terminal-page deletion, PDF rewriting, CSS workaround, blank-page exemption
or speculative after-margin behavior patch was made. A discriminating next
diagnostic would record those actual final print-layout bounds and after-side
margin propagation, then distinguish intended forced blank pages, content
overflow and margin-only overflow. The existing accepted A4 controls and
unaltered thresholds must remain. No additional CI was started for this.

## Retention and continuation boundary

- Native artifact **14201668983**, 13,964,376 bytes, SHA-256
  `2f08324abdedb9107c9ab0d7d5a23727b31eac5b6d2871ae55ae289e5dc3d3fa`.
- Build artifact **14202132525**, 5,171,734 bytes, SHA-256
  `56d7b02d715f051b9396923eee5066a2414945d8bd0412cdade7a248adab4cf9`.
  Both unchanged ZIPs are retained here with raw PDFs/logs and receipts.
- New object artifact **14202401300**, 557,628,995 ZIP bytes; GitHub digest
  `2d328c377e7f1a4e0e3d8423e703eca8bf1845594aa130cd904777d055428cf7`.
  Snapshot entries total 560,387,511 bytes; no runtime/user data.
  Key: `pagination-behavior-objects-v1-924d5a56949e2a3af945cb8e9b608dd1c248c226e867436b1ce65ee3415595c9`.
  It expires **2026-11-23 06:12:30 UTC**. It was not downloaded to the small local
  workspace. Cross-job restore of this new seven-field bundle is **not yet
  proved**; a future restore must match behavior inputs after applying the exact
  patch, not pass it to the old six-field pre-mutation restore step.

Remaining release gates are unchanged: Letter terminal page and unexecuted
orientation/oversized/forced-break/margin edge cases; complex table semantics;
Chinese source-to-Unicode fidelity (still false here), URI annotations (none),
and a maintainable supported distribution/security-update delivery path. ASCII
search and the retained intentional radicals do not replace the failed Chinese
contract. No private-prefix result, different build or earlier platform pass is
combined into a release claim. No main merge, publication, production config,
system library replacement, sandbox/security or notification change occurred.
