# Windows debug-image primitive experiment — not approved to run

This isolated crate is not a desktop dependency, updater implementation, or installable
component. The requested runtime approval is still pending. Do not run the executable
or `run-approved.ps1`, apply the workflow proposal, push workflow changes, or trigger CI
on the basis of this source checkpoint.

The branch starts at `302dd3901aa70b3a01d147d24578fa7add51fb1b`. Product code, updater
policy, NSIS hooks, install layout, signing configuration and active workflows are unchanged.
All 23 external locked package versions/checksums already occur in the desktop lockfile.
The experiment has its own manifest/lockfile; nothing is added to the product dependency graph.

## Source checks allowed now

```sh
cargo fmt --manifest-path tests/native/windows-debug-handoff/Cargo.toml --check
cargo test --manifest-path tests/native/windows-debug-handoff/Cargo.toml --lib --locked --offline
cargo check --manifest-path tests/native/windows-debug-handoff/Cargo.toml --target x86_64-pc-windows-msvc --all-targets --locked --offline
```

Linux gate tests do not launch children. Windows cross-check is compilation/type checking,
not linking or execution. PowerShell syntax/runtime has not been checked by PowerShell in
this Linux executor, which lacks `pwsh`.

## Exact prospective Windows actions

Only after specific approval: build this crate, then run one supervisor with seven cases,
at most fourteen self-built coordinator/helper children, one case at a time. Each case
uses a fresh subdirectory under an exclusively created `milkup-debug-probe-*` temp root.
The helper is a byte-identical copy of the test executable; its only body writes a small
readiness marker and exits or sleeps. No product executable or candidate installer runs.

The supervisor creates its coordinator suspended and assigns an unnamed outer Job before
resuming. The coordinator creates its own helper with `DEBUG_ONLY_THIS_PROCESS` and
`CREATE_SUSPENDED`, assigns a nested Job, sets debugger kill-on-exit, and resumes. Both Jobs
are non-inherited and kill on last-handle close; neither allows breakaway. Nested-job or
access failure stops the experiment. No privilege or security-setting fallback exists.

The debug loop runs on the creating thread. Only `CREATE_PROCESS_DEBUG_INFO.hFile` supplies
actual-image evidence. NULL is refused. A read-only, non-inherited duplicate supplies a
bounded SHA-256 and file identity; no path reopen substitutes for it. Before launch a
separate file read establishes the expected inert fixture, then closes to avoid changing
the debug handle's sharing conditions. File identity, size and digest must match the event
handle. This observes the executable file, not loaded memory, DLLs, full installation,
Authenticode, signed release, installation completion or application health.

PID alone is insufficient: process creation time and the event process handle must match
the owned `CreateProcessW` handle. The supervisor opens only the recorded helper PID with
query/synchronize rights while it is blocked, then verifies creation time and outer Job
membership before using that handle. There is no debugger attach, memory access, token
modification or third-party process termination. Termination uses the test's Job or the
handle returned by its own failed suspended creation, never a process name.

The marker directory is an experiment coordination mechanism under the runner account;
it is not an authenticated production channel against malicious same-user processes.
An environment opt-in reduces accidental execution; it does not grant approval.

| Case | Required result |
| --- | --- |
| normal | Actual event handle binds; helper body runs; exit 0; pinned process signals; both Jobs empty |
| null-hfile | Injected NULL input is refused; actual OS handle presence logged separately; helper body never runs |
| wrong-hash | Altered expectation refused before helper body |
| wrong-pid | Altered PID refused despite otherwise valid event |
| wrong-instance | Same PID with altered creation time refused |
| timeout | Verified helper starts; 2-second coordinator deadline stops only its Job; debug exit and process exit observed |
| coordinator-exit | Coordinator exits 23 without Rust Drop after helper readiness; supervisor observes helper exit before any fallback cleanup |

For negative cases the real debug hFile must still exist; otherwise the hypothesis remains
unproven and the suite fails. Injection tests are not evidence that Windows naturally
returns those values. Coordinator-exit tests the combined OS debug/job cleanup, not which
mechanism individually killed the helper. It is not a power-loss or installer test.

Every role records elevation, elevation type, integrity RID, administrator group presence/
enabled/deny-only attributes and SeDebugPrivilege presence/enabled status. The token is
only opened with `TOKEN_QUERY`. An already enabled SeDebugPrivilege stops before children
are created. Administrator or filtered administrator results never count as ordinary-user
evidence. API access denial is a failure, not permission to elevate. No `runas`, token
adjustment, new user, service, scheduled task, persistent debugger or system setting exists.

Failure criteria include missing/duplicate create event, NULL/unreadable handle, changed
file metadata, digest or instance mismatch in a positive case, accepted injected negative,
unexpected exception/exit, missing helper readiness, changed token context, timeout or
unconfirmed cleanup. The supervisor checks helper exit before terminating its outer Job
as a fallback; cleanup after failure cannot turn that failure into success. The suite
stops at the first failed case and leaves JSON evidence in its ephemeral temp directory.
No artifact or binary upload is proposed.

## Why this does not solve installed-EXE replacement

The current updater calls `update.install(bytes)` after authorization. Its Windows path
uses `ShellExecuteW("open", installer, args)`, then exits the application after launch is
accepted. That status is not a process handle or installation-completion fact. An internal
thread cannot survive `process::exit`. Starting another process from the same installed
EXE may keep that image mapped while NSIS tries to replace it; its separate PID does not
prove the old EXE can be overwritten. Current NSIS hooks only handle the file icon, and
provide no trusted completion handshake.

This test deliberately runs from build/temp paths and performs no overwrite. It cannot
settle that conflict. A later design would need an explicitly reviewed lifetime and trust
contract for a temporary coordinator outside the replaced image (including dependencies,
signature/digest binding, pre-exit transfer, cleanup and compatibility), plus trusted
installer completion and ownership of application launch. Copying the full Tauri EXE
would also duplicate its binary/dependency footprint temporarily; a small separate helper
adds a separately versioned/signed distribution component. No package-size number is
claimed without a real build and design decision. Neither alternative is implemented here.

After this bounded test, stop for the integration decision. Do not add further Unverified
product modules to compensate for a failed or missing Windows primitive result.

## Official contracts reviewed

- [CREATE_PROCESS_DEBUG_INFO](https://learn.microsoft.com/en-us/windows/win32/api/minwinbase/ns-minwinbase-create_process_debug_info): image handle provenance, NULL and ownership.
- [WaitForDebugEvent](https://learn.microsoft.com/en-us/windows/win32/api/debugapi/nf-debugapi-waitfordebugevent): creating thread and event handle lifecycle.
- [DebugSetProcessKillOnExit](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-debugsetprocesskillonexit): establish a debug connection first; exit behavior.
- [Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects): child membership and nested ownership.
- [DeleteFileW](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-deletefilew): open/mapped-file deletion constraints; no claim about actual NSIS overwrite success.
- [GetTokenInformation](https://learn.microsoft.com/en-us/windows/win32/api/securitybaseapi/nf-securitybaseapi-gettokeninformation) and [TOKEN_ELEVATION_TYPE](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ne-winnt-token_elevation_type): read-only token facts and split-token distinctions.
