# Mermaid plugin strategies: Windows evidence, 2026-11-09

## Exact candidates and downloadable package

- Accepted application source: `9e7b825a3a9b6eb27786c0c18316b195095de01a`,
  [source acceptance 42563952707](https://github.com/Auto-Plugin/milkup/actions/runs/42563952707).
- Packaging candidate: `d06d31486b349c51a183d022378b04138aa2ba16`,
  [installed acceptance 42569506864](https://github.com/Auto-Plugin/milkup/actions/runs/42569506864).
  Protected application sources are identical to the accepted source. Packaging-only
  changes pin and verify the official NSIS assets before compilation; both downloads
  succeeded on their first attempt. Earlier attempts 42566346681/1 and /2 failed
  at official NSIS HTTP 504, before any installer existed.
- Lifecycle harness: `074bf281e380c33881a06e5f2fd3b26140d4e397`,
  [same-installer lifecycle 42572760369](https://github.com/Auto-Plugin/milkup/actions/runs/42572760369).
  It downloads the immutable accepted package; it does not rebuild the application.

[Download the tested package ZIP](https://github.com/Auto-Plugin/milkup/actions/runs/42569506864/artifacts/13653464012).
GitHub reports retention until **2026-11-16 06:20:53 UTC**.
Installer: `milkup-2.0.0-beta.10-windows-x64-d06d31486b34-setup.exe`, 7,097,133 bytes.
SHA-256: `0e6f44631600c420d0517ae6d6f3822f87271ca2721a818c73c6f7a274d3bee2`.
It remains an unsigned current-user test installer requiring existing Evergreen
WebView2. No Release, tag, main merge, automatic rollback or republished installer
was created by this work.

## Independently checked results

Four fresh installs used four distinct account SIDs and the exact same installer.
Both pure-standard and filtered-admin product reports passed all 11 steps. Both
installed GUI reports passed the full strict contract, including:

- Default preview, immediate disable/re-enable, Mermaid-only source/render/mixed
  strategies, real caret input, editing/save/undo/redo, 12 syntax families and an
  actual invalid-grammar renderer error. Ordinary Markdown, enabled Math, original
  editor mode/layout, document version and dirty state stay unchanged by strategies.
- Natural size, horizontal wheel, restoration to fit and unchanged document bytes;
  image ownership and render admissions are reused across unchanged caret movement.
- Twelve compact and twelve spaced diagrams, each with 15 visits including returns;
  18 trusted wheel events per account during the rapid-scroll burst.
- Idle/busy UI closure with pending work 0/1, exit 0, drained stdio, internal release
  evidence and no forced termination. Complete window observers, no overflow,
  positive controls passed, zero visible product or unattributed consoles.

The lifecycle matrix passed **12/12** cases in 12 distinct accounts. Each case
passed all 11 new-product steps, baseline installation, upgrade, same-version
installation, real UI closures, actual NSIS uninstall and preservation of six
saved documents. Both account kinds cover:

| Baseline                                       | Cases per account                           | Evidence boundary                                                                                               |
| ---------------------------------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Actual user beta.10 `40c66b69`                 | enabled, explicitly disabled                | Real old UI choice and untouched restart; same old WebView profile reused; saved 125% application zoom retained |
| Shipped beta.9 `a5556bee`                      | enabled, explicitly disabled                | Real old UI choice and untouched restart; same old browser profile reused                                       |
| beta.9 plus controlled approved-plugin fixture | same version/different bytes, startup throw | Synthetic prior plugin, explicitly identified in receipts; not a historical release variant                     |

All explicit disabled choices survived initial upgrade. The startup-throw cases
retain `MILKUP_SYNTHETIC_PRIOR_STARTUP_FAILURE` diagnostics and restore the approved
original bundle; same-version/different-byte cases also restore its exact digest.
The four actual beta.10 cases prove appearance persistence. Beta.9 preparation does
not capture that appearance field: an initial external verifier incorrectly applied
that beta.10-only requirement to all cases; it was corrected to the existing baseline
contract. Raw CI evidence and acceptance gates were unchanged.

## Performance observations (not a distribution)

| Installed measurement                             | Pure standard | Filtered admin |
| ------------------------------------------------- | ------------: | -------------: |
| Process birth to navigation                       |    2741.03 ms |      714.33 ms |
| Navigation to first decoded diagram               |    2563.30 ms |     2522.20 ms |
| Process birth to first decoded diagram            |    5304.33 ms |     3236.53 ms |
| Prefetch renders before/after nearby scroll       |         8 / 8 |          8 / 8 |
| Additional cache hits after nearby scroll         |             7 |              7 |
| Rapid 18-wheel burst                              |     901.37 ms |      893.91 ms |
| Burst completion to visible decoded return target |      92.68 ms |       69.40 ms |

One fresh-account launch per kind, debugger attached. The first sampled visible
frame after prefetch was already decoded; this does not measure physical display
latency or immediate cold-scroll behavior. Prefetch is bounded to nearby 256 lines,
eight fences and the existing 64 MiB budget, not the whole document. Cache usage
was about 4.9 MB. Navigation-before-startup variability remains unexplained and
previous sporadic frame/driver startup failures are not declared root-caused.

Both installed product audits had eight frontend connections reach ready. The
only renderer errors were the deliberately invalid fixture (`unknown-diagram`).
Consumer-aborted stale work remains recorded. Initial driver `/status` readiness
probes failed briefly; one 4.6 ms close-confirmation probe was aborted as the product
normally exited, with exit/stdio/internal cleanup independently complete. No such
observation is omitted merely because the overall run passed.

## Original evidence identities

All downloaded archives passed SHA-256, ZIP CRC and safe-path checks. Product and
GUI reports, declared file inventories, PNG hashes, process generations and package
contents were checked independently of the Actions conclusion.

| Artifact                        | ZIP SHA-256                                                        |
| ------------------------------- | ------------------------------------------------------------------ |
| Delivery `13653464012`          | `b8f4b92e5f1d6fd5450580dc2c91406967b0881b5b5dbcf17688d72fdaae78bf` |
| Installed reports `13653991469` | `7e9b2827514631d6a52fc377facc41212b9abe0fba2af2bf3c68dae99263e3db` |
| Inspection `13654115843`        | `07e85caf04206336c22199d4d01202cf06c35b9ea4664a3f7033f44253bf0c4a` |
| Lifecycle `13654992617`         | `6ea2291d763581eaf201708e8a9b735ba241d4e5cbfbfc5772a744cce4672bae` |

The full compiled application hash is
`4e5d7c1b97bdc160ee571def39944c14e24359502e08fe38a07c9331072a96fc`;
the actual installed image hash after Tauri's documented NSIS marker conversion is
`e00dba6947c58711613548f2cdd2163b0ae7f45108ff87036e3f7ba87fc78088`.
The lifecycle comparison image is a verified copy and is never executed.

## Manual check and remaining scope

Install the package, open a copy of an ordinary Mermaid Markdown document, then
use **menu → plugins → Diagrams details → Mermaid 渲染策略**. Test source, render
and mixed while moving the caret inside/outside a fence; verify unrelated Markdown
and Math do not change. Scroll to nearby diagrams and rapidly back and forth, edit
one diagram, save, close normally and reopen. The package includes sample documents.

This is not complete beta.10 acceptance: full real IME/system-DPI coverage, every
Mermaid syntax combination, immediate cold rapid-scroll behavior, a cold-start
latency distribution, arbitrary JavaScript hard termination and automatic rollback
are not established. 125% application zoom is not system DPI. Existing export and
input/resource limits remain. No user-machine result is inferred from hosted CI.
