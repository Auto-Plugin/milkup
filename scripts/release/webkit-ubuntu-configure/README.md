# One-shot Ubuntu configuration gate

Explicit v2-only push request, exact parent, attempt 1, one stock Ubuntu 26.04 job; 60 minute job limit and 3300 second internal limit, with 12 GiB reserve. No global package install, maintainer scripts, default Ninja target, runtime application launch, uploads, caches, secrets or automatic continuation.

Provenance is Debian archive InRelease -> Sources -> exact 2.54.3 upstream archive bytes. Direct upstream detached signature remains rejected for expiry; no claim of upstream-signature success. Review the public pinned archive keys and fingerprints independently. Signed Ubuntu indexes authenticate all 825 packages, preserving the original 716. Packages are extracted only into job-owned space and set-ID modes are not recreated. Source patch postimages are locked.

Only after actual Clang compile/link fixture and exact GTK3/API4.1 release/default-sandbox CMake generation does the gate allow the four-command UserAgentStyleSheetsData resource milestone. A changed dependency closure is rejected. No complete engine, installation, native PDF, driver, or release acceptance follows from this gate. Logs contain bounded phase/identity/failure data only; owned outputs are removed at job end.
