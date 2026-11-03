# Product integration acceptance preparation

**Status: prepared-not-executed.** This document and the companion
[case catalog](product-integration-test-cases.json) add no product code, public
SDK/IPC entry point, dependency, runtime execution, or passing test result.
Product source reviewed: `4f88dfe78e7687377bbfb9d8c0b770a8c62969ca` (beta.7).
Prototype preparation checkpoint: `7686155eefae5e3b096a1389db5b519c171ec08d`.
These source labels do not imply that prototype code is integrated into beta.7.

## Existing entry points and the smallest intended change

| Exact reviewed source | Existing behavior | Intended future change |
| --- | --- | --- |
| [Manager render/epoch](https://github.com/Auto-Plugin/milkup/blob/4f88dfe78e7687377bbfb9d8c0b770a8c62969ca/apps/desktop/src/desktop-plugin-manager.ts#L1627) | Forwards renderer requests; exposes host activation generation | Private dispatch bound to reviewed package fingerprint, published catalog generation, renderer ID and epoch; no ID-only or plugin-self-reported authorization |
| [Service context guards](https://github.com/Auto-Plugin/milkup/blob/4f88dfe78e7687377bbfb9d8c0b770a8c62969ca/apps/desktop/src/document-presentation-service.ts#L52) | Rechecks document/source identity, version, theme and renderer activation | Reuse these guards; bind request ID, fence range/body hash, width and original deadline through the private service |
| [Immediate revocation](https://github.com/Auto-Plugin/milkup/blob/4f88dfe78e7687377bbfb9d8c0b770a8c62969ca/apps/desktop/src/desktop-plugin-manager.ts#L2457) | Removes contributions and disposes brokers when an epoch retires | Cancel owned native work and release private image leases on the same retirement chain |
| [Core node union](https://github.com/Auto-Plugin/milkup/blob/4f88dfe78e7687377bbfb9d8c0b770a8c62969ca/packages/core/src/document-presentation.ts#L128) / [SVG image owner](https://github.com/Auto-Plugin/milkup/blob/4f88dfe78e7687377bbfb9d8c0b770a8c62969ca/packages/view-dom/src/document-svg-image.ts#L14) | No PNG node; SVG images already wait for decode and revoke Blob URLs | Private typed PNG lease/owner; do not cast PNG as SVG or bypass public validation; hide source only after accepted decode |
| [Bundled receipt policy](https://github.com/Auto-Plugin/milkup/blob/4f88dfe78e7687377bbfb9d8c0b770a8c62969ca/apps/desktop/src/main.ts#L1499) / [live invalidation](https://github.com/Auto-Plugin/milkup/blob/4f88dfe78e7687377bbfb9d8c0b770a8c62969ca/apps/desktop/src/main.ts#L1567) | Diagrams upgrade receipt lists 1.1.1; document views already refresh on invalidation | Review migration above delivered worker 1.2.0, preserve disabled/tombstone intent, reuse hot refresh |

This recommendation is the host-private service/private adapter route, replacing
an earlier public `renderMermaid12` SDK proposal. Private PNG transport still
needs an actual typed integration design; the current core result cannot carry
one. Native leases, decode lifetime, aggregate budgets and export reuse are not
implemented by the present preparation files. Export reuse is not an acceptance
claim or an extra implementation mandate for this checkpoint.

## Prepared cases

Each JSON case has a stable ID, source references, fixtures, operations,
observable assertions, evidence requirements and `result: null`. Driver adapters
are future work. The catalog must not be ingested as already-passing test output.

| ID | Required observable acceptance |
| --- | --- |
| MI-01 | Spoofed/same-ID, pending, disabled and retired package identities start no service job |
| MI-02 | Document/source/version/fence/theme/width/renderer changes reject deferred results and release output |
| MI-03 | Cancel at queue/start/ready/render/decode; terminate only owned work; never reset the original deadline |
| MI-04 | Reject malformed/over-budget PNG before publishing; decode failure leaves source visible |
| MI-05 | Count native leases, Blob URLs and old-plus-new bytes; repeated replacement returns counts to baseline |
| MI-06 | Open document → enable → return → render → edit → disable → re-enable, without restart or card movement |
| MI-07 | Caret inside/on fence edges, blur to plugin page and IME composition retain coherent editing behavior |
| MI-08 | Upgrade/retry synthetic 1.2.0 histories with exact receipts; preserve disabled, tombstoned and failed states |
| MI-09 | Render/toggle leaves exact LF/CRLF/Unicode bytes and dirty state unchanged; edits keep undo/redo/save intact |
| MI-10 | Actual wide/tall/CJK/MathML pixels remain readable in light/dark, narrow/wide and 100/125/150/200 native scale |
| MI-11 | Same-login coordinator owns cancellation, timeout, exit and cleanup; CI's different-SID supervisor is insufficient |
| MI-12 | Record pure-standard, filtered administrator and elevated contexts accurately; absent contexts stay unverified |
| MI-13 | Pinned official syntax scope has actual retained PNGs and actual product-path evidence; parser-only success is insufficient |
| MI-14 | Closed text-only input and inert validated output; no arbitrary plugin code, native bridge or active remote-resource surface |
| MI-15 | Reverse-order concurrent completions cannot cross ownership, exceed total budgets or dispose newer work |
| MI-16 | Runtime provenance/version/architecture/layout/image hashes distinguish Fixed and Evergreen evidence |
| MI-17 | Stable cards, hidden Live fences, toolbar context, saved bytes and recovery safeguards retain their existing behavior |

Reuse the existing service tests for deferred promises and activation/source
replacement, the view preparation tests for original-deadline and destruction
races, and the hot-focus tests for ordinary/windowed caret behavior. Extend the
existing mechanisms rather than introduce a second ownership state machine.
The fixtures are self-authored in-memory documents, synthetic temporary catalogs,
existing corpus references, generated PNG mutations, and test-owned lease
counters. No real user document, catalog, installation or third-party process is
part of these prepared cases.

## Execution gates and evidence

1. Review the changed product trust boundary before implementing or distributing
   the fixed service. Existing prototype/evidence authorization is retained; this
   catalog grants no additional permission and demands no repeat approval for it.
2. Resolve the product same-login ownership and cancellation design. The current
   synchronous prototype and cross-SID CI cleanup scaffold do not satisfy it.
3. Keep the current filtered-administrator rejection visible until a reviewed
   account policy and real eligible token context are available. Do not adjust
   privileges, UAC or security settings to manufacture acceptance.
4. Scope full Mermaid to the pinned official version. The existing 50 fixtures
   cover 37 built-in registration IDs and selected variants, not all productions.
   Enumerate optional modules/assets explicitly; reject unknown options clearly.
5. Preserve the disclosed UDP/browser-vulnerability residual. Request filtering
   and zero-capability tokens do not establish OS-wide network denial.
6. Attach exact candidate SHA, actual product binary SHA, platform, Runtime
   provenance/version/hash, view/mode/theme/scale, outcomes and evidence paths.
   A prototype image does not prove product integration; synthetic IME events do
   not prove Windows system IME; editor tests do not prove installation/rollback.

These preparations can be reviewed while historical Runtime investigation
continues. No assumption that error 5 was repaired, no new Windows pixel
acceptance, and no new installer delivery follows from this catalog.
