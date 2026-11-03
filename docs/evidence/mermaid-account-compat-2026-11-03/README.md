# Windows account compatibility follow-up

The delivered beta.8 installer remains frozen at source
`a5431693a4ea1e1a282c16b9cc9651e17b67f9ea`, Actions run `41668620695`,
ZIP SHA-256 `0ffb9793b1ab3c025b6d9d97497260ac3ad8526735bc4f1384343830702da089`.
This follow-up begins after its evidence commit
`1494852518fb449191c839ef8573ba548bbefaa3`. It does not replace that ZIP,
its Library copy, or its original reports. No main merge or Release is authorized.

## Cause and intended boundary

The original launcher rejected all Administrators membership, including
deny-only membership, and every elevation type except Default. This rejection
preceded private profile/Job/browser creation. It therefore rejected the usual
non-elevated UAC administrator launch without establishing an AppContainer
failure. The proposed compatibility scope is a real Limited, non-elevated,
medium-integrity primary token with the current user as owner, no UIAccess,
an exact interactive session, and only ordinary user privileges. An administrator
SID must be deny-only; enabled/default-enabled/owner authority remains rejected.
The old pure-standard boolean keeps its original meaning.

The existing `CreateProcessW` plus creation-time `SECURITY_CAPABILITIES`, exact
handle list and owned Job are retained. No linked-token selection, privilege
adjustment, account switch, UAC change or desktop-ACL change is introduced into
the product. Suspended helper, child self-check and browser token observations
must verify low integrity, no administrative authority, zero capabilities,
the same user/session and exact fresh AppContainer identity before proceeding.
The first candidate additionally required Default elevation type in the helper
and browser, using its lack of a linked token as a conservative proxy. The
subsequent isolated diagnostic below establishes why this proxy must be replaced
by an actual identification-only token check for the supported Limited case.
Elevated, UAC-disabled/default-admin and unrecognized tokens remain unsupported.

Independent review found no need to add `CreateRestrictedToken` or
`CreateProcessAsUser`: the former does not by itself establish all required
token properties, and the latter introduces additional privilege/API conditions.
The account fixtures are separate from product code: only newly owned test
accounts may acquire the group membership needed for their declared test kind.
Actual suspended-token evidence determines whether the fixture is admissible;
a full token is never relabeled as filtered.

