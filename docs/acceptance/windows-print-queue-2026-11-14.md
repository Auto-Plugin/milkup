# Isolated Windows application print queue acceptance — 2026-11-14

Application source baseline: `b877746f5dfd236dfc13f718ed23d837b8e4f89d`.
Test branch: `dot/print-queue-acceptance-20261114`.
This work changes the test harness only. It does not release or distribute a product.

## Scope

Use the hosted Windows 2025 runner, its existing Spooler and Microsoft inbox
`prnge001.inf` (`Generic / Text Only`) driver. Create a uniquely named, unshared,
unpublished queue on the local `NUL:` device. Pause it before any application
submission. Never change a default printer, existing printer, service configuration,
security policy, driver-store package or real/shared device. Never purge a queue.

The application test uses a newly created Users-only account, observed medium
integrity token and the existing held-Job coordinator. It opens only a generated
unique-marker Markdown document. Actual W3C input opens the export/print plugin;
native input operates only the exact held output-helper generation and its live
print dialog. The application is built with production custom-protocol assets;
this is not acceptance of the byte-identical historical installer.

Two operations are separate: cancel the native chooser before submission, and
submit a job then remove that single observed job from the system queue. The latter
is **system queue cancellation**, not an application promise to retract a job.
Spool evidence is not physical paper output or layout/fidelity acceptance.

## Completed prerequisite evidence

