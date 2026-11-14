# Large-file editor implementation plan

> Active design plan created on 2026-07-08 for moving milkup from small-file in-memory editing toward responsive GB-scale Windows editing. This plan is intentionally complete enough to resume work after interruptions without losing the later architecture.

## 1. Problem statement

The current Windows desktop editor can open and edit small Markdown files, but a 175 KB, 1,734-line file such as `docs/coding-plan.md` already exposes visible latency:

- Opening shows an empty editor first, then fills content after the file is read, parsed, session state is replaced, and the full DOM is rendered.
- Live-mode cursor moves and ordinary edits can become sluggish because current paths still rely on whole-document parse/render work in several cases.
- The existing native large-file command path has benchmark evidence, but it is not yet the actual desktop editor path.

The target is a staged implementation that first makes normal Windows files feel instant, then evolves toward documented GB-scale opening, scrolling, searching, local editing, and saving.

## 2. Existing assets

Use these instead of starting from zero:

- `packages/core/src/store/large-file-policy.ts`
  - Existing scale modes: `normal`, `incremental`, `large`, `ultra-large`.
  - Existing strategy matrix for memory/chunked store, full/incremental/local parse, full/virtual/viewport DOM.
- `packages/core/src/store/document-store.ts`
  - Existing store abstraction with line/window reads.
- `packages/core/src/store/store-search.ts`
  - Existing chunked search over `DocumentStore` line windows.
- `packages/markdown`
  - Existing full parse, incremental parse, and local window parse work.
- `apps/desktop/src/large-file-service.ts`
  - Frontend wrapper for native large text commands.
- `apps/desktop/src-tauri/src/lib.rs`
  - Native commands: `open_large_text_file`, `read_large_text_file_chunk`, `read_large_text_file_line_window`, `apply_large_text_file_changes`, `flush_large_text_file`, `close_large_text_file`.
- Benchmark evidence:
  - `docs/large-file-benchmark-protocol.md`
  - `docs/native-large-file-benchmark-256mib-2026-07-06.json`
  - `docs/native-large-file-benchmark-1gib-2026-07-06.json`
  - `docs/desktop-editor-interaction-benchmark-175kb-10mib-2026-07-09.json`
  - `docs/desktop-editor-interaction-benchmark-100mib-2026-07-09.json`
  - `docs/native-large-file-benchmark-working-temp-256mib-2026-07-09.json`
  - `docs/native-large-file-benchmark-working-temp-1gib-2026-07-09.json`

Historical limitation: the retained 2026-07-06 native benchmark reports were produced before the current source-backed editor integration and working-temp native edit path. The 2026-07-09 reports supersede them for current working-temp public wording at 256 MiB and 1 GiB, with measured latency caveats.

Current implementation note: the native large-file save path now includes both `flush_large_text_file` for original-path atomic replacement and `flush_large_text_file_as` for Save As without frontend full-text materialization. Save As to the original path still uses the external-change conflict guard. Clean external modifications can be reloaded by reopening the same path through the native line-window service rather than by reading the full file into frontend memory.

Phase 8 implementation note: `SourceDocumentView` now supports asynchronous Markdown window parse-cache warmup for the current and adjacent viewport windows. The desktop source-backed large-file path enables this warmup after viewport renders, while cancellation on source update, edit, or destroy prevents stale work from mutating the active view.

Phase 6/7 implementation note: the source-backed large-file view now supports visible-window insert, paste, Backspace/Delete, undo/redo, and Shift-click range replacement/deletion without frontend full-text materialization. Whole-document selection, cross-window cut, and other full-document operations remain blocked with non-modal notices. Dirty large-file saves are blocked when an external conflict is known; Save As remains available, and reloading an externally changed dirty large file requires explicit confirmation because it discards local large-file edits.

## 3. Design principles

