# Final validation entry — prepared, not executed

Wait for explicit Root CPU GO and frozen input confirmation. This preparation ran no test, typecheck, version check, formatter, build, browser, compression or copy. The script requires --cpu-go, a new unique run name, an exact approved HEAD and explicit mode; these flags document scheduling and are not approval themselves.

Examples only, not yet executed:

    python3 -B run-final-validation.py --cpu-go --run final01 --expected-head <APPROVED_FULL_SHA> --mode workspace
    python3 -B run-final-validation.py --cpu-go --run browser-full02 --expected-head <APPROVED_FULL_SHA> --mode browser

Use mode all only if Root grants one continuous slot for the full sequence. Workspace sequence is package-serial full tests, types, version check, workspace build, full-repository Prettier check, git diff check. Browser mode first lists exactly 197 cases, then executes the complete unfiltered suite with workers=2, retries=0 and the original config deadlines. Failure-only retained trace is enabled, alongside the bounded formatting fixture diagnostics; retain original failure outputs. No test selection, retry, deadline increase, auto-install, or corrective formatting is permitted. A later pass must remain separate from full01's 196/197 failure and target01/02 evidence.

Cloud wrapper and nested pnpm PATH are used; dependency verification auto-install and package-manager auto-switch are disabled, Corepack network disabled, Playwright downloads disabled. Only existing /usr/bin/chromium is used. Each command records UTC start/end, monotonic elapsed time, PID, exact command, exit and full log. Before and after each command, source/lock/config/test and staged bundled-plugin hashes are captured. Any source or HEAD drift stops remaining steps. Build outputs are expected but source mutation is not. Actual Vitest/Node summary lines and Playwright JSON stats are retained; never infer totals from old checkpoints.

No-overwrite output names protect M02 historical failures. Format is check-only and must not rewrite evidence. Full-repository format occurs before the new M02 raw archive is copied; if copy precedes a later formatter pass, Root must explicitly add the frozen M02 path to the repository's existing evidence-ignore policy, not rewrite raw payload. Trace sizes and final logs are reviewed under the provisional 16 MiB archive plan. M01 is never a write destination.

On process completion immediately release CPU to Root; do not opportunistically add checks or reruns. Diagnostic retained traces can be larger than ordinary logs; disk must be reviewed at the actual GO. This script has only been written/read as preparation and has not been executed or syntax/type tested yet.
