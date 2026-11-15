# One same-package Windows visibility run: 43674323919

Run https://github.com/Auto-Plugin/milkup/actions/runs/43674323919 completed
**failure** at harness `92e27a1b98c4aa4bb367ca8babbe8c8c4fe96c7e`.
Only this one native diagnostic was dispatched. No product rebuild, installation
matrix, ETW capture, production configuration or system security change occurred.

## Passed prerequisites

- Existing Edge 156.0.4314.58, Playwright 1.61.1, `chromiumSandbox:true`; no browser
  installation or no-sandbox argument. The real-layout positive/negative fixture
  passed: clipped image was not visible; intentional source exposure produced two
  samples and 32.5 ms between first visible source and decoded image; warmed
  control had zero source samples and was explicitly decoded at its first sample.
  This is a measurement fixture, not Milkup rendering or physical paint evidence.
- Original build 43616134287/artifact 14122777302 metadata and internal package
  identity passed. Exact installer SHA-256 remained
  `6fe28bcd235dc04993b1889f3c4bb5086e4e86cc2ad06da0172098ba1f974902`.
  Installed executable SHA-256 remained
  `5845ef28a2c27d87c2cd459c0c583e6f984b4323518408cd073288b6426cc433`.
- Actual fresh pure-standard account, medium integrity, no Administrators group,
  held Job, non-inherited parent environment and exact process birth/image proof.
  Actual installer returned 0. Existing runtime was used, not provisioned.
- Actual Windows PowerShell parse and verifier positive/negative tests passed.

## First diagram observations

One process: PID 1388, creation FILETIME `134391884823639796`.
First DOM observation was installed after attachment and file-open verification.
It did not see an already-decoded image at its first sample. All times below are
this single CI sample, not a percentile, cold OS-cache benchmark or optimization.

| Boundary                                                     |     Observation |
| ------------------------------------------------------------ | --------------: |
| Process creation → observed layout-visible decoded first PNG | about 4351.5 ms |
| Frontend initial-document-ready mark → that observation      |        866.1 ms |
| Mermaid fixed owner assets-read → connection ready           |          386 ms |
| Actual first render started → finished                       |          233 ms |
| Render finish → frontend first-decoded mark                  |     about 11 ms |
| Frontend first-decoded mark → rAF visible observation        |         10.5 ms |
| Maximum rAF gap in initial observation                       |         29.5 ms |

The historical ~20-second startup tail did not reproduce. Native setup entered
at 1794714884094 ms; navigation started at 1794714884119, Wry main-resource callback at
1794714885038 and content loading at 1794714885047 (all are epoch milliseconds).
The Wry handler itself took 1.468 ms. Existing raw startup records remain intact.
No new cause for the previous long tail is claimed.

## Exact failure and causal boundary

Cursor interval: pointer input at 1794714886770 ms, 40 arrow movements began at 1794714886790. The assertion `Cursor did not rerender` failed (`2 !== 1`) and the image
DOM instance changed. Both requests were successful and had exactly the same
source hash and PNG hash; this was not rendering of a different prefetched graph.

| Request                            |      Admitted |       Started |      Finished | PNG SHA-256                                                        |
| ---------------------------------- | ------------: | ------------: | ------------: | ------------------------------------------------------------------ |
| `6d60b578389d4777a996f459505df650` | 1794714886453 | 1794714886461 | 1794714886694 | `b28f3895c9d7255d97cadf07d95c98fcfeca566c4160740ed010ba7e6e279a1e` |
| `624b24260e184364ada21c5fd52f5269` | 1794714886835 | 1794714886853 | 1794714887046 | same                                                               |

Source SHA-256: `ed6c1c45e641854fc978b72aef8b7f3e55c38b8d11fc4e8f961e042367bb71fa`.

**This does not isolate cursor causality.** The pre-input startup snapshot had no
`plugin-catalog-ready` mark; catalogue preparation was still underway. Native
prepare 15 started at 1794714886713 and took 63.185 ms, overlapping the first pointer.
Read-icon commands followed at 1794714886830–1794714886838. The application code's
`desktopPluginManager.ready` callback calls `refreshPluginContributionsInViews`,
which clears the presentation cache and recreates the small editor. That is a
concrete competing cause consistent with the duplicate render and replaced DOM,
not a proven disposal-stack attribution. No-input through catalogue completion
and a separate post-ready cursor interval would distinguish it. No speculative
product change was made on the strength of temporal coincidence.

The failed cursor assertion stopped before either offscreen entry. Thus:

- Immediate cold-entry and independent prefetched entry: **not executed**.
- Normal UI close / owner release: **not accepted**. Failure cleanup forcibly
  terminated the product; final streams drained, but that is not normal exit.
- Actual NSIS uninstall: **not executed**. Outer Job/account/profile cleanup
  passed with no cleanup errors and does not substitute for these missing proofs.
- No complete window/zero-console audit was requested or claimed in this narrow run.

## Observer defect discovered and locally corrected

The model and standalone HTML fixture initially treated a visible `.milkup-line`
rectangle as visible source. Actual Milkup replaces that host's children with the
preview while leaving the host visible (`document-presentation.ts` paint path).
Consequently the reported **51 source-visible frames are not valid source-flash
evidence**, including a false source sample in the decoded frame.

The correction walks only nonblank visible text ranges outside presentation and
hidden-marker subtrees, with a 4096-node per-line bound. A new deterministic
regression and the real-layout fixture now model the actual retained source-line
host. The corrected observer/fixture has **not** run on Windows yet. Do not apply
its expected semantics retroactively to this artifact.

The follow-up harness also records startup marks before/after input, keeps the
startup-overlap classification, and preserves count/owner failures while allowing
independent entry measurements and real normal-close attempts. Final verification
still rejects changed admissions or image identity; it cannot turn the original
failure green. Fatal measurement errors now try identity-verified UI close before
forced cleanup, with separate failure-close evidence.

Corrected local Node regression: **115/115 passed**, syntax and formatting passed.
PowerShell corrections after the native run still require their next Windows
parser/fixture gate. No second dispatch was made under the one-run instruction.

## Original evidence

Artifact **14144759518**, 32,316-byte ZIP, SHA-256
`cf6981acd29a6d69da1d97ed7fdb05788c11423ba8634d1eaccf184b6c36a95a`.
Downloaded original ZIP hash, CRC, extraction paths and expanded budget checked.
Local original: `/workspace/milkup-visible-native-43674323919/artifact.zip`;
raw reports under its `raw/` directory. This workspace is temporary storage.
The original artifact retains the browser probe log, native process/stream proof,
application audit and startup records, first PNG and failure reports. Raw data was
not rewritten by the observer correction.

Persistent private retention: Library file
`libfile_fde3_f-aa66161dd3d48191bcfc60637738a819_0ca5afc9150881919eb83108db749c2b`,
`milkup-visible-evidence-43674323919.zip`, 49,478 bytes, SHA-256
`8581360435808313b217af1a4a15d47d68f9fbd1ab37a0cb75e46ee1c363d118`.
It includes the unchanged original artifact, report and clearly labelled untested
native corrections; no private user document or screenshot was included.
