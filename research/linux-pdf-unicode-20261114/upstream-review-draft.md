# Local review draft: source-aware Skia PDF text and URI metadata

**Not sent upstream or to a distribution. Not a production dependency proposal
already accepted.** Engine source is WebKitGTK 2.52.6 from Ubuntu package
2.52.6-0ubuntu0.26.04.1; no system runtime was replaced.

## Reviewable issues and narrow approach

1. Glyph cmap reversal loses original Unicode when an ordinary Chinese
   character and an intentional radical share a glyph. Source text must stay
   associated with actual shaped glyph clusters through local display lists
   to Skia text blobs. Never normalize one into the other or replace extracted
   PDF text afterward.
2. Latin-context Noto CJK digits can undergo `locl`: nominal IDs 17–26 become
   uncoded IDs 63153–63162. The initial unchanged-nominal research bridge rejects
   them and Skia emits U+0000. A narrow internal helper now permits valid ASCII
   digits only when the entire LTR horizontal TextRun has complete independent
   scalar/glyph coverage. Partial selections, missing/repeated/reordered
   clusters, ligatures, composition and arbitrary non-digit substitutions keep
   the prior protections. Actual glyphs, advances, font and layout are unchanged.
3. Skia already has a per-occurrence ActualText fallback when two source
   characters conflict for one glyph mapping. Native synthetic `1212` proves
   this path without overwriting the first source value.
4. URI support is a separate GraphicsContextSkia annotation path. Exact
   per-collection duplicate focus rectangles caused one duplicate annotation;
   the research dedup is local, not per-URL/global. Actual ancestor clip
   arguments are snapped before painting; screen boxes/word boxes are not an
   adequate annotation oracle. Independent print/paint evidence is retained.

Relevant research inputs live beside this document and under
`research/linux-pdf-links-20261114`. Original artifacts and precise candidate
commits, compiler arguments, font hashes and PDFs are recorded in the result
documents. Corrected same-runtime Noto A/B passed in run 43672149274 on
`ec539706`, with all ten PDF mappings changing from U+0000 to U+0030–0039 and
identical page pixels. Its seven private runtime file hashes match 43670757867.
The earlier failed run remains failed; successful sub-gates are not a rewrite
of that result. See `result-43672149274.md` for the exact scope.

## Prerequisites before an upstream submission

- Strip fixture/environment instrumentation and isolate a production-quality
  source metadata API, including ownership and backend/platform guards.
- Obtain upstream review of display-list behavior, unsupported remote IPC,
  text effects, partial runs and glyph provenance. Research coverage deliberately
  does not establish general ligature/combining/bidi/Indic extraction fidelity.
- Add upstream rendering/PDF regression cases for original Chinese/radical
  aliases, ten Latin-context digits, one glyph with distinct Unicode sources,
  malformed/partial/reordered clusters, negative no-link pages, multi-page
  links, adjacent links and clips. Preserve actual font licensing/provenance.
- Maintain conventional WebKit/Skia source style, platform build coverage and
  security review; do not upstream fixture-specific environment switches.

## Distribution and security-update path

Preferred: upstream fix, then distribution-reviewed backport to its supported
WebKitGTK package. Milkup should keep consuming the system package and inherit
its normal security updates. Validate each supported distro version; a source
version string alone cannot prove the patch is included.

An independently bundled fork would require continuous WebKit security update
tracking/rebuilds, ABI/dependency and sandbox-helper maintenance, redistribution
review and a signed update lifecycle. Those obligations are not implemented by
a successful private prefix. Do not ship this research prefix or silently pin
an obsolete distro library. No production channel/key or package dependency is
changed here.

## Prepared normal-system-runtime acceptance entry

Once a supported distro package containing the reviewed fixes is independently
available in an isolated ordinary-user GUI test environment, this repository
provides the following explicit entry (not automatically dispatched):

```bash
python3 scripts/ci/run-webkit-link-probe.py baseline /tmp/milkup-system-pdf-proof --system-acceptance
```

Use a new output directory. Prerequisites are the normal GTK/WebKit development
packages, compiler, Xvfb/DBus, Poppler, Python pypdf/fonttools and Noto/DejaVu
fonts already provisioned by the test environment. The entry installs nothing,
rejects a private prefix and LD_PRELOAD, removes library overrides, uses an
ephemeral profile and enabled sandbox, and requires host plus owned WebProcess
mappings under `/usr/lib`. It records package versions and library/PDF hashes.
It requires original Chinese/radical source, exact WRAP tokens/pages, URI/page
sets, a no-link negative and corrected digit/collision source extraction.

This entry is prepared and locally negative-tested; it has **not** been run
against a fixed normal distro runtime. It is a text/URI smoke gate, not a claim
that independent link geometry, the installed Milkup application, GUI clipboard,
complex-text fidelity, physical printing or production delivery has passed.
It must be followed by those relevant native candidate checks after a supported
system runtime is available. It does not use the old deliberately-failing
baseline assertion as an acceptance criterion.
