# Windows account acceptance: original failed run 41692476025

Exact candidate `5e683405e48231595f66f998fb89d04d04f05514`, attempt 1, [original run](https://github.com/Auto-Plugin/milkup/actions/runs/41692476025). Overall acceptance remains **failed**. Filtered-admin passed all ten product steps and four natural UI closes. Pure-standard failed at its first diagram because native cleanup was uncertain; no diagram PNG was published or accepted for that account. The two accounts' outcomes are not combined across different runs to claim a complete passing matrix.

The original artifact ZIP is **366067 bytes**, SHA256 `a8968f297d0de0e2942f60f0f1f475169bc09389c837a425b207b2c8efb41c53`, artifact ID `13260506549`. Its API source/run, size/digest, both manifests and all 64 retained files were verified. It was downloaded once. `extracted/` preserves all original report, fixture, log and PNG bytes. No binary, installer, user profile, password, signed download URL or private Library identifier is archived.

## Exact scope and verified successes

`source-delta.json` confirms that the only non-evidence changes from the previous candidate `c377f56212353ed26eda82a4fc24a1bcfb4b2e27` are the two Node acceptance-harness files. Native code, the private engine, bootstrap, worker plugin and account workflow are unchanged Git objects. This build's actual EXE is 30262272 bytes, SHA256 `e3108d2cd1043dac6ec04a0dd30106909c714617d49f76b4d33a791e88ccca3d`; it is a development build embedding production assets, using existing Evergreen `156.0.4314.50`. It is not the previously delivered installed beta.8 binary or a newly tested installer.

Windows private-engine tests passed 54 with 3 ignored; desktop tests passed 228 with 3 ignored; Node tests passed 150. A separate explicitly selected actual elevated-host negative test passed before admission with no helper launch. Checkout, desktop-check and final source snapshots remained clean without index refresh or restoration. The negative test is not elevated GUI acceptance.

Filtered-admin's actual host is non-elevated, medium integrity, Limited, with deny-only Administrator membership. All twelve admitted native jobs finished; eleven started and nine succeeded, with one cancellation and two bounded unknown-grammar failures. Each started job has the four required native token observations, including helper-context browser inspection and independent coordinator inspection. All Limited linked-authority observations satisfy actual target type 2 and identification level 1. All twelve jobs satisfy strict inner cleanup. Seven diagram PNGs are bound to native successful-output bytes and hashes; ten screenshots are also fully decoded. All four real UI closes are accepted with exit code 0, no signal, no fallback and no unsaved-dialog acceptance bypass.

The filtered-admin close records in this run include `no such window` and `invalid session id`, but no `target frame detached`. The newly handled detached-target branch is covered by regression tests; this Windows run must not be described as having exercised that particular response. Null and closed-context responses retain their original meaning and are not inferred to prove that no dialog existed.

## Native cleanup failure retained for pure-standard

The only pure-standard job was admitted, started with valid four-view token proofs, and finished with `rendererStatus="ok"` and `capturedPngBytes=2606`. Those captured bytes were not retained as an accepted PNG: `pngBytes=0`, `pngSha256=null` and `successful=false`.

Its original typed cleanup evidence is:

- `cleanupUncertain=true`; `privateTreeRemoved=false`.
- Cleanup failure kinds: `stdout-join`, `stdout-protocol`, `stderr-join`, `stderr-budget-or-read`, `private-tree-delete`.
- stdout: read error 995 in `trailing-byte`, after stop was requested; its synchronous I/O cancellation succeeded and its thread finished after 59ms.
- stderr: read error 995 after stop was requested; cancellation succeeded and its thread finished after 60ms. stdin finished without cancellation.
- The owned Job reported zero active processes, all IPC threads finished, and AppContainer profile deletion succeeded. These facts do not prove private-tree deletion or make the protocol failure successful.

The product therefore retained source and a diagnostic and refused to publish the diagram. Its shutdown gate also refused to report confirmed native cleanup. After the unchanged 15-second UI-close wait, the harness used its identity-verified exact-owned-process fallback: the original product exit is `exitCode=null`, `signal="SIGTERM"`, `closedByUi=false`. This is not an accepted UI close. The three retained pure-standard PNGs are window screenshots, not diagram output.

The closed audit does not contain the private-tree deletion's numeric OS error or attempt list, so it cannot establish whether that failure was a sharing violation, access denial or another condition. Nor does this run establish the cause of historical cleanup failures. No timeout, protocol, privilege or cleanup gate was relaxed during collection or offline verification.

Both outer supervisors subsequently proved empty Jobs, complete empty exact-SID process observations, profile/path/ProfileList/HKU absence, account and Users/Administrators membership removal, and stage deletion, with empty cleanup-error lists. This confirms outer cleanup and does not overwrite the failed inner cleanup.

## Reproducible evidence checks

`verification.json` separates complete artifact integrity from product acceptance: filtered-admin passes, pure-standard and the overall matrix fail. `native-ledger-partial-verification.json` preserves the first complete-matrix replay, which rejects pure-standard's missing three launches. `native-ledger-available-records-verification.json` then checks only the records that actually exist: pure-standard's four token proofs are valid, but the original `verifyFinished` correctly rejects cleanup certainty. It does not invent missing launches, PNGs or successes.

The exact candidate harness was frozen before the run. Its LF blob has 86209 bytes and SHA256 `c32bce853495a104ca638889773e17b1d8f051de63fe6d0abcfd7efc4cd95f90`; replacing its 2192 LF bytes with CRLF yields exactly 88401 bytes and SHA256 `f53d5c237d9d14770e6303ebcd00becae6e93b4c3fbfac57223527eab0ccd3c9`, matching both actual Windows reports. The offline verifier imports only this frozen LF module and accepts only the exact derived Windows hash. It performs no arbitrary source normalization. The verifier's sixty synthetic cases and its old-run controls are retained.

The closed reports allow checking that the frozen harness accepted each successful held-process exit within its 15-second wait. They do not expose the original monotonic deadline as a separate numeric field, so this archive does not claim to recompute that deadline independently.

No eight-close, two-account overall pass, new installed release, elevated GUI rendering, real IME matrix, DPI matrix or all-grammar acceptance is claimed. The delivered beta.8 ZIP and all historical raw failures remain unchanged.
