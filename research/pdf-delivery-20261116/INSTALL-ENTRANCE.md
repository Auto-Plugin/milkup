# Executable final-prefix entrance — prepared, not installed

QA-only branch based on `0f9eebe43406824f93d33c39f49fc95b063f3276`.
Application candidate is **v2 integration `546796b005390642ee5cc655440b4b350a730717`**,
not the application sources on this research/QA branch. No workflow was edited,
no CI was dispatched and run 43890194973 was not queried or changed.

## Implemented now

`install_gate.py stage` reuses the existing `package_boundary.audit` and binds its
assembled payload to the **actual** CMake `install_manifest.txt` and original
`DESTDIR`. It does not run CMake, install, reconstruct a runtime from object files,
copy a research prefix or manufacture a manifest. The upstream install must first
complete at the already-compiled final prefix in a separate temporary DESTDIR.
Every runtime/helper/driver/resource file must match its CMake-installed source
byte-for-byte and mode-for-mode. The only file-link normalization accepted is a
bounded local chain whose every path appears in that same install manifest; final
payload SONAME files remain real files. Absolute/parent links, directory aliases,
wrong source/hash/prefix, extra/missing files and unexplained exclusions fail.
Every omitted SDK/development path needs an explicit per-path review rationale.
The tool is an audit entrance; a real assembly/packaging producer remains pending.

The reused boundary now also requires the matching **QA WebKitWebDriver** at
`<prefix>/bin/WebKitWebDriver`, and carries forward the actual generated GTK API4.1
and GTK Unix printing checks. QA driver inclusion is not a decision to ship a
WebDriver in a public product. The remaining release/runtime closure, host ABI,
licenses and build-derived SBOM rules are unchanged. Synthetic licenses/SBOM in
unit fixtures cannot satisfy real build provenance.

`install_gate.py installed` is read-only and refuses root execution and loader,
injected-bundle or sandbox overrides. It validates the exact `.deb` hash/size/name,
reads its actual payload through `dpkg-deb --fsys-tarfile` (60-second hard child
bound), rejects unexpected/link/duplicate/traversal/oversized entries, checks
root ownership and exact role modes, and compares all payload bytes. It then
checks the final installed closure and **every ancestor's** ownership, modes,
symlink status and effective ordinary-user write access (including ACL effects).
It rechecks installed file hashes and ELF identities/RPATH. App and driver must
be the exact manifest paths, not `/usr/bin` substitutes or environment-selected
research executables. There is no chmod/chown, installer, package replacement,
package-manager policy change or executed ELF in this gate. Debian control/maintainer
script review remains a separate prerequisite before any actual install; the data
stream check does not approve those scripts.

Every CLI result has a deliberately limited status; a failure saves its earliest
error without overwriting earlier evidence. Stage receipts bind the complete
manifest. Neither a receipt nor synthetic tests imply actual native mappings,
sandbox execution, package-manager installation or PDF correctness.

## Input contract and invocations (future real artifacts required)

Use the existing `qa-final-path-profile.json`, locked real CMake cache, compile DB
and generated config. Extend the candidate manifest consumed by `package_boundary.py`:

- `applicationSourceSha` **and** `sourceSha`: exactly `546796b0…` above.
- `installer`: `{name, bytes, sha256}` for the eventual exact QA `.deb`; the manifest
  resides beside this package so the existing native package checks can reuse it.
- `cmakeInstall`: `{manifestSha256, cacheSha256, excludedEntries:{absolutePath:reason}}`.
- `files`: existing exact payload roles/hashes, plus one `qa-driver`; no implicit files.
- Existing source/patch, build evidence, host dependencies, SBOM, license and
  unassigned-maintenance fields remain mandatory. No production approval is invented.

```sh
python3 research/pdf-delivery-20261116/install_gate.py stage \
  --stage "$ASSEMBLED_PAYLOAD" --destdir "$CMAKE_DESTDIR" \
  --manifest "$CANDIDATE_MANIFEST" --recipe "$FINAL_RECIPE" \
  --install-manifest "$BUILD/install_manifest.txt" --cache "$BUILD/CMakeCache.txt" \
  --commands "$BUILD/compile_commands.json" --config "$GENERATED_CONFIG" \
  --output "$NEW_STAGE_RECEIPT"
```