- Never block the UI thread on full-file parse or full-file DOM construction for files above the normal threshold.
- Render only what the user can see, plus a small overscan buffer.
- Treat source mode as the universal fallback. Live rendering may degrade for large and ultra-large files.
- Keep text offsets stable as UTF-16 positions at the editor API boundary, because the existing core, DOM hit testing, and Tauri large-file commands already use UTF-16 editor offsets.
- Keep save safety conservative. If the app cannot confidently flush changes, it must block overwrite and explain the state.
- Every public GB-scale claim must point to a retained benchmark report.

## 4. Scale modes and expected behavior

| Mode          |  Suggested size | Store                         | Render           | Parse                  | Editing                 | User expectation                                     |
| ------------- | --------------: | ----------------------------- | ---------------- | ---------------------- | ----------------------- | ---------------------------------------------------- |
| `normal`      |     `< 128 KiB` | memory                        | full DOM allowed | full/incremental       | full                    | Current rich editor behavior, but optimized          |
| `incremental` |   `128-256 KiB` | memory initially, store-ready | virtual DOM      | incremental/window     | full local edits        | Smooth scrolling and typing, partial background work |
| `large`       | `256 KiB-2 MiB` | chunked/native                | viewport DOM     | local window           | local edits             | Open, scroll, search, edit visible regions           |
| `ultra-large` |      `>= 2 MiB` | chunked/native                | viewport DOM     | on demand/source-first | local edits with limits | Source-first, explicit degraded features             |

Thresholds are intentionally conservative for Windows preview builds after manual feedback showed visible stalls on several-hundred-KiB Markdown files. The architecture should not hard-code behavior in UI components; use policy resolution.

## 5. Phase 0 - Instrument and stop obvious stalls

Goal: Make current small/medium files measurable and remove avoidable whole-document work.

Tasks:

- Add lightweight performance marks for open stages:
  - native dialog selected
  - file read start/end
  - `MemoryTextDocument` construction
  - markdown parse start/end
  - first editor paint
  - first interactive focus
- Add a debug-only timing panel or console diagnostics gated behind the developer panel.
- Keep recent view-dom local rendering optimizations:
  - cursor movement only rerenders affected live lines
  - single-line edits only rerender affected live line when safe
  - overlay/cursor code reuses parse cache
- Add automated regression around `docs/coding-plan.md`:
  - open fixture
  - switch/live default path
  - click middle and tail lines
  - type one character
  - assert no full DOM replacement on selection-only movement and simple single-line edit

Acceptance:

- `docs/coding-plan.md` opens without appearing broken.
- Cursor movement in live mode does not rebuild all line DOM.
- Simple single-line input in live mode does not rebuild all line DOM.
- Timings are visible enough to identify the next bottleneck.

## 6. Phase 1 - Honest loading state and first-paint split

Goal: Remove the blank-editor impression and decouple file selection from content readiness.

Tasks:

- Introduce document loading state in desktop session:
  - `idle`
  - `opening`
  - `indexing`
  - `ready`
  - `failed`
- When opening a file, immediately render a non-editable loading surface in the editor area:
  - file name
  - size
  - current phase
  - cancel option if native path supports it later
- Avoid clearing the old document until the new file is ready, unless user explicitly opens into a new tab/session.
- For normal files, perform read/parse/render as a staged async flow:
  - set session opening
  - read file
  - build document state
  - render editor
  - focus editor
- Disable editing commands while the document is in `opening` or `indexing`.
- Replace current "empty editor then filled editor" behavior with either old content retained or loading surface.

Acceptance:

- Opening `docs/coding-plan.md` never shows a misleading blank editable document.
- Failed open restores previous document/session cleanly.
- E2E covers loading state with mocked delayed open.

## 7. Phase 2 - Viewport renderer for memory-backed documents

Goal: Make 10-100 MB memory-backed documents responsive by rendering only visible lines.

Tasks:

- Add a virtualized line renderer in `@milkup/view-dom`:
  - fixed or measured line-height baseline
  - top spacer and bottom spacer
  - visible line window with overscan
  - stable `data-line`, `data-from`, `data-to` mapping
