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
| C4 text contrast correction after the corpus run | 18 checks; 12 C4 examples / 88 leaf labels, minimum nominal contrast 5.6168:1 | `logs/c4-contrast-chromium.log`, `c4-contrast/c4-contrast-results.json` |
| Core private PNG and existing core regressions | 202 tests pass | `logs/core-tests-retained.log` |
| View PNG and related presentation/decoding checks | 187 tests pass | `logs/view-png-tests-retained.log` |
| Linux native backend corpus | 50/50 PNGs generated, decoded, retained; 50 exit and directory checks | `native-linux-helper/README.md` |
| Linux product editor end-to-end | 11/11 operations pass on four self-authored documents, DPR 1 / light theme | `product-linux/evidence/mermaid-private.json` |

The bootstrap PNGs in this folder are **local Chromium 154 renderings**. They do
not establish product editor integration, WebKitGTK/WebView2 pixel fidelity,
native scale/IME behavior, Windows same-login cleanup, or installer acceptance.
The corpus source is retained in `fixtures/`; `fixtures-manifest.json` is copied
from the verified prototype baseline. Root review inspected the wide and C4
examples, including the cropped component image; the 100-image automated decode
check is not a claim that a person visually accepted every image.

The later C4 contrast correction uses each shape's actual fill to select black
or white label text, including grouped Person and custom backgrounds. The full
100-image corpus was not rerun for this C4-only correction; its selected C4
cases and wide controls have separate retained images and hashes. Root reviewed
the final light Component image. Core/view implementation/test commits are
`45618c99` and `02b852a6`; native results remain separate.

## Native status and remaining acceptance

Linux real native helper rendering now passed (fixed assets → official Mermaid →
WebKit snapshot → complete PNG decode/nonuniform pixels → lease release), as did
cancel/cleanup followed by a fresh render. See
`logs/linux-helper-native-evaluation.log` and
`logs/linux-helper-native-cancel-mounted.log`. These exercise the actual backend,
not the product editor. Early attempts failed at WebKit's sandbox setup and
missing runtime paths; temporary mappings now retain the sandbox without system
installation changes. Actual code errors also surfaced and were fixed: response
Content-Type was missing under nosniff, and JavaScript dispatch returned a Promise
that WebKit's native evaluation API could not serialize. Native directory cleanup
now reports deletion failure instead of silently ignoring it (`688fc89a`).

Linux product editor end-to-end execution passed 11/11 operations on candidate
`688fc89aad6c6b4b54cdec87ffa66179e5dd0def`, binary SHA-256
`01487ea1f1fcf22f6c9557b7e0c85d14bd93942d9bbc26c30ace8e6fce5af746`.
This is a custom-protocol debug binary with embedded production assets, not an
installer/release build. The native harness used an independent empty profile,
real keyboard/pointer/GTK file operations, and DOM observation only. It verified
initial pending/disabled state, enable, actual PNG decode, source/caret behavior,
edit+save, replacement image, exact undo/CRLF/Unicode bytes, disable/re-enable,
natural-size wide graph, C4, invalid-grammar fallback, and final unchanged files.
The first attempt failed because the harness expected an active generation before
initial activation; the corrected test explicitly checks pending first and active
after enable. It did not change the product to satisfy that assumption.

Root reviewed actual system screenshots 04, 08 and 09: `XDraft 草稿` changed in the
image, wide nodes remain readable with a horizontal scrollbar, and C4 black text
is visible on light blue shapes. The source and diagnostic are visible for the
invalid fixture. The final report, 22 screenshots, complete evidence hashes and
post-namespace process/port/display cleanup checks are retained in `product-linux/`.
The actual runner, namespace mapping and initial failed-harness evidence are in
`product-linux/reproduction/`; their machine-specific assumptions are explicit.
This establishes only those four documents on Linux WebKitGTK 2.52.6, light/DPR1;
it does not establish all 50 diagrams in the editor, dark/high-DPI/Windows/IME or
installer behavior.

