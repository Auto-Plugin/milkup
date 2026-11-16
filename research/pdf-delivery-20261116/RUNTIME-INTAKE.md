# Exact completed runtime intake, not a package pass

The input is run [43921562333](https://github.com/Auto-Plugin/milkup/actions/runs/43921562333),
source/harness `f084ae61eb3fc115c0368390d2ed87b1e8f7fb89`.
The completed normal Ninja build took 6951.602 seconds, exited zero, and has no
stop reason; same-job CMake DESTDIR installation completed. Optional linked
object checkpoint failure is unrelated and will not trigger another build.

## Actual bytes independently checked locally

* Original runtime artifact 14265020653: 283,921,787 bytes,
  SHA-256 `34e4e12cda98933eef024ede2317b3fbf255631936376312d3e8e33d915aaf7c`.
* Evidence artifact 14264011071:
  `68d61f216c3bab3b04f79c947b80d56a9b742a01aa923eb107057896561bed15`.
* Inner CMake tar: 286,494,903 bytes,
  `24222e13da4ea05d2fbebe93633d986ad54c001bf5dbc980b5dcbda51300fed1`.
* 294 exact entries, 885,166,733 regular-file bytes; all hashes/modes and four
  declared local SONAME/linker aliases verified. Source/patch are unchanged.
* Actual compile graph restored losslessly: 38,998,330 bytes,
  `d17709e8ea25829b8a2e94fc0aa7c51515c24e209acb334f6930e2e04a60c3fa`.
* Generated API 4.1, GTK3, Release, developer off, GTK Unix printing and default
  bubblewrap sandbox on. Every actual ELF has the expected final-prefix RPATH.
  Three helpers directly NEEDED the private WebKit SONAME; WebKit NEEDED JSC.
* jsc is explicitly excluded as a developer shell. Headers, pkg-config/GIR
  build metadata and unversioned linker aliases have individual exclusion
  reasons; locale/typelib runtime resources remain accounted for.

## Corrected checker, not altered runtime

Actual CMake installs both shared libraries and the injected bundle 0644,
programs 0755. Earlier synthetic tests incorrectly made every ELF executable.
The stage, package and installed gates now require exact role-specific modes;
source mode preservation, root ownership, non-writability, hashes, Build IDs,
RPATH and all identity requirements remain. Positive library and negative
program/library-mode tests cover this correction. No binary was patched.

## Bounded next operation

`current-runtime-intake` in the existing explicitly dispatched workflow has a
20-minute hard job bound. It authenticates the above ZIPs before extraction,
then resolves direct and transitive ELF dependencies plus required symbol
versions on ordinary Ubuntu 26.04. Official SDK dependency plans must not remove
packages or install/upgrade system WebKit/JSC. It never executes the staged
ELFs, builds an engine/application, installs this runtime, changes a loader
path, or disables sandboxing. Raw original ZIPs are separately retained up to
90 days; this is still expiring Actions retention, not permanent storage.

A Library upload was attempted with the current documented helper. It failed
at tools/list HTTP 401 before a create; no Library copy was made. The checked
local /tmp copies are ephemeral. Do not claim persistent Library preservation.

## Remaining, independently blocking package acceptance

1. Actual Ubuntu host transitive ABI closure (this operation), including package
   ownership/hash/version; separately audit dlopen and resource paths.
2. Complete build-derived static component/license inventory and SBOM. The
   CMake install alone contains no license notices. Compile DB includes ANGLE,
   Skia/skcms and xdgmime; that list alone is not complete static provenance.
3. Build/bind the unchanged integration application
   `546796b005390642ee5cc655440b4b350a730717` and its assets at the final prefix,
   assemble the exact package and run existing stage/installed gates. No
   application binary is included in the CMake runtime artifact.
4. Ordinary-user installed mappings, actual default sandbox, same-package native
   PDF matrix, code wrapping, #255, external reload, IME, clean exit and package
   lifecycle. None is inferred from readelf or this historical engine build.
5. Supported delivery/security maintenance and update/recovery ownership remain
   unassigned, not production-approved. No system runtime replacement or
   research/private loader override is an acceptable substitute.

No production settings, main, notification settings, security policy or release
were changed. The default original native PDF/print output contract remains.
