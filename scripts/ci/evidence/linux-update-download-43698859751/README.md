# Linux native application update: isolated download/signature acceptance passed

[Run 43698859751](https://github.com/Auto-Plugin/milkup/actions/runs/43698859751), exact QA SHA **`d17583dae56042bb0d1017d51a330404ca17b72e`**, completed **success** on 2026-11-15 at 09:30 UTC, job duration **9m20s**. This was the one authorized native supplement after the full offline orchestration prerequisite. No retry, further dispatch, installation, main merge or release followed.

## Preconditions and distinction from offline evidence

Before dispatch, the exact native orchestration and client parser ran against a controlled local HTTP WebDriver/page substitute using the actual product controller/UI. The original 43697294000 error response was replayed. The complete flow and each of eight phase-failure paths passed their contracts, retaining failure evidence and correct normal/fallback close distinctions. These **nine offline scenarios** are not native application passes. Their source hashes match the independently retained CI offline summary.

CI repeated that full gate, default WebKit sandbox navigation, explicit dependency/syntax/import checks, actual tauri-driver process-inheritance positive/negative controls, matching WebPKI TLS and Minisign contracts, native GTK input/owned close checks, exact target identity and the real Rust loopback URL test (**1 passed, 0 failed, 0 ignored**) before acceptance. None of the old failures were erased or counted as success. No duplicate in-progress/queued task existed before the single dispatch.

## Exact identities and native scope

- Ubuntu 26.04, ordinary UID **1001**, default sandbox. Current-source **beta.9 version fixture**, not historical beta.9 or a production installer. Executable SHA-256 **`02d7fb99e85e9dd09c8f8ce944e2c632c3eedd86428ed7681470324ed1e85014`**. The owned application confirmed inheritance of the exact public fixture path. The executable hash is unchanged from the preceding recorded QA builds; no executable bytes were uploaded.
- Reused original target from **`58c78973101acb0a22ca0cb5d24ef24bd9edc199`**: package `milkup`, **2.0.0-beta.10**, amd64, **9,854,742 bytes**, SHA-256 **`9e71e2b6f6c5cd030f7307d35679ded1d4f5605127d77320db1d455d90c1ddde`**. It was read/downloaded/verified, never installed or executed. No target rebuild.
- The test uses a process-local literal-loopback HTTPS endpoint and fresh in-memory signing/TLS authority. The certificate is trusted only by this QA updater client. Production endpoints/public keys, system trust and security settings are unchanged.

| Native step | Result | Duration |
| --- | --- | --- |
| Launch and CLI open | Passed, fixture-path inheritance true | 2,859 ms |
| About wrong manifest signature | Actual verifier rejection, only retry/check offered | 490 ms |
| Signed release offered and HTTP 503 download | Actual 503 rejection, retry download offered | 984 ms |
| Corrupted deb | Actual signature verification failure, no install offered | 644 ms |
| Exact valid deb | Native verified-ready, beta.10 offered | 680 ms |
| Clear verified download | Returns to download action, no install action | 380 ms |
| Ordinary edit/save | Unique synthetic marker persisted; binary and target hashes unchanged | 937 ms |
| Normal close | Owned WM_DELETE, exact process gone, no force | 136 ms |

These are single-run phase durations, not cold-start performance or tail-latency claims.

## Independent raw-evidence checks

The endpoint ledger contains exactly five GET requests, totaling **19,712,013 bytes**:

1. `/manifest.json`, bad-manifest, HTTP 200, 1,249 bytes. About reports `检查更新失败：The signature verification failed`, actions `[check]`.
2. `/manifest.json`, valid signed release, HTTP 200, 1,249 bytes; its SHA matches `gui/accepted-manifest.json` exactly.
3. `/candidate.deb`, controlled download-error, HTTP **503**, 31 bytes. About reports the actual `Download request failed with status: 503 Service Unavailable`, actions `[download]`.
4. `/candidate.deb`, bad-artifact, HTTP 200, **9,854,742 bytes**, SHA **`11a33bebbb75514a7694d1de4583858ad9a17232351dd2efc769b7d20f4320e2`**. The harness recomputes the one-byte-mutated original hash before accepting this evidence; native UI reports `The signature verification failed`, actions `[download]`.
5. `/candidate.deb`, valid, HTTP 200, **9,854,742 bytes**, original SHA **`9e71e2b6f6c5cd030f7307d35679ded1d4f5605127d77320db1d455d90c1ddde`**. Native UI says the package passed signature verification, `updateError=null`, actions `[cancel, install]`. The install action was **not clicked**. Native clear produces actions `[download]`, zero received display and no error.

The final synthetic file is exactly `UPDATE_DOCUMENT_43698859751\nUPDATE_CHECK_ONLY_SAVED` (literal newline), SHA **`a399256fddfc0de7d8d021150bcb00c5c0c1359249c6a628b1b7f1aef3bf10f8`**. Disk bytes/hash were independently checked. The old application remains beta.9 and its executable hash remains unchanged.

Close evidence: PID **13789**, birth tick **56624**, window **2097168**; supported `WM_DELETE_WINDOW` sent to that exact owner, `dirty=false`, `processGone=true`, `forced=false`, no forced-failure cleanup. Endpoint stop reason `requested`, status `closed`; final report has **8/8 passed steps and errors=[]**.

## What is deliberately not established

This passes **isolated application check/download/signature/clear/usability/close**, including wrong-signature and corrupt-package rejection. It does **not** pass Linux privileged deb replacement, pkexec/sudo/dpkg behavior, update installation/restart, automatic rollback, production update delivery, real historical-version data migration, or the overall five-gap release matrix. The test executable's non-default feature explicitly blocks host/vendor install entry points and excludes the Linux installer implementation. No credentials were requested/entered, and no install action was submitted. This is compile-feature plus action/evidence proof, not a claim that every unrelated CI host exec was traced. Provisioning official CI build dependencies is separate from the application's privilege path.

The public repository has not been used to pretend that binary artifacts are private. Only original logs, public ephemeral fixture material, synthetic data and receipts are retained, not private keys/configured executables. The full QA branch includes fixture versions/features and must **not** be merged wholesale into a product candidate. Product integration and main remain unchanged; no formal endpoint/key, notification or security settings changed, no release published. Windows, PDF and other completed matrices were not repeated.

## Durable evidence

Artifact **14156036594**, **58,044 bytes**, SHA-256 **`e140f81ac0e76f1e0deeac2ba10b436773dc2f38ffbf45743411953863615b6a`**, Actions expiry **2026-11-22 09:30:47 UTC**. Original length/hash, ZIP CRC, safe paths and bounded expansion passed. `original-artifact.zip` retains the exact 38-file ZIP in Git, independently of expiry. Selected JSON reports are extracted unchanged. `receipt.json` records every original member's length/hash.

`job.log.gz` losslessly preserves the original decoded **226,370-byte** job log, raw SHA-256 **`24dfc9c83f54c1a7fdb0ae3f13456c8eb36bfd1c7f60abbb0300ac48056b2fb8`**. No private key blocks or real user documents were found. Local originals: `/workspace/milkup-linux-update-flow-native-evidence-20261115/`. Earlier failed runs remain in their separate evidence directories.
