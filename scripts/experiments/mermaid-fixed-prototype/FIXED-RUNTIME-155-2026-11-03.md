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
