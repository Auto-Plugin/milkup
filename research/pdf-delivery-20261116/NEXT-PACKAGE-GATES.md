# Same-package continuation: support, dependencies, maintenance and recovery

This is the validation design for the **same** normal 2.54.2 candidate after the actual-TU gate. It is not a package, an installation result, an automatic rollback implementation, or an expanded support promise.

## What the current run supplies

`43849878532` / `68ed9169ec7cbd21a6fd9c627af423996ddfef7b` is restricted to Ubuntu 26.04 amd64 configure/headers/selected TUs. Official source and patch identities, authenticated SDK package selection, installed-package versions, pkg-config versions, compiler content hash, generated API/printing/sandbox settings, real flags/commands/graph and resource samples are retained or the earliest failure explains why they were never obtained. This run completed real configuration/ordinary headers but the first TU stopped on an omitted PCH prerequisite (see its report); no object or runtime resulted. A 26.04 compile alone says nothing about older supported distributions, installed library loading or native output.

Future package eligibility requires actual ELF symbol-version requirements (GLIBC/GLIBCXX/CXXABI), DT_NEEDED/SONAME/RUNPATH, full dependency closure and each supported host's providers. Do not silently raise the product's Linux minimum to 26.04 because that runner is convenient. If the minimum host cannot satisfy the ABI, select a compatible build baseline and prove it; do not bundle an alternate libc, replace system WebKit or disable the sandbox.

## Exact required runtime closure

Derive the inventory from the real configured build and CMake install manifest, not the old research prefix. Required roles already encoded in `package_boundary.py` are the exact application, matching WebKitGTK and JavaScriptCore, Web/Network/GPU processes, injected bundle, nonembedded resources, notices and build-derived SBOM. The final runtime path is version/patch specific; direct installed app and helper linkage must resolve that path without broad LD environment changes.

Source facts checked in the locked 2.54.2 files:

- `PlatformGTK.cmake` compiles PKGLIBEXECDIR/LIBDIR/PKGLIBDIR/DATADIR/LOCALEDIR. Non-developer ELF symbol exports use the upstream version script.
- Inspector, media controls and WebKit resource bundles are generated C resources; PDFJS resources depend on actual configuration. Audio resource XML is generated. These facts do not establish complete runtime assets: use the generated manifests and embedded-resource listing from the full build before excluding files.
- GTK Unix printing adds GTK::UnixPrint and exposes HAVE_GTK_UNIX_PRINTING. It is mandatory, not an optional absent feature to ignore.
- The normal executable-path branch uses compiled PKGLIBEXECDIR. Upstream still accepts WEBKIT_INJECTED_BUNDLE_PATH outside developer mode, so native evidence must record its absence and the exact loaded bundle. No system policy/environment modification is proposed.

Only four source license files are presently retained in the selected source set (JavaScriptCore COPYING.LIB, WebCore LGPL2/LGPL2.1/Apple notices), with hashes in the source receipt. That is **not the whole runtime license inventory**. The full source/build must enumerate Skia, ICU usage, font/media/image libraries and all static third-party dependencies, bind their source versions/licenses to actual configuration, and retain applicable notices/source correspondence. No synthetic fixture SBOM may be substituted.

## Minimal installation and recovery evidence

Use one new package pair with exact application/runtime identities in an isolated guest, synthetic files and a nonprivileged application session. The CI administrator's package-install step and the application's ordinary-user execution must be recorded separately; do not call the install itself unprivileged.

| Case | Required evidence | Reject / preserve |
|---|---|---|
| Clean install | Package SHA, installed file ownership/modes/hashes, root-owned non-user-writable final prefix, normal entrypoint | Any runtime family mapping outside expected prefix; absent helpers/resources |
| Start/edit/IME/plugins/exit | Same installed binary, real process birth identities, normal sandbox, source-to-file bytes, IME composition count, plugin policies, normal close | No inherited result from an older runtime; #255 caret fixture only rides this run |
| Native PDF/printing | Same app/guard/runtime mapping for original 15 cases, exact geometry/text/links and cleanup | Research logs cannot be required for product behavior; separate independent geometry evidence retained |
| Upgrade pair | Both old/new package identities and dependency compatibility; atomic selection of matching app/runtime; synthetic user data/config preserved | No mixed versions, partially replaced tree, or silently widened search path |
| Verification failure | Corrupted/wrong-signed test payload rejected before replacement | Old app/runtime identity and document bytes unchanged |
| Interrupted installation / failed new health | Controlled failure points in test-owned installation; clearly identify OS/package-manager behavior versus application behavior | Never label manual restoration or package-manager repair “automatic rollback” |
| Recovery | Verified compatible retained old pair, explicit recovery path, real launch/edit/close and preserved data | No unverifiable binary fallback or assumed data-format downgrade compatibility |
| Uninstall | Remove only owned package/runtime files; verify no owned processes or newly orphaned runtime; preserve requested user data | Never delete global WebKit, shared SDK/runtime packages, or unrelated profiles |

Actual clipboard paste/search, link clicking/internal destinations and complex-script correctness remain distinct from extraction/URI records and negative unchanged-shaping tests. They must stay open until executed.

## Security-update/rebase controls

No maintenance owner is currently assigned; this prevents a production claim. A sustainable isolated runtime needs a named owner and review cadence for stable/security updates, support horizon and incident response. Each revision must verify official source, preserve upstream security fixes, review every changed preimage/API, re-run current TU and installed same-package gates, regenerate SBOM/licenses and host ABI evidence, and retire vulnerable bundles. Exact rollback compatibility and source availability obligations must be established. No old 2.52.6 cache, private prefix, or old 15/15 result is security maintenance.

A maintained distribution backport is preferred when actually available and validated on supported production hosts. Internal upstream/backport materials remain drafts; this work does not send them, configure production keys/endpoints, publish packages, merge main, or modify notifications/security policy.

## Current measured continuation inputs

[43852458294](evidence/43852458294/REPORT.md) now supplies actual two-PCH/ten-TU success and identity-bound object retention. [Measurements](evidence/43852458294/measured-next-stage-inputs.json) explicitly do not extrapolate full-build duration; cross-job restore is unproved and PCH binaries require regeneration. [Configured static targets](configured-static-components.json) resolve ANGLE/GLESv2/xdgmime/Skia/PAL graph inputs but do not include every direct object, nested/header-only dependency, license or installed component. No additional build is scheduled by these records.

The next clean-job proof is described in [CROSS-JOB-RESTORE.md](CROSS-JOB-RESTORE.md). The [actual graph inventory](full-build-graph-inventory.json) and [bounded continuation conditions](FULL-BUILD-SEGMENT-PLAN.md) separate restoration, compile progress, full linking and same-package acceptance. They do not schedule a full build or assert restored objects are usable before the native proof completes.
