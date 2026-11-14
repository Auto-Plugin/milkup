# Diagram output timeout acceptance fixtures

These are source fixtures for the existing independently installed diagram plugin and existing HTML/PDF/print routes. They add no syntax, SDK API or renderer budget. `manifest.json` pins the bytes, UTF-16 lengths, line counts, diagram fence ranges, node labels and body markers. A `fixtureRevision` is a label for source bytes; it is never the application's document version.

| Fixture                     | Purpose                                                                                              | Diagrams                 |
| --------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------ |
| `single-r1.md`              | First output and repeated output from the same observed document version                             | One three-node flowchart |
| `single-r2.md`              | Real edit after cancellation; new source and labels must replace r1                                  | One three-node flowchart |
| `multiple-r1.md`            | Two identical graph sources followed by one different graph; preserve independent IDs and references | Three                    |
| `windowed-r1.md`            | 624 source lines with graphs before, between and after 300 uniquely marked paragraphs                | Three                    |
| `print04-regression.source` | Exact original failed print04 Markdown bytes, including rich content and 100 paragraph markers       | One                      |

Top-level `resources` pins `assets/logo-fixture.png`; copy it at the same relative path into every isolated run. Its successful inclusion is required for the original regression. Only the deliberately missing and remote images may produce the existing two image warnings.

The `.source` file contains Markdown. Copy its exact bytes to the run's `source.md`; its extension prevents a formatter from changing the original regression input. Its SHA-256 is `8b4f460fb664ce9b2ef92314dd284404eb4bdfeb28578a34d6dfa08a608454a7`. Format the other Markdown before recomputing manifest hashes, never after freezing a run.

`windowed-r1` exceeds the existing 256-line presentation input window. It is a minimal multi-window content regression, not proof of the native large-file mode or a replacement for the existing 60,000-line Large05 route. Record actual editor/window state if claiming that separate mode.

## Run and version requirements

Use actual installed independent packages, record archive and binary hashes, and record renderer approval/enabled state before and after every output. The manifest minimalMatrix covers HTML, A4 portrait PDF, Letter landscape PDF and GTK Print to File in eight successful artifacts plus a cancellation attempt: cold/repeated original Print to File, multiple-diagram HTML/repeated HTML/A4/Letter, windowed HTML, and cancelled-r1/edit/retry-r2 HTML. A real printer is outside this fixture's evidence.

For first output, use a fresh isolated approved profile and wait for the document to be ready. Do not add an arbitrary warm-up delay. Record all renderer dispatches from activation: opening the editor may already render the graph, so first output and first renderer invocation are separate facts. Repeat successful output twice in the same document without edits, with distinct output destinations. Document version and source hash must remain the same.

For cancellation, record whether cancellation actually occurred during preparation or in a native chooser. An action that finished before cancellation is not a successful preparation-cancellation test. Verify no committed output from the cancelled job. Edit the document through the actual editor from r1 to r2, observe its new version and exact source hash, then retry. The existing retry starts a fresh capture: it must use observed r2 bytes/version and exclude r1 labels. A later edit during an already captured operation must not silently enter that operation's output. Never assume version 0 or 1, or assume every editor replacement increments by exactly one.

Preserve failed attempts with their original artifacts and logs. A later retry does not erase a timeout, renderer disablement, incomplete fragment or source fallback. Capture actual source observation method, document ID/version at action start, captured version, final current version, output hash, native request IDs and dispatch/deadline/completion/cancellation timestamps when available.

## Acceptance must demonstrate a diagram

HTML requires the expected number of actual SVG presentations, visible expected nodes and connecting arrows, unique IDs and resolved local references. The two identical graphs in `multiple-r1` must both exist independently. Check the saved bytes with offline DOM and pixels; matching node labels in source text is insufficient.

For PDF and Print to File, inspect actual page rasters and record each graph's page and visible node/edge geometry. A fenced Mermaid block is failure even when every label or ASCII marker survives extraction. Keep all body markers exactly once and verify every page for clipping or lost content. Keep source-preserving fallback warnings visible and report them as degraded output, never rich success.

The original WebKit PDF copy/search codepoint loss and long table/code/list heading orphaning remain separate unresolved assertions. Do not use normalization, source simplification, omitted diagrams, extended safety deadlines or a different output engine to make this timeout acceptance green. These small diagrams do not validate those other boundaries.

The draft independent audit is staged outside the product tree at `/workspace/milkup-export-print-evidence/milestone06/content/audit-artifact.py`. It can reject source fallback and count source markers, but its zero exit means only a content precheck: visual and production-provenance review are still pending. No milestone06 native/UI execution is established by these fixtures.

## Additional native large-file diagram case

`true-windowed-r1.md` is a separate frozen fixture: 327,594 UTF-8 bytes (about 320 KiB), 121,120 UTF-16 code units, 2,088 lines, and 1,032 uniquely marked body paragraphs. Three distinct three-node/two-edge diagrams occur at the beginning, midpoint and end. It exceeds the existing 256 KiB native-open threshold while staying below the 2 Mi UTF-16 capture budget.

Run the new harness with `MILKUP_P5M6_CASE=large-diagrams` and `MILKUP_P5M6_FORMAT=html`. The case requires both the actual `.milkup-source-document-view` and native large-file notice, followed by three actual SVGs, closed references and all unique body markers. If the host falls back to memory opening, the case fails instead of claiming native window coverage. The existing `windowed-r1.md` remains unchanged and covers only the smaller multi-window content case; the old 60,000-repeat `large` stage disables diagram rendering and cannot substitute for this case.

Cancellation evidence retains raw traces and evaluates the earliest terminal event for each export request. A result already drained by the helper before the click, an earlier owner terminal event, absent interval endpoints, or timeout cleanup cannot establish successful active rendering cancellation. Preparing-UI cancellation and chooser cancellation remain separately named observations.