- Keep full DOM renderer available for normal mode.
- Implement viewport recalculation on scroll, resize, mode switch, and document change.
- Support source mode first, then live mode.
- Ensure cursor and selection overlays map against virtualized DOM:
  - if cursor line is outside viewport, scroll it into view before measuring
  - if selection spans outside viewport, render visible selection fragments only
- Add tests for:
  - rendered line count bounded by viewport
  - scroll maps to expected line window
  - cursor stays visible
  - no offscreen line DOM in large fixture

Acceptance:

- A synthetic 10 MB memory document does not create one DOM node per line.
- Scrolling remains responsive.
- Keyboard navigation does not require full DOM.

## 8. Phase 3 - Desktop file open policy

Goal: Route files into the correct editor/store path at open time.

Tasks:

- Read file metadata before reading full content:
  - path
  - byte size
  - supported extension
  - readonly flag where available
- Resolve `DocumentScaleMode` from size.
- Normal path:
  - existing `open_markdown_file`
  - `MemoryTextDocument`
  - full or optimized memory view
- Incremental path:
  - full read may still be allowed initially
  - virtual DOM enabled by policy
  - background parse/search indexing
- Large/ultra-large path:
  - call `open_large_text_file`
  - do not create `MemoryTextDocument` for the full file
  - create a large-document session backed by the native line-window service
- Surface mode in UI:
  - normal text only in status/developer area
  - no noisy warnings for ordinary users
  - clear degraded-mode label for large/ultra-large

Acceptance:

- Opening a large fixture calls native large-file commands, not full `open_markdown_file`.
- Small files keep current behavior.
- Tests assert routing by size threshold.

## 9. Phase 4 - Store-backed editor state

Goal: Let editor views read from a store/window instead of requiring full `MemoryTextDocument`.

Tasks:

- Define a view-facing document adapter:
  - `lineCount`
  - `length` if known, or estimated/async
  - `readLineWindow(fromLine, toLine)`
  - `lineAtPosition` via line index
  - `positionAtLineOffset`
- Decide whether to extend `TextDocument` or introduce a separate `EditorDocumentSource`.
  - Prefer a separate interface if async reads are required.
- Create `MemoryDocumentSource` for existing small files.
- Create `LargeDocumentSource` over `DesktopLargeTextFileService`.
- Refactor `EditorView` to operate on a visible line window for virtual modes.
- Keep `EditorState` for normal documents; introduce `LargeEditorState` or session-level store state only when needed.

Acceptance:

- The view can render a line window without full document text.
- Existing normal editor tests keep passing.
- Large-document tests prove no full text materialization in the frontend.

## 10. Phase 5 - Local-window Markdown rendering

Goal: Enable useful live rendering in large files without full parse.

Tasks:

- Use `parseMarkdownWindow` for visible line windows.
- Add context padding:
  - several lines above/below viewport
  - special handling for fenced code, lists, blockquotes, and tables
- Define degradation rules:
  - source mode always available
  - live mode in `large` parses viewport plus context
  - live mode in `ultra-large` defaults source-first, user can request live for current viewport
- Avoid expensive blocks by default:
  - no automatic Mermaid/rendered diagrams
  - no plugin full-document transforms
- Cache parsed windows keyed by document version, line range, and mode.

Acceptance:

- Large file viewport live rendering does not parse entire file.
- Fenced code and table display remain acceptable within viewport context.
- Degraded features are deterministic and documented.

## 11. Phase 6 - Large-file editing model

Goal: Support local edits without rewriting or loading the entire file in the frontend.

Tasks:

- Use a change log / piece table model:
  - original file chunks
  - inserted text buffers
  - ordered edits in UTF-16 space
- For native large path, map editor UTF-16 offsets to byte ranges using the line index.
- Apply edits through `apply_large_text_file_changes`.
- Keep dirty state and version state in the desktop session:
  - native document version
  - pending edit count
  - last flushed version
- Support editing operations first:
  - insert text
  - delete selection within visible loaded range
  - backspace/delete near viewport
  - paste bounded text
