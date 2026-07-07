# Markdown Parser M3 Closeout Decisions

This note defines what M3 does and does not complete.

## Completed in M3

M3 establishes a source-preserving Markdown CST parser with:

- block parsing for headings, paragraphs, blank lines, fenced code, indented code, blockquotes, lists, and thematic breaks
- inline parsing for text, escapes, code spans, emphasis, strong, links, images, autolinks, and hard breaks
- incomplete nodes for unclosed emphasis, links, code spans, and fenced code blocks
- initial parse cache and invalidation range expansion APIs
- full-parse vs incremental-parse equivalence tests
- plugin parser isolation stub

## AST Conversion Decision

AST conversion is deferred.

Reason:

- The editor needs CST first for live-render marker hide/show.
- AST shape should be driven by renderer/export requirements, not guessed early.
- Introducing AST now would create a second semantic model before the view layer proves what it needs.

Follow-up:

- Add minimal CST-to-AST conversion when M5 live rendering or M12 export pipeline needs it.

## True Node Reuse Decision

True incremental node reuse is deferred.

Current behavior:

- `parseMarkdownIncremental` exposes cache and invalidation APIs.
- It still performs a full parse and returns `reusedPreviousTree: false`.
- Tests assert that incremental output equals full parse output.

Reason:

- Stable correctness is more important than premature reuse.
- Real reuse needs stronger block identity and remapping semantics.
- Large-file work will provide better constraints for chunked parsing and cache reuse.

Follow-up:

- Revisit true node reuse during M9 Large File Architecture.
- Keep the current API stable enough that callers do not need to change when reuse is added.

## Nested Container Decision

Nested list/blockquote parsing is deferred to a container-stack parser.

Reason:

- Naive recursive parsing is likely to destabilize editing around partially typed Markdown.
- Container continuation, lazy lines, blank lines, and code blocks inside containers require explicit stack semantics.

Reference:

- See [markdown-container-design.md](./markdown-container-design.md).

## Plugin Parser Isolation Decision

M3 includes only an isolation stub.

Reason:

- Runtime plugin loading belongs to later plugin milestones.
- Parser hooks still need an error boundary shape now so future plugin syntax cannot corrupt the base parser.

Current contract:

- Plugin parser callbacks must run through a safe wrapper.
- Throwing plugin parser code returns a structured failure result.
- Base parsing continues independently.
