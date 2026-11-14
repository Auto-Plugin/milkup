# Installed trial 41713129442 visual verification plan

Status: reference preparation only. No new installed screenshots have been supplied; no visual or product acceptance is claimed.

Target candidate: `a5556beea5cdd1570361c528b2326bc0ad8ba0c4`.

## Grounded references

- Accepted source run `41703213523`, candidate `b139a9891a086685d7e0e9e85472a29a629f7a45`: 34 original PNGs, 17 per account. Each file SHA-256 and decoded RGBA hash was checked against its existing independent visual review. Paths, dimensions and hashes are in `reference-manifest.json`.
- Prior delivered beta.8 run `41668620695`: original wide/C4 review and original C4 PNG. Both old and corrected reference C4 PNGs were directly viewed at original resolution in this preparation.
- The corrected reference C4 remains 564×118. It differs from beta.8 by 374 pixels only, bounds `[280,38,333,57)`. Pixel `(331,45)` changes from white `[255,255,255,255]` to the expected blue outline `[120,168,216,255]`. This demonstrates the recorded tiny edge correction in this fixture, not a general guarantee for C4 layouts.

## Actual-run checks after download

1. Use only the two new account screenshot trees supplied by `installed_verification`; do not download or substitute older files. Retain all originals unchanged. Record each raw PNG SHA-256, decoded dimensions and RGBA SHA-256, and snapshot hashes again after review.
2. Expect seven diagram PNGs and ten window PNGs per account. Missing files or failed run scope remain explicit and cannot be counted as visual acceptance.
3. Compare each of the seven complete diagrams against the matching accepted source reference and across the two actual installed accounts. Compare complete RGBA buffers, not merely encoded PNG byte equality.
4. Compare whole windows and their body/status area `[0,36,1028,760)` separately. Title-bar work paths/account names may differ; do not call the whole window identical when only the body matches. Record difference count and exclusive bounds. Directly view every new/differing body, unexpected dimension or unexplained difference.
5. Directly inspect actual installed C4 and wide diagrams plus their actual UI windows. For C4, confirm the View left outline at the Presents backing remains restored and labels/connector remain readable. For wide, check all 16 nodes in the original PNG and the window's horizontal viewport/natural-size layout; a left-viewport screenshot alone does not establish user scrolling to the far right.
6. Check initial disabled source, enabled placement, edit/undo/redo/re-enable, invalid source fallback and final disabled source against the accepted fixture behavior. Do not rewrite `visualReviewAccepted` in the original report.
7. State conclusions only for captured light-theme/DPR-1 fixtures. No claims about full grammar/layout corpus, IME, all DPI, exports, upgrade/rollback or manual human sign-off.

The visual report will corroborate, but never replace, root's exact installer/content/hash and native/outer cleanup verification. In particular, matching PNGs cannot convert IPC 995, forced termination or cleanup uncertainty into a pass.
