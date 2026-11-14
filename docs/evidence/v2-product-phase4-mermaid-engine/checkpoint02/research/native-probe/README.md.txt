# External native Mermaid observation module — prepared, not executed

Serve this directory's `entry.mjs` and exact `mermaid-full-12.2.0.mjs` under the helper's fixed local origin; entry has one relative import and the bundle has no external imports. The bundle SHA256 is `043c33385b8b41bb628872f4e419c7f20886403152b045736382db36072d8c0c`. Preserve its legal notices and the fuller research/offline/licenses inventory when distributing; this research copy is not a product package.

The native helper must enforce network/navigation/resource isolation and the only hard two-second deadline. This module is not a sanitizer, secure realm, execution supervisor, production API or replacement for those controls.

## Calls

1. Load the fixed module. If import fails, the global will not exist; treat module startup separately from rendering.
2. `window.__milkupMermaidProbe.ready()` starts font preparation and returns a Promise. Native need not serialize that Promise.
3. Synchronously poll `window.__milkupMermaidProbe.readiness()`; shape is `{status:'idle'|'pending'|'ready'|'error',result?,error?}`. Ready result is metadata only. No Mermaid document has been parsed or initialized.
4. Start the native deadline **before** invoking `start(request)`. Request exact keys: `{id:string, source:string, profile:'baseline'|'classic-tspan', theme:'light'|'dark'}`. ID is 1–96 ASCII alphanumeric/underscore/hyphen; source at most 50,000 UTF16 units. Returned value is `{taskId,status:'pending'}`. Concurrent requests reject as busy.
5. Synchronously call `poll(taskId)` within the same deadline: `{status:'pending'}`, `{status:'complete',result}`, `{status:'error',error}`, or `{status:'unknown'}`. `result.ok:false` is an engine/observation failure. No timeout/retry is hidden in the module.
6. Persist results **without changing the native size/deadline contract**. `serializedBytes` counts the result JSON itself (not the poll wrapper) and `over256KiB` explicitly flags excess. Do not assume every output fits the production limit. If transport refuses it, record the refusal rather than enlarging the budget.
7. Optional screenshot target is `#mermaid-native-probe-host`; it retains the most recent completed output. `clear(taskId)` removes a settled result and the host when idle. Pending work can only be stopped by native termination, not JS cancellation.

`run(request)` is also exported and returns one Promise, but native evaluate callbacks should use start/poll. No method batches samples. Task results are bounded to the latest two entries.

## Result indexing

`styleFields` defines shared property order. Each `styleTable[index]` is a string array in that order; each `nodes[]` entry has `treePath`, tag, namespace and `styleId`. Tree paths are element-child indices beginning with the root SVG as `0`, relative to the probe host. `geometry.text[]`, URLs and active animations use the same paths. Full source SVG preserves all original attributes; computed-style extraction does not rewrite it.

The effective-style set includes mix-blend-mode/isolation, group opacity, SVG/CSS filters, paint/stroke metrics, text/font/spacing/baselines, textbox dimensions/border/background/overflow, transforms, and animation metadata/keyframes. `counts` records total elements and all tag/attribute counts, without silently truncating nodes. Native process isolation/deadline still bounds hostile expansion; this external collector is not a product complexity validator.

Baseline preserves engine appearance defaults, with strict/htmlLabels=false/security keys/system Arial font. Dark adds the official dark theme/darkMode. Classic-tspan additionally selects official `look:'classic'` and `journey.textPlacement:'tspan'`. This is a pre-render configuration change, not deletion of foreignObject/filter/gradient nodes. Neither profile currently has native or pixel acceptance evidence.