All 50 native backend PNGs were separately inspected using actual image views.
The two per-image review records are in `visual-review/`: 41 pass, 9 warnings,
no severe clipping/blankness/missing glyphs. Warnings include small or low-contrast
labels in Gantt, timeline, Venn, treemap and Wardley; Sankey name/value spacing;
packet's possibly intentional half-row blank area; Cynefin's center divider; and
C4 component relation backing touching a border. These are recorded observations,
not a declaration that every visual issue is resolved. The nominal shadow fixture
contains no actual shadow/filter and does not prove shadow-overflow handling.

Windows run `41630133039` at candidate `ca10c4e1` passed the compile/test/link
steps (private engine 11 tests; desktop 228 pass / 3 ignored), but the overall run
**failed** at the final clean-checkout gate. Its original PowerShell conditional
consumed the changed-file list without printing it. Follow-up run `41630161068`
was **skipped**, not passed.

Exact-source diagnostic replay `41632477668` checked out the same full candidate
`ca10c4e17fa1b8114ba65bd32da8082d625fbe16`, independently of instrumentation
`8b9adfe551593bac125cd867f72e49f621f14a79`. Checkout, dependency restoration,
plugin staging, frontend build and private engine checks/tests were clean. The
first dirty status appeared after desktop `cargo check`: only
`apps/desktop/src-tauri/gen/schemas/desktop-schema.json` and
`apps/desktop/src-tauri/gen/schemas/windows-schema.json`, both ` M`. All captured
text diffs against HEAD were empty and Git reported LF-to-CRLF conversion warnings.
Desktop tests/link passed again; the strict final gate **failed** again. The
original logs, per-phase empty diff files and structured analysis are retained in
`windows/original-source-replay/`. Its path enumeration missed status-only paths,
so raw schema-byte hashes were not captured in that replay. The subsequent
controlled Windows experiment `41635596471` closed the mechanism: original
checkout CRLF (125,620 bytes / 2,411 CRLF pairs) versus HEAD LF (123,209 bytes);
a same-content LF rewrite reproduces the two dirty status entries with no text
diff, and index refresh does not resolve it. Only the two schema paths with
explicit `text eol=lf` stay clean throughout. See `windows/eol-diagnostic/` for
raw logs, byte/index hashes, generator-source provenance and the earlier
experimental limitations. `.gitattributes` now aligns these two checkout paths
with Tauri's LF output. No source gate has been relaxed and no build output was
restored to hide drift. Actual candidate build/UI verification follows below.

Actual Windows product workflow `41635937295` at candidate
`87bfeaf281ace926c54662d9508e88fd896c7cf0` independently passed frontend staging,
private Windows checks/tests (13 pass), desktop checks/tests (228 pass / 3 ignored),
production-asset binary link and the **unchanged strict clean-source gate**.
Checkout, desktop-check and final snapshots all show the two schema HEAD/index/
worktree byte hashes equal, LF, and completely empty raw Git status. Binary
SHA-256 is `56b5e222408084d8131ed20e18a789198ffe3e19d218454d41983477a66851e6`
(29,960,192 bytes). This closes the build-drift correction with a real build.

The overall run still **failed** in the test wrapper before account creation:
PowerShell found two Node executable paths and concatenated them. No standard
account, product process or diagram was started. The runner's interactive desktop
was observable and existing Evergreen 156.0.4314.50 plus its signed matching driver
were found; this does not establish access from the intended standard account.
The owned staging directory was removed, with no cleanup errors. Commit `16c2a422`
selects the first resolved executable for Node/PowerShell; a two-match local
regression reproduces the original bug and verifies the scalar result. The next
attempt must still pass every source, identity and cleanup gate.

`windows/product-attempt-41635937295/` retains the raw log, run metadata, original
artifact ZIP and all four reports plus artifact manifest. The ZIP digest matches
GitHub, and every artifact file size/SHA was verified. No PNG was produced in this
attempt. These results do not establish Windows product rendering, same-login
teardown, scale/theme or installer upgrade/rollback.
Historical cleanup error 5 has not been reproduced or declared fixed.

The inherited Git hook calls `npx lint-staged`, but the v2 baseline has no matching
dependency/configuration. Commits used that hook's documented
`SKIP_SIMPLE_GIT_HOOKS=1` switch; actual package checks, formatting and tests were
run separately. No relevant product check was represented as passing without
execution.
