# PDF Font Strategy

This note records the production PDF font policy for `@milkup/export`.

## Scope

The export package owns document scoping, Markdown-to-HTML rendering, theme style injection, and the PDF provider contract. It does not own a browser engine or native print engine.

High-fidelity PDF output must use a host renderer through `createBrowserPrintPdfProvider`. The host renderer receives:

- scoped document id and title
- fully rendered HTML
- theme CSS already embedded in the HTML
- a `PdfFontStrategy`

## CJK Policy

Production renderers must treat CJK text as a first-class path:

- Prefer explicit project/user font families when present.
- Fall back through CJK-capable fonts such as Noto Sans CJK, Microsoft YaHei, PingFang SC, and platform sans-serif.
- Honor `embeddingMode: "require-embed"` by embedding fonts or failing the export with an actionable error.
- Honor `embeddingMode: "prefer-embed"` by embedding when supported and relying on host fonts only as a fallback.
- Never silently replace unsupported CJK glyphs with tofu boxes when the renderer can detect missing glyph coverage.

The baseline `createPlainTextPdfProvider` remains a deterministic fallback and is not the production CJK path.
