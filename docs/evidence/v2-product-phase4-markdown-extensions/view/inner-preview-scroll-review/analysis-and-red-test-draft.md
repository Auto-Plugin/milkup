# Candidate10 reachability02: read-only mechanism review and regression draft

Status: no product/test changes, no tests or UI run. This is a test design, not a reproduced browser failure. Formal reachability02 remains failed.

## Recorded facts and limits

`native/candidate10-reachability02-summary.json` reports failure reaching the windowed/light flow bottom after the unchanged budget of 30 real wheel notches. Document selection 162..173, version 0, saved version 0, dirty false. Editor client viewport approximately y37..229 CSS px. The final flow preview is y92.148..261.148, clientHeight169/scrollHeight303; its SVG is y100.547..386.547. The lower vector edge is outside both intersected client viewports. The recorded failure DOM does not include preview scrollTop or stable node identity; the runner's per-notch `steps` local was not persisted on failure. Blank X11 pixels despite SVG DOM geometry may involve a distinct WebKit painting issue. No evidence yet establishes a single cause.

## Exact existing code paths

- `source-document-view.ts:220–232`: non-capturing editor root scroll handler invokes `renderVisibleWindow` unless the dedicated `scrollToLine` anchor suppresses it. A normal descendant scroll does not bubble into this listener; inner wheel alone is not proof of an outer render. Wheel chaining, outer anchor adjustment or another outer scroll can invoke it.
- `source-document-view.ts:760–820`: source window rendering keeps source/version/edit-revision/request ordering guards; there is no equal-window DOM reuse short circuit after a successful read.
- `source-document-view.ts:829–856`: saves code-line `scrollLeft`, then replaces all content children, republishes window metadata, and restores code-line horizontal offsets. It does not save presentation span offsets.
- `document-presentation.ts:834–902`: `updateContent` saves source reading anchor and semantic focus, updates source DOM, then synchronously reapplies eligible cached output. It never captures preview `scrollTop`/`scrollLeft`.
- `document-presentation.ts:1028–1044`: paint skips only the same response, selection and exact line-node identities. Replacing source lines defeats this skip; paint restores source before constructing previews again.
- `document-presentation.ts:1104–1118,1152–1170`: fresh preview spans have `overflow:auto`, bounded height and newly appended vector children. No old inner offset is copied. Their initial inner offsets are therefore zero.
- `document-presentation.ts:699–707`: a new valid provider response also paints fresh output; same document/range alone does not preserve old spans. This can affect ordinary views too, independently of Source replacement.
- `document-presentation.ts:988–990,922–950`: existing scroll restoration affects only root scrollTop; focus restoration uses preventScroll. Neither restores inner scroll.

Thus there is a deterministic code-level loss path for a reader's inner offset when an otherwise valid preview is rebuilt. Whether that path caused the native 30-notch failure remains unproven until an inner-offset/nonzero → detach/replacement → zero sequence is observed.

## Minimal red test A: source replacement and equivalent provider refresh

Add inside the existing `[false,true]` loop in `src/__tests__/document-presentation.test.ts`, reusing `make`, `provider`, `settle`, and view cleanup. Use a valid block vector 900×900 with an upper label and a lower/right label (not math). Keep source text, current selection and document identity/version fixed.

1. Obtain the preview and set reader offsets to top120/left90. In jsdom this is a state-continuity unit assertion only, not proof of physical reachability.
2. Record text, version, selection, activeElement; leave focus on an external button to ensure no restoration steals it.
3. Windowed: call public `view.renderVisibleWindow()` on the currently rendered window; ordinary: call public `view.refreshDocumentPresentation()` with an equivalent provider response and await its completion.
4. Re-query the preview (do not assert replacement is required). Expect top120/left90; unchanged source/version/selection and external focus. This describes reader continuity, independent of node reuse vs state transfer.
5. In a distinct case for both view types, force a same-content provider refresh. It covers the shared paint path without assuming a source-window replacement.

Do not count an invalid vector schema, missing preview or fixture setup failure as the product red. Provider must return correct request source/from/to and the original helper's trusted declaration.

## Minimal real-browser red B: reader-visible target continuity

Extend the existing controlled view fixtures in `tests/e2e/desktop-markdown-extensions.spec.ts`, normal and windowed, narrow viewport with existing production preview CSS. Use a valid large vector with labeled bottom/right target and no plugin workers.

1. Scroll using actual `page.mouse.wheel` while pointer hit-tests inside the preview. Wait for two stable geometry observations. Record scrollTop/Left, SVG/target rect, preview/client/editor intersection and text/version/selection.
2. Reveal the lower target and horizontal label using bounded wheel input, then trigger the supported same-source refresh from A. For Source also trigger a small outer scroll while the same range remains loaded, proving a real root-scroll-to-replacement path separately from direct render invocation.
3. After the asynchronous render settles, assert the same target stays inside the visible intersection (and offsets stay within 1 CSS px when geometry is unchanged), without a second corrective wheel. Source bytes/history/selection and external focus remain unchanged. Record node identity, never require it to change.
4. Native-like chained wheel scenario remains a separate integration probe; never substitute this controlled path for the native failure cause.

## Guard cases

- Different document identity with identical text/range must start with fresh offsets.
- Version-changing source edit at the same range must not inherit stale offsets; undo/re-enter likewise must not revive stale view state accidentally.
- Replace/disable the presentation config, change source/live mode, or destroy: no old scroll state is resurrected.
- Fragment range change/removal: do not apply offsets to a neighboring/new fragment.
- Same valid fragment with smaller new dimensions: normal browser clamp is allowed; no forced outer scroll to recover an obsolete inner position.
- A preview that merely remains mounted keeps native scrolling unchanged; no extra async queue or retention of detached nodes is required by the tests.

## Passive native trace fields needed

Capture before each notch and on capture-phase descendant scroll + MutationObserver delivery: wall/performance time, preview WeakMap identity/connected, range/layout, inner scrollTop/Left/client/scroll dimensions, root scrollTop/Left, source-window fromLine/toLine, SVG and intersection rects, exact wheel hit node, selection/version, provider response/request timestamp. Record identity and inner offset before/after every source replacement. Preserve this bounded trace on assertion failure. This separates (1) actual offset reset, (2) wheel routed/chained elsewhere, (3) successful DOM scrolling with blank compositor pixels.
