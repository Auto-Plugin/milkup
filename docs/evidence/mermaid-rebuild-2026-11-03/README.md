# Independent Mermaid product rebuild — 2026-11-03

This is a new implementation in an independent worktree, **not recovery of the
missing uncommitted files** from the offline engineering environment. That
environment was not reset, archived, replaced, or used to start another process.

The verified product baseline is `5ea31846e0cd72d52ca6c9ae83a77a695861acaf`.
The separately retained prototype baseline is
`ea5ebcc69d83a6c8eecf4edc73aabd6445b8dac4`. Both were fetched and checked out
separately. Original engineering thread `01a1396a-156f-7138-8cdb-3a3673f27090`
could not be read through a cross-thread tool; Personal Context returned
unavailable. Readable room history confirms earlier test-count reports but
contains no complete uncommitted patch. Those historical 30/133 counts are not
claimed as this candidate's verification. The prototype's product acceptance
catalog contains 17 prepared cases, not executed passing results.

## Rebuilt behavior and boundaries

- Exact manifest and content hashes authenticate the reviewed Diagrams Worker
  1.3.0 package; permission fingerprints alone do not authorize the native engine.
  Dispatch also requires current published catalog generation, committed
  activation epoch, enabled runtime and renderer contribution. Same-ID packages
  cannot obtain the private service. Public plugin SDK/RPC output remains unchanged.
- Native jobs bind the caller main webview, owner and request. The unchanged
  original deadline includes queue/start/render/cleanup. Retirement cancels work,
  waits for pending completion and releases late output; uncertain cleanup fails.
- PNG is a private typed resource authenticated by object identity, validated
  before use, and decoded before source is hidden. Failed/deferred/stale output
  releases owned resources. Aggregate old-plus-new budgets apply. Errors retain
  exact source with a diagnostic. Export retains the existing restricted renderer.
- Wide graphs retain natural size and scroll. C4 labels sit above connectors with
  theme-aware backing; C4 raster bounds use actual content plus 16px padding.
- Linux and Windows use fixed embedded Mermaid 12.2.0. Linux/Windows bundle the
  reviewed Worker 1.3.0; macOS retains its existing DOM package. Receipt migration
  recognizes exact 1.1.1 and 1.2.0 histories and preserves disabled/removal intent.
- No old Fixed Runtime run, runtime installation, main merge, release publication
  or installer delivery is part of this rebuild. Windows compilation is a separate
  isolated candidate workflow and is not Windows pixel/IME/cleanup acceptance.

## Verified so far

The logs below describe actual new executions, not inherited prototype claims.

| Check | Result | Evidence |
| --- | --- | --- |
| Desktop complete Vitest suite | 71 files, 978 tests pass | `logs/desktop-full-tests.log` |
| Isolated module bootstrap | 4 tests pass | same log |
| Desktop ownership/catalog focused checks | 132 tests pass; subset of full suite | `logs/desktop-mermaid-unit.log` |
| Desktop TypeScript and production Vite build | pass | `logs/desktop-typecheck.log`, `logs/desktop-production-build.log` |
| Diagrams Worker existing compiler/renderer | 56 tests pass | `logs/diagrams-worker-tests.log` |
| Exact package identity/tampering | 4 tests pass; native Rust catalog hashes match | `logs/package-seals-test.log`, `logs/native-seal-probe-result.json` |
| Linux desktop Rust type check | pass | `logs/linux-engine-check.log` |
| Fixed bootstrap in installed local Chromium | 112 checks pass, including 50 fixtures × 2 themes | `logs/bootstrap-chromium.log`, `bootstrap/corpus-results.json` |

The bootstrap PNGs in this folder are **local Chromium 154 renderings**. They do
not establish product editor integration, WebKitGTK/WebView2 pixel fidelity,
native scale/IME behavior, Windows same-login cleanup, or installer acceptance.
The corpus source is retained in `fixtures/`; `fixtures-manifest.json` is copied
from the verified prototype baseline. Root review inspected the wide and C4
examples, including the cropped component image; the 100-image automated decode
check is not a claim that a person visually accepted every image.

New core/view private PNG checks also passed (core 202 tests; selected view 187
tests), with implementation/test commits `45618c99` and `02b852a6`. Their separate
execution output is in the engineering session; native results remain separate.

## Native status and remaining acceptance

Linux real native rendering and product editor end-to-end testing are still in
progress. Early attempts failed at WebKit's sandbox setup and missing runtime
paths in this independent environment. The system sandbox remains enabled;
temporary runtime mappings are being tested without modifying system installs.
Do not infer a native success from a frontend build or a Chromium fixture image.

Windows compile/link, actual product rendering, same-login teardown, scale/theme
matrix, standard-user context, and installer upgrade/rollback remain unverified
unless a later result in this folder explicitly records their execution.
Historical cleanup error 5 has not been reproduced or declared fixed.

The inherited Git hook calls `npx lint-staged`, but the v2 baseline has no matching
dependency/configuration. Commits used that hook's documented
`SKIP_SIMPLE_GIT_HOOKS=1` switch; actual package checks, formatting and tests were
run separately. No relevant product check was represented as passing without
execution.
