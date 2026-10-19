# Outline retirement failure: independent runtime/owner review

2026-10-19. Source and existing native artifacts inspected; no native run, browser, build, or runtime product edit performed in this review.

## Observed failure

`../native-ui/runs/p6-m02-outline-01/failure.json` records timeout waiting for Outline disabled/panel removed. The final `observations.json` row has `milkup.outline` 1.3.1 `enabled:false`, `state:failed`, and `Plugin cleanup did not fully complete`; footnotes remains enabled without errors. The original `failure.png` was opened with `view_image`: its visible red Failed badge and cleanup error agree with the recorded state. This remains a failed native run, not a successful disable.

## Deterministic failing path found with manager owner

1. Mounted UI is tracked in `activeUi`.
2. `unloadRuntimePlugin` invokes `revokeExecutionEpoch`, which synchronously starts `runtime.disablePlugin`, removes actions, revokes capabilities, and begins trusted owner disposal.
3. The old unload path then queues `renderUi(pluginId, viewId, 'dispose')` for each tracked mounted view.
4. `renderUi` calls `runtime.render`; the latter requires an enabled runtime and an available renderer. After revocation it returns `Renderer is not available: <viewId>` (or a missing-plugin error if unloading won the race). `renderUi` throws the error, which manager collects as a cleanup failure.

This explains why a base plugin with no mounted UI passes while Outline fails. The recorded native artifacts expose only the outer AggregateError, so the nested error is established by source analysis and the manager owner's new mounted-UI RED regression, rather than falsely quoted as present in the original run log.

## Owner teardown guarantee and repair boundary

Manager owner is adding the RED regression and changing manager code. The runtime/owner review supports removing renderer disposal RPC only for an already-retired epoch; normal enabled panel-close disposal remains a separate valid lifecycle operation.

Retirement cannot depend on calling plugin unsubscribe/render callbacks after revocation. `createIsolatedPluginModule.disposeIsolation` binds activation disposal to the trusted Worker owner. Worker owner synchronously closes its capability gate, disposes each broker RPC server, rejects host pending RPC, and terminates the worker. Document disposal aborts host operations and clears scan sessions/checkpoints; UI disposal aborts navigation operations. These resources are scoped to the old owner. A supervised Worker still requires its trusted child-stop acknowledgment. Owner cleanup errors remain aggregated and explicit retry only revisits failed cleanup steps of that same owner; they must not be swallowed to make the UI pass.

No runtime change is necessary for this particular manager ordering defect. Existing `owner-retire-green.log`, `targeted-frozen.log`, and `file-read-final03.log` preserve owner-race/retirement regressions; manager's new RED/GREEN and a fresh native Outline lifecycle run are required before claiming the new fix accepted.
