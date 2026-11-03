# Optional installed Mermaid product acceptance

`scripts/ci/run-windows-mermaid-product-e2e.ps1` retains its original linked-binary
mode. Installer mode additionally requires all five arguments:

- `-Installer`: the freshly built NSIS installer.
- `-ExpectedInstallerSha256`: SHA-256 of that exact installer.
- `-ExpectedVersion`: candidate product version, including prerelease suffix.
- `-PackageManifest`: reviewed `installer-input.json` from the delivery prepare step.
- `-ExpectedPackageManifestSha256`: SHA-256 of the prepared manifest.

Keep passing `-Binary`, `-ExpectedBinarySha256`, `-ExpectedCommit`,
`-EvidenceDirectory` and `-ProductionAssetsConfirmed`. The built binary is used
only as an immutable comparison input in installer mode. The UI harness launches
the EXE installed under the fresh standard user's own profile.

The manifest requires schema 1, exact candidate/version/built/expected-NSIS
hashes, `installMode: currentUser`, `webviewInstallMode: skip`, exactly the
`file.ico` resource with size/hash, and a bounded sealed bundled-plugin inventory
using `{id, version, archiveFile, bytes, sha256}`. Full byte comparison permits
only Tauri's unique `__TAURI_BUNDLE_TYPE_VAR_UNK` to `..._NSS` transformation.
Installed PE x64, FileVersion, ProductVersion and icon bytes must also match.
Plugin archives are embedded Vite data, not external installation resources;
the exact installed image comparison binds their reviewed build bytes. The
installer-only UI inventory observes actual card IDs, versions and disabled
switches before enabling Diagrams for the normal product acceptance steps.

Installation occurs only after the child coordinator proves its real pure-standard
SID/session and existing interactive desktop. The installer process is launched
without a shell or elevation and is checked through its held process handle.
The parent administrator session never installs the product. NSIS receives `/S`
and a final unquoted `/D=` absolute destination, as required by the
[NSIS command-line specification](https://nsis.sourceforge.io/Docs/Chapter3.html).
No `/NCRC`, UAC/ACL/security-policy change, Runtime installation, existing account
or profile reuse is allowed. Existing machine Evergreen is a prerequisite.

Installer and comparison processes use held-handle waits and bounded stdout/stderr.
A timeout/nonzero exit/unproved identity is a failure, not an assumed success.
The existing native job ledger and real product UI-close checks remain required.
After processes are confirmed empty, exact fresh-profile deletion removes the
installation and that account's HKCU changes; its directory absence is recorded.
An uncertain profile or installed-directory cleanup retains the account and fails.
This is disposable per-user test installation, not installer UI/SmartScreen,
upgrade/rollback, system IME or multi-DPI acceptance.

New bounded evidence names are `installation-result.json`,
`installed-binary-comparison.json`, `installed-binary-comparison-stderr.log`,
`installer-stdout.log`, and `installer-stderr.log`. No installer/executable or
profile enters the screenshot/report evidence artifact. The separate delivery
workflow owns the explicitly authorized trial installer/plugin payload.

`installer-wrapper.test.ps1` extracts and runs only the wrapper's pure admission
functions. It exercises identity/policy/manifest rejection and preserves an
existing-directory sentinel without executing Windows native APIs or installers.
C# process regression and installed-byte comparison tests cover actual process
wait/exit/output behavior and the exact Tauri image transformation separately.
Actual Windows installation and product acceptance are established only by the
subsequent CI run's reports, not these local tests.
