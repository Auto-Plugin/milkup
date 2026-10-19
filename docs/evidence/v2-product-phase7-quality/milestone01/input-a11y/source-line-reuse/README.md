# Ordinary Source line reuse: frozen implementation

The 1024-line component regression initially produced **17 failures / 9 passes** (`red01.log`, exit 1). Unrelated line nodes were replaced and the changed line's horizontal scroll was lost. The Source-only implementation now passes **26 / 26** (`green01.log`). Full view-dom validation passed **791 tests in 30 files**, single worker, with typecheck and formatting exit 0.

The change adds a private renderChangedSourceLine and calls it only from the existing Source branch. It rejects virtual viewports and unsupported transaction/newline shapes, prevalidates every old line element's count/class/line/from/to metadata, replaces only the affected plain-text line, and refreshes later absolute UTF-16 offsets from the current document. It explicitly restores root and affected-line scroll, then uses the existing selection/cursor/search/input-proxy refresh path. Complex changes and missing metadata fall back to full rendering. The current implementation consistently refreshes suffix offsets even for zero-length-delta edits; it does not add a separate optimization for that case.

`source-scope-proof.json` verifies that removing only the new helper and restoring the original Source return-false call reproduces the exact pre-handoff editor-view.ts SHA. Root's parse-cache threading and readonly-Tab changes are therefore preserved. SourceDocumentView navigation remains unchanged.

Validation artifacts:
- `red01.log`, `red01.exit`: genuine before-change failure.
- `green01.log`, `green01.exit`: 26 targeted passes.
- `view-dom-full01.log`, `.exit`: 30 files / 791 passes.
- `typecheck01.log`, `.exit`; `format-check01.log`, `.exit`: both zero.
- `final-proof.json`: exact final source hashes and limits.
- `design.md`, `prepared.json`: preserved earlier unexecuted design checkpoint; superseded for status by this README.
- `source-helper.ts.txt`: frozen helper excerpt.

Tests cover first/middle/last Unicode edits in 1024 lines, CRLF raw bytes, every line's metadata/text, retained DOM identity, forward/reversed selections, exact undo/redo, later-line clicks after growth/shrink, empty placeholders/final empty line, scroll properties, and reliable newline/multi-change/multi-transaction/untracked-state/virtual fallbacks.

These tests demonstrate semantic preservation and removal of unnecessary DOM reconstruction. They do **not** prove that this path caused the prior ordinary Source latency regression, or that native p95 is now within budget. Candidate03 still requires actual native measurement. jsdom scroll-property checks do not model layout-dependent browser clamping; the DOM preflight is a controlled-renderer consistency guard, not a guarantee against arbitrary text-node tampering. Synthetic caret hit-testing does not stand in for native pointer or OS IME acceptance.

The implementation was frozen and the CPU slot released to Root for candidate03 construction. No new dependency or public API was added.
