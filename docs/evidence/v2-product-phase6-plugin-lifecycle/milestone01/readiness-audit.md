# P6 readiness audit — baseline 1388f646

Scope: read-only investigation and external controlled reproduction. No product, plugin, public SDK, fixture or native UI changes. Native renderer execution budget remains 2 seconds. Findings separate observed production evidence, deterministic source reproduction, and proposed behavior; there is no new product acceptance run.

## Finding

**Activation ready is not document-index ready.** The current footnote implementation deliberately starts a bounded asynchronous index on the first render for each `(documentId, version)` and immediately returns an incomplete result. Export captures that first result once. A later presentation invalidation refreshes the editor, but cannot update the captured export. This is sufficient to reproduce first-output footnote source fallback and the first-only incomplete warning even with a fully enabled plugin and known Markdown context. Waiting only for module loading/activation will not fix it.

The same controller returns incomplete on a new document **without any footnote syntax** until its index finishes. Thus complete, visible diagram output can coexist with an aggregate incomplete warning. The P5 production evidence did not record each worker result, so attributing every historical incomplete warning specifically to footnotes remains an inference; the local reproduction establishes that this path exists, not exclusive causation for every production run.

## Production evidence retained

All paths below are under `/workspace/milkup-export-print-evidence`.

- `milestone01/native-ui/runs/p5-m06-product-print-02`: source SHA256 `8b4f460fb664ce9b2ef92314dd284404eb4bdfeb28578a34d6dfa08a608454a7`; first and repeat both observed document version0, with footnotes1.0.0 and independent diagrams1.1.1 already enabled before each output. No registry renderer errors in these observations.
- First PDF SHA `0aa743eb069b663918296f6502456f6627d282617603e260b7aa4757cc010871`, page2 actual graph and math visible, but `[^p5]` reference and definition remain source. Page7 contains incomplete `(0–5448)`, two intentional missing/remote-image warnings and two footnote source warnings `(885–905)` / `(907–950)`.
- Repeat PDF SHA `afddae83e427b3d016e007aa6a8f2eb8b615af478d50b1b30c4f7205eaec0709`, page2 superscript1 and return-reference1 rendered. Only the two intentional image warnings remain. Same104 body markers exactly once in both. The first chunk is frozen before later work completes; elapsed time rendering other providers cannot retroactively change its saved result.
- `milestone06/artifact-review/product-pdf-print/review.json` and preserved actual PNGs contain the all-page visual/marker proof. First/repeat pixels differ only on pages2 and7; graph region unchanged.
- `p5-m06-product-multi-html`, `p5-m06-product-letter` and `p5-m06-product-cancel-02` show first/new-version incomplete warnings despite actual visible graphs; cancel retry observed version0→1 and exact saved R2 SHA `a5913b56a09f91e1428b07f44dd7493a5da30dd9216f1a716aef8818cb6ec01d`. Large windowed output had time to complete indexes and had no warnings. This is consistent with the mechanism, not proof that file size is the cause.

## Actual code chain

| Layer | Source at baseline | Relevant behavior |
|---|---|---|
| Module activation | `plugins/footnotes/src/plugin.ts:4` | Synchronous activate creates controller and publishes renderer. It has no document index yet. |
| Per-document readiness | `plugins/footnotes/src/controller.ts:122` | A new ID/version replaces current job, creates empty `FootnoteIndex`, schedules `scan` after default80ms, immediately calls `present`. The code does not distinguish export from screen target. |
| Initial result | `plugins/footnotes/src/presentation.ts:18` and `:102` | Known context still yields zero fragments and `complete:false` for an empty unfinished index. `contextKnown` is not index readiness. |
| Bounded scan | `controller.ts:26–121` | Reads version-bound256-line pages, max8Mi UTF16/200000lines, validates page identity/version/range, aborts old generation, finishes index at EOF. Failures mark `partialReason`; they are not success. Invalidation is coalesced at250ms. |
| Empty-document completion | `plugins/footnotes/src/indexer.ts:222` | `finish()` changes complete and increments revision even if no references exist; therefore a readiness invalidation can be emitted for plain text too. |
| Host context | `apps/desktop/src/document-presentation-service.ts:42–119` | Guards document identity/version/theme/revision, reads host Markdown context with bounded scan, distinguishes unknown context. Builds a trusted request before rendering. Does not wait for plugin-owned indexes. |
| Provider aggregation | `document-presentation-service.ts:150–165` | Text providers invoked once with `Promise.allSettled`; any incomplete provider makes aggregate incomplete. Fence work later does not rerun text providers. Conflicts and admission-budget failures also mark aggregate incomplete and must not be mistaken for transient index preparation. |
| Export | `apps/desktop/src/output-presentations.ts:120–172`, `:220–270` | Renderer incomplete is immediately added to sticky warnings; each chunk service is called once and its results are captured. No readiness retry. Per-provide preparation has an absolute10s deadline; native execution deadline is unchanged. |
| Existing readiness signal | `packages/plugin/src/document-broker.ts:486` | `invalidatePresentation` validates renderer ownership, active capability and exact current document/version, coalesces requests. No additional permission is needed to observe this host-verified event internally. |
| Signal currently discarded by export | `apps/desktop/src/desktop-plugin-manager.ts:1008`; `apps/desktop/src/main.ts:1351` | Manager discards request payload, calls screen-only invalidation. Main invalidates screen service and refreshes editor views. Frozen export service is separate and has no subscription. |

