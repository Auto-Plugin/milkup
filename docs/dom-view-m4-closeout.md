# M4 DOM View and Input Spike Closeout

## Scope

M4 proves that milkup v2 can edit plain text through a custom DOM view without
using `contenteditable` as document truth.

The implemented path keeps Markdown source in `EditorState.doc`, derives cursor
and selection overlays from `EditorState.selection`, and routes document changes
through core transactions.

## Completed Decisions

- Hidden textarea is the input proxy.
- `contentDOM` is explicitly `contenteditable=false`.
- Text input, Enter, Backspace, Delete, arrow movement, IME composition, click
  positioning, and drag selection dispatch transactions or selection-only
  transactions.
- Selection-only changes set `addToHistory: false`.
- Composition updates do not mutate the document; compositionend commits one
  undoable transaction.
- Cursor and selection overlays are view projections, not DOM-owned state.
- Playground now mounts `@milkup/view-dom` and edits plain text through the same
  transaction path.

## Browser Test Decision

Do not add Playwright as an M4 blocker.

M4 only needs smoke geometry and input pipeline confidence. The current jsdom
tests cover transaction routing, history isolation, selection projection, IME
commit behavior, drag selection, and scroll/cursor visibility helpers.

Add browser-level Playwright coverage during M5, when live render mode introduces
hidden markers, source-to-visual projection, real DOM measurement, and mode
switch cursor/scroll restoration. Those are the first places where browser
layout behavior becomes correctness-critical.

## Deferred Manual Checks

Windows Chinese IME should be tested manually when the desktop shell exists. The
manual requirement remains in the cross-cutting manual test matrix and should
feed M8 regression coverage once a replayable harness exists.

## Known Limits

- Drag selection is a smoke path based on rendered line offsets; it is not yet a
  full browser coordinate selection engine.
- Selection overlay rendering is approximate for multi-line ranges.
- `positionToRect` and `coordinateToPosition` use logical metrics until M5 adds
  live render projection and real browser measurement.
- Large file viewport virtualization is not part of M4; it belongs to M9.
