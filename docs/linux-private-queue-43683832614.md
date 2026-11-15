# Installed Linux non-file queue acceptance — 43683832614

The exact existing 383c0712 deb passed the ordinary-user native queue test in
[run 43683832614](https://github.com/Auto-Plugin/milkup/actions/runs/43683832614).
This is actual Milkup → GTK native printer selection → WebKit print operation →
CUPS IPP backend → loopback IPP receiver evidence. It is not Print to File,
physical paper output, a new product build, or complete PDF fidelity acceptance.

## Candidate and environment

- Tested QA commit: `41e46f4c5339197a3939eeb61babab51ab4f7e74`, branch
  `dot/linux-private-queue-20261115`. Only QA/records changed; no product changes.
- Existing package source: `383c0712f21071467f2549d73a022b03db4b69aa`.
- Package: `milkup-2.0.0-beta.10-linux-deb-383c0712f210.deb`, 9,853,866 bytes,
  SHA-256 `8cd091ac83ffea06e2bac6c34ce3a9353047722fc0dbf7d64b1491341acfc860`.
  Reused original artifact 14121749762 from build 43616134287, without rebuild.
- Installed executable SHA-256:
  `00b8bb61eb53cf252e22bc1836a5eda07a6462f216a600861d9961004fa5c2e1`;
  installed bytes were compared to the deb's extracted executable.
- Ubuntu 26.04, ordinary UID 1001; system WebKitGTK
  `2.52.6-0ubuntu0.26.04.1`, GTK 3.24.52, AT-SPI 2.60.4.
  The default WebKit sandbox navigation prerequisite passed. No private patched
  WebKit runtime was used.

## Actual results

All six app steps passed: open exact installed app, enable output through UI,
native-dialog cancellation, real non-file submission and receipt, cancellation
of one owned queued job, normal application close.

The private printer was `MilkupPrivate43683832614`. Native GTK enumerated it as
`virtual=false`, `active=true`, `acceptsPdf=true`, `default=false`. Its device URI
was `ipp://localhost:18631/ipp/print`; the private scheduler listened only on
127.0.0.1:18632 and the receiver only on 127.0.0.1/[::1]:18631. The queue was not
shared. Native pointer input selected this exact row, with AT-SPI selected-row
evidence, before clicking each action. Print to File was never selected.

1. **Application dialog cancellation:** selected queue, clicked the native GTK
   Cancel button. Queue job IDs remained `[]` before and after. This proves
   cancellation before submission, not revocation after a printer has accepted
   a job.
2. **Application submission:** private CUPS job **1**, owner `runner`, completed
   with IPP state **9**, one document, one completed sheet/impression. The CUPS
   log identifies its real `ipp` backend; the receiver log records Create-Job
   and Send-Document with `application/pdf`. The receiver retained exactly one
   PDF, **15,104 bytes**, SHA-256
   `d3f4a463b59cc949503d7f36fcf9eca347bb43c34447320839759737eca54220`.
   Independent Poppler inspection confirms **one A4 page**, 595.276 × 841.89 pt,
   rotation 0, unique marker `MILKUP-PRIVATE-QUEUE-43683832614` exactly once.
   Default and layout extraction also preserve the full English body sentence.
   Raw extraction joins body word spaces; that mode alone is not an exact
   whitespace/fidelity contract.
3. **Queue cancellation:** paused only the private queue, then submitted from
   the app again. Job **2** was pending (state **3**) and cancelled through the
   private CUPS API, becoming **7** and disappearing from active jobs. It never
   reached the receiver; only the first PDF exists. Cancelled job history was
   deliberately retained for audit. This is **queue-side cancellation**, not
   automatic rollback or proof of app-side cancellation after submission.
4. **Close/cleanup:** the app received WM_DELETE_WINDOW for its verified PID
   8097/birth 13753, then disappeared within 118 ms; no forced termination.
   Its OS exit code was not separately captured, so no exit-code-zero claim is
   made. Both owned service processes exited **0**, no private listeners
   remained, and the private service root was removed. Only this run's app
   installation was uninstalled. The temporary source file was unchanged.

The tools were extracted into the runner's temporary workspace, never installed
as system CUPS services. Logs before and after GUI dependency setup both report
`no packages found matching cups-daemon`. The official IPP receiver source was
built with its supported `--with-dnssd=no` option, without source changes.
No shared printer, system default printer, system printing service, sandbox,
security policy, personal notification, production channel or main branch was
modified. No release was published.

## Failures retained and corrected

- **43683351834 / d1a6edaa:** tool preparation stopped before application install.
  Recursive APT dependency enumeration included all alternatives and hit the
  160-entry gate. The fix uses the concrete solver plan and a smaller 60-entry
  gate; this runner needed only 14 downloaded packages. No service installation
  or acceptance check was bypassed.
- **43683488614 / 20a2c32f:** native queue enumeration and actual row selection
  worked, but the harness expected AT-SPI role text `push button`. Current AT-SPI
  reports `button`. Replaced the text comparison with the compatible public
  enum (role 43), confirmed through the local actual AT-SPI library, and added
  persistent dialog snapshots. The final run records Preview/Cancel/Print as
  role 43 and proves the requested native inputs. The earlier app and private
  services also closed normally; no printing success was claimed for it.

The final driver log retains expected isolated-environment warnings for missing
DRI3, Avahi and colord, plus helper inspector-port collisions inherited from
the attached GUI harness. These did not prevent the measured queue path. This
is not a claim that the environment had no warnings.

## Evidence and remaining boundaries

Final Actions artifact **14149676526**, 136,482 bytes,
SHA-256 `24699ef081ed720cffc7abaa83c8bf42921d635df7c697a4e26deb9e5c795a31`,
expires **2026-11-22 06:07:18 UTC**. ZIP CRC, length and SHA were independently
verified before extraction. Original ZIP, reports, logs, screenshots and PDFs
are also in `/workspace/milkup-linux-private-queue-evidence/43683832614`;
`independent-review.json` records the separate review. Earlier failure artifacts
are retained alongside it. Workspace storage alone is not durable retention.

This closes the scoped Linux installed **non-file queue integration** gap for
this exact package and controlled receiver. It does not cover physical paper,
real printer hardware/drivers, general color or layout fidelity, Chinese copy
quality, unrelated PDF links, newer package identities, app-side removal of an
already submitted job, or production deployment of the research WebKit fixes.

References for the tool configuration and stable role:
[CUPS receiver](https://www.cups.org/doc/man-ippeveprinter.html),
[private scheduler configuration](https://www.cups.org/doc/man-cupsd.html),
[AT-SPI enum compatibility](https://github.com/GNOME/at-spi2-core/blob/main/atspi/atspi-constants.h).