- Defer or block high-risk operations:
  - select all on GB files
  - whole-document replace
  - full-document formatting
  - plugin transformations requiring full text

Acceptance:

- A 256 MiB fixture supports visible local edits and undo/redo for those edits.
- Edits do not cause full frontend text materialization.
- Unsupported operations show clear, non-modal explanations.

## 12. Phase 7 - Save and crash safety

Goal: Persist large-file edits safely.

Tasks:

- Keep current atomic-flush behavior for native large service.
- Strengthen native service beyond full-text-backed storage:
  - temp file rewrite from source chunks plus edit log
  - fsync/sync policy where practical
  - recover or clean temp files after crash
- Integrate external file watcher:
  - if file changes while dirty, mark conflict
  - block silent overwrite
  - offer save-as or reload/discard paths
- Save UI:
  - progress for large flush
  - cancel only if safe
  - clear failure details

Acceptance:

- Dirty large file cannot silently overwrite external changes.
- Flush creates valid output and preserves untouched content.
- Native tests cover crash-safe temp behavior where feasible.

## 13. Phase 8 - Search and background work

Goal: Make large-file utility features non-blocking.

Tasks:

- Search:
  - use chunked store search
  - stream results
  - allow cancel
  - cap result count
- Character count:
  - exact for normal
  - metadata/async for larger modes
  - do not block editor open
- Background workers:
  - indexing
  - search
  - parse cache warmup

Acceptance:

- Searching a 1 GiB fixture does not freeze the UI.
- Status bar never blocks on full-document character count.
- Search cancellation works.

## 14. Phase 9 - Benchmarks and release gates

Goal: Convert implementation into trustworthy Windows claims.

Required benchmark reports:

- 175 KB real plan file interactive report.
- 10 MB memory/virtual renderer report.
- 100 MB large-mode report.
- 256 MiB native report.
- 1 GiB native report.

Metrics:

- time to visible loading state
- time to first visible content
- time to interactive cursor
- scroll latency
- click-to-cursor latency
- single-character input latency
- line-window read latency
- search first result latency
- save/flush time
- peak memory

Acceptance:

- Reports live in `docs/`.
- Public wording matches evidence exactly.
- Windows release plan references the latest report.

## 15. Implementation order

Do this in order:

1. Phase 0: instrumentation and current view-dom local-render fixes.
2. Phase 1: loading state so open never looks blank/broken.
3. Phase 2: memory-backed virtual viewport renderer.
4. Phase 3: desktop open policy by file size.
5. Phase 4: store-backed view source.
6. Phase 5: local-window Markdown rendering.
7. Phase 6: large-file editing.
8. Phase 7: safe save/flush.
9. Phase 8: search/background indexing.
10. Phase 9: retained benchmark reports and release wording.

Do not start Phase 6 before Phase 4 is stable. Editing without a store-backed view will create another in-memory large-file path and defeat the architecture.

## 16. Near-term checklist

- [x] Add open-stage performance marks.
- [x] Add delayed-open UI state.
- [x] Add `docs/coding-plan.md` interactive regression fixture.
- [x] Create `VirtualLineRenderer` or equivalent view-dom path.
- [x] Add viewport bounded DOM tests.
- [x] Route size metadata through desktop open flow.
- [x] Decide exact threshold for enabling virtual DOM on Windows preview builds.
- [x] Keep current full-DOM normal path until virtual renderer has parity.

## 17. Non-goals for the first pass

- Perfect Typora-like live rendering for 1 GiB files.
- Whole-document AST for large/ultra-large files.
- Full-document plugin transforms on GB files.
- Immediate multi-platform manual validation. Windows remains the first validation target.

## 18. Risks

- UTF-16 to byte mapping can become expensive if not indexed per line.
- Variable line heights complicate virtual scrolling; start with stable line height and measured corrections later.
- Markdown context can be wrong at viewport boundaries; context padding and source fallback are required.
- Saving huge files safely is mostly a native/service problem, not a DOM problem.
- A partial large-file mode can be worse than an honest read-only/source-first mode; degraded capabilities must be explicit.
