# Large File Piece Tree Plan

## Decision

Replace the native large-file editing implementation with a persistent piece tree.
The current implementation materializes the complete file, applies a change by
copying the complete string, and rebuilds all line indexes. That makes a local
edit O(file size), so it cannot provide responsive typing or newline insertion
for large files.

The new implementation keeps the public editor boundary in UTF-16 positions,
but stores the document natively as an indexed tree of immutable source ranges
and append-only inserted ranges. A local edit must cost O(log N + edit size),
where N is the number of pieces. Full-file work is permitted only while
creating an immutable base or saving an atomic output file.

## Scope

This plan applies to the native large-file path:

- `apps/desktop/src-tauri/src/lib.rs`
- `apps/desktop/src/large-file-service.ts`
- `apps/desktop/src/large-document-source.ts`
- `packages/core/src/store/large-edit-session.ts`
- `packages/view-dom/src/source-document-view.ts`

It preserves the current frontend contract for line-window reads, UTF-16 edit
ranges, version checks, visible-window editing, undo/redo, and safe save-as.
Normal memory-backed documents are out of scope.

## Current Failure Mode

`apply_large_text_file_changes` currently does the following for every edit:

1. Materializes the full native file as a `String` when necessary.
2. Copies the complete text to produce the changed document.
3. Scans the complete changed text to rebuild byte, line, and UTF-16 indexes.
4. Keeps the complete changed text in `materialized_text` until save.

The desktop benchmark records a 6,538.1 ms visible edit for a 100 MiB file.
Scrolling and line-window reads are much faster, so the mutation model rather
than viewport DOM rendering is the primary input-latency bottleneck.

## Data Model

Use a balanced B+ tree, called `PieceTree`, whose leaf entries are:

```text
Piece {
  source: Base | Add,
  byte_start: u64,
  byte_len: u64,
  utf16_len: u64,
  newline_count: u64
}
```

`Base` references an immutable session base file. `Add` references an
append-only edit-buffer file. Internal nodes aggregate byte length, UTF-16
length, and newline count for all descendants. Each leaf is bounded in size so
that resolving a position only scans a small local range.

The tree supports:

- lookup by UTF-16 position;
- lookup by line number;
- split, insert, delete, and concatenate pieces;
- sequential iteration over a byte/line window;
- aggregate metadata updates along the modified tree path.

The base file must remain immutable during an edit session. On Windows, prefer
an edit-session file handle that denies external writes. If that cannot be
acquired, create a streamed session-base copy before enabling editing. The
watcher still records conflicts and blocks overwriting the original file.

## Native Operations

### Open

Build a sparse base index using bounded blocks, initially 64 KiB. Each block
records byte length, UTF-16 length, and newline count. Do not create a
whole-file `String`, a per-line text array, or a full frontend copy.

Open may index in the background after the first visible window is available.
Until an immutable base is ready, the large document can be displayed but is
not editable. The status must expose this as indexing rather than accepting an
edit that will block for a full copy.

### Read Window

Resolve the requested first line through the tree's newline aggregates, scan
only the bounded containing leaf/block, then iterate consecutive pieces until
the requested final line. Return the existing line-window DTO. The frontend
continues to render only the viewport plus overscan.

### Apply Changes

Keep `apply_large_text_file_changes(document_id, expected_version, changes)`
as the command boundary. For each atomic batch:

1. Validate the expected version and UTF-16 scalar boundaries.
2. Resolve each position through aggregate tree metadata.
3. Append inserted bytes to the add-buffer file.
4. Split affected pieces and splice the new pieces into the tree.
5. Recompute metadata only for changed leaves and their ancestors.
6. Record inverse piece operations for undo/redo and increment the version.

There must be no call to `materialize_large_file_text`, no complete-text copy,
and no `index_large_text` call on this path.

### Undo and Redo

`LargeEditSession` continues to own user-visible history in UTF-16 positions.
The native document stores an equivalent reversible splice operation for each
confirmed batch. Undo and redo invoke the same O(log N) tree operation and
return a new version. Frontend history and native version advancement must be
atomic: a failed native mutation must not advance session state.

### Save

Save traverses the PieceTree in order and streams base/add ranges into a
temporary output file. It fsyncs the temporary file and atomically replaces the
target only after the external-change guard succeeds. Save is intentionally
O(file size); editing is not. Interrupted saves leave a recoverable temporary
file and never corrupt the original target.

## API and Migration

Keep the following frontend-facing DTOs unchanged during the first migration:

- `DesktopLargeTextFileLineWindow`
- `DesktopLargeTextFileChange`
- `DesktopLargeTextFileSnapshot`
- `LargeDocumentSource`

Introduce an internal native document implementation behind the existing Tauri
commands. This allows `SourceDocumentView` to retain its local optimistic line
update behavior while newline insertion waits only for a bounded native splice,
not a whole-file rebuild.

Replace the existing native `LargeFileRegistration` fields incrementally:

```text
remove: materialized_text, line_starts, line_utf16_starts
add:    piece_tree, base_store, add_buffer, session_journal
```

The sparse base index is part of `base_store`; aggregate tree metadata becomes
the mutable current-document index.

## Implementation Sequence

1. Add native `piece_tree` unit tests with no Tauri wiring.
2. Implement base/add storage and a read-only PieceTree line-window adapter.
3. Route `read_large_text_file_line_window` through the adapter behind a
   feature flag; compare results with the legacy implementation.
4. Implement insert/delete/splice plus UTF-16 conversion and version checks.
5. Route `apply_large_text_file_changes` through PieceTree and remove full-text
   mutation from the active path.
6. Update `LargeEditSession` confirmation ordering and undo/redo integration.
7. Implement streamed PieceTree save, recovery cleanup, and external-conflict
   handling.
8. Remove legacy materialization code and the old full line-index rebuild.
9. Enable the path by default after retained desktop and native benchmarks pass.

## Verification

Native property tests must compare PieceTree behavior with a reference `String`
for randomized edits. Include ASCII, Chinese text, emoji, CRLF/LF, empty lines,
multibyte UTF-8, UTF-16 surrogate-pair boundaries, multi-edit batches, undo,
and redo.

Integration tests must prove:

- a large edit never creates a full document string;
- a line window after edits matches reference text at head, middle, and tail;
- save output matches the edited reference document;
- external modification blocks overwrite and allows save-as;
- crash remnants can be recovered or safely cleaned.

Retained Windows WebView benchmarks must cover 100 MiB, 256 MiB, and 1 GiB.
The acceptance gate is that single-character insertion and newline insertion
have bounded p95 latency rather than latency proportional to file size. Save
latency is reported separately and may scale linearly with output size.

## Non-Goals

- Full-document Markdown parsing for GB-scale documents.
- Full-document plugin transforms in large-file mode.
- Making save constant-time.
- Hiding external-change conflicts.
