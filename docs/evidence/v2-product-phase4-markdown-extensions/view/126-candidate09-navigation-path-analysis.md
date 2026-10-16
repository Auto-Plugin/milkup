# Candidate 09 near-footnote return: read-only analysis

Status: candidate 09 native acceptance failed; no product/test changes or UI/tests run for this analysis. Source checkpoint reported by root: 065882. The mechanisms below are existing code paths, not a proven diagnosis of this native click.

## Observed formal-run facts

Sources: `native/candidate09-run01-failure-summary.json` and `native/run-candidate09-run01/{results.json,render-trace.json,pointer-input.json}` under `/workspace/milkup-markdown-extensions-phase4-evidence/`.

- Ordinary semantics/history and windowed root/flow/graph/reference keyboard navigation passed before the failure.
- Windowed definition screenshot at 04:47:20.317Z has selection 463..499, cursor 499, version 0. Right/Down then leaves cursor 501.
- Return pointer sample at 04:47:21.910Z (wall 1792126041910): first return button center (80.46875, 76.140625), rectangle y65.640625..86.640625 entirely inside editor y37..730. `elementFromPoint` hit the reference button. Active element before pointer was input proxy. Native pointer command was sent.
- Last three renderer results before that pointer: wall 1792126041464 (math), 1465 (diagrams), 1477 (footnotes), approximately 433 ms before the pointer record. The next renderer requests are at 1792126051613..1615, approximately 9.7 seconds after the pointer record, still with selection 501..501. There is no recorded renderer response overlapping the recorded pointer instant.
- Final failure at 04:47:38.235Z: cursor 501, version 0, dirty false, focus BUTTON; three renderers remain enabled with no supervisor timeout/error control. Return preview still exists and is visible. The final generic focus.visible field is false despite the reference's visible rectangle, so it does not identify which button owns focus.
- Formal run records neither the actual DOM pointer event sequence nor stable node identity. A sent XTest command and earlier hit test do not prove click-handler entry. Worker traces also do not record host SourceDocumentView read/DOM replacement.
- The failure status array reads content text from the fallback-marked content element, not the actual notice text. It cannot prove whether the navigation-error notice was emitted.

## Existing code paths

Line numbers refer to the current frozen candidate 09 source.

1. `packages/view-dom/src/document-presentation.ts:117`: a reference button's click listener prevents default/propagation and invokes its navigation closure. At :1038 that closure silently returns if its request is not the current cache request or its preview element is no longer connected to content. At :1044 it calls host onNavigate. Rejection is caught, but :1040 only displays `导航目标已失效。` while that same request remains current. Therefore absence of this notice alone does not prove the host succeeded or the handler was never called.
2. `document-presentation.ts:1050`: button mousedown is allowed its native focus default; preview pointerdown stops propagation to the source selection handler. The manager's focusin handler (:254) only maintains the one-shot Tab-navigation state. It does not itself repaint or change the editor selection.
3. `document-presentation.ts:581` caches a newly validated response, then paints it. Paint restores/replaces preview DOM and restores matching focus. Focus restoration preserves keyboard focus identity, not a native pointer down/up gesture across replacement. Source DOM replacement also reinstalls previews via updateContent, without necessarily requesting a new renderer response.
4. `packages/view-dom/src/source-document-view.ts:219` renders a new window on a scroll event unless it matches the one-shot scrollAnchor. Native focusing a button might cause browser scrolling; whether it did so here is unobserved. A pending earlier Source window read can also complete independently of a new worker response.
5. `source-document-view.ts:738..742`: scrollToLine sets scrollTop, records its scroll anchor, then awaits a targeted render request. `renderVisibleWindow` (:781) discards a request if a higher request id has already applied. A same-document scroll request can therefore supersede a target request; no document/version/navigation-revision invalidation is required.
6. `source-document-view.ts:679..692`: revealSelection awaits scrollToLine, checks document/version/navigation revision, then **silently returns if the target line is absent**. It has not changed selection yet. scrollToLine itself also does not reject if the target line is absent. This is a concrete possible silent-success path when a newer window wins; it has not been proven to occur in candidate09-run01.
7. `apps/desktop/src/main.ts:4392..4409`: host navigation checks editor/source identity, document id/version and valid range, not selectionRevision. Thus the observed stable version 0 offers no evidence for a selection-based host rejection. Host then awaits target lookup (:4415), revealSelection (:4420), and finally focuses the editor (:4435). Final BUTTON focus is compatible with no click, a pending navigation, or a caught failure; a completed silent reveal would normally focus the input proxy, though final focus alone cannot establish the full event sequence.
8. `apps/desktop/src/document-navigation.ts`: target lookup uses bounded complete single-line reads (65536 UTF-16 units each), at most 128 reads, and binary search. Around 160k lines a near-start target still requires roughly 18 reads. Budget/validation failures reject; they are not silent. No independent wall-time deadline exists for this lookup. Host IPC timing is absent from the formal trace, so a pending lookup is not excluded.

## Existing coverage gap and independent reproduction designs

No execution requested or performed here.

### A. Native pointer gesture across preview replacement

Use the existing generic fake provider with one reference, in ordinary and SourceDocumentView configurations. Keep document/version/selection unchanged. Start a valid background refresh and hold its response. Place the button fully inside the viewport; real browser `mouse.down` on its center, then release the held provider while the mouse is down. Record old button identity/connected status, new button identity, activeElement and navigation count; issue real `mouse.up` at the same coordinates. Assert exactly one intended navigation with unchanged source/history. Separately repeat with a pending Source window read completing between down/up and no new provider response.

Current tests (`document-presentation.test.ts:860` and :1030 onward) test focus preservation and synchronous `button.click()` while a refresh is pending or after completion. They do not test down/up spanning replacement. A failed controlled test would demonstrate this mechanism, but would not by itself prove it happened in the formal native run.

### B. Target render superseded by another Source window

Use a controlled async source with enough lines for disjoint windows. Start revealSelection with host-like signal/assertCurrent guards, hold the targeted window read, then complete a higher-id scroll window that excludes the target. Release the older target read. Record whether reveal resolves, whether target line is absent, whether selection stayed unchanged, and whether any error reaches the navigation callback. Keep identity/version stable to distinguish this from already-covered stale-document guards. This independently exercises the silent `if (!line) return` path, without pointer timing.

## Minimum native observations to distinguish the chains

- Capture pointerdown/mousedown/focusin/scroll/pointerup/mouseup/click with stable WeakMap node ids, target class, connected status, active node id, buttons and event-time geometry. Record defaultPrevented after dispatch, not only inside an early capture listener.
- MutationObserver: old target detach/new matching target creation during that interval; preserve ids even if labels/ranges remain identical.
- Record actual notice text, source window from/toLine and scrollTop at each event. Worker request/result timing alone cannot identify Source DOM replacement.
- If a click is observed on the same connected button, follow host bounded line-read IPC start/settle and target render-window application, without changing product state or adding a longer timeout.

No cause is selected pending this evidence. Do not weaken pointer-hit, selection, version, budget or source-safety assertions to obtain a pass.
