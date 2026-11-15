# Cold-entry follow-up: mode and pre-armed observation

This change completes the observation-wiring fallback, **not** a cold-source-flash product fix. No new Actions run, installer build or installed acceptance was started. Previous failed runs and their original artifacts remain unchanged.

## Candidate and evidence

The working candidate `dot/mermaid-visible-latency-20261115` contains product fix `3c658aa49f39263c7a0fdb9867b5d20a1b251194` and exact-package result `42277c9a` / run `43676925544`. The other existing integration worktree, `dot/release-quality-integration-20261112` at `0252c9d6`, does not contain that fix; it was not modified or merged. Current application/build inputs (`apps`, `packages`, `plugins`, `vendor`, `release/update-channel.json`) are unchanged from the tested `42277c9a` candidate.

The saved cold-entry samples used `storedPluginPolicy=null`. `createMermaidRenderSettings` resolves that to **live / mixed**, independently of the editor's own `live` mode. Those six source frames cannot be relabeled as a measurement made with explicit plugin `preview / render`. The view source also shows why a render-only pending state needs explicit work: `DocumentPresentation.sync()` waits for `provide`, `paint()` applies plugin strategy only to returned authenticated PNG fragments, and image decode can defer replacement again. There is currently no authenticated synchronous pending-fence presentation primitive. This supports investigating render-mode pending display, but is not native evidence of a newly fixed render-mode behavior.

## Implemented measurement changes

- Arm each independent document observer **before** the native file-picker operation. Until exact normalized target path and `#app` loading-ready match, old document offsets/images cannot contribute source, visibility or decoded samples.
- Record document-match time and bounded waiting frames. A subsequent document change fails the observation; wall-clock and total frame budgets still apply while waiting.
- Require no prior admitted request (including pending work) or completed source at arm. The warm control additionally requires a target-bound offscreen sample before successful preparation, actual rendering after arm, readiness before real target-entry input, and first visible entry after that input. Same-source prior work, unknown identity, already-visible first sample and readiness before first offscreen evidence remain invalid.
- Keep readiness observed after picker acknowledgement as a separate fact. It may be accepted only if the earlier pre-armed timeline proves the required ordering. This corrects the former attachment point; it does not retroactively pass `43676925544`.
- Before entry scenarios, drive the existing **Diagrams plugin** details/select using real pointer/wheel/keyboard actions to choose `preview`. Verify both the visible selection and persisted plugin preference, close settings, and assert the editor's global mode is unchanged. No storage injection, global mode control or private application mutation is used. The policy step's failure remains a failure and does not prevent normal-close finalization.
- The derived `readyBeforeFirstInput` now describes only that timestamp fact. The full warm-comparison gate remains separate and stricter.

The real-browser fixture now arms against a different current document, checks old-image exclusion, switches the fixture to the target, observes it offscreen, produces/decodes a new image while offscreen, then uses a real wheel for entry. This is an observer fixture, not the actual Milkup application or Mermaid performance.

## Tests and actual blocker

- 29 Node observation/frontend contracts passed, including old-document exclusion, bounded pre-arm wait, document-change rejection, pre-ready/pending-source rejection, delayed picker acknowledgement with independently prior offscreen evidence, and plugin UI policy sequencing/persistence rejection.
- Existing 30 PNG view tests and 5 Mermaid settings tests passed, including mode behavior and owner lifecycle. They are local regressions, not native installed mode acceptance.
- PowerShell parsing, five native-result negative fixtures and five failure-finalization cases passed. Formatting, JavaScript syntax and diff checks passed.
- Local real-layout browser attempt failed **before any fixture ran**: `/usr/bin/chromium` aborted with `setuid_sandbox_host.cc:172`, “SUID sandbox helper binary ... not configured correctly”, alongside crashpad database initialization errors. Sandbox remained enabled; no system file, policy or security setting was changed. No fallback with `--no-sandbox` was attempted.
- The new pre-armed browser sequence and plugin-select/native document flow therefore remain unverified in a real browser/Windows session. No new native experiment was dispatched on the strength of model-DOM tests alone. The earlier first-image samples do not establish long-tail improvement.

## Minimal product direction, not yet implemented

For explicit plugin render mode only, a host-owned pending-fence presentation could retain source geometry and original nodes while showing a stable “图表加载中” state, replacing it only after decoded authenticated output. It must not count as a rendered image or reset latency start. This needs an authenticated, bounded exact-fence range before async rendering; it must stop on source/mixed policy, plugin disable or identity/epoch change, and restore recoverable source on renderer/decode timeout/error. Document edits, selection/focus mapping, scroll anchoring, virtual-line replacement, theme changes and cancellation must be covered through the entire pending→decode→success/failure lifetime.

A CSS-only hide, a generic provider-derived pending range, or hiding all Mermaid text while any render is pending would not meet those requirements. Widening the existing 256-line/eight-fence prefetch budget would not guarantee a cold jump and could increase unrelated work. Neither was implemented. The next product patch should introduce that narrow pending-state contract with real first-layout/restore tests; then use one bounded targeted native validation, reusing a package only when product inputs truly match. Do not repeat installation matrices or initialization/cursor baselines merely to obtain a green run.

No main merge, publication, notification change, formal configuration change, system/runtime substitution or sandbox weakening.
