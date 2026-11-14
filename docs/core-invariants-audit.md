# Core Invariants Audit

This audit maps the non-negotiable project invariants in `docs/coding-plan.md` to current implementation evidence.

## Markdown Source Is The Single Source Of Truth

Evidence:

- `MemoryTextDocument` stores exact source text and preserves line endings.
- `EditorView` renders source/live/preview as projections over `EditorState.doc`.
- `tests/regressions/v1/table-mode-switch-data-loss.test.ts` proves mode switching around table rendering preserves Markdown source.
- `packages/view-dom/src/__tests__/editor-view.test.ts` covers source/live/preview toggles without text changes.

## View/Render Layer Does Not Mutate Documents Directly

Evidence:

- `EditorView` takes an optional external `dispatch` callback and state updates flow through transactions.
- `packages/view-dom/src/__tests__/editor-view.test.ts` covers external dispatch ownership and view-only mode/theme/parser-cache changes.
- `packages/tauri-bridge/src/session/document-session.test.ts` proves view-only changes do not mark sessions dirty.

## Every Document Mutation Goes Through Dispatch

Evidence:

- `BasicEditor.dispatch` is the core mutation entry point.
- Input, paste, delete, enter, keyboard movement, plugin, CLI, MCP, and action paths use transactions or selection-only dispatches.
- `packages/core/src/__tests__/action-registry.test.ts` proves action edits run through editor transactions and global history.
- `packages/plugin/src/runtime.test.ts`, Worker isolation tests, and native sidecar smoke coverage prove plugin mutations are serialized back into normal editor transactions.

## History Survives View Mode Switch

Evidence:

- `packages/core/src/__tests__/editor-history.test.ts` covers mode switch effects not clearing history.
- `packages/view-dom/src/__tests__/editor-view.test.ts` covers source/live/preview switching without history replacement.
- `tests/regressions/v1/history-mode-switch.test.ts` captures the v1 failure mode.

## Code Block Editing Uses Parent Editor Transactions

Evidence:

- `packages/core/src/__tests__/editor-history.test.ts` covers code-block-origin edits in global history.
- `tests/regressions/v1/history-code-block.test.ts` proves fenced-code edits undo through the document history after mode switches.
- `tests/regressions/v1/paste-code-block-blank-lines.test.ts` proves code-block paste remains a single undoable document transaction.

## Parser Does Not Throw Unrecoverable Errors On Malformed Markdown

Evidence:

- `parseMarkdown` wraps block parsing and returns a fallback document node on parser failure.
- `packages/markdown/src/__tests__/block-parser.test.ts` covers malformed inline syntax and incomplete fenced code.
- `packages/markdown/src/__tests__/inline-parser.test.ts` covers incomplete inline code, emphasis, and links.
- `tests/regressions/v1/renderer-error-boundary.test.ts` covers parser/renderer failure isolation behavior.

## Mode Switch Preserves Document Identity, Selection Anchor, And Scroll Anchor

Evidence:

- `packages/view-dom/src/__tests__/editor-view.test.ts` covers mode switching without changing selection, history, or scroll position.
- `tests/e2e/live-render.spec.ts` covers browser scroll preservation across mode switches.
- `tests/regressions/v1/cursor-scroll-code-block.test.ts` captures deep code-block cursor/scroll anchoring.

## Dirty State Reflects Document Content Changes Only

Evidence:

- `packages/tauri-bridge/src/session/document-session.test.ts` covers document-changing transactions, selection-only transactions, and view-only changes.
- `tests/regressions/v1/dirty-state-open-save.test.ts` covers open/save dirty semantics.
- `tests/regressions/v1/file-watcher-conflict.test.ts` covers own-save watcher echoes, clean reloadable external changes, and dirty conflict state.

## Plugin/Render Failure Is Isolated

Evidence:

- `PluginRuntime.render` returns fallback records instead of throwing renderer failures into the host.
- `packages/plugin/src/runtime.test.ts` covers renderer failure fallback.
- `tests/regressions/v1/renderer-error-boundary.test.ts` proves extension parser failures are captured and core parsing continues.

## Every V1 High-Risk Bug Has Regression Coverage

Evidence:

- `tests/regressions/v1` contains dedicated regression files for history/mode switching, code-block history, paste normalization, code-block paste, table mode-switch stability, renderer failure, dirty/open/save, file watcher conflicts, active document export, cursor scroll in code blocks, and Windows Chinese IME composition.
- `docs/cross-cutting-test-audit.md` maps regression and integration coverage into the broader test strategy.
