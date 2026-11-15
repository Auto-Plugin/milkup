# Linux application update boundary: evidence and blocked native preflight

Product reviewed: integration `8d93519b1bbacd48d8dd1f692a6932c547b9530c` (product `0e4e8c580353710db9b7f0ec4820522d305ec9fc`). Existing package inspected: `58c78973101acb0a22ca0cb5d24ef24bd9edc199`, package `milkup`, version `2.0.0-beta.10`, architecture `amd64`. No product edits, rebuild, CI dispatch, authentication, package installation, system policy, notification or production configuration changes in this task.

## What the product actually implements

Linux deb is **not download-only**, and it is not the Windows NSIS flow:

1. `updates.rs` embeds `release/update-channel.json` at compilation. When endpoints are empty and publicKey is null, check returns `configured=false`, without constructing the network updater. The current About UI says “此版本尚未配置在线更新渠道。” Download/install controls require an available/verified release. This is unavailable, not “already latest.”
2. With a configured authority, host check requires HTTPS, signed manifest, product/channel/platform, freshness/replay policy and bounded data. Download verifies the package signature, and install reauthorizes and re-verifies. These shared paths exist, but the Windows native result does not prove their Linux execution.
3. Bundled type `Deb` selects the deb installer; target lookup prefers `linux-x86_64-deb`, then `linux-x86_64`. The deb path checks format, writes a private temporary package, and calls `dpkg -i` through authorization helpers.
4. `try_install_with_privileges` attempts **pkexec**, then **zenity/kdialog plus sudo -S**, then **terminal sudo**. It does not directly replace a per-user executable. Real replacement uses the system package manager and its privilege policy. System-dependent authorization and package maintainer-script behavior are not covered by ordinary extracted-binary launch tests.
5. A nonzero status from the first authorization helper does not end the operation: later helpers may run. A failed graphical-password attempt can also be followed by terminal sudo. There is no independent native-install cancellation/deadline API after the host has committed installation. The document-save/confirmation gate protects the pre-install transition; it is not proof that later OS authorization dismissal terminates all fallback attempts.
6. If the installer returns an error, `install_application_update` propagates it before the Linux `app.restart()` call. On success it requests restart. Neither branch is evidence of installed-version health, rollback or data-format migration. Auto rollback is not implemented.

Sources: `apps/desktop/src-tauri/src/updates.rs` (embedded config line 10, check 281, package-version check 394, install 511); `vendor/tauri-plugin-updater/src/updater.rs` (signed install 846, Linux dispatch 1093, deb 1174, privilege chain 1231); `apps/desktop/src/application-updates-ui.ts`; `apps/desktop/src/protected-install.ts`.

The independent internal package-version comparison is currently Windows PE-only. For Linux the signed publisher statement and authenticated package bytes are bound, but the application does not independently compare deb control Package/Version/Architecture to the signed release before invoking dpkg. Do not generalize the Windows PE gate to Linux. This is a source-level boundary, not a demonstrated unsigned-package bypass.

## Existing evidence and exact package inspection

