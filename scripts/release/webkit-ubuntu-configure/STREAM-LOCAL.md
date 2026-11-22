# Local streaming collector candidate

Base: fce75b5e24dc7e9364cd995d9f7267775bf76f10. Not pushed or dispatched.

The normal isolated entry now sends CMake's actual JSON trace to an owned FIFO. It reads 64 KiB chunks, hashes/counts every byte, validates every record and source path, and retains all 48 required sites. Every other event remains in a file/line/command catalog with count and ordered argument digest. Dependency operations (find, include, subdirectory, execute, try_compile/run and pkg-config calls), including sites absent from the old 48, retain exact distinct argument variants and their counts. Other command semantics are explicitly unclassified; their arguments are digested, not presented as analyzed. No unknown command silently becomes a dependency pass. Unknown schema fields, malformed records, changed/missing/unbound source files and exhausted bounds fail.

There is no full raw trace file. Bounds are: 2 MiB record, 4096 source files, 16384 command sites, 8 MiB metadata, 8 MiB retained required/dependency arguments, 128 variants per retained site, 1 GiB total stream processing, 2 million events, 8 MiB process log and 32 MiB serialized summary. These are failure boundaries, not truncation thresholds. Existing 24 GiB start/12 GiB reserve, 3300-second total, 900-second configure, 300-second resource and default namespace/SDK policies remain unchanged. The 1 GiB processing limit does not reserve or write a 1 GiB trace to disk.

Exit zero AND pipe EOF AND complete parsing AND stable source identities are necessary for a complete trace. Absence is reported as `not-executed-in-complete-trace` only then; failures keep it `unresolved`. Observed sites remain observations, never implicit acceptance. A separate certificate requires generated print/API/sandbox flags, cache, graph and compile DB; another admission checks these hashes again and exactly four resource commands. A successful process/trace alone cannot authorize resources.

Local repro:

- `python3 stress_configure.py NEW_OWNED_DIRECTORY /tmp/milkup-sdk-2543-20261122/sdk` uses the pinned **Debian** CMake fixture (SHA 9a2692f4d712265eb29c90c3366bfc40df400ea586b0477edabbcf3bae745dc1). It generates >64 MiB actual JSON, a tail event, a real small CMake cache and Ninja graph. It is not WebKit/Ubuntu acceptance.
- `MILKUP_CMAKE_TEST_TRACE=/tmp/milkup-isolated-entry-20261122/light-chain-final/actual-trace.jsonl python3 -m unittest test_run test_isolated_configure test_trace_obligations test_stream_trace` also needs the retained exact source/SDK/graph fixtures referenced by those tests. Missing fixtures error rather than skip.

This candidate's input lock is refreshed, but the request digest and one-shot launch scope are deliberately NOT updated: the prior launch entry cannot admit these changed files accidentally. A separately reviewed real Ubuntu run remains necessary. No current full WebKit configuration or four-resource execution is claimed.

Locale investigation separately authenticates libc-bin 2.43-2ubuntu2.7 (c0393ea4fa3c45cefe0351db369d3a4a459edc8045856f2e3612ca17e77b2797), missing from the 832 plan and containing C.utf8 data. The local Perl test without target LOCPATH used host locale data (proved with openat), so it is not a valid isolated negative. Explicit target locale data works locally. The package lock is not silently changed here; a future root must include/authenticate that provider and test effective UTF-8 locale without host fallback. No locale warning is suppressed, and no application Unicode/locale acceptance is inferred.
