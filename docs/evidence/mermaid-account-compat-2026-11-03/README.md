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

Local policy, account-fixture, close-probe and rendering regressions have passed;
their exact outputs are retained separately. Separate real Windows
pure-standard and filtered-admin product runs, plus actual elevated-host rejection,
are required before claiming compatibility. Local policy tests or a matching
account name are not native execution evidence.

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