- Windows [43612332507](https://github.com/Auto-Plugin/milkup/actions/runs/43612332507) covers the isolated-feature actual Windows check/download/verify/install/restart path and rejection cases. Its old fixture is a Windows executable, and `updates_ci_fixture.rs` at `6eb10ba8` explicitly rejects non-Windows. Its fixture authority and client-local TLS hook were deliberately excluded from the product integration. It cannot be reused as a Linux test binary.
- Historical Linux beta.1 native evidence is indexed by `docs/evidence/v2-plugin-architecture/native-summary.json` and `docs/v2-product-phase1-plugin-correction-2026-10-15.md`: unconfigured updates UI and ordinary editing/plugin lifecycle. It is historical evidence, not current beta.10 signed download/install verification. No new claims are made about raw records not retained in this checkout.
- Current accepted Linux GUI/IME/install, conflict, recovery and printing runs are not application updater tests. No same-scope active run appeared in the current repository run lookup. No existing configured Linux update binary or Linux signed-upgrade native result was found in the inspected integration/evidence paths.
- Existing deb SHA-256 **`9e71e2b6f6c5cd030f7307d35679ded1d4f5605127d77320db1d455d90c1ddde`**, actual packaged executable **`42394c4bdcaeea078c7d553acbe6edc7a75f13b16ce5b70cba2d0a3a02176ed6`**. Both were read and hash-checked locally. `dpkg-deb --field` was read-only. Exact empty channel JSON bytes occur in this executable; source confirms the active include/configured path.
- Host updater, vendored updater and channel JSON are byte-identical between package source `58c78973` and this integration. Machine hashes and comparison are retained in [result.json](acceptance/linux-update-boundary-20261115/result.json).

## Newly executed local boundary checks

`research/linux-update-boundary-20261115/probe.py` compiles the exact three privilege-dispatch methods from the vendored source using Rust 1.99.0, with only std error/log adapters. Four bounded subprocess cases use an isolated PATH containing inert command fixtures; no real pkexec, sudo, password dialog, dpkg, network request or application process is started. A direct-dpkg trap detects unexpected direct dispatch. The fixed dummy stdin is synthetic, never a credential.

| Fixture | Actual extracted-method calls | Result |
| --- | --- | --- |
| pkexec returns 0 | pkexec only | `Ok(())`; fixture status, **not an installation** |
| pkexec returns 126, all others refuse | pkexec → zenity → kdialog → sudo | `PackageInstallFailed` |
| pkexec returns 127, all others refuse | pkexec → zenity → kdialog → sudo | `PackageInstallFailed` |
| graphical dummy password, sudo rejects | pkexec → zenity → sudo -S → sudo | `PackageInstallFailed` |

All four expectations pass; inert package bytes remain unchanged. This confirms fallback control flow, not the meaning of an actual dialog dismissal, polkit policy, real privilege denial, GUI error display or old-app usability after a native install attempt. [Exact source subset](acceptance/linux-update-boundary-20261115/exact-methods.rs), [adapter](acceptance/linux-update-boundary-20261115/harness.rs) and complete calls/result are retained. No failed genuine upgrade was turned green: the result is explicitly `passed-offline-boundary-only`, while native readiness is `blocked-existing-package`.

## Why no native CI was dispatched, and the minimum remaining gate

The reusable accepted package cannot consume a temporary test endpoint/key: its authority is compile-time and empty. Changing profile/environment alone cannot turn it into a signed update fixture. Repeating its “unconfigured” UI would not verify the missing path. The existing Windows-only fixture cannot substitute. Clicking real Linux install in a newly configured build would invoke authorization fallbacks; on a CI account with passwordless sudo, a later fallback could modify the host package database. This task explicitly forbids automatic elevation and host package-policy changes, so that action was not attempted. This is a scoped technical limitation, **not an approval-tool denial**.

The smallest subsequent path, if undertaken separately, is an explicitly non-distributable Linux fixture with bounded loopback HTTPS and process-local test certificate/key (no system trust change), reusing the existing target deb bytes. It should first stop at actual About check/download/signature acceptance and bad-signature/download-failure rejection, preserving original package/configuration/document hashes and normal close. A compile-time fixture guard must prevent entry into any real install helper; this would be explicitly a check/download gate, not successful installation. It needs a new fixture binary and cannot satisfy the present exact-package reuse premise. No such feature, build or workflow was added here.

System replacement/authorization-denial/restart acceptance remains a separate gate requiring an appropriate explicitly controlled package-management environment. It must record actual deb metadata, installed version/package state, document/configuration preservation and process identity. No automatic elevation, fake-success installer, Windows-result reuse or unapproved production update architecture is a substitute. Formal channel/key decisions remain separate; no production key is needed or used for the local checks above.

The Linux application update gap therefore remains open with a concrete implementation/evidence boundary. The preceding A4 heading/header defect remains open and its stopped experiment was not resumed. Main, release channels and the working product integration are unchanged.
