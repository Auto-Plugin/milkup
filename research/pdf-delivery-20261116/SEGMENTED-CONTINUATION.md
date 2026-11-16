# Actual graph continuation, two clean jobs

This manual QA operation (`current-object-segment`) builds no runtime or package.
It uses the locked official WebKitGTK 2.54.2 source and unchanged normal-path patch,
GTK3/API4.1/Soup3 release configuration and default sandbox. No 2.52.6 objects,
private research runtime, fake target or altered compiler flags are accepted.

## Executable boundary

The actual configured Ninja `bmalloc` dependency command order selects the first
28 libpas `.c`-suffix sources. The real configured compiler for these sources is
clang++ with C++23. They have no PCH edge and are disjoint from the ten previously
compiled WebCore objects. The entire configured graph and toolchain are retained.

1. A clean Ubuntu 26.04 job prepares the approved generated headers, executes
   the first 24 original object edges with normal Ninja, and writes a content-bound
   checkpoint. Compilation uses two jobs with ccache disabled.
2. A **different clean job** repeats configuration/header generation but never
   compiles those 24 objects before restore. It checks exact source, patch, graph,
   ABI/options, compiler/tools, SDK inventory, generated headers and entry identity.
   It rejects altered identity, a damaged archive/member and an actual changed
   source input before restoration. Then it restores 24 objects and normal Ninja
   dependency/log metadata. Running the 24 targets must execute zero compilers;
   running all 28 must execute exactly four new compiler commands. Old object
   hashes must remain identical. Native dependency records must be VALID and
   correspond exactly to actual output timestamps.
3. Both jobs produce an explicit relocatable `ld -r` result and a bounded object
   checkpoint. **Neither is a complete engine/shared-library link.**

Every compiler depfile input is hashed before any object write. Only verified,
owned source/generated-file timestamps may be restored; host SDK content and
mtime must already match and are never changed. Full Ninja graph/configuration
and generated-header hashes must remain unchanged across execution. The only
native metadata transported is the exact selected-output Ninja log and a native
dependency log proven to contain exactly those completed objects. No environment,
credentials, arbitrary source trees or runtime binaries are archived.

## Budget and stopping

Each job has a 30-minute hard limit and a shared 1,560-second work deadline from
its own start; 240 seconds are reserved for bounded evidence retention/upload.
Compilation is capped at 900 seconds per stage inside that shared deadline;
partial link is capped at 90 seconds. At least 8 GiB disk and 2 GiB available
memory are required. Checkpoints have a 256 MiB total limit and 32 MiB/member.
A failed producer prevents the successor from starting. Completed objects and
original failure logs are retained even on failure. There is no automatic retry,
full-engine fallback or old-version cache fallback.

Local prerequisites include the retained real WebKit compile DB/graph selection
and a real Ninja/compiler clean-directory restoration test, not only mocked state.
The local test also proves a later changed header makes restored objects dirty.
Actual cross-job success remains unproven until both new jobs reach their terminal
states. Earlier 43859140947 compiled the comparison objects first; its success is
not being reused as this new proof.

## Still open

This first bounded batch cannot predict complete engine time or the largest
shared link's peak RAM. It establishes the transport/skip mechanism on real
previously uncompiled dependency objects. A broader continuation must bind PCH
and all prerequisite outputs, preserve the same graph and record actual progress
before estimating full engine completion. Final-prefix runtime closure, package
install/upgrade/recovery, maintenance/SBOM and same-package native PDF remain
separate mandatory gates; no research result substitutes for product acceptance.