After a separately authorized real package install, run **as the ordinary test
user**, with no runtime loader variables:

```sh
python3 research/pdf-delivery-20261116/install_gate.py installed \
  --manifest "$CANDIDATE_MANIFEST" --recipe "$FINAL_RECIPE" \
  --receipt "$NEW_STAGE_RECEIPT" --package "$EXACT_QA_DEB" \
  --application "$FINAL_PREFIX/bin/milkup-desktop" \
  --driver "$FINAL_PREFIX/bin/WebKitWebDriver" --output "$NEW_INSTALLED_RECEIPT"
```

The application must actually have been built/linked for that final prefix. A
previous standard `/usr/bin` package or an environment override will not pass.
Actual package construction, launcher/desktop-file support, deployment/recovery
and maintenance ownership still need implementation/proof; this gate does not
hide those missing deliverables.

## Same-package daily acceptance wiring, not executed

`scripts/ci/run-linux-final-prefix-daily.sh` is a new **manual entry**, not attached
to any workflow. It first runs the installed gate, obtains the exact package/app
identity, refuses an occupied driver endpoint and explicitly starts the declared
matching WebKitWebDriver via tauri-driver. The driver wrapper has a 600-second
bound, installed gate 90 seconds, external-reload case 240 seconds, #255 180 seconds.
Use a 720-second outer supervisor with existing isolated failure-artifact collection.
No research logging flags or private-runtime override are required.

Provide `MILKUP_FINAL_MANIFEST`, `MILKUP_FINAL_RECIPE`, `MILKUP_FINAL_STAGING_RECEIPT`,
`MILKUP_FINAL_PACKAGE`, `MILKUP_FINAL_APPLICATION`, `MILKUP_FINAL_DRIVER`, plus the
existing native exclusive-display, isolated ordinary-user profile/XDG paths,
`MILKUP_NATIVE_EVIDENCE_DIR`, `MILKUP_NATIVE_EXTRACTED_APP`,
`MILKUP_NATIVE_CLOSE_HELPER`, and `RUNNER_TEMP` contract. This entry does not create
profiles, alter system services, install packages or use credentials.

- External reload entry and response-delivery helper are **byte-identical** to
  integration 546796b0. Real read + system keyboard; bounded, explicitly reported
  transport delivery scheduling covers late edits and switched-document results.
- Existing #255 entry is unchanged: actual keys in middle-of-line brackets,
  wait 3.2 seconds, mark insertion, save/reopen and exact normal-close evidence.
- #94 remains **not applicable / not executed**: no supported language-switch UI
  exists on the reviewed candidate. No fake switch or inferred pass is substituted.
- Default sandbox / actual app, WebProcess, helpers and driver PID/birth/library
  mapping gates and the same-package PDF suite remain required independent steps.
  This minimal entry does not yet claim to implement that complete launcher/sampler.

## Local evidence and remaining boundaries

24 local tests (9 existing/extended ELF-boundary + 15 new entrance tests) pass.
They compile small **synthetic** ELF files and build/read one **synthetic** `.deb`;
that package is never installed or executed. Tests cover real CLI receipt writing,
source/manifest/cache mismatch, declared local SONAME links, escape/alias/unsafe
permissions, missing driver, corrupted bytes, wrong application/driver paths,
archive ownership/paths, preserved prior evidence and simulated root/ACL cases.
The real user-owned tmpfs staging directory is also correctly rejected as an
installed final prefix. Passing protection mocks are not root-owned installation
proof. An initial synthetic `.deb` construction error (control directory 0700)
was fixed in the **test fixture** to Debian's required control mode; no system mode
or product permission was changed.

Current host has no native DISPLAY/tauri-driver/WebKitWebDriver/xdotool. No real
engine install manifest, final-prefix package, mapping, PDF, IME, #255, external
reload, upgrade/recovery/uninstall or release result is claimed here. Existing
research-engine results are not inherited. The full engine build remains under
its parent's existing monitor. Production channel/keys, main, notifications and
security settings were untouched; no upstream material was sent.