### Lifecycle availability is a separate gate

`PluginRuntime.enablePlugin` (`packages/plugin/src/runtime.ts:331`) awaits activate before state becomes enabled. Runtime `renderDocument` (`:457`) rejects unavailable/non-enabled renderers and guards capability generation. Desktop manager also awaits runtime enable before `registry.markEnabled` (`desktop-plugin-manager.ts:633`). For a normal completed enable operation, returning `enabled` does **not** imply a prepared index for the current document.

Manager contributions are computed from registry enabled records (`state():463`, `packages/plugin/src/registry.ts:442`), not from a joined runtime activation snapshot. Startup restores persisted enabled records asynchronously via `ready` (`desktop-plugin-manager.ts:399,1457`) and per-plugin lifecycleTasks (`:1338`). Output currently reads contributions synchronously and calls runtime directly; it does not await manager.ready or relevant pending activation. During startup/reload this is a distinct possible unavailable/omitted-renderer race, not the established cause of the reviewed print first/repeat pair. `main.ts` obtains a nonbusy current document, so native document loading readiness and plugin index readiness are also distinct.

## External deterministic reproduction

Files beside this report:

- `reproduce-readiness.ts` imports the real footnote controller and real export collector. It uses a ready in-memory readWindow host, known complete context, version7, no competing UI work, and arbitrary plugin/renderer identifiers (no host ID special case).
- SourceA: `A[^x]\n[^x]: body`; sourceB: `Plain document without footnotes`.
- `reproduce-readiness.json`: for both, first export returns before **any** readWindow call, with no fragments and incomplete warning. After the real controller's validated-in-shape invalidation, repeat is complete and warning-free without changing source/version.
- `reproduce.exit = 0`: expected baseline reproduction passed.
- `ready-first.red.exit = 1`: proposed first-output-ready assertion fails against unmodified baseline. This is an external controlled probe, not a committed Vitest test or native run. Its mock host does not exercise RPC ownership enforcement; existing broker tests cover that independently.

Re-run from repo root:

```sh
./node_modules/.bin/esbuild /workspace/milkup-plugin-lifecycle-evidence/milestone01/reproduce-readiness.ts --bundle --platform=node --format=esm --outfile=/workspace/milkup-plugin-lifecycle-evidence/milestone01/reproduce-readiness.mjs
node /workspace/milkup-plugin-lifecycle-evidence/milestone01/reproduce-readiness.mjs
node /workspace/milkup-plugin-lifecycle-evidence/milestone01/reproduce-readiness.mjs --expect-ready-first
```

The existing `plugins/footnotes/src/controller.test.ts:52` explicitly tests immediate incomplete followed by scan/invalidation then complete for screen. Preserve that nonblocking screen contract.

## Recommended smallest generic host change

