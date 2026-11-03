# Official Fixed Runtime 155 investigation and bounded test

## Verified provenance, before Windows execution

On 2026-11-03 the [Microsoft WebView2 download page](https://developer.microsoft.com/en-us/microsoft-edge/webview2) listed Fixed Version `155.0.4283.62` for x64, x86 and arm64. The x64 URL below was read from the official page, not guessed or taken from a mirror:

`https://msedge.sf.dl.delivery.mp.microsoft.com/filestreamingservice/files/232cf50b-3980-4531-afbb-779f446d7de1/Microsoft.WebView2.FixedVersionRuntime.155.0.4283.62.x64.cab`

Actual HTTPS download: 310,492,238 bytes, SHA256 `cf54aa717a0ebd05b40e87620724583cb6eb0a5b8b64764cc11e42822f68bf6c`. Static CAB file-table inspection: 256 files, 705,180,320 expanded bytes. The Linux copy was neither extracted nor executed. This hash identifies the observed download; it is not a substitute for publisher verification.

The [official deployment guide](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution#the-fixed-version-runtime-distribution-mode) documents CAB extraction and an explicit browser executable folder without installing/registering the Runtime. Fixed mode does not update itself and must use a local filesystem. The [Microsoft Runtime terms endpoint](https://developer.microsoft.com/microsoft-edge/api/eula/webview2?locale=en-us) is the same endpoint previously accepted by the user and includes development/test use. No separate installer or new agreement was executed here.

Source captures were read locally, not published in full: official page SHA256 `23c8521167c57534055cdc409c829be335faeb5c2e76cc5228a2c97c0ed40d48`; EULA response SHA256 `821657eb0994850b0ea86b53242c52a22016e45859fee74bcd456dd77c0ba18e`.

## Exact temporary test scope

The isolated existing prototype branch may select `[mermaid-fixed-runtime-155]` only with the single deletion-diagnostic corpus: one flowchart canary, then the historically failing gitGraph. No full matrix or automatic retry. Native source is pinned to `dbc9811d0c405ba59d7c9ca93182d1889b6286f0`; fixed official Mermaid, fixture, dependency, and supervisor inputs remain pinned to the already reviewed baseline.

The fresh disposable-runner stage receives the one exact official CAB. Preparation checks HTTP status/no redirects, exact length/hash, valid Microsoft CAB Authenticode, bounded CAB names/counts/expanded bytes before extraction, and every PE signature after extraction. Only the browser entry must be Microsoft+x64+exact version; Microsoft’s complete signed CAB also contains x86 helpers and vendor-signed components. There is no unsigned fallback or selective package pruning. Failed verification prevents launch.

The complete immutable manifest is placed in the protected `code` directory. The trusted temporary standard-user coordinator controls only the fresh Runtime directory; native code grants read/execute only to each exact test AppContainer profile SID. No broad application group, existing Runtime directory, firewall, UAC or system Runtime registration is changed. Native checks every pinned file/hash, read-only child access, and actual browser PID image path before sending diagram text. Handles stay pinned until the owned Job is empty, or until supervised host exit after an uncertain cleanup. Profile-specific read grants may remain on the fresh Runtime until outer stage deletion; that is not claimed as immediate revocation.

The existing approved temporary account/password creation and cleanup mechanism remains unchanged. CAB, Runtime, account and test profile are removed after the bounded test. No Actions artifacts, Runtime binary, installer, credential or real document is uploaded. Authenticode may use normal OS trust/revocation services; renderer isolation and the disclosed UDP/browser-vulnerability residual are unchanged. This is a prototype test, not authorization to add this Runtime or service to the product.

## Verification status at preparation

- Linux existing locked offline tests: 7 passed. The new Windows-only module was not compiled by that result.
- Independent static review covered launcher lifetime, complete manifest binding, path/reparse/hardlink checks, child access probes, preparation failure cleanup and PowerShell/native schema agreement.
- PowerShell parser/synthetic metadata tests, 4 new Windows file/manifest tests, actual CAB/PE Authenticode, Fixed Runtime startup and the two render cases require the Windows run. They are not claimed passed by this preparation record.
- The original OS error 5 remains unresolved. Modern installed Runtime 156 passed diagnostic and original-std controls; version/layout differences prevent calling that a historical fix. Even a successful Fixed 155 run would not recreate the old machine or Evergreen installation byte for byte.
- Product integration remains unimplemented; [the acceptance preparation](PRODUCT-INTEGRATION-ACCEPTANCE.md) and [17 prepared cases](product-integration-test-cases.json) record the private service/PNG ownership, cancellation, migration and visible-document requirements without claiming execution.

## Actual bounded Windows result

[Run 41618128815](https://github.com/Auto-Plugin/milkup/actions/runs/41618128815), exact source `d41810d8d73c6a7c57fca29a9a437089a042ebe7`, completed successfully. PowerShell preflight and 22 Windows Rust tests passed. Prototype EXE: 7,969,792 bytes, SHA256 `2b08d5939faf9164e050a9c65b96d9723ac2a8c1ad365251da73bc531832a77c`.

The real CAB had a valid Microsoft Authenticode signature; all 39 PE files passed Windows signature verification. The complete protected manifest SHA256 was `5bfdc4b42dfd55839d557623bb564b55e9a62ec3b870c46f44b0bb6b8c79f0c3`. Each run pinned/hashed all 256 files and 17 directories, verified 1,960 forbidden-access denials and 273 readable/execute opens using the actual child token, and matched the browser PID image to this temporary Runtime. The installed Runtime inventory was still 156.0.4314.50; it was not selected or modified.

Both flowchart-v2 and gitGraph rendered valid nonuniform PNGs using Fixed155. No terminal directory deletion failure occurred. Owned Jobs were empty, profiles/private trees were absent, and Runtime pins were released after Job emptiness. The outer temporary account, profile and complete stage (including download and Runtime) were deleted with no cleanup errors. Actions artifacts: zero. This diagnostic run did not retain PNG bytes or establish full-ink visual acceptance.

[Machine-readable case/signature/cleanup evidence](evidence/windows-delete-2026-11-03/run-41618128815.json) preserves the actual result. The historical error5 is still not reproduced, not fixed and not attributed to a specific path or Runtime version. Current-Fixed155 success does not reproduce the original Evergreen155 layout or machine. The next existing-scope visual matrix uses installed Runtime156 and original std deletion, retaining its images; it is not another attempt to claim a historical fix.

## Same-host historical prefix follow-up

The old failure was the sixth fixture inside one host process; the two initial Fixed155 cases used separate hosts. A single additional bounded run therefore selects exactly the original first six reviewed fixture records in order (`c4`, `flowchart-v2`, `agentflow`, `swimlane`, `er`, `gitGraph`), following one separate canary. It rejects changed records/order/unknown selectors and saves the first failed record before stopping, including ordinary rendering failures. It does not dispatch the remaining 44 fixtures. Native source checkpoint: `3b03127cb46afcbda68180dbf28ba0cc3625401b`; Linux locked offline tests: 10 passed. Windows outcome is pending at this preparation checkpoint. The preparation changes no rendering fixture, engine or Runtime trust policy.
