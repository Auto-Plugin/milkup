# Generic scroll scheduler candidate — preparation only

No product implementation edited and no test/formatter/GUI executed. Existing product and test bytes were saved before adding tests in before-manifest.json. The seven test cases are RED targets, not observed RED results.

## Actual trace read

Source: milestone02/outline/runs/p7-candidate-m02-outline-dense-diag-01/{rpc-dom-trace.json,measurements.json}. The trace reports dropped=0 and pendingDropped=0. For wheel-burst-10-3, host-clock start=36139ms, last wheel=36216 (+77), driver triggerFinishedAt=36235 (+96), first range RPC=36598 (+459), old response=36608 (+469), old 160-row DOM=36643 (+504), storage requests/responses=36642..36672 (+503..533), requestUpdate/new render request=36674 (+535), new 374-row response=36683 (+544), actual 374-row DOM=36752 (+613), first target observation=36753 (+614), stable frames=[36752,36792,36816], done=36818 (+679). Requested range8902..9276; old DOM8920..9080; visible9078..9100. The old slice did not cover the visible bottom. RPC settlement therefore was not actual range completion.

The first-request delay is larger than subsequent storage/renderer phases in this observed sample. It does not prove that all459ms were the160ms timer: trace lacks each scroll event/timer reset and event-loop scheduling marks. Treat scheduler as a targeted hypothesis, preserve this sample and remeasure actual DOM completion after any change. No200ms outcome promised.

## Minimal implementation scope after observed RED

Only apps/desktop/src/desktop-plugin-ui.ts and its test file. No outline implementation, SDK API, ID-based behavior, Worker permissions, budgets, input fixture, or DOM reconciliation optimization in this candidate.

Near cache edge or outside actual slice: use a single next-frame-sized task (~16ms) from the first pending event. Later events update latest position/edge intent but do not postpone that task. Callback rereads the current list and metadata. Keep existing buffer/margin and pointer-drag protection. An inner-buffer event may create a cheap pending evaluation but must not issue render RPC. Do not retain160ms startup waiting for a near-edge request; do not emit one RPC per animation frame.

Keep two distinct mount-local records:

1. Latest user demand: document/version, list id, scheduling epoch, newest position and edge. A single scheduled callback and dirty latest value; no FIFO event backlog.
2. Requested buffer: same context plus from/to, visible interval at dispatch, edge request identity, and actual renderer-promise token. Retain buffer after RPC settles if response is an old slice; configureVirtualList must not overwrite this independent record with the old metadata. Do not claim completed until actual installed rows cover current viewport. The existing virtualViewport public snapshot may continue reflecting actual output, but the next explicit refresh must carry the applicable newest requested range, not silently re-request the old echo.

At most one scheduler-originated render RPC is in flight. New events whose visible interval remains within that requested buffer are coalesced even if old DOM is still shown. If the user moves beyond it, retain only latest demand and drain once the old promise settles at the next frame-sized opportunity (no extra160ms). Promise settlement releases only its own token; it neither satisfies DOM coverage nor erases a newer request. With no new demand, never poll/retry an unchanged buffer. A plugin requestUpdate is not blocked by this scheduler limiter: it must be able to publish prepared rows. A distant demand after a settled old echo can issue a new bounded request; do not wait forever for an old buffer to be realized.

All callbacks resolve the current attached list by the same public list id under the current mount; old captured Element closures must not discard the only queued latest demand after legitimate replacement. Remount/document/version/dispose invalidate old state. Keyboard Home/End/cross-slice navigation clears the scroll task/demand and remains immediate. Wheel still cancels an obsolete keyboard intent under existing rules. Preserve focus departure and render generation/sequence/version guards. Never restore focus merely because a scroll range completes. Existing programmatic scroll/follow semantics and one-time edge adjustment tests remain required; no new polling loop or feedback-derived user intent.

Initial count bound is semantic rather than a universal requests/second promise: one in-flight scroll renderer and one latest pending demand; zero duplicate request for a visible interval already covered by the currently requested buffer; zero autonomous retries after events stop. Continuous movement farther than the buffer may legitimately issue further sequential requests. Test specific400ms within-buffer gesture needs exactly one render; cross-buffer flight test needs exactly two, with the second equal to the latest range. Later native traces must include both request counts and actual DOM coverage duration.

## Added test targets (not run)

The new describe block is generic virtual scroll scheduling in desktop-plugin-ui.test.ts. Public fixture id is public-items and plugin is public-example; no production ID. Actual controller output mounts tree rows. fake timers advance complete timers/microtasks via advanceTimersByTimeAsync, not two guessed microtask flushes. jsdom geometry is an explicit280px viewport fixture, not native layout evidence.

- Sustained wheel/scroll every8ms: first near-edge render within32ms while gesture continues;50events/400ms remain inside returned overscan; exactly one request and actual mounted row count/range cover final viewport. Old trailing160ms is expected to fail, but that is not recorded as observed yet.
- Old-slice response forces actual old DOM replacement via revision change; repeated movements within already-requested buffer cause no duplicates despite old echo. Farther movement to600 must request440..770 within32ms; simulated plugin invalidate then publishes330real rows. One second without events cannot trigger autonomous requests.
- Deferred render Promise held while positions150/600/900 arrive: still one request in flight, resolve old response then only latest740..1070 is sent; no polling while second promise remains held.
- Scheduled demand invalidation parameterized over document, version and dispose: no old-demand request after context change.
- External focus remains external after range refresh; pending wheel followed by keyboardHome cannot replay over Heading0 or create extra roving tab stops.

Existing tests retain pointer-drag wait, inner-buffer no-render, edge-before/after gesture authority, single scroll adjustment, background total changes, text-only tree naming, stale success/rejection, mount teardown and keyboard navigation. CPU release is required before executing any tests/formatter. Preserve first actual failures before implementing.
