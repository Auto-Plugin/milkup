# Local diagnostic entry — not dispatched or release acceptance

Base: 19ba976bd6994b7549958409890202f6f517c58b. SDK manifest preserves all original 829 exact identities and adds three signed essential-userland records (832 total): dash 0.5.12-12ubuntu3, debianutils 5.23.2build1 and coreutils 9.5-1ubuntu2+0.0.0~ubuntu25; gettext/gettext-base remain 0.23.2-1. `run.py` still verifies fresh Debian archive provenance and Ubuntu signed indexes, safely extracts packages without maintainer scripts, and checks exact source/patch postimages. The upstream detached signature remains rejected.

`run.py NEW_OWNED_WORKDIR` now calls `isolated_configure.run_pipeline` rather than the previous mixed-host PATH/LD_LIBRARY_PATH suffix. The unchanged gate requires Ubuntu 26.04 x86_64, ordinary UID, >=24 GiB free at start, >=8 GiB available memory, a 12 GiB reserve throughout, and 3300 seconds total. On this Debian executor it rejects before authentication/download. Do not lower the gate to exercise the full entry.

The new suffix first hashes actual extracted SDK files and checks required executables, interpreters and ELF version dependencies. A stock root-owned, non-group/world-writable `/usr/bin/bwrap` must admit ordinary user/PID/network/IPC/UTS namespaces. It mounts only the SDK as read-only `/`, exact source read-only `/source`, and a separate owned writable `/work` (never a parent containing SDK/source). It clears the environment. No host `/usr`, `/lib`, `/etc`, LD_LIBRARY_PATH or tool PATH is mounted/passed. No privileged workaround exists.

Before CMake: an actual Python probe checks target Ubuntu identity, glibc 2.43, child Perl module paths, mapped file hashes and disappearance of a host-only sentinel. The host rebinds every observed input to the SDK inventory. Required tool version commands, genuine Clang compile/link/execute and receipts follow inside the same root definition. Namespace arguments and synthetic receipts are not evidence that this ran.

Then CMake uses the original GTK3/API4.1, release/non-developer, print, sandbox and hardening settings, the original final QA prefix, exact authenticated SDK tools, and a complete bounded expanded JSON trace. A 48-site obligation ledger records exact source hashes and conditional impact. Only a real successful configuration can label an unexecuted site as not exercised for that configuration; failed/partial trace remains unresolved. All generated feature/cache/unused-option gates remain.

The real `ninja -t commands` result must match exactly the two preference copies, CSS concatenation, and Perl resource generator. Changed tool, output, count, source escape or injected shell expression is rejected. Only that target is invoked. The graph hash must remain unchanged. The output must exist and be hashed. No engine, install, PDF or native product pass is implied.

Local evidence distinguishes:
- actual lightweight Debian-CMake/Ninja harness with exact Ubuntu Gettext/Perl children and independent MO/CSS checks;
- actual missing-SDK refusal during configure and execution, retained errors and no output;
- pure namespace argv/receipt/graph contracts;
- NOT RUN: full namespace route, full Ubuntu configure, four-command Ubuntu milestone, engine/package/native PDF.

The one-shot workflow/request is bound to parent 19ba976bd6994b7549958409890202f6f517c58b, the exact 14-file scope, current input-lock digest and [webkit-ubuntu-832-isolated-once] marker. Only v2 request-path pushes match, only attempt 1 is allowed, and the sole Ubuntu 26.04 job has a 60-minute cap. It has read-only permissions, anonymous public checkout, no artifact/cache upload, installation or full engine build.

Local evidence-dependent trace tests require MILKUP_CMAKE_TEST_TRACE to name the preserved actual small-chain trace. Missing evidence is an error, never a skip or acceptance. These local contracts are distinct from the real job milestones.

Actual local essential-userland result: `/bin/sh` executes and preserves requested argv0. Ubuntu Rust coreutils correctly rejects direct ELF-loader invocation because `/proc/self/exe` identifies the loader; no workaround was attempted. Its normal execution inside the new SDK root remains an explicit prerequisite. Existing coreutils implementation/aliases were already pinned; adding only Gettext would still have left the SDK without `/bin/sh`.
