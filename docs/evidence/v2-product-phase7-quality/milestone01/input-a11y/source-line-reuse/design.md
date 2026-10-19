# Ordinary Source single-line DOM reuse — design checkpoint

Status: tests prepared, not executed; product editor-view.ts not edited by this agent. Root retains product ownership until explicit handoff and the native timing slot releases. This targets a directly observable unnecessary full DOM rebuild, not a proven explanation of the first native performance regression. Candidate03 still requires real latency measurements.

## Observed path

EditorView.updateState updates the cached Markdown parse state and calls renderChangedDocumentLines. That method immediately returns false in source mode. render() then replaces all source line nodes, even for one same-line insertion in a 1024-line, nonvirtual document. The existing Live path only replaces selected line DOM; directly allowing Source into it would render the wrong representation and leave later absolute offsets stale after length changes.

DocumentPresentation.updateContent is the established wrapper for synchronous content updates, but its scroll anchor eligibility is explicitly Live-only. Calling it is not a Source scroll-preservation proof.

## Small source-only implementation proposal

1. Keep the current Live code unchanged. Add a private source branch invoked only for ordinary, nonvirtual source. Reject shouldUseVirtualViewport() before any patch.
2. Reuse the existing single-transaction/single-change/same-line/same-line-count eligibility, with a conservative source-only CR guard on inserted and removed text. LF/CR edits, multi-change, multi-transaction, missing transaction hints and line-count changes retain full render fallback. Undo/redo without supplied transactions retain fallback; never invent history transactions.
3. Before mutation, validate the complete direct child line sequence against previousState.doc: count, parent, .milkup-line, data-line, data-from and data-to. An incomplete or stale line set falls back before any partial patch. Source DOM has plain text per line, so no nested Markdown range attributes need shifting.
4. Create only the changed line using renderPlainTextLineWindow(ownerDocument, state, number, number). Preserve its scrollLeft. Wrap the mutation in documentPresentation.updateContent; replace that one line, then update later line data-from/data-to from state.doc.line(number), not from displayed text lengths. Keep other line nodes/text nodes and data-line numbers intact. CRLF positions and Unicode UTF-16 lengths remain exact.
5. Explicitly save/restore outer scrollTop/scrollLeft and changed-line scrollLeft around mutation. Browser legal-range clamping is still possible if content shrinks; avoid claiming jsdom proves real geometry. Existing selection-change reveal may intentionally move scroll afterward. The scroll regression holds selection unchanged to isolate DOM-rebuild effects.
6. Call renderSelectionAndCursor, retaining its search-overlay refresh, input-proxy synchronization and presentation selection lifecycle. Leave updateState's ordinary selection reveal rules intact.

This is O(number of following lines) metadata reconciliation and DOM prevalidation, not an O(1) edit or a new source index. It avoids O(document lines) new elements/text nodes and blanket replaceChildren. No dependency or public API is added.

## Prepared regression coverage

New independent file: packages/view-dom/src/__tests__/p7-source-line-reuse.test.ts (26 generated cases).

- 1024 lines, first/middle/last edits, insertion/deletion/replacement of complete Unicode sequences; assert unrelated node identity, all line numbers/from/to/text, exact original/edited document bytes, caret metadata, selection and one undo boundary, then undo/redo correctness.
- CRLF offsets, empty-to-text/text-to-empty placeholders, final empty line, reversed later-line selection/history.
- Real EditorView click dispatch into a retained later line after growth/shrink, with the browser caret hit-test result supplied by the test; verifies the updated absolute mapping and input focus. This is synthetic DOM hit-testing, not native pointer geometry.
- Explicit outer and affected-line scroll retention with unchanged selection.
- Full reconciliation for LF insertion/removal, CR insertion/removal, multi-change, multi-transaction, untracked state, and incomplete source DOM.
- Virtual source retains bounded rows/spacers and correct visible absolute offsets after an offscreen edit; it does not accidentally use the ordinary-source patch.

No test, typecheck, formatter, build, browser or native UI was launched for this design checkpoint. Expected RED is not represented as executed evidence. Prior SourceDocumentView and fixture freezes remain unchanged.
