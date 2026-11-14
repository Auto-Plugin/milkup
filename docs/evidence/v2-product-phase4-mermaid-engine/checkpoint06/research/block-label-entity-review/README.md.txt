# Block label entity evidence review

The literal `&nbsp;&nbsp;&nbsp;` is already present in the official-engine baseline output before the product converter. The converter and host serializer retain that same text. No configuration or decoding change was made.

## Evidence chain

1. The archived official `block.md`, line 14, contains `blockArrowId6<["&nbsp;&nbsp;&nbsp;"]>(down)`. The first sample is the unmodified official block.
2. Native baseline `scan-light-01-000/scan_000.svg` already contains a text tspan with `&amp;nbsp;&amp;nbsp;&amp;nbsp;`. The same run's measured DOM text is the literal ASCII entity spelling, not three U+00A0 characters. The probe records `mermaid.render(...).svg` directly, before any product converter. Its inspected configuration uses `securityLevel: strict` and `htmlLabels: false`.
3. Later `product-converter-fourth-00/scan_000-result.json` contains the identical textRun. Host-validation `case-0.svg` parses to the same text. Neither raw nor canonical SVG contains `&amp;amp;nbsp;`; ordinary XML escaping preserves the ampersands once.
4. The existing `mermaid-ui-02/preinstalled-cold-window-webview.png` visibly matches this literal label. This image was reviewed, not regenerated.

`summary.json` supplies each original absolute path, byte length, SHA-256, exact extracted text/XML, and JSON pointer. Large originals are referenced rather than copied.

## Limits

These artifacts come from distinct retained runs, not one instrumented production invocation. No configuration A/B experiment isolates `strict` versus `htmlLabels:false`. The current renderer source is included only as a read-time configuration reference. This is evidence of the official engine's output under the reviewed configuration, not proof of a particular internal cause or new product acceptance. No browser, native app, build, or test was run; no product source was edited.
