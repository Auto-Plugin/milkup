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
the EXE installed under that fresh account's own profile. Run two independent
invocations with `-AccountKind pure-standard` and `-AccountKind filtered-admin`,
separate evidence directories, and the same frozen installer, manifest and built
binary. The default remains `pure-standard`.

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

Installation occurs only after the child coordinator proves the selected account
kind using its actual token, exact SID/session and existing interactive desktop.
Both kinds require primary, medium-integrity, non-elevated tokens with the
existing ordinary-privilege restrictions. A filtered administrator additionally
requires a Limited token and the Administrators SID with exactly deny-only
attributes; it is never relabeled as pure-standard. Elevated, full, enabled-admin,
unknown or mismatched tokens are rejected. The installer process is launched
without a shell or elevation and independently checked through its held process
handle against the same selected account kind, SID/session, image and owned Job.
The parent administrator session never installs the product. NSIS receives `/S`
and a final unquoted `/D=` absolute destination, as required by the
[NSIS command-line specification](https://nsis.sourceforge.io/Docs/Chapter3.html).
No `/NCRC`, UAC/ACL/security-policy change, Runtime installation, existing account
or profile reuse is allowed. Existing machine Evergreen is a prerequisite.

`installation-result.json` records `expectedAccountKind`. Its `installerRun`
records that same selection, and both `callerIdentity` and `startedProcess`
retain the actual token facts plus `expectedAccountKind` and
`accountKindVerified`. The latter is set only after the observed token passes
the existing account policy. Passing metadata alone cannot establish installation;
the actual installed image comparison and product path/hash binding remain
required. The built comparison EXE is never the installer-mode UI input.

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

### Plugin strategy and prefetch acceptance (2026-11-09)

The product suite requires the original editor mode toggle and rejects duplicate
`data-set-view-mode` global buttons. It changes Mermaid's own settings selector
using native pointer/keyboard input and observes persistence without writing test
preferences. Source/render/mixed must hot-apply without changing editor mode,
Markdown, Math, document version or dirty state. An absent historical preference
must start mixed. Existing editor preview read-only/copy/undo, cursor-image reuse,
native ownership, GUI observer and teardown gates remain mandatory.

The syntax fixture retains all twelve grammars but places them below 130 lead
lines and adds 1,000 tail lines. Before input, it must produce offscreen ready
results with at most eight prefetch renders and less than all twelve diagrams.
A real wheel scroll samples visibility/decoded state using requestAnimationFrame;
the first diagram must decode within 100 ms of becoming visible and match a
renderer request already completed before scrolling. Cache hits must increase;
cache bytes must remain within 64 MiB and pending work within eight. This is an
explicit acceptance threshold, not a claim that Windows has already passed it.

The new `dot/mermaid-plugin-modes-20261109` branch is explicitly allowed. Without
local workflow-dispatch credentials, the authorized push path is two stages:

1. Push a source commit containing `[mermaid-frontend-e2e]`, then verify that exact
   SHA's frontend two-account workflow succeeded.
2. Push a packaging-only commit containing `[mermaid-windows-installer]`,
   `[accepted-source-run:<successful run ID>]`, and
   `[accepted-source-sha:<exact 40-character source SHA>]`.

The installer workflow resolves the supplied receipt via GitHub's runner token,
requires the same branch, successful frontend workflow and accepted ancestor,
and rejects application/native/renderer source differences. It does not wait for
a source workflow in the shared concurrency group. Manual dispatch remains
supported. Clone/read access alone is not proof of push permission.
