# Cross-Cutting Test Audit

This audit maps the cross-cutting test strategy in `docs/coding-plan.md` to current evidence.

## Unit Tests

- Text document: `packages/core/src/__tests__/memory-text-document.test.ts`
- ChangeSet: `packages/core/src/__tests__/memory-text-document.test.ts`, `packages/core/src/__tests__/document-store.test.ts`
- Selection mapping: `packages/core/src/__tests__/memory-text-document.test.ts`, `packages/core/src/__tests__/editor-history.test.ts`
- History: `packages/core/src/__tests__/editor-history.test.ts`
- Parser: `packages/markdown/src/__tests__/block-parser.test.ts`, `inline-parser.test.ts`, `incremental-parser.test.ts`, `window-parser.test.ts`, `ast-stringify.test.ts`
- Action registry: `packages/core/src/__tests__/action-registry.test.ts`

Verified command: `pnpm test`.

## Integration Tests

- Editor dispatch: `packages/view-dom/src/__tests__/editor-view.test.ts`, `packages/core/src/__tests__/action-registry.test.ts`, `packages/mcp/src/server.test.ts`
- Parser + view decorations: `packages/view-dom/src/__tests__/editor-view.test.ts`
- Paste pipeline: `packages/view-dom/src/__tests__/editor-view.test.ts`, `tests/regressions/v1/paste-*.test.ts`
- Mode switch: `packages/view-dom/src/__tests__/editor-view.test.ts`, `tests/regressions/v1/history-mode-switch.test.ts`, `table-mode-switch-data-loss.test.ts`
- File workflow: `packages/tauri-bridge/src/session/*.test.ts`, `packages/tauri-bridge/src/file/*.test.ts`, `tests/regressions/v1/file-watcher-conflict.test.ts`

Verified commands: `pnpm test`, `pnpm --filter @milkup/regressions test`.

## Browser Tests

- Cursor placement: `tests/e2e/live-render.spec.ts`
- Selection rendering: `tests/e2e/live-render.spec.ts`
- Scroll restoration: `tests/e2e/live-render.spec.ts`
- Input behavior: `tests/e2e/live-render.spec.ts`, `tests/e2e/desktop-shell.spec.ts`
- Paste behavior: `tests/e2e/desktop-shell.spec.ts`

Verified command: `pnpm exec playwright test tests/e2e/live-render.spec.ts --project=playground-msedge`.

## Manual Matrix

The cross-platform manual matrix remains open. Windows IME and file watcher behaviors have automated regression coverage, but the checklist is specifically manual and cross-OS, so it should not be marked complete until those manual runs are recorded.
