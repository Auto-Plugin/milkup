# Shipping boundary after the combined research gate

This is local review preparation, not a package, permission to distribute, or a
claim that a distro has accepted the fixes. It does not change the original
native PDF/print path, product feature promises or fidelity contracts.

The experiment's source is pinned by `source-receipt.json`. It deliberately
includes diagnostics and a same-runtime negative control, which must not be
mistaken for a production patch set:

- Scalar/independent-digit source transport is the historical implementation,
  including bounded complete-run/independent-cluster/LTR guards. Keep all
  ligature/composition/reordering/partial-span and glyph-collision negatives.
  `MILKUP_DIGIT_NOMINAL_ONLY` and source/glyph logging are research-only.
- URI fragment regions and the Skia annotation backend are combined. The
  retained per-call dedup is inside `MilkupPrintResearch::focus`, gated by
  synthetic title/IDs and explicit environment flags. Thus passing geometry
  would prove this candidate algorithm for those cases, not an already shipped
  general dedup implementation. A production extraction must put the reviewed
  per-call operation at the actual annotation collection boundary, retain
  legitimate same-URI fragments/pages and be revalidated without fixture gates.
- Heading/first-fragment keep, repeated headers and root trailing-margin
  behavior must be rebased onto the exact maintained source without the
  pagination/tail/paint observers. Their patch preimages currently contain
  research observation code. Removing observers requires an explicit reviewed
  source composition and behavioral equivalence gate, not fuzzy patching.
- The universal page envelope and all source/layout logs remain test-only.
  The generated collision font belongs only to isolated QA XDG directories.
  The original product CSP/guard/sandbox is not a switch for the test to disable.

## Preferred route: maintained distro backport

Prepare separate minimal code and upstream-style regressions for source-text
transport, URI fragments/annotation and legacy print pagination. Keep the
combined native gate as integration evidence. Nothing is sent externally in
this task. Acceptance by an upstream/distribution maintainer, availability in
the supported distro package, and its normal authenticated security-update
path remain external conditions, not facts established by this experiment.

Once a suitable maintained package exists, test the same original installed
application/guard and all combined contracts with ordinary system loading:
no private prefix, loader override or library substitution. Bind the exact
distro package/build IDs and actual child mappings; repeat on a subsequent
security update to show the fixes are retained. A higher version number alone
cannot substitute for this evidence.

## Alternative only if supportable: application-private runtime

This would be a separately reviewed delivery project, not copying the current
research prefix into an installer. It must keep the same WebKit native PDF and
print implementation, with no system library replacement or relaxed sandbox.
Before adoption it needs:

- an accountable maintenance process tracking supported WebKit security
  releases, rebasing the small patch set and rerunning the combined gate; no
  indefinitely frozen 2.52.6 fork;
- authenticated source/build provenance, dependency inventory/SBOM and source
  notices, reproducible build comparison and an exact supported OS/ABI matrix;
- an immutable, installation-owned versioned location, coordinated WebKit /
  JavaScriptCore / WebProcess resources and helpers, and checks against mixed
  or substituted family members while keeping normal sandbox launch behavior;
- normal trusted package installation/update, failure preserving the previous
  usable version and documents, and explicit tested recovery semantics. Do not
  label prepared manual recovery as automatic rollback;
- installed-product tests of the actual delivery build, not an LD_LIBRARY_PATH
  research run, including the unchanged export/print entry, user documents,
  normal shutdown and actual supported update behavior.

No runtime bundling, loader change, release signing key/channel, elevated
installation action or external issue/PR is introduced by this document. The
current bounded CI can establish combined mechanism evidence only. Manual
viewer clipboard/clicks, internal PDF targets, full complex-script fidelity,
physical printing and other existing release gates stay explicit until tested.
