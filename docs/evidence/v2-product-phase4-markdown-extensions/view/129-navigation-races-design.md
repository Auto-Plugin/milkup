# Controlled navigation races: red evidence and proposed design

No product modification yet. Five tests were added to the existing matched browser spec. `127` is only a runner startup error, not a regression failure. `128` contains five real assertion failures, each preceded by geometry/state JSON and a real screenshot. `129-navigation-races-summary.json` collects their raw observations. UI is released; ports 1420/5174 have no listeners.

## A: pointer activation across replacement

All three cases (ordinary provider response, windowed provider response, windowed source replacement) show the same trusted browser sequence: pointerdown/mousedown on button id2; native focus id2; replacement focuses id3; pointerup/mouseup hit id3; **no click event**. Navigation count remains zero, original button disconnected, source/version/selection unchanged. The observed down/up span is about 20–60ms, not a synthetic click. This proves a generic gesture-lifetime hole even though focus restoration works.

Existing tests use synchronous `.click()` or test focus before/after a refresh; neither covers a pointer held across replacement. The current red fixture explicitly waits for old-node detachment to enforce the failure timing. In a fixed test this must change to waiting for the controlled refresh/read to settle, recording identities rather than requiring detachment, because preserving the original node is a legitimate solution.

### Proposed minimum cohesive implementation (needs parent approval)

Prefer preserving the browser's gesture rather than synthesizing navigation or executing on pointerdown. Track an internal primary-reference pointer gesture in DocumentPresentation, tied to the actual button, pointer id, source identity/version/selection and config. Defer only same-document background presentation replacement while that gesture is active. Release deferred work after pointerup's native click dispatch, or cancel on pointercancel, blur, Escape/editing/pointer abandonment, configuration removal, source/version/selection invalidation, or destroy. This must not hold stale work across a document switch or suppress user edits. Pending provider results still require the existing validity checks after the wait; do not install a new cache request before preserving the old button's click closure.

Provider paint deferral alone is insufficient: SourceDocumentView can rebuild content using the same cached presentation. A narrowly scoped internal wait before applying a completed Source window is also needed, followed by the existing source/version/editRevision/request-id checks. This avoids changing the synchronous updateContent contract or partially updating source-window metadata while deferring its DOM callback. No public core/SDK API is necessary. Hard invalidation must clear the wait immediately; no timeout or renderer-budget increase.

This is slightly larger than a one-line fix but covers both proven routes. Alternatives that dispatch a synthetic click, invoke navigation on pointerdown, or restore focus after replacement do not preserve native cancel/release semantics and are not recommended. A DOM diff retaining live nodes could also work but is substantially broader than the controlled replacement gate.

Necessary guards: normal pointer click and keyboard activation once; release outside the original button does not navigate; modifier/secondary pointer not intercepted; config disable/document replacement/edit invalidation releases pending work without stale navigation; later external focus is not stolen. Tests should not require a specific node-retention strategy.

## B: missing target after a newer window wins

Both source and live controlled sources hold the line-50 target read, apply a newer window 199..208, then complete the older read. The target render is discarded by request id. `revealSelection` resolves with no error, target line absent, selection still 0 rather than target offset628. Text/version remain unchanged.

### Proposed minimum implementation (needs parent approval)

When the target line is absent after the awaited targeted render and current-source checks, reject with AbortError instead of silently returning. A newer viewport request should not be overwritten by an unbounded retry, and navigation must not report success without selection. The host already catches navigation rejection. Preserve source/version/signal/navigation guards; do not force the user back to an obsolete target or widen the render range. A successful non-raced reveal still selects exactly once; a superseding reveal remains cancellation. If UX later requires reattempting navigation after internal layout-only contention, that needs an explicit ownership distinction rather than a blanket retry.

## Limits

These tests prove independent reproducible boundaries. Candidate09 formal pointer timing did not record down/up or target node ids; its nearest renderer result preceded the pointer by ~433ms. The native observer failed before reaching the return click. Therefore neither controlled failure is labeled the root cause of that native acceptance failure. Native remote-preparation and frontend matrix acceptance remain separate outstanding work.
