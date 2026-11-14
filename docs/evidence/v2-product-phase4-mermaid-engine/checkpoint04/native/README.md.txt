# Frozen production Linux DOM backend mechanism evidence

This archive records the actual generic product Rust guardian/helper and WebKit backend, debug build, on 2026-10-16. It is mechanism evidence, not complete editor or Mermaid renderer acceptance. No source changed between build02 and these first-attempt runtime probes. Both commands exited 0; original raw output and command start/end/exit metadata are retained. No retry occurred.

## Minimal archive inventory

- `source/`: exact owned native sources, Cargo files, build script, bootstrap/tests and SDK index dependency.
- `tracked-native.patch` plus `provenance.json`: base Git HEAD, build profile/command and file hashes. New files are present in `source/`, not omitted merely because Git diff does not list untracked files.
- `bin/`: exact executable, test executable and native extension used for validation. `post-run-binary-check.json` confirms working binary paths still matched frozen hashes after both probes.
- `inputs/`: exact narrow runtime wrappers, observer, preparation notes, freeze script, build02 and direct Rust unit logs.
- `run-recorded.py`, `parent-kill-01.command.json`, `native-02.command.json`: command arrays, UTC start/end, monotonic start/end, exit codes.
- `parent-kill-01.log`, `native-02.log`: original unfiltered command output.
- `parent-kill-artifacts/result/`: exact snapshot/provenance, guardian stdout/stderr, observer events, CPU/PID/birth samples and first verdict.
- `validation-summary.json`: machine-readable results and timing.

Binary SHA256: `a9accf7f1b466e061e03a620b46cbeeef438fa3261caacd074a22473f29f76cb`.
Test executable SHA256: `b32ac5eadea307c3b17cf5d4f820f241e607a352de1f819442ebdbf1c11946be`.
Native extension SHA256: `5b1082768123b9ac1923eb8ef3f6f8c0bd05ffd5d66b8b2a023f75b69106c44c`.

## Actual observations

Native02 passed default-export activation, genuine Unicode SVG text `getBBox` (150.765625 by 24, viewport 1024), exact-URI native guard denial, https/file fetch denial, globalThis/window/self alias tampering, and synchronous infinite-loop termination. All tracked process identities were gone before success.

Loop timestamps relative to native dispatch:

| Phase | Seconds |
| --- | ---: |
| Deadline observed | 2.000161617 |
| Guardian SIGKILL starts | 2.000396263 |
| Guardian cleanup reaches ECHILD | 2.018833747 |
| App confirms guardian cleanup | 2.025976721 |
| Trusted timeout control emitted | 2.026041550 |
| Test receives timeout event | 2.026165938 |

These are scheduling observations, not a zero-latency or exactly-two-second process-death claim. Trace dispatch is emitted just before deadline assignment; the native source is retained for exact interpretation.

Parent-kill01 used an external observer inside the same still-live narrow namespace, outside the simulated App/guardian tree. The actual product WebKit process increased CPU time by 10 ticks during a synchronous loop before the observer SIGKILLed only the simulated App. The guardian exited successfully 28.723361 ms later; every observed PID/birth disappeared and its exact private native-extension directory was removed before observer/namespace exit. Both raw guardian kill-start and cleanup-complete diagnostics arrived. This checks actual guardian EOF cleanup, not the Rust Instance deadline or full editor SIGKILL integration. Escaped setsid child adoption is separately covered by the shared guardian subprocess Rust test; it is not claimed as a sandboxed DOM OS-fork test.

Direct Rust build02 tests: 14 passed, 2 ignored fixture/integration entries. The private ignored fixture is invoked by the passing escaped-child test. The real ignored WebKit test was run explicitly as native02. Earlier bootstrap Node VM tests passed 4/4 (console output existed, no original separate log was saved). Original build01 native run passed, but its complete source/binary snapshot was not preserved; its historical hashes/log remain in `../product-native-01`, and this frozen build02 revalidation closes that reproducibility gap for current code. No fabricated build01 snapshot is supplied.

## Limits

The narrow cloud namespace is a test-environment boundary, not an automatically deployed product confinement guarantee. Native WebKit sandbox, private ephemeral context, exact resource guard and CSP stayed enabled. No proot runner or WebKit sandbox-disable switch was used for either runtime probe. Ordinary Rust tests had one earlier inherited historical runner invocation, explicitly superseded by direct tests with that runner unset.

Full editor UI responsiveness, disable/uninstall integration, renderer conversion and public output-validation acceptance remain separate integration work. Windows/macOS explicitly report backend unavailable. Idle plugin execution has no CPU quota; initialization, lifecycle and active render deadlines are authoritative and stop/release revokes the context. Lease startup qualification expires after 60 seconds; memory reclamation is on prepare/release and bounded by 16 leases/32 MiB snapshots rather than a background expiry timer.
