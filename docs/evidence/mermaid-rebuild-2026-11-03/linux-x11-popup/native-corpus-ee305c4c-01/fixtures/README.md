# Fixed Mermaid 12.2.0 prototype fixtures

These 50 authored, self-contained examples cover each of the fixed official
engine's 37 lazy registration IDs once, plus 13 feature/C4-variant cases.
`../fixtures-manifest.json` records the expected ID, SHA-256, exact pinned
documentation/source reference, initialization, and limits of each example.
This is a registration and selected-feature corpus, not exhaustive coverage of
all grammar productions, valid documents, layouts, effects, or failure modes.
`error` and `---` are internal diagnostic entries, not additional chart fixtures.
ZenUML and other separately installed external diagram plugins are outside the
fixed main package and are not included.

All 37 registration examples use the common strict initialization and no
per-case overrides. The `flowchart-elk` keyword itself selects the official ELK
registration/layout. Architecture uses only built-in database/server icons;
no fixture requires an external image, font, icon pack, URL, or script. Gantt
uses fixed dates and disables the current-date marker.

The additional cases exercise HTML labels, Markdown labels, MathML input, CJK
font fallback, wide/tall graphs, a neo appearance/shadow candidate, nested
subgraphs, sequence groups, and all five C4 grammar headers. Only `flow-shadow`
requests `look: "neo"`; this is a reviewed host-owned finite preset, not an
arbitrary configuration object accepted from a plugin or document. The helper
may map that preset to its own fixed configuration. Inspect the resulting DOM
and pixels before claiming shadow or MathML coverage; parser acceptance cannot
prove either effect rendered.

## Actual validation and its limits

`verify-parse.mjs` called the real official `mermaid.parse` API with strict
security, `htmlLabels: true`, and all top-level default configuration keys
secured. An intentionally unfinished flowchart was also rejected as a syntax
error, so this check is more than matching a diagram detector.

Both distributions passed all 50 fixtures with the expected registration ID:

| Distribution | SHA-256 | Evidence |
| --- | --- | --- |
| `dist/mermaid.core.mjs` | `4d085c790146a42c65d51ea21170427b24bc706de970df570331321996cbdbaf` | `parser-validation-esm.json` |
| `dist/mermaid.min.js` | `a8a6a6f805b074a8261a2825c86f99c8054acb3b35f50bb7e24a4f9f2c3c3b9f` | `parser-validation-browser-umd.json` |

The UMD is the same 5,494,801-byte browser distribution selected for the
prototype. It was evaluated only after its hash matched, and only the fixed
library was evaluated as JavaScript; fixture strings were passed to its parser
as data. Existing jsdom 27.4.0 supplied DOM APIs for the official sanitizer.
Its resource loader and document-script execution were not enabled. No SVG
geometry methods were mocked or polyfilled, and `mermaid.render` was never
called. No browser, Windows process, untrusted plugin, screenshot, native helper,
network canary, isolation test, or PNG decoder was run by this fixture task.
No dependencies were installed.

`parser-validation-initial.json` retains the first 48/50 result. The initial
block example needed quoted labels. An attempted `drop-shadow(...)` flowchart
style was rejected by the official parser and was replaced with valid ordinary
style plus the fixed neo host preset. The revised case does not claim that its
pixels or shadows have been verified.

To repeat with already installed dependencies, pass explicit existing entry
paths; this command never installs or downloads anything:

```sh
node scripts/experiments/mermaid-fixed-prototype/fixtures/verify-parse.mjs \
  /existing/mermaid/dist/mermaid.min.js \
  /existing/jsdom/lib/api.js
```

An actual isolated browser rendering run must separately prove complete visible
ink, nonempty/current screenshots, math/fonts, DPI, overflow/shadows, deadlines,
output budgets, PNG validation, and the documented security boundaries. These
parser results authorize no integration or release claim.
