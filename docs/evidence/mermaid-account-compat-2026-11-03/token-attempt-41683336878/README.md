# Dual-context token observation 41683336878 — diagnostic complete

[Run 41683336878](https://github.com/Auto-Plugin/milkup/actions/runs/41683336878),
attempt 1, exact source `0783bd63aa92bef8908df8dd0ea3aa157b82ff2b`.
Windows private Rust tests passed 43 cases (3 explicitly ignored); wrapper
regressions passed 28 cases. Both real fresh account fixtures completed their
fixed native probes. All three read-only source snapshots remained clean.

The single downloaded artifact is `13254618161`, 25,239 bytes, SHA-256
`35c81f01539b1a6cc86f24a6f8c0d1f52716c494a2d0aefe6ca91e9516b619dd`.
API provenance, ZIP digest/size, the exact 20-file allowlist, both manifest
layers, executable hash references, and stdout/result identity all verified.
`verify-native-observations.py` additionally checks the actual identity chain,
full privilege lists, both linked-token views, each duplicate result, and exact
profile/account/process cleanup. Original reports remain unchanged.

Both actual AppContainer primary tokens were low-integrity (4096), zero-capability,
same-user/session (2), non-elevated, and without UIAccess. Their complete privilege
lists were exactly `SeChangeNotifyPrivilege` (attributes 3, enabled) and
`SeIncreaseWorkingSetPrivilege` (attributes 0, disabled). Both caller threads
actually returned `ERROR_NO_TOKEN` (1008); no impersonating caller was assumed.

| Observation | Pure standard | Filtered administrator |
| --- | --- | --- |
| Host/helper elevation type | Default 1 | Limited 3 |
| Helper administrator SID attributes | Absent | Deny-only 16 |
| Parent and self linked query | Failed, Win32 1312 | Succeeded in both contexts |
| Original linked handle actual access | No handle | 983551 / `0xF01FF` |
| Linked target type/level | No target | Impersonation 2 / Identification 1 |
| Linked target elevation/integrity/session | No target | Elevated Full 2 / 12288 / 0 |

The filtered linked target retained administrator attributes 15 and 24 privileges.
In the AppContainer self view, all three separate `DuplicateHandle` requests
succeeded, with actual masks 10 (`QUERY|DUPLICATE`), 9 (`QUERY|ASSIGN_PRIMARY`),
and 12 (`QUERY|IMPERSONATE`). Each resulting token still had type 2 and level 1.
Every returned handle was closed immediately. Thus the observed handle was
**not query-only**, and duplicate-request rejection cannot be used as the safety
argument. The Identification level is the relevant observed constraint; official
[ZwDuplicateToken documentation](https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/ntifs/nf-ntifs-zwduplicatetoken)
restricts raising an impersonation level or converting such a token to primary.
This probe did not attempt token duplication, impersonation, privileged process
launch, or privilege adjustment, and does not claim an exhaustive exploit test.

Both native children exited naturally with code 0. Owned native Jobs were empty,
both pipes joined without cancellation, and the fresh AppContainer profiles and
private trees were removed. Each outer fixture had zero active processes before
cleanup, no forced termination, no cleanup errors, complete zero-process exact-SID
observations, and confirmed absence of its profile path, ProfileList entry, HKU
hive, account, Users/Administrators memberships, and staged directory.

No COM, WebView, JavaScript, Mermaid source, document, or PNG was run. This is
successful **token observation**, not rendered product compatibility acceptance.
The delivered beta.8 package and production admission policy were unchanged by
this diagnostic. Earlier failed runs and their limitations remain separate.
