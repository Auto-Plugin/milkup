# First-failure deletion diagnostic (prototype only)

Base: `5c8f9b8949923e95adeb3ce6b1d15da55def5733`.
Native candidate: `0a40abfb1eb571f9c67099fca775dfabcd758c29`.

Run 39939237277 rendered gitGraph but failed private-tree cleanup with OS5.
The later seven access-open probes could not identify the failing delete API.
This candidate records the first API failure and terminal propagated failure
inside an isolated adaptation of the locked Rust 58cf8f9c deletion algorithm.
It is not instrumentation of the linked standard library and is not a product
replacement deletion implementation. Extra allocations/observations can affect
timing. The actual CI compiler and installed Runtime versions must be recorded;
a newer compiler does not establish equality with its current std implementation.

The reviewed mode runs only the existing flowchart-v2 canary followed by one
existing gitGraph fixture. A canary failure stops before gitGraph. No automatic
full matrix, PNG export, artifact upload, toolchain/Runtime install or installer
execution is added. The ordinary mode remains on std::fs::remove_dir_all.
The fixed engine, inputs, Cargo files and account supervisor remain at 82fb49e9.
Token gates, Job ownership, AppContainer profile deletion and failure cleanup
rules remain in place. Product integration and its changed trust boundary remain
outside this prototype authorization.

The adaptation preserves root access/share/flags, relative NtOpenFile with
OBJ_DONT_REPARSE, empty-name Unicode ABI, 1024-byte enumeration and stack/restart
semantics, consumed-handle closing, disposition flags and fallback only for
87/50/1. Inner retries remain 50 yields for sharing/dir-not-empty; existing outer
32/33-only bounded retries and independent root-absence verification remain.
OS5 is not retried. Native first/last outer attempts are retained (at most two),
with explicit omitted intermediate count. Each report is capped at 8 KiB and
relative path display at 256 UTF-16 units with full length/hash. The PowerShell
log projection suppresses a diagnostic exceeding 20 KiB.

Primary sources (MIT notice retained in RUST-DELETE-LICENSE-MIT):
- https://github.com/rust-lang/rust/blob/58cf8f9c35b355199727627d07ae34a4e2846d67/library/std/src/sys/fs/windows/remove_dir_all.rs
- https://github.com/rust-lang/rust/blob/58cf8f9c35b355199727627d07ae34a4e2846d67/library/std/src/sys/fs/windows.rs
- https://github.com/rust-lang/rust/blob/58cf8f9c35b355199727627d07ae34a4e2846d67/library/std/src/sys/pal/windows/api.rs

Preflight: seven Linux tests passed on existing rustc1.99.0 after restoring
locked build crates; initial offline fetch failed because image was uncached.
No package/lockfile/dependency change. Six new Windows-specific tests await
actual CI: empty root/Unicode ABI, nested Unicode and directory buffers, real
sharing conflict, missing/wrong-type inputs, inert mapped copy of this test EXE
(no execution) producing disposition denial, and bounded first/terminal reports.
Independent review corrected empty Unicode MaximumLength and retention of the
last outer attempt. Local Windows target, PowerShell and rustfmt are unavailable;
no Windows execution or formatting pass is claimed here. Adversarial junction
execution remains untested. New CI results must be appended without erasing
failures or converting a non-reproduction into a fix.
