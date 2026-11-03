# Opt-in Windows token observation (tests only)

This diagnostic does **not** render Mermaid or change the renderer admission
policy. It exists only in the private crate's `cfg(test)` executable. The shipped
application has no token-probe command, public bridge, or plugin SDK entry.

Run the private test executable under each independently verified fresh fixture:

```text
MILKUP_MERMAID_TOKEN_DIAGNOSTIC=1
MILKUP_MERMAID_TOKEN_DIAGNOSTIC_ACCOUNT_KIND=pure-standard|filtered-admin

<test.exe> --exact launcher::token_diagnostic::parent_observes_suspended_and_self_tokens --ignored --nocapture --test-threads=1
```

`TEMP` must be the fixture's own ordinary writable directory without reparse
ancestors. No Evergreen directory, frontend, installed application, or document
is required. The parent verifies its actual token using the unchanged host
policy, creates a fresh zero-capability AppContainer and creation-time Job, and
pins a copy of the test executable. The launch retains the renderer's fixed
environment, three inherited pipes, suspended creation, code access checks, and
owned resource cleanup. Only the fixed child test is selected:
`launcher::token_diagnostic::child_observes_own_token`.

Before resuming that trusted native test, the parent observes the suspended
child. The child observes itself before any COM, WebView, or JavaScript activity.
No input bytes are written. This test-only baseline permits the two specific
ordinary-privilege Default/Limited observations that the renderer currently
rejects; it does not admit source or execute an untrusted renderer.

Both views record complete bounded privilege LUID/name/attributes, token
identity, elevation, integrity, session, AppContainer, administrator attributes,
and linked-token query results. Actual observer/subject PIDs bind both views to
the held child process. Each caller first queries its current thread with
`TOKEN_QUERY`, `OpenAsSelf=false`; only actual `ERROR_NO_TOKEN` permits the linked
experiment. An existing thread token or an unknown query failure is retained
and fails the diagnostic instead of silently attributing that caller to the
process primary token. Returned linked handles are queried once with a
fixed-size structure and immediately owned. `NtQueryObject` from the already
loaded system `ntdll.dll` records actual granted access; requested rights are
never substituted for observed rights. Linked targets include token type and,
for impersonation tokens, the actual impersonation level.

Only the child-self view tries three separate `DuplicateHandle` requests on a
returned linked handle: `TOKEN_QUERY|TOKEN_DUPLICATE`,
`TOKEN_QUERY|TOKEN_ASSIGN_PRIMARY`, and `TOKEN_QUERY|TOKEN_IMPERSONATE`. Source
and target are the current process; inheritance and option flags are zero.
Each resulting handle is observed and closed immediately. The linked-token
experiment performs no `DuplicateToken`, `Impersonate*`, token assignment, launch using a linked token,
privilege adjustment, `SAME_ACCESS`, `CLOSE_SOURCE`, or `MAXIMUM_ALLOWED` attempt.
The separate, unchanged code-ancestry negative-access check duplicates and
temporarily impersonates the low-privilege AppContainer child token, then
reverts. It does not use any returned linked token. Both linked-query caller
contexts independently prove `ERROR_NO_TOKEN` at the time of observation.

The child has a 10-second original deadline. Each stream and the complete JSON
are capped at 64 KiB; incomplete/oversize output fails rather than being
presented as complete. Checked Job stop, pipe joins, profile deletion, and private
tree removal run even after partial construction. Existing pipe cleanup timings
are unchanged.

The independent final line begins `MILKUP_MERMAID_TOKEN_DIAGNOSTIC ` and contains
schema 1 JSON. `status: "observed"` means both perspectives and resource cleanup
were completely observed; **it does not mean rendering compatibility passed or
that an observed linked token is safe or usable**. `failed` retains the closed
stage/Win32 error and all observations already obtained. The wrapper must also
require the real test process exit code, bounded stream completion, actual
fixture identity, and outer cleanup. Query failure is recorded numerically as
an availability observation, not silently converted to a token with zero rights.

The successful record requires `hostPolicyAccepted`, `creationTimeJobVerified`,
`parentAndSelfIdentityMatch`, both view `complete` fields, `childExitCode: 0`,
`failedStage: null`, and every cleanup proof: `jobCreated`, `jobEmpty`,
`profileCreated`, `profileDeleted`, `privateTreeCreated`, `privateTreeRemoved`,
`ipcCompleted`, and no cleanup errors. `parentAndSelfPrivilegesMatch` is an
observation, since attributes can record use during execution; both original
lists remain available.

Interpretation references:

- [GetTokenInformation](https://learn.microsoft.com/en-us/windows/win32/api/securitybaseapi/nf-securitybaseapi-gettokeninformation)
- [TOKEN_LINKED_TOKEN and CloseHandle ownership](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-token_linked_token)
- [NtQueryObject and the 56-byte public basic structure](https://learn.microsoft.com/en-us/windows/win32/api/winternl/nf-winternl-ntqueryobject)
- [DuplicateHandle](https://learn.microsoft.com/en-us/windows/win32/api/handleapi/nf-handleapi-duplicatehandle)
- [ZwDuplicateToken impersonation-level constraints](https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/ntifs/nf-ntifs-zwduplicatetoken)

Neither `Limited` nor `TOKEN_QUERY` alone proves exploitability or safety. The
actual target type/level, actual handle rights, and distinct calling contexts
must be interpreted together; this probe never exercises an elevation operation.
