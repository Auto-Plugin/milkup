# Final01 complete validation

Baseline HEAD: `78e9329004d2ff244585d98dbe0d7cdd98ab9495`. Frozen source includes the final uncommitted P7 candidate and test changes; this is not a claim that HEAD alone includes them. Input identity SHA256: `6be37e168026a5c7d60bc6f6e68c151aff04213f5b089840df86d07f1dda5af1`. Before/after snapshots include tracked/untracked source, configuration, tests, lockfiles and all 11 staged plugin archives.

| Step | Exit | Started UTC | Finished UTC | Seconds |
| --- | --- | --- | --- | --- |
| workspace-tests | 0 | 2026-10-19T13:43:40.100571+00:00 | 2026-10-19T13:45:08.707277+00:00 | 88.607 |
| workspace-types | 0 | 2026-10-19T13:45:09.032304+00:00 | 2026-10-19T13:45:47.305153+00:00 | 38.273 |
| version | 0 | 2026-10-19T13:45:47.841199+00:00 | 2026-10-19T13:45:48.667408+00:00 | 0.826 |
| workspace-build | 0 | 2026-10-19T13:45:48.877137+00:00 | 2026-10-19T13:46:23.874211+00:00 | 34.998 |
| full-format | 0 | 2026-10-19T13:46:24.139842+00:00 | 2026-10-19T13:48:37.969657+00:00 | 133.831 |
| diff-check | 0 | 2026-10-19T13:48:38.342242+00:00 | 2026-10-19T13:48:38.411521+00:00 | 0.069 |
| browser-list | 0 | 2026-10-19T13:48:38.581126+00:00 | 2026-10-19T13:48:40.259719+00:00 | 1.679 |
| browser | 0 | 2026-10-19T13:48:40.440047+00:00 | 2026-10-19T13:58:21.768072+00:00 | 581.329 |

Actual full workspace result: **2,561 Vitest tests in 194 files, plus 4 Node tests**, all passed. Types, version, workspace build, full-repository Prettier check and git diff check all exit0. `final01-summary.json` reports allPassed=true and inputDrift=false. Each step has complete command/log/exit and input snapshots. No automatic installation or corrective edit was performed.

The unfiltered browser suite actually ran **197 cases**, expected197 / unexpected0 / skipped0 / flaky0, errors=[]; workers2, retries0, original test/config deadlines. Existing system Chromium154.0.8037.57 was selected. Retain-on-failure traces were enabled; passing traces are not retained by Playwright. This is an independent complete run, not an inference from partial tests. CPU was released immediately after the final browser/identity check, before native candidate04 build.

## Preserved historical boundary

`browser-full01` independently ran all197 on the earlier clean78e93290 state and failed one formatting fixture (196 pass /1 fail). The absent toolbar assertion happened before the named 760×520/125% geometry was applied; retained screenshot was1280×720. Its exact root cause remains unknown because original registry/console/trace evidence was not captured. Test-only bounded diagnostic attachments do not constitute a product fix. `browser-target01` selected zero tests due to an incorrectly anchored grep and remains a failed invocation. `browser-target02` ran the original case once with retries0 and passed. None of these originals was overwritten by final01.

## Environment disclosure

During final01 browser execution, Root preserved an idle release/build cache by moving it to /tmp and replacing the original path with a symlink, 2026-10-19T13:53:36.675828Z–13:53:37.518875Z (0.842862 seconds). No active Rust/native process or source/bundle/browser artifact was changed; 324 historical zombies were not touched. See environment/release-build-cache-relocation.json. This background I/O is disclosed, not assigned as a cause of any timing observation. This suite is functional browser regression, not native performance acceptance.

No Windows/macOS/native IME validation, runtime download, upload, release, commit or push is established by this validation. Native candidate04 results and M02 final archive integrity are separate and pending.
