# Linux private queue prerequisite, 2026-11-15

Scope: a private CUPS scheduler and IPP receiver, both owned by the ordinary
test user, with no system print service, default printer, security policy,
production configuration or application source changes. Queue receipt is not
physical printing or general printer fidelity.

The existing Linux native evidence enumerated only Print to File. No equivalent
queue run was active among the recent Actions runs when this task started.

## Exact application input

Reuse build run 43616134287, artifact 14121749762, source
383c0712f21071467f2549d73a022b03db4b69aa. The unchanged deb is
`milkup-2.0.0-beta.10-linux-deb-383c0712f210.deb`, 9,853,866 bytes,
SHA-256 `8cd091ac83ffea06e2bac6c34ce3a9353047722fc0dbf7d64b1491341acfc860`.
No product rebuild or repeated installation matrix is required.

## Local ordinary-user protocol evidence

Debian 13, UID 1000. Official Debian CUPS 2.4.10 packages were downloaded,
checked against repository package hashes and extracted only under `/tmp`.
No package maintainer scripts or system service were run.

The packaged `ippeveprinter -r off` failed with `Unable to initialize DNS-SD`
before opening a listener. Upstream 2.4.10 calls `dnssd_init()` unconditionally.
The official source's supported `--with-dnssd=no` configuration avoids that
dependency; no source changes were made. Source archive SHA-256:
`d75757c2bc0f7a28b02ee4d52ca9e4b1aa1ba2affe16b985854f5336940e5ad7`.
Only libcups.a and the receiver tool were built in the temporary workspace.

Observed listeners were exactly `127.0.0.1:18631`, `[::1]:18631` (receiver)
and `127.0.0.1:18632` (private scheduler). An official driverless queue used
the `ipp://localhost:18631/ipp/print` backend. The initial no-filter tool
extraction rejected application/pdf; adding the official extracted PDF filter
and its dependencies resolved this prerequisite, without altering the app.

The same queue-control script intended for native QA verified:

- Own job 1 completed (IPP state 9), one received PDF page, unique synthetic
  marker exactly once. Received SHA-256
  `aab6aa3f156c83796f5ae08529cacefc36a3460a91d42a7b322c2cc6d6f98be5`.
- Own job 2 was submitted while the private queue was paused, then cancelled
  through private CUPS: state 3 to 7, absent from active jobs, no second PDF
  received. This is queue cancellation, not application rollback.
- Both owned service processes exited 0. No system CUPS process was touched.

These local submissions used the CUPS client, not Milkup or GTK. They establish
protocol, ownership, content and cleanup prerequisites only. Native GTK queue
selection, app submission, native-dialog cancellation and normal app exit are
still required in the single bounded Ubuntu 26.04 run.

Original local JSON and received PDF are retained in
`/workspace/milkup-linux-private-queue-local-evidence-20261115` (workspace copy,
not durable Library retention). The manual native workflow will preserve its
own original reports, spool evidence and exact package manifest separately.
