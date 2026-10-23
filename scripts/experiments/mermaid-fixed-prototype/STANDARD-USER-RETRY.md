# Authorized temporary standard-user retry

This document records the initial zero-image-transfer retry. The separately
authorized [visual evidence follow-up](VISUAL-EVIDENCE.md) preserves bounded
self-authored PNGs through logs while keeping zero Actions artifacts and the
same account/process cleanup gates.

This test-only follow-up retains the fixed Mermaid 12.2.0 bundle, the 50 positive
fixtures (37 built-in registration IDs), the five negative/observation fixtures,
and the existing zero-capability AppContainer, network-policy and process gates.
It does not add ZenUML/tidy-tree, install a Runtime, integrate into Milkup, or
establish an OS-wide network guarantee. The earlier elevated-runner failure and
its evidence remain unchanged in `WINDOWS-RESULT-2026-10-23.md`.

The user authorized a fresh ordinary local account and random password on the
disposable GitHub runner, with account and test-directory deletion afterwards.
`run-standard-user.ps1` uses a SecureString populated directly from a cryptographic
RNG. The password is never inserted into source, command lines, environment,
files, or logs. The fixed C# supervisor exposes it only through temporary native
memory for `CreateProcessWithLogonW`, then zeroes that memory. Windows itself
temporarily stores account credential records, as disclosed before approval.

The account belongs only to the local Users group. Code/fixtures are read-only
to it; writable state/output directories are private to the temporary identity,
SYSTEM, and the existing administrative supervisor. A white-list environment
excludes runner credentials and WebView2 overrides. `LOGON_WITH_PROFILE` creates
the temporary user's actual Windows profile; relocating environment paths alone
is not treated as profile cleanup.

The process starts suspended. Before resumption the C# supervisor binds its own
kill-on-close Job and verifies the exact SID, absence of all Administrators SID
membership including deny-only, no elevation, and absence of SeDebugPrivilege.
Rust independently repeats the standard-user/SID requirement before creating
any per-case profile. Neither layer adjusts privileges or changes UAC, firewall,
Runtime ACLs, or existing desktop/window-station ACLs. Existing desktop access
may still block execution; that must remain a recorded failure.

A single flowchart canary must produce a validated image and finish cleanup
before the 50-case matrix, followed by the five negative/observation cases.
After every run the outer Job is stopped and checked empty. Finally cleanup
attempts the exact user's Windows profile, account, and test tree independently;
errors remain failures. Uncertain process emptiness or reparse points block
unsafe directory deletion and are explicitly recorded, never passed silently.

Windows run 39916676286 completed rendering `stateDiagram` but encountered a
sharing violation while deleting its private tree after the Job was empty and
the AppContainer profile was absent. It remains a failed run: the outer account
and Windows profile were removed, but the test stage could not be removed.
The follow-up retries only Windows sharing/lock errors 32/33 for at most 31
attempts and three seconds of retry scheduling, records each error, and checks
actual path absence with metadata. No later helper starts before cleanup passes.
Each newly created case root also preserves full cleanup access for the exact
supervising runner user SID, obtained read-only and passed through the explicit
environment whitelist. It grants no access to Users/Everyone or to any existing
system, Runtime or desktop object. Permanent failures still stop the matrix.

This retry has **zero Actions artifact uploads**. Synthetic case summaries,
actual token facts, PNG decode/dimensions/nonuniform-pixel checks/hashes and
cleanup facts remain in Actions logs/summary. PNG files are deleted with the
test tree, so their decoding checks are not a human visual inspection claim.
No screenshot, executable, installer, credential, or user profile is uploaded.

Local preparation: four existing Rust tests and Windows MSVC-target offline
type checking pass. PowerShell/C# compilation requires the existing Windows
runner; a cheap parser/Add-Type step precedes Cargo and account creation.
Windows runtime results must be read from the exact newly triggered SHA/run;
this document does not claim execution passed.
