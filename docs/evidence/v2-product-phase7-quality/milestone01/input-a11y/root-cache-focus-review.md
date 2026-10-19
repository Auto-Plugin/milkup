# Independent cache and focus review

Read-only review of the current root changes to `EditorView`, `desktop-focus.ts` and desktop `main.ts`. No source edits and no browser/native UI. Full workspace checks belong to root and were not rerun here. SHA256 snapshot in `root-cache-focus-review.json` identifies reviewed files; later root corrections are separate.

## Concrete finding: unsuccessful focus restoration lacks fallback

`canRestoreFocus` checks connection, disabled/hidden/inert, rectangles and computed visibility, but a visible ordinary div or body can satisfy all checks while `.focus()` does nothing. `restoreDesktopFocus` then skips its fallback. `setMenuOpen` captures `document.activeElement`, which is not guaranteed to remain a focusable target (including body or an invoker whose tabindex was removed).

External lightweight unit probe `focus-review-probe.mjs` uses the actual helper with jsdom, no product copies. After hiding a menu whose button still holds focus, returning to a visible non-focusable div produces `consideredRestorable=true`, `fallbackCalls=0`, and `focusRemainsInHiddenMenu=true`; see `focus-review-probe.json`. This demonstrates helper behavior, not the incidence of this sequence in native WebKit. Recommended minimal correction: after attempting focus, verify the target actually became active; otherwise invoke the existing fallback. Add a non-focusable/removed-tabindex invoker regression. Do not treat visibility alone as focus success.

## Cache review: no additional finding

The new calls pass `this.markdownParseState.cache.root` into coordinate mapping, measured caret fallback, cursor scrolling and code-block paste detection. The root is initialized before first render. `updateState` synchronously updates the parse state before changed-line/full render and cursor reveal when transactions change the document or document text differs. Selection-only updates reuse syntax but projections read the current selection; source/live changes do not require a different Markdown syntax tree. Undo/redo or state replacement without a single change hint still use the existing incremental/full fallback. Same text in a different immutable document object can safely share syntax. Controlled syntax extensions are included in the stored parse state, keeping geometry aligned with the already-rendered syntax instead of reparsing with default extensions.

The root argument is optional in existing internal helpers, so standalone exported source-coordinate functions retain their behavior. Root's new parse-budget tests check no redundant parse during reveal/coordinate queries and refreshed heading syntax after insertion; earlier input suites cover edit/history/source-live semantics. No additional stale tree introduced by these argument additions was identified. This review does not prove arbitrary caller mutation of readonly document/tree objects is supported, nor does it replace actual native latency measurements.

## Focus navigation review and boundaries

Both memory-windowed and native-large SourceDocumentView creation paths are wired. Main now uses the still-active element within editorRoot as navigation origin, not a fixed input proxy. This preserves backward input→focusable root→previous control progression instead of looping on the root. The SourceDocumentView checks owner generation, selection revision, current focused element, destroyed state and composition state before the callback. Positive tabindex ordering and visible/disabled/inert filtering are explicit; root tests cover normal forward/reverse and wrapping behavior.

This is a desktop light-DOM traversal, not a complete browser sequential-focus implementation for arbitrary shadow roots, cross-frame widgets or radio-group tab-stop semantics. Those are not newly claimed supported by the current controlled UI. Actual focus visibility, selection retention and native event ordering remain root's native keyboard acceptance responsibility.

## Optional view-dom API compatibility

`SourceDocumentViewConfig.onFocusNavigation?: (request: { readonly backward: boolean }) => void` is a trusted view configuration callback in **@milkup/view-dom**. It is not a core contract, public plugin SDK addition, capability grant or plugin focus API. No plugin manifest/SDK version is required to consume these host-internal changes.

The callback is optional. Omission preserves the standalone windowed view's previous indentation behavior; root's desktop supplies it in both creation paths. With a callback, Tab is prevented immediately while the existing bounded block-context logic resolves whether the selected line is ordinary, unindented, non-list/non-code/non-pipe prose. If so and the captured request remains current, the host is asked to move forward/backward. The host owns actual focus traversal. The callback is not invoked for live table-cell navigation, code/list/multiline indentation or source pipe-row raw indentation. A stale request is discarded without applying an indentation edit. Readonly SourceDocumentView already leaves Tab to browser default; readonly EditorView now does the same. Existing consumers without a callback do not gain deferred host focus behavior automatically.

A returned void indicates only a navigation request was delivered; the callback itself must choose a valid target. Component tests assert direction, single delivery, no document edits and stale-request rejection; they do not impersonate real browser Tab or OS IME behavior.

## Post-fix independent check

Root corrected restoreDesktopFocus to test activeElement after attempting focus and otherwise invoke fallback; it also added the visible-unfocusable-div regression. The original external probe JSON remains unchanged as RED. Rerunning exactly that script against the corrected helper produces `activeId=fallback`, `fallbackCalls=1`, `focusRemainsInHiddenMenu=false`; recorded separately in `focus-review-probe-after.json`. Final reviewed source hashes are in `root-cache-focus-final-review.json`. No product files were edited by this reviewer. No additional blocker was identified in the scoped cache/focus review; platform focus and latency validation still belongs to the native runs, not this jsdom check.