- Run [43551681526](https://github.com/Auto-Plugin/milkup/actions/runs/43551681526),
  harness `3687c3a1e369335c867d7d60478717d64e5322c1`: read-only capability check.
  Existing Spooler running; Print Management available; sole existing/default
  printer Microsoft Print to PDF. Found Microsoft inbox x64 `prnge001.inf`, SHA-256
  `59fe7f8bf571e38e5eee197d8e246bb6332cf6aeb5dbfe03be35d8e6000fcd9f`.
- Run [43551990812](https://github.com/Auto-Plugin/milkup/actions/runs/43551990812),
  harness `5acba8ea0a589126733fa6ee36fa74e3b1202bb2`: queue created, paused and
  removed, no job. PowerShell port/driver cleanup failed; the overall run failed.
  Do not infer successful cleanup from successful queue creation.
- Run [43552227574](https://github.com/Auto-Plugin/milkup/actions/runs/43552227574),
  harness `005138a371930a2d162da5f59306728d68a71f4e`: same capability test passed.
  Queue, newly created port and newly added driver registration removed; native
  DeletePort and DeletePrinterDriver returned success on the first attempt.
  Driver-store files were not deleted. Default printer unchanged. No job submitted.
- Run [43552536519](https://github.com/Auto-Plugin/milkup/actions/runs/43552536519),
  harness `2746f0cee3c53dc31777a5a245f5f89b7517581d`: checkout failed on historical
  evidence filenames exceeding normal Windows Git path limits. Build and GUI
  skipped. Fixed only Git's checkout long-path setting, not OS/security policy.

Original ZIPs were downloaded via the authorized GitHub connector; API archive
SHA-256, exact byte count, ZIP CRC and member paths were checked before extraction.
Local evidence directories are `/workspace/milkup-print-queue-results-<run-id>`.
These workspace copies are temporary, not a claim of durable external retention.

## Application run

Run 43552641857 (`79dd95a2`) built successfully and verified the ordinary-user
identity. The harness did not scroll the print action into view; no output helper
or spool job was reached. Queue/port/driver/account/profile/stage cleanup passed.

Run 43553424856 (`f49ba5a8`) reached the application print action. The test's
helper selector incorrectly expected `--milkup-internal-output-helper`, which is
the file-output path. The actual print backend uses
`--milkup-internal-pdf-helper` directly. No task submission was accepted by this
run. Queue/port/driver cleanup passed, but temporary profile removal was not
confirmed; the run failed rather than ignoring that evidence gap.

Run 43554097462 (`34a4bf52`) demonstrated native chooser cancellation with no
job, then a real spool job on the exact paused queue: ID `2`, document
`MILKUP_SPOOL_f0137c840f5f4b318592579ef1adadc3`, owned by the exact temporary
ordinary user. The first observation was still spooling (`JobStatus=8`, size 0),
so it is not proof of complete submission. The harness then wrongly required
helper exit 0. The existing backend deliberately waits after writing its framed
result and is terminated by its owner Job; exit 1 alone is not a failure signal.
That test stopped before system cancellation. The job remained, so queue, port
and driver removal were withheld rather than purging unverified state. The CI
machine was ephemeral; no claim of scoped cleanup success is made for that run.
Account/profile/staging cleanup did pass.

Run 43554863556 (`dce31905`) confirmed application submission success and a
complete job (ID 2, 1 page, 1184 bytes). Ordinary-user PowerShell/CIM
`Remove-PrintJob` returned access denied, including the scoped failure-cleanup
attempt. This is a failure of that observed cancellation path, not evidence that
all ordinary-user cancellation requires administrator rights. Queue/port/driver
cleanup was withheld because the job remained. Account/profile cleanup passed.

## Verified final result

Run [43555564933](https://github.com/Auto-Plugin/milkup/actions/runs/43555564933)
completed successfully on exact harness SHA
`d53b4f8969cdc3e5d139267f0b1cd467364e3124`. Independent verification of the raw
reports also passed. Application source directories and dependency manifests have
no changes from the baseline above. The tested executable was 32,470,016 bytes,
SHA-256 `994f4a2670e1c06d523778ee4b0e22ed7aba491191092d6531542a9d3256bd6f`:
a dev Rust build with production frontend/custom-protocol assets, not the original
installer binary.

- The application and coordinator ran as the same fresh Users-only account,
  medium integrity (8192), not elevated, with no administrator group even as
  deny-only. Real application input opened the plugin print action. Native input
  selected the exact temporary queue; no private application invoke was used.
- Native print-dialog Cancel before submission left the queue empty and the
  application showed cancellation. This covers pre-submission cancellation only.
- The second print submitted to paused queue
  `Milkup-Isolated-006d3c58cddc40298dac27e4600b91dd`, Microsoft inbox
  `Generic / Text Only`, local device `NUL:`. Spool job **2**, document marker
  `MILKUP_SPOOL_a7e2d0a364fe42beac2c7dced21f5414`, belonged to the exact temporary
  user's SID. It reached **1 page, 1184 bytes**, no longer spooling, and Milkup
  visibly reported “已提交打印。请在打印队列中查看进度。” before cancellation.
- The ordinary user then opened the exact printer with minimal
  `PRINTER_ACCESS_USE` (8). `GetJobW` rechecked job ID, queue, marker, owner SID
  and submission time on the held handle. `SetJobW(JOB_CONTROL_DELETE)` removed
  that single job; open/get/delete returned Win32 0, the handle closed and the
  queue was empty afterward. This is **system queue cancellation by the ordinary
  user**, not application retraction of an already submitted job. No ACL, policy
  or default-printer modification was needed.
- Milkup exited normally with code 0, without forced product termination. Its
  supervisor Job was empty before outer cleanup. The exact temporary queue,
  newly created port, newly added driver registration, account, profile and
  staging directory were removed with no cleanup errors. Inbox driver files
  were not removed. Existing defaults were unchanged. The fresh test account's
  initial default was the temporary queue and remained unchanged during its
  test; the runner's existing default remained Microsoft Print to PDF.

## Evidence and limits

Original [artifact 14098596086](https://github.com/Auto-Plugin/milkup/actions/runs/43555564933/artifacts/14098596086),
`milkup-print-queue-43555564933`, is 126,961 bytes. Archive SHA-256:
`d41cf85f487acc8404ca6cb87ddcae00cbc2ad36a8993712b8de925ab65cbaf3`.
The API digest, local archive digest, ZIP CRC and member paths were checked.
GitHub reports expiry **2026-11-21 04:20:37 UTC**. Local original and extracted
reports are under `/workspace/milkup-print-queue-results-43555564933/`;
these are temporary workspace copies, not durable external retention.

The original archive includes `build.json`, `print-queue.json`, and
`standard/print-child.json`, `standard/standard-print-supervisor.json`,
`standard/print-ui.json`, `standard/print-dialog-cancel.json`,
`standard/print-spool.json`, screenshots and the generated document.
The adjacent checked-in JSON is an independently derived summary, not a
replacement for those raw reports.

This closes actual WebView2 Print submission, correct queue/job ownership,
ordinary-user single-job system cancellation, pre-submission dialog cancellation,
normal application exit and scoped cleanup for this isolated CI build. It does
not prove physical output, printer fidelity, application cancellation after
submission, a physical printer/driver combination, or the byte-identical
historical installer. No release was published and no user machine, shared or
real printer, security setting or real document was touched.
