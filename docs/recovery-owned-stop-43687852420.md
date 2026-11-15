# Installed Linux recovery after one owned abrupt termination

Run [43687852420](https://github.com/Auto-Plugin/milkup/actions/runs/43687852420)
passed on 2026-11-15. Independent inspection of the raw manifest, payload,
process and GUI records confirms all 11 steps. This is a controlled SIGKILL
and restart test after a completed checkpoint, not a spontaneous crash or
power-loss test. No product change was necessary.

## Exact candidate and isolation

- Product integration: `0e4e8c580353710db9b7f0ec4820522d305ec9fc` (includes
  `8f7fefdf`); package source `58c78973101acb0a22ca0cb5d24ef24bd9edc199`.
- QA commit: `6a2019ed63a226dfae972576ea0dd6580ce7687a`, branch
  `dot/recovery-owned-stop-20261115`. All intervening differences were checked
  against an explicit QA-only path allowlist. Product/package inputs unchanged.
- Reused `milkup-2.0.0-beta.10-linux-deb-58c78973101a.deb`, 9,854,742 bytes,
  SHA-256 `9e71e2b6f6c5cd030f7307d35679ded1d4f5605127d77320db1d455d90c1ddde`.
  No package build or repeated installation matrix.
- Installed executable SHA-256
  `42394c4bdcaeea078c7d553acbe6edc7a75f13b16ce5b70cba2d0a3a02176ed6`.
- Ubuntu 26.04 ordinary UID 1001, a fresh run-owned XDG profile, one synthetic
  Markdown and native keyboard/pointer input. Default WebKit sandbox navigation
  preflight passed. Only this run's installed package was removed afterwards.

## Observed behavior

1. Original disk content remained `ORIGINAL_43687852420\n`, SHA-256
   `4ecf791ef588995080cc97f1d0da092470ba820b43abb762aaf7107be2294cb2`.
2. Two acknowledged dirty checkpoints were independently read from disk:
   version 24 / 45 bytes, then version 49 / 70 bytes. Latest manifest retained
   the first payload as its previous generation. Byte counts and SHA matched.
   Latest payload SHA-256:
   `39c1c88073f9beac356d08e99cb081705acad4f0a753f8c8ef0fdfaeef156a3b`.
3. Only PID 5740, Linux birth tick `85921`, was intentionally interrupted.
   Before the signal, a held pidfd and repeated checks verified birth, all UIDs,
   executable path/hash and the exact owned fixture argument. `pidfd_send_signal`
   sent SIGKILL once; the descriptor reported exit, and the original PID was
   reaped. No process-name, group, descendant or system-service termination.
4. Restart offered the pending v49 snapshot while the original file and editor
   still contained the old original. Choosing “暂不恢复” retained both. A normal
   close and second restart offered the same pending snapshot again.
5. “打开恢复副本” opened a distinct recovery copy with the exact 70-byte latest
   payload, including both A and B markers. Original bytes stayed unchanged.
   The manifest changed only from pending to restored.
6. Further restart did not automatically reoffer the restored record; explicit
   recovery history still showed the archived record. The independent recovered
   file reopened with identical bytes after another normal restart.
7. Five application launches, one planned abnormal exit, four normal closes:
   PIDs/births 5865/86470, 5991/86660, 6117/86831, 6257/87194. Each normal close
   used WM_DELETE_WINDOW and verified the exact process disappeared. No failure
   cleanup or forced normal-close fallback was used. OS exit codes were not
   collected, so this report does not assert exit code zero.

Input-settled to acknowledged-checkpoint observation was 1122.849 ms and
1033.428 ms in this sample, including observation overhead. The controller's
750 ms idle / approximately 5 s continuous-change scheduling is not a hard
durability or maximum-loss guarantee. Native complete-payload/manifest sync
and publication were reviewed; this test cannot prove storage hardware flush
semantics. No input was deliberately added after the final checkpoint.

## Verification and retained evidence

Local recovery controller tests: 7 passed. Five no-signal ownership-protection
tests passed locally and on the native runner: incorrect birth, UID, executable,
hash, fixture, self/parent and exited-process cases reject. Positive tests open
pidfds but close their own test subprocesses normally via stdin EOF.

Raw Actions artifact `14151380854`, `milkup-linux-owned-recovery-43687852420`:
133,325 bytes; SHA-256
`1a0cbcd15ccc3bec33417c6397662b7bea4baf3db7aa2bcc392da417be1ac4d2`;
expires **2026-11-22 07:00:46 UTC**. Downloaded bytes, ZIP CRC, traversal and
expanded-size bounds were checked. Workspace retention:
`/workspace/milkup-recovery-evidence/43687852420/` contains original ZIP,
extracted records/screenshots, workflow log and independent hash/byte review.
This workspace is temporary; a separate text-evidence Library copy is retained
with its receipt alongside the local evidence. It excludes browser screenshots;
their original hashes and Actions provenance remain in the text inventory.

The package manifest's `built-not-installed` and `installedAcceptance:not-run`
are original build-time metadata, not rewritten claims. This run's installation,
native flow and uninstall logs provide the later acceptance evidence separately.

## Limits

No spontaneous fault, OS crash, power loss, partial-write corruption, disk-full,
uncommitted IME composition, checkpoint-in-flight kill, large/binary document,
resource attachment or cross-platform recovery claim. A checkpoint is recovery
data, not saving the original file. AT-SPI bus and headless DRI3 warnings remain;
this is not an accessibility or GPU validation. Existing archived-data retention
is not deletion or space reclamation. No main merge, release, production channel,
notification or system security changes.
