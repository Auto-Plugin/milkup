# Bounded negative and security observations

This corpus is separate from the frozen 50 positive fixtures. It uses the same
original Mermaid 12.2.0 browser distribution and host initialization recorded in
`../negative-fixtures-manifest.json`. It adds five authored inputs; no dependency,
browser, runtime, installer, plugin, product or operating-system setting is changed.

| Fixture | Actual offline parser result | Native expectation, still unverified |
| --- | --- | --- |
| `unknown-grammar` | Rejected with `UnknownDiagramError` containing `No diagram type detected` | That original renderer error and complete cleanup |
| `tall-budget` | Accepted as `flowchart-v2` | Original renderer error containing `Measured output exceeds pixel budget` and complete cleanup |
| `strict-https-link` | Accepted as `flowchart-v2` | Successful static rendering; inspect removal of interaction separately |
| `strict-javascript-link` | Accepted as `flowchart-v2` | Successful static rendering; inspect removal of interaction separately |
| `external-image-observation` | Accepted as `flowchart-v2` | Observation only; no success/failure or resource-blocking result presumed |

The long chain has 480 nodes and 479 edges. Its 12,379 UTF-16 units and three
newline-separated segments (including the trailing empty segment) fit the
50,000-character, 256-line and 500-edge input limits. Its actual DOM dimensions
have not been measured. The expected geometry rejection must match the bootstrap
error precisely; a timeout, startup failure, unrelated renderer error or successful
render does not pass this negative check. Both expected failures also require
complete process/private-data cleanup in the native harness.

The HTTPS and `javascript:` links are diagram data. This check does not invoke
`bindFunctions`, click links, dispatch a URI, or execute diagram text as JavaScript.
Later static DOM removal checks or policy observations must not be described as
an attempted navigation test. The image fixture similarly proves only valid
grammar here. Rendering may fail, time out or produce a fallback. Its
`expectedFailure: null` means observation only and must not be coerced into an
expected successful render. Actual requests, policy events and receiving-side
observations, when applicable, require separate evidence.

`parser-validation.json` records actual calls to the fixed UMD's `mermaid.parse`:
all five parser expectations matched. Existing jsdom 27.4.0 supplies DOM objects
for Mermaid's sanitizer; it has no browser layout engine, resource loading or
document script execution enabled. Only the SHA-256-checked official UMD is
evaluated. No renderer, screenshot, PNG decoding, browser/Windows execution,
network operation or OS-isolation outcome is established by this report.

Reproduce using the already installed dependencies, without installing anything:

```sh
node scripts/experiments/mermaid-fixed-prototype/fixtures-negative/verify-parse.mjs \
  /workspace/milkup/plugins/diagrams/node_modules/mermaid/dist/mermaid.min.js \
  /workspace/milkup/node_modules/.pnpm/jsdom@27.4.0/node_modules/jsdom/lib/api.js
```

The verifier checks the official bundle hash, each fixture hash and input bounds,
then records official parser acceptance or the specific unknown-grammar error.
It does not equate detector matching, parser acceptance, successful rendering or
network-policy enforcement with one another.
