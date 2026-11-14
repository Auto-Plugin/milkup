# Product guardian parent-SIGKILL probe — prepared, not run

Only external evidence files are changed. No build, runtime test, GTK/WebKit launch, or product change has been performed during preparation. Python AST parsing and `bash -n` are static checks only.

Inputs and exact hashes are in `parent-kill-preparation.json`. The product binary was rebuilt after the first native run; its **current reviewed SHA must be supplied**, not the stale `2eb8…` SHA. The native owner identified the guard library through the actual executable dependency file. The wrapper rejects a guard hash mismatch, and Python rejects a binary hash mismatch before launching it.

After an exclusive UI/CPU slot and narrow-namespace execution approval:

```sh
bash /workspace/milkup-mermaid-engine-evidence/product-native-01/parent-kill-run.sh \
  parent-kill-01 \
  /workspace/milkup/apps/desktop/src-tauri/target/debug/build/milkup-desktop-c72ae893c4ab7ce9/out/libmilkup_dom_guard.so \
  5b1082768123b9ac1923eb8ef3f6f8c0bd05ffd5d66b8b2a023f75b69106c44c \
  ACTUAL_REVIEWED_CURRENT_BINARY_SHA256
```

The command needs the same `require_escalated` namespace capability review as the prior narrow runner. It retains the empty root, readonly runtime and fixed X118 socket, isolated network, and WebKit sandbox. It maps only the new observer script and exact guard library in addition to the product binary, replacing the old unit-test executable. Only the fresh profile and evidence directory are writable. `parent-kill-wrapper.diff` shows all changes from the existing runner.

The observer lives inside that restricted namespace but **outside the simulated App/guardian tree**. The namespace remains alive until evidence and assertions are complete; bwrap teardown cannot count as product cleanup. The observer is a subreaper, and it spawns only one simulated App, so all subsequently adopted children are attributable to this test. It records namespace PID, birth time, parent/group/session and CPU ticks; these are namespace identities, not mislabeled host PIDs.

The simulated App alone creates and retains the FD4 stop-pipe writer. Its child execs the actual product executable in `--milkup-internal-dom-helper` mode, with result FD3, control FD4, and the exact native extension in a private directory. No other process keeps the stop writer alive. The actual product guardian forks the actual GTK/WebKit helper. Initialization keeps its 10-second deadline; a real default-export plugin verifies nonzero Unicode getBBox and viewport within a 2-second task deadline. The next task synchronously loops forever. Before the original 2-second execution limit, the observer requires increasing CPU ticks in an owned, non-zombie WebKitWebProcess and then uses a pidfd to SIGKILL **the simulated App only**. It never closes FD4 on the App's behalf or sends a graceful stop. An owner-side guardrail closes its own writer at 2 seconds only if the intended SIGKILL fails; that path is a failure, never a pass.

Success requires the owner to have exited by SIGKILL, the actual guardian to exit zero, every observed owned PID/birth to disappear, and the exact private extension directory to be removed by the guardian, all before namespace teardown. Raw `DOM_NATIVE_TIMING` lines, if delivered, are retained separately. The product guardian's successful exit follows its `waitpid(-1)` ECHILD branch; the summary labels this code-path evidence rather than inventing a direct kernel-syscall trace. The trace logger is asynchronous, so a missing diagnostic line does not itself prove the branch did not execute.

Failure is preserved without retry. After a failed verdict the observer performs separately labeled, bounded emergency cleanup using exact PID/birth checks plus pidfds. Emergency cleanup never changes the verdict to pass.

Outputs are under `parent-kill-runs/<name>/result`: original snapshot, provenance, owner/observer events, 50 ms process/CPU samples, raw guardian stdout/stderr and summary. Naturally observed late descendants and group changes are retained. This test cannot make sandboxed DOM code fork arbitrary OS children. The native owner's separate `guardian_adopts_unsampled_escaped_descendant_on_control_eof` test exercises that shared guardian path; it must remain separate evidence, not be described as a real Mermaid/WebKit escape. This probe also does **not** validate the Rust App `Instance` watchdog, complete editor integration, or guardian SIGKILL survival.
