# External test patch status

`public-preview-scroll-regressions.patch` is an unapplied patch against `packages/view-dom/src/__tests__/document-presentation.test.ts`. `git apply --check` succeeded. No repository files changed and no tests/typecheck/browser run.

14 proposed cases: 3 public refresh continuity checks (ordinary provider, windowed provider, windowed same-window render); 8 public invalidation checks (identity/version/config/semantic content in both views); 1 same-object mutable source version check; 2 public root-scroll event checks (duplicates preserve the mounted reader diagram and do not add source reads; genuine scrollTop movement still loads line21). All use the existing fixture cleanup and validated presentation provider. Assertions allow node reuse or replacement. The unit offset assignments only prove scroll-state continuity; they do not establish actual wheel reachability.

Patch SHA256: `47fb89f0916824c73aac555a1a567747d396c9151c6436c80d77e028218ebe88`.

Native diagnostic owner separately reports `candidate10-windowed-scroll01-summary.json`: 16 observed nonzero inner offsets reset on replacement, 126 replacements, root scrollTop fixed235, editor-target scroll events, no Worker messages in the replacement interval. This strengthens the local replacement-loss mechanism but does not identify why the editor receives those scroll events. Original reachability02 remains failed.

Parent has since applied this patch. The ordinary identity fixture correction is documented separately in `identity-fixture-correction.md`; this agent ran no tests.