1. **Join relevant lifecycle readiness once, within a bounded output preparation operation.** Await manager startup and already-requested renderer lifecycle tasks admitted for this capture, with cancellation/deadline/current-document guards. Do not auto-enable plugins, request new permissions, or chase arbitrary future enable operations. Capture the actual renderer set and activation-instance/epoch tokens after readiness. Failure/unavailability must remain explicit. A matching plugin ID after reload is not the same activation.
2. **Expose the existing verified invalidation internally with identity.** Preserve `(pluginId, rendererId, activation epoch, documentId, version)` in a manager-local monotonic revision/subscription API. No public SDK change or private import in independent plugins. Do not call screen-service `invalidate()` on the export service: that would revoke its own in-flight generation instead of waking it.
3. **For export only, wait/reinvoke incomplete providers on matching readiness revisions.** Record the provider revision before invocation, so an invalidation arriving during a render or between result settlement and subscription cannot be lost. Retry the same trusted immutable request only after its provider revision advanced. Revalidate and replace that provider's prior result; never append duplicate fragments. Preserve already-complete providers (particularly expensive isolated diagrams). Coalesce floods and keep only one active request per provider. Screen remains one-shot/nonblocking.
4. **Use the original absolute preparation deadline throughout.** Do not loop `service.provide()` with a fresh default10s deadline or restart native2s. Include context, lifecycle wait as explicitly budgeted, readiness waiting, re-render and queue/result settlement in the selected fixed preparation budget. Cancel, document/version/source identity change or activation revocation must immediately reject and remove listeners/timers. Abort the export's request without assuming it can destroy a shared screen index job.
5. **Only final accepted provider results produce incomplete warnings.** Current `output-presentations.render` adds warnings on every attempt, so adding retries underneath it without moving this decision will retain false historical warnings even after success. Aggregate fragment validation/conflict/budget checks still run after final provider outcomes. Do not retry aggregate conflicts or oversized source as if an index could repair them.
6. **Do not pretend complete:false means “still loading”.** Existing SDK has no pending/terminal discriminator: scan-limit, unsupported syntax, missing content, conflicts and transient index all can be incomplete. With no matching invalidation, wait only to the fixed bound and preserve explicit incomplete/source fallback, or return an accurate host preparation error. Do not label this as isolated renderer execution timeout or disable a plugin for a readiness timeout. If all enabled rich content is mandatory for output policy, fail capture explicitly instead of publishing degraded output; policy must be chosen, not silently changed by the retry implementation.

This uses a signal independent plugins already implement. A smaller alternative of teaching only footnotes to await its index for target=export can solve this plugin, but does not provide generic host readiness and may mix document scanning into render execution budgets. Merely delaying output80/250ms, increasing native2s, polling arbitrary times, changing declaration IDs, warming an editor viewport, or retrying every successful diagram is not a lifecycle fix.

## Proposed meaningful RED/GREEN tests (root owns implementation)

1. Real controller+collector integration: first export of simple footnotes remains pending until controlled readWindow resolves; final result contains both reference and definition, no incomplete warning. Before resolution assert no final snapshot/publication. Repeat should match semantic fragments. Baseline resolves too early: deterministic RED.
2. No-footnote text provider: same async index lifecycle, final empty-but-complete result and no false incomplete warning. Prevents “only footnote syntax” host heuristics.
3. Generic readiness tests with unrelated plugin/renderer IDs: incomplete→matching invalidation→complete; invalidation before result settlement is not lost; two providers independently become ready; complete fence provider called exactly once; revised result replaces prior fragments rather than duplicating anchors. Final warnings reflect final result, not transient first result.
4. Identity/lifecycle isolation: wrong document/version/renderer/activation invalidations do not wake pending output; disable/reload same ID revokes old generation; source edit, switch document or save-location mutation fails existing capture guards; no stale results accepted.
5. Absolute budget/cancel: fake clock proves repeated dirty events do not extend deadline, no-event incomplete settles with accurate incomplete/error, blocked result arriving after deadline rejected, cancellation removes timers/listeners and prevents later publication. Real isolated execution timeout still uses original2s and existing disable semantics; readiness timeout alone must not trigger that path.
6. Terminal/partial cases: index scan-limit/error, incomplete Markdown context, fragment conflict, unsupported nested content and aggregate budgets preserve source with accurate warnings. A provider returning complete:false forever cannot keep export alive. Do not assert green merely because fragments exist.
7. Manager startup/reload: deferred module activation prevents a renderer from being treated as ready; resolve→render succeeds, reject→accurate failure; an unrelated unrequested plugin does not expand scope. Capture admitted set once rather than watching every future lifecycle task.
8. Frozen offsets/anchors: selection limitations unchanged; full-document sliced windows use absolute offsets; first chunk waits on current-version index without rebuilding document from a different version. One successful later chunk must not erase an earlier terminal error.

Remaining independent P5 boundaries: WebKit exact Unicode copy/search and long-block heading pagination are unchanged; physical printer acceptance has not occurred. This audit makes no claim to fix them or to prove all native rendering timeouts eliminated.

## Implementation decision after audit

Root selected an explicit public result field `pending?: true` with SDK0.3.6, rather than treating arbitrary `complete:false` as readiness. This supersedes the ambiguous retry trigger in the generic recommendation above: only `pending:true` should qualify for bounded host preparation retry; ordinary terminal incomplete remains immediate fallback/error. Root owns host preparation, SDK agent owns strict wire/schema support. This agent owns only footnotes controller/tests. Its new field is emitted while the same live index is unfinished and has no permanent partial reason, only with known context. Rendering remains synchronous, scanning budgets and cancellation are unchanged. Root coordinates the independent package version and minimum SDK; emitting the new field into an older strict host is incompatible and requires that metadata update.
