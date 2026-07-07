# Markdown Container Parsing Design Notes

This note records the intended direction for nested Markdown containers in `@milkup/markdown`.

## Current State

The current parser recognizes these block containers:

- `unorderedList`
- `orderedList`
- `listItem`
- `blockquote`
- `blockquoteLine`

At this stage, list and blockquote nodes are source-preserving structural nodes. The parser records marker ranges and content ranges, but it does not recursively parse nested block content inside them.

This is intentional. Early recursion without a container stack tends to create unstable behavior around partially edited Markdown, especially for:

- blockquote inside list
- list inside blockquote
- fenced code inside quote
- blank lines inside list items
- partially typed indentation
- tab/shift-tab list editing

## Required Invariants

Future nested container parsing must preserve these invariants:

- Markdown source remains the single source of truth.
- Container parsing must be error-tolerant.
- A broken inner container cannot corrupt the outer container.
- Block parser and inline parser remain separate phases.
- Container marker ranges must remain available for live-render hide/show behavior.
- Content ranges must point at user-authored content, not normalized text.
- Mode switching must not rewrite container indentation or markers.
- Fenced code blocks stop container-inline interpretation for their content.

## Future Container Stack

The future block parser should move from line-classification helpers to an explicit container stack.

Draft shape:

```ts
interface ContainerFrame {
  type: 'blockquote' | 'orderedList' | 'unorderedList' | 'listItem'
  from: number
  markerRanges: SourceRange[]
  contentIndent: number
  children: SyntaxNode[]
}
```

Parsing flow:

```text
scan line
  ↓
match existing container continuation
  ↓
open/close container frames
  ↓
parse leaf block
  ↓
attach leaf to innermost valid frame
```

## Deferred Behavior

The following behaviors should not be hand-rolled casually:

- lazy continuation lines in list items
- blank lines that keep a list item open
- mixed ordered/unordered nesting
- blockquote continuation without repeated `>`
- code blocks inside containers
- table blocks inside list items

Each of these needs regression tests before implementation.

## Near-Term Rule

Until the container stack exists, v2 should keep nested-looking content inside the current container as source-preserving text ranges rather than pretending to fully parse it.

This is less feature-complete, but it is safer for live rendering and mode switching.