Primary references: [deny-only SID semantics](https://learn.microsoft.com/en-us/windows/win32/secauthz/sid-attributes-in-an-access-token),
[creation-time AppContainer attribute](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-updateprocthreadattribute),
[AppContainer access model](https://learn.microsoft.com/en-us/windows/win32/secauthz/implementing-an-appcontainer),
[CreateProcessAsUser requirements](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-createprocessasuserw).

## Other findings

The close probe's `value.value ?? value` unwrapping turns a valid JSON null into
a truthy envelope. The follow-up records bounded raw responses and makes only
literal boolean true a visible-dialog observation. An actual dialog on a clean
successful-close path must fail acceptance; null/closed-frame observation still
requires the exact process to exit normally under the original deadline.
The original beta.8 response was not retained, so its historical ambiguity
cannot be retroactively diagnosed as this specific response.

C4 investigation found a label positioned toward the destination node plus the
private three-unit white background padding. Any correction must leave the
official Mermaid 12.2.0 asset bytes and connector endpoints unchanged, avoid
large reflow or overridden author offsets, and retain before/after images.

## Acceptance status

The latest candidate `b139a9891a086685d7e0e9e85472a29a629f7a45` passed complete
same-run Windows pure-standard and non-elevated filtered-admin product acceptance
in run `41703213523`, including eight natural closes and verified native cleanup.
Its standard account actually exercised the new error-5 retry before successful
removal and PNG publication. This is source-built product acceptance, not a new
installer: the delivered beta.8 remains unchanged. Historical IPC 995 remains
unexplained and was not reproduced in the passing run. Details and the original
failed attempts follow; no historical failure is rewritten as a pass.

### First real Windows attempt: failed

[Run 41675610602](https://github.com/Auto-Plugin/milkup/actions/runs/41675610602)
tested `1f64a10fa6c7c86488ccca31fa90be221c86ca38`. Private Windows tests, desktop
228 tests, production-assets linking, strict source checks and the actual
elevated-host rejection test passed. Both fresh account fixtures produced the
expected real host token: Default/standard and Limited/deny-only administrator.

Both editor runs then failed step 02 before producing a diagram. Each has two
admissions/two finished records, zero ready/browser events and zero diagram PNGs.
The suspended standard child is low-integrity Default with two privileges, one
outside the newly imposed sandbox list. The filtered child is low-integrity
Limited with the same counts. Both were rejected before resume/source delivery.
Host observations directly identify ChangeNotify and IncreaseWorkingSet; the
original child records preserve counts only, so the second child's privilege
name is not yet directly proven.

Every created resource has clean teardown fields, and the exact new profiles,
accounts, group memberships and staging directories were cleaned. The strict
ledger nevertheless rejects these pre-ready rendering failures; resource cleanup
must not be relabeled a passed rendering ledger or product acceptance. Only
failure/window screenshots exist, so this attempt does not validate the new
Windows C4 output or the wide clean-close path. [Original failure evidence](attempt-41675610602/analysis.json)
is preserved without rewriting outcomes.

The next step is a fixed, test-only token observation with no COM, WebView,
Mermaid or document input. It will compare parent and LowBox self observations,
including actual privilege names, linked-token type/impersonation level and
actual handle access. A diagnostic success means observations and cleanup were
complete, not that administrator rendering worked. The rendering gate remains
unchanged while these facts are investigated.

### First isolated token diagnostic: fixture setup failed

[Run 41681937161](https://github.com/Auto-Plugin/milkup/actions/runs/41681937161)
tested `93755eb640b2dc8a1b614c3bd7cf175b253c6ab8`. Its private Windows test
executable compiled, ordinary crate tests and wrapper fixtures passed, and the
strict source gate remained clean. Both fresh-account setups then failed before
account creation: the fixed description prefix plus the complete 32-character
run ID was 52 characters, exceeding `New-LocalUser`'s 48-character maximum.
Neither native parent nor AppContainer probe ran. There are no new linked-token
facts from this attempt. Both owned staging directories were removed, and no
account, profile or native supervisor had been created. The correction shortens
only the description prefix while retaining the complete unique run ID and exact
ownership comparison; it does not change rendering admission.

### Completed isolated diagnostic and revised implementation basis

[Run 41683336878](https://github.com/Auto-Plugin/milkup/actions/runs/41683336878)
tested `0783bd63aa92bef8908df8dd0ea3aa157b82ff2b` successfully. Both fresh-account
native probes completed, with exact identity, process, Job, IPC, AppContainer,
profile, account, group and staging cleanup proofs. The root independently
checked the 25,239-byte ZIP against the API SHA-256
`35c81f01539b1a6cc86f24a6f8c0d1f52716c494a2d0aefe6ca91e9516b619dd`
and every one of the 19 original file records in its manifest. The archive has
20 files including the manifest. [Original observations](token-attempt-41683336878/README.md)
remain unchanged.

Both parent and AppContainer-self views directly observed exactly
`SeChangeNotifyPrivilege` (attributes 3) and `SeIncreaseWorkingSetPrivilege`
(attributes 0). Standard containers were Default; both linked queries returned
Win32 1312. Filtered containers were Limited, low integrity, zero capability,
and administrator deny-only. Their linked handles had actual access `0xF01FF`,
not QUERY-only. All three fixed handle-copy requests succeeded with actual
rights 10, 9 and 12. Every linked target remained `TokenImpersonation` (2) at
`SecurityIdentification` (1). Its high integrity, Full elevation, session 0 and
administrative privileges were preserved as observations, not misrepresented as
the current container's execution authority. No returned linked token was used
for impersonation, token adjustment or process creation. The reused launcher
also retains its pre-existing negative-write access test: it temporarily
impersonates a copy of the low-privilege AppContainer child token, then reverts.
Both linked-token observation contexts were subsequently verified to have no
thread token (Win32 1008). No COM, WebView, JavaScript or document execution
occurred in this diagnostic.

The revised implementation uses the identification-level constraint,
not the presence or absence of handle-copy rights. Windows documents that this
level cannot impersonate, cannot be copied to a higher level or a primary token,
and token type cannot be changed in place. These are the relevant constraints
even when the handle has ALL_ACCESS. The product queries and closes handles,
without importing the test-only duplication experiments. The current executing
helper/browser must still pass the original low-integrity, zero-capability,
same-user/session/fresh-AppContainer checks and the exact ordinary privilege
list. Native helper-self and browser observations from inside the AppContainer,
plus independent coordinator HANDLE/Job observations, must precede document
delivery. Missing, unknown or usable linked targets must fail closed.

Primary references: [impersonation-level requirements](https://learn.microsoft.com/en-us/windows/win32/api/securitybaseapi/nf-securitybaseapi-impersonateloggedonuser),
[token-copy restrictions](https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/ntifs/nf-ntifs-zwduplicatetoken),
[token type is fixed at creation](https://learn.microsoft.com/en-us/windows/win32/api/securitybaseapi/nf-securitybaseapi-settokeninformation#remarks).
This successful diagnostic is not product rendering acceptance. Actual Windows
body PNGs, close behavior and C4 output still require the next product run.

The completed local implementation passed 51 private Rust tests, 119 Node
regressions and Windows GNU library/test cross-checks. Independent review also
checked late-cancellation publication and partial parent-browser observations.
The unchanged 4 KiB Ready and 8 KiB audit budgets cover the tested maximum
records (1803, 4250 and 5803 bytes). [Final local preflight evidence](product-authority-preflight/README.md)
does not claim Windows product execution.

### Conditional policy: actual Windows body rendering, overall close failure

[Run 41688389731](https://github.com/Auto-Plugin/milkup/actions/runs/41688389731)
tested `c377f56212353ed26eda82a4fc24a1bcfb4b2e27`. Windows private tests
(54 passed, 3 ignored), the separate actual elevated-host rejection, desktop
tests (228 passed, 3 ignored), Node checks (137 passed), production-assets linking
and the strict source gate passed. Pure-standard product acceptance passed in
full. Filtered-admin completed all ten body steps and all seven actual diagram
PNGs, but its final invalid-fixture window close failed the harness. The overall
run remains **failed**. [Original attempt and independent checks](attempt-41688389731/README.md)
preserve this distinction.

The 81 native events cover 29 finished jobs with complete teardown and bind all
14 body PNGs to actual successful outputs. All four native token observations
are present on prepared jobs, including the conditional Limited/identification
checks under the administrator fixture. Both temporary Windows profiles,
accounts, Users/Administrators memberships and staging directories were removed
with direct post-cleanup evidence. The two accounts' seven diagram images match
pixel-for-pixel. Six also match delivered beta.8; the C4 image changes only
374 pixels to restore the View node's border, without changing its 564x118 size.
Independent visual review confirms ordinary/wide images and body placement.

The failed close probe retained the exact HTTP 404 response with
`value.error: "target frame detached"`. It was classified as a generic probe
error at 18:04:06.477Z and immediately entered fallback. The held product process
then exited normally with code 0/no signal and drained stdio at 18:04:06.481Z;
fallback's PID lookup failed because the process had already exited. This is
evidence for a narrow close-harness correction, not permission to rewrite the
original failure. The correction must still require the held process's normal
exit within the original 15-second deadline, retain raw responses, reject an
actually observed unsaved dialog and reject generic unknown errors. A new full
two-account run is required for overall acceptance.

### Next two-account run: administrator passed; standard native cleanup failed

[Run 41692476025](https://github.com/Auto-Plugin/milkup/actions/runs/41692476025)
tested `5e683405e48231595f66f998fb89d04d04f05514` and **failed**. Only the close
harness and its tests changed outside evidence since the preceding candidate;
native/product/plugin source objects were identical. The compiled binary has
its own recorded hash and is not claimed to be byte-identical. Windows private
tests (54 passed, 3 ignored), elevated-host rejection, desktop tests (228 passed,
3 ignored), 150 Node checks and the strict source gate passed.

The filtered administrator completed all ten body steps, seven actual diagram
PNGs and four natural UI closes. Its twelve admitted requests all finished with
verified native cleanup. The pure-standard account failed at step 02: one native
request captured 2,606 PNG bytes and passed all four token observations, but
cleanup was uncertain, so no PNG was published. Both stdout's trailing-byte read
and stderr returned Win32 995 after successful synchronous-I/O cancellation.
The owned Job reported zero active processes and the native profile was deleted;
the private tree was **not** confirmed removed. The old audit does not preserve
the tree deletion's exact error, number of calls or elapsed time, so a lock,
permissions failure or retry exhaustion is not established.

Standard-user shutdown did not complete within the original UI-close deadline;
the held product process required the recorded SIGTERM fallback. Its successful
outer account/profile/staging cleanup does not prove product-internal cleanup.
[Original failure and independent verification](attempt-41692476025/README.md)
remain failed. Neither the prior standard pass nor this administrator pass can
be combined into a passed two-account run. The next change records bounded
cleanup stages and numeric deletion facts while retaining strict EOF, ownership
and cleanup requirements; complete two-account product acceptance remains due.

### Observed deletion error: Win32 5 with clean IPC

[Run 41699494037](https://github.com/Auto-Plugin/milkup/actions/runs/41699494037)
tested `b2415e9ec06ac6a5defcac2833de81840a61b007` and **failed**. The standard
account passed its first five steps and published four verified diagram PNGs,
then failed step 06 on re-enabling diagrams. This failure has one cleanup kind,
`private-tree-delete`: the first removal call returned Win32 5 (access denied)
with zero recorded elapsed milliseconds. No retry or final absence check ran.
All three IPC threads completed without cancellation; stdout and stderr reached
normal EOF, stdin finished writing, the owned Job was empty and the native
profile was deleted. The cleanup timeline records Job stop at 15 ms, IPC and
pin release at 21 ms, profile deletion at 26 ms and the failed tree removal at
26 ms. This does not establish which file failed or why Windows denied deletion.

The administrator again passed all ten steps, seven diagram PNGs, four natural
closes and twelve finished native jobs. Outer cleanup for both accounts passed,
without overriding the standard account's internal failure. Its product process
required the recorded SIGTERM fallback and did not pass its natural-close check.
The
72 files and 28 PNGs are retained in
[this attempt's evidence](attempt-41699494037/README.md). Neither this run nor its
normal IPC proves the cause of the older Win32 995 cancellations.

The next candidate evaluates repeating the same owned-tree removal on error 5
within the existing 31-call / three-second limits. It must still establish real
removal and independent absence; persistent access denial remains a failure.
It introduces no ACL/attribute modification or alternative deletion API. This
is bounded recovery for an observed failure mode, not proof of a transient lock
or permission-root-cause diagnosis, and requires new full product acceptance.

### Complete same-candidate acceptance and actual error-5 recovery

[Run 41703213523](https://github.com/Auto-Plugin/milkup/actions/runs/41703213523)
tested `b139a9891a086685d7e0e9e85472a29a629f7a45` and **passed**. Both accounts
completed all ten product steps and seven verified diagram PNGs. All eight
product windows closed through the actual UI with exit code zero, no signal
and no fallback. The complete 70-event native ledger covers 24 finished requests,
including each account's nine successful renders, one cancellation and two
bounded unknown-grammar failures. All created native resources were confirmed
cleaned, with no cleanup uncertainty. One filtered-admin cancellation occurred
before a profile or Job was created; it is not falsely reported as a deleted
profile. Both outer account/profile/group/staging cleanups also passed.

The pure-standard request `d59ba476e8974396a80a6304f47de81b` directly exercised
the fix: the first removal returned error 5, the second succeeded after 142 ms,
and independent absence verification confirmed the tree was gone. All three
streams completed normally without I/O cancellation, prior cleanup errors were
empty, and the product published the actual 2,606-byte PNG. This is observed
recovery from error 5, not merely a passing run without the motivating condition.
The final denied object's identity and the reason for the first denial remain
unknown. No error-5 retry occurred under filtered-admin in this run.

Windows private tests passed 67 with three ignored; the separate actual
elevated-host rejection and desktop tests (228 passed, three ignored) passed.
Source snapshots and the strict clean-checkout gate passed. Both accounts used
the same source-built executable, SHA-256
`70ea7b77f3f775fb50cb2a223d96d24e5a6300bbe65d2a5a46b3efb8ccca5605`,
and existing Evergreen `156.0.4314.50`. The artifact is 540,024 bytes, SHA-256
`9bee0476dfe9eb49907a51ca51ae77cde6c74df75789df76d62da4d5b3fe5048`;
the root independently checked API/source identity and all 85 archive files
against extracted bytes. The frozen original acceptance harness, full native
proof/PNG binding verifier and separate closed cleanup-observation verifier
all passed. [Original successful evidence](attempt-41703213523/README.md)
retains all reports and the actual recovery record.

Both accounts' seven diagram images match pixel-for-pixel. Against delivered
beta.8, only the expected C4 border correction differs; ordinary and wide output
remain unchanged. Neither account had a stdout/stderr failure in this run.
This does not explain or claim to fix the older 41692476025 I/O cancellations.
The delivered beta.8 ZIP was independently rehashed and remains
`0ffb9793b1ab3c025b6d9d97497260ac3ad8526735bc4f1384343830702da089`.
No new installer, production Release, main merge, elevated GUI acceptance or
additional IME/system-DPI/upgrade matrix is claimed.
