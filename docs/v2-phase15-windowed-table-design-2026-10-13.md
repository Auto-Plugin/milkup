# Phase 15 — production path and bounded windowed tables

Support contract and design record; execution evidence is reported separately in [phase 15 verification](./v2-phase15-production-verification-2026-10-13.md).

## Production boundary

Build the ordinary Tauri release binary with `tauri build --no-bundle`; no Vite profile transform, no app publication. Run with port 1420 closed. Observe the shipped DOM and actual module Worker at `tauri://localhost/assets/...`. XTest sends system keys; non-ASCII WebDriver key actions are Unicode transport, not Chinese IME acceptance. Local-resource/offline-dev-server verification is distinct from network isolation: this environment rejects creating a network namespace. Existing CSP configuration is unchanged (no configured CSP); absence of CSP violations is not CSP hardening.

## Supported table context

Top-level windowed live pipe tables require a complete contiguous pipe block, a Markdown header and delimiter, at most 128 logical lines including the delimiter, 16 columns, and 262,144 UTF-16 code units including immediate outside context. A bounded whole-table read precedes structural commands. The native bridge checks indexed UTF-16 bounds before materializing a requested window. Four context entries each hold at most 262,144 UTF-16 units in `window.text`; duplicated line strings and parser objects add representation overhead. This is a text budget, not a WebKit RSS cap. Fence checks reuse versioned checkpoints and read bounded pages; if an earlier page exceeds the table-context budget, that table remains literal. This is a deliberate conservative limitation for giant preceding logical lines. Deep first-use fence discovery can still require scanning preceding pages; no 200 ms guarantee is made.

A table beyond a support limit stays literal Markdown with no table toolbar or whole-table operations. A viewport fragment must never masquerade as a complete table. Source mode remains literal. A linear selection crossing cells is not rectangular selection; Tab/Enter must not destroy separators.

## Editing and geometry

Reuse ordinary-editor table commands and arrow selection semantics over the bounded local document, then translate both directional selection endpoints and the single atomic edit to global UTF-16 coordinates. Enter moves down a column; Tab/Shift-Tab traverse cells and skip the delimiter; Shift-Enter inserts `<br>`; Home/End respect cell bounds; deletion protects separators and treats rendered breaks/escaped pipes as units. Pasted/committed text escapes pipes and converts newlines to `<br>`. Row/column edits are isolated history entries. Ordinary typing retains the existing optimistic 24 ms commit batching. Native history coalesces opted-in adjacent insertion batches within 750 ms and at most 65,536 UTF-16 units; paste/composition/structural operations, save, native snapshot history, undo/redo, and selection discontinuities break that group. Transport batch timing must not split a rapid typing burst into arbitrary undo fragments.

Rendering receives the complete header context but mounts only viewport/overscan rows. HTML hard breaks create real line breaks. A bounded cache of 2,048 measured row heights adjusts virtual spacers and line lookup; unvisited or evicted rows use the existing estimated line height until measured. This is not full-document exact layout. Rendering and async context reads must reject obsolete source versions; navigation and input share the existing edit queue. All reads, edits and history remain bounded by the support contract, independent of file size.

## Required evidence

Production Unicode Worker fallback and cancellation; original 100 MiB full-search/replacement/cancellation/history/save/reopen with whole-file bytes; true native cross-window table navigation, cell breaks, row/column operations and history; typing while operations are queued; stale async reads; budget refusal; real DOM cursor/selection geometry and screenshots. Preserve IME, Windows/macOS/Word 2016, unresolved WebDriver allocator errors, and wider visual/accessibility acceptance as separate gaps.
