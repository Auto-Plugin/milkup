# Native ACL process removal, 2026-11-04

Worktree: /workspace/milkup-mermaid-stability; original worktree is untouched.

Replaced three per-render icacls.exe subprocesses (without CREATE_NO_WINDOW, synchronous output wait) with two SetSecurityInfo/GetSecurityInfo operations on held directory handles. No process Command remains in the launcher. The existing fixed GUI helper launch/Job/token/capabilities/handle-list policies remain unchanged.

Only CREATE_NEW request root and state call sites use the new helper. It validates concrete user and fresh AppContainer SID syntax, directory attributes with FILE_FLAG_OPEN_REPARSE_POINT, observed owner, and empty-directory invariant. No DELETE sharing protects the selected object during checks/set/readback. It never changes the owner, adjusts a token/privilege, changes an ancestor ACL, or takes caller-defined permissions. Descriptors and handles use RAII on success and failure.

Root protected DACL has exactly user F, SYSTEM F, AppContainer RX; state protected DACL has exactly user F, SYSTEM F, AppContainer F plus inheritable Low/NO_WRITE_UP. All allow ACEs use OI|CI. Same-handle readback checks exact owner, protected control bit, ACE count/type/flags/mask/SID and Low label. State ACL is canonicalized to three explicit ACEs, with equivalent effective rights to prior inherited RX plus explicit F; it is not byte-identical.

The original real suspended low-token code/ancestor negative write probes are preserved. A fixed sentinel additionally proves state CREATE_NEW/write/delete-on-close and an independent NotFound check after reverting impersonation. Production evidence never treats missing facts as successful access. Profile deletion now also accepts only explicit symlink_metadata NotFound, not Path::exists false.

New audit directoryAccess exposes fixed booleans/counts/masks only; private paths/SIDs/ACL text are not exported. Finished audit separates per-request renderBlockedAfterFailure, resourceReleaseProven and resourceCleanupUncertain from historical cleanupUncertain. These are not the Registry's accumulated latches.

Local validation:
- Linux --lib: 75 passed, 0 failed; log milkup-native-stability-tests.log.
- Windows GNU cargo check --tests: passed; log milkup-native-stability-win-gnu.log.
- Worst-case audit started 4595 bytes; finished 8169 bytes; original maximum 8192 unchanged.
- Independent read-only reviewer found no blocking ACL/API error; suggested access/reparse/empty-scope coverage was added.
- Added Windows descriptor mutation tests, actual directory set/readback and handle-release tests, native directory-junction rejection with target ACL unchanged, and explicit absence tests. These Windows tests have only been cross-compiled here, not executed.

Pending: actual Windows test execution and standard-user/unelevated-administrator product GUI acceptance, console visibility, repeated rendering, close, full resource cleanup. No push, Windows run, merge, package publication or formal release performed by this agent.

Cancellation boundary: external ACL child process and unbounded output wait are gone. Windows filesystem/security API calls are still synchronous kernel calls; checkpoints observe cancellation after each operation returns. This does not claim arbitrary kernel calls are interruptible, nor establish the old Win32 995 root cause.
