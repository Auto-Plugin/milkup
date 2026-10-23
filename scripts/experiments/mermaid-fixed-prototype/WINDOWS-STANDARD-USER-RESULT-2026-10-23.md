# Fixed Mermaid: actual Windows rendering under a temporary standard user

The independent prototype passed its bounded Windows matrix at source
[`82fb49e95caf99ea45654f552992eff81f72bee9`](https://github.com/Auto-Plugin/milkup/commit/82fb49e95caf99ea45654f552992eff81f72bee9),
[run 39918541123](https://github.com/Auto-Plugin/milkup/actions/runs/39918541123),
job `120297866282`. All **50 positive fixtures produced actual WebView2 PNGs**
that passed complete-file/CRC/decode, nonuniform-pixel, dimension, hash and
expected registration checks. This is successful independent rendering, not a
Milkup product integration or a human visual/readability acceptance.

The user authorized a temporary ordinary account on the disposable runner and
its cleanup. The implementation kept the elevation, Administrators membership,
SeDebugPrivilege, zero-capability AppContainer and owned-Job gates. It did not
change UAC, firewall, existing desktop or Runtime ACLs, install anything, or
modify a user computer. No prototype has been added to a product package.

## Accepted evidence

- The canary passed before the 50-case positive matrix. The five subsequent
  negative/observation fixtures yielded four passing assertions and one neutral
  observation, with no failed assertion or execution-control failure.
- HTTPS link rendering initially exposed an active anchor. The fixed capture
  adapter now removes navigation attributes while retaining rendered children.
  The final HTTPS case reports one stripped target, zero active links and a
  valid PNG; the JavaScript-link case also reports zero active links. These are
  static-output checks, not a test of interactive Mermaid behavior.
- Unknown grammar and an excessive-height diagram were rejected as expected.
  An external-image probe failed in a bounded manner with
  `EncodingError: The source image cannot be decoded.` It is an observation,
  neither a positive render nor proof of complete network denial.
- All 56 recorded host tokens matched the temporary user, were non-elevated,
  lacked Administrators membership including deny-only membership, and lacked
  SeDebugPrivilege. The helper and actual browser tokens had the same expected
  AppContainer SID, zero capabilities and low integrity RID 4096, and the browser
  belonged to the owned Job. The host had medium integrity RID 8192.
- All 56 inner Jobs reached zero active processes, AppContainer profiles were
  removed with folder absence checked, and private trees were deleted. All
  three outer supervisor Jobs were empty. The temporary account, its actual
  Windows profile and the complete test stage were removed. No cleanup errors
  remained. The final run did not need transient-deletion retries.
- Eight Windows Rust tests passed, including a real file handle opened without
  delete sharing: deletion first failed while held, then succeeded after release.
  Additional deterministic tests cover bounded repeated sharing errors, immediate
  access-denial failure, exact SID restrictions and actual tree absence.
- The final run and all three temporary-account retries have **zero Actions
  artifacts**. PNG files were removed with successful test-directory cleanup;
  no Windows screenshot or executable was transferred for visual inspection.

Per-case dimensions, PNG hashes, result status and token/cleanup checks are in
[the sanitized final summary](evidence/windows-standard-user-2026-10-23/run-39918541123.json).
All four new run summaries and their [SHA256SUMS](evidence/windows-standard-user-2026-10-23/SHA256SUMS)
are retained. Each summary records the SHA-256 of the locally preserved,
newline-normalized complete job log. Ephemeral user names, SIDs and stage paths
are omitted or replaced in repository summaries; no credentials are included.

## Preserved failures and fixes

| Run / exact source                                                                                                         | Actual result                                                                                                                                                                                                                                                                                                                    | Correction / retained boundary                                                                                                                                                                                                                                                                                                                                                                                    |
| -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [39893819391](https://github.com/Auto-Plugin/milkup/actions/runs/39893819391) / `5a77d939f5ca83c096f273f21b652f0f8f9328bd` | Earlier elevated runner: 50 children rejected while suspended, zero renders.                                                                                                                                                                                                                                                     | Original evidence remains in [first execution report](WINDOWS-RESULT-2026-10-23.md). Standard-account creation was performed only after explicit authorization; no gate was removed.                                                                                                                                                                                                                              |
| [39915739027](https://github.com/Auto-Plugin/milkup/actions/runs/39915739027) / `8e805bc42a7dc7f55275db58fc3e18f94196f032` | Account description exceeded Windows' 48-character limit; account, stage and render process were not created.                                                                                                                                                                                                                    | Shortened description and added explicit metadata limits in `51b666ceede91527ff7ac72a5ba798f043d0e958`.                                                                                                                                                                                                                                                                                                           |
| [39916116615](https://github.com/Auto-Plugin/milkup/actions/runs/39916116615) / `51b666ceede91527ff7ac72a5ba798f043d0e958` | Canary and all 50 positive renders passed; HTTPS-link assertion failed because official strict rendering retained one active anchor. All cleanup passed.                                                                                                                                                                         | Removed navigation attributes before capture in `377c82167838c6e47178dfc7d2c120eed706661f`; kept the original zero-active-links assertion.                                                                                                                                                                                                                                                                        |
| [39916676286](https://github.com/Auto-Plugin/milkup/actions/runs/39916676286) / `377c82167838c6e47178dfc7d2c120eed706661f` | Canary and 14 positive cases passed. `stateDiagram` returned a 1280×248, 5329-byte render, but private-tree deletion hit Win32 32 after Job emptiness/profile deletion. PNG output was discarded, the matrix stopped and negatives were not run. Account/Windows profile deleted; stage remained after parent ACL access denial. | `82fb49e9` retries only sharing/lock errors 32/33, at most 31 attempts, with no new retry scheduled after the three-second monotonic deadline. Final metadata must prove absence. The newly created case root preserves cleanup access for the exact supervising runner SID, not Users/Everyone. No existing object ACL or renderer token changed. The original holder of the transient lock was not established. |
| [39918541123](https://github.com/Auto-Plugin/milkup/actions/runs/39918541123) / `82fb49e95caf99ea45654f552992eff81f72bee9` | Canary + 50 positives + four negative assertions passed; one bounded observation. All process/account/profile/tree cleanup passed.                                                                                                                                                                                               | Final tested checkpoint; no follow-up CI was needed.                                                                                                                                                                                                                                                                                                                                                              |

The earlier retained stage is a failed cleanup on that discarded disposable
runner. A later green run does not retroactively prove its removal.

## Size and remaining integration decisions

The existing runner WebView2 was **155.0.4283.62**. The unoptimized standalone
prototype executable was **7,688,704 bytes**, SHA-256
`c6e37b2e3ef6e72a48e6ef56d5d664d5aecf995d9d011ddebf6edf213604130d`.
The unchanged official Mermaid 12.2.0 asset is **5,494,801 bytes**, SHA-256
`a8a6a6f805b074a8261a2825c86f99c8054acb3b35f50bb7e24a4f9f2c3c3b9f`.
These are prototype measurements, not a release-build or NSIS size increment;
no new Runtime was installed or bundled.

The matrix covers **37 built-in registration IDs** in the fixed full official
bundle, plus selected feature combinations. It does not exhaust every legal
grammar combination. Optional ZenUML and tidy-tree remain absent; external icon
packs are separate assets. The earlier [scope review](WINDOWS-RESULT-2026-10-23.md#coverage-and-size-still-needing-a-decision)
records those gaps. No package or dependency was added to close them in this run.

Before product integration, the remaining decisions are explicit:

1. Whether to accept the disclosed browser-vulnerability/UDP residual risk for
   the fixed-code service. This run retained ordinary request/navigation
   controls; it did not establish an OS-level all-network guarantee.
2. How to supply the missing optional official modules and local icon assets
   under the same fixed-code/data-only boundary, then actually render them.
3. How to integrate validated raster results, cancellation, stale-document
   protection, DPI/theme/layout and plugin lifecycle in Milkup, followed by actual
   product GUI acceptance and representative Windows pixel/readability review.

This authorization covered the prototype and temporary test account, not
publication, installation, a new production trust boundary or a claim that
Windows Milkup already renders the full official Mermaid engine.
