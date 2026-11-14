# WebKit 2.52.6 patch: build and terminal deployment feasibility

Assessment: **research patch preparation is feasible; a runnable patched engine and a compliant end-user delivery are not currently available.** This assessment performs read-only inspection and writes evidence only. No engine/runtime download, cache cleanup, compilation, library replacement, injection, product edit, or installation was performed.

The user's constraints are authoritative: retain existing dependencies, do not replace global system libraries, do not bundle a large custom WebKit by default, and do not shift a new engine installation burden to users. A source patch is not a fix to the currently installed binary. The previous Chromium experiment remains research evidence and is not the selected delivery route.

## Exact local engine

The environment uses the Debian `webkit2gtk` package `2.52.6-1~deb13u1`, amd64, extracted into the private cloud sysroot. It is not a local WebKit development build.

| Item | Observed value |
| --- | --- |
| API / runtime | WebKitGTK 4.1 / 2.52.6, GTK3, libsoup3 |
| Actual library | `/workspace/.cloud/milkup-v2/sysroot/usr/lib/x86_64-linux-gnu/libwebkit2gtk-4.1.so.0.21.10` |
| Library bytes | 96,302,176 |
| Library SHA256 | `e5145df62121ee186c4a9bdaebe2ebebb706d8ce400675b131449ecf8bd94889` |
| ELF build ID | `07d5042a452660c650c0e3e1a710d47faa24ff46` |
| Cached archive | `libwebkit2gtk-4.1-0_2.52.6-1~deb13u1_amd64.deb` |
| Archive bytes / SHA256 | 24,163,372 / `6471d989a61a56a7801e88e420789aa6b0eaba630a9787365bba8b9576b7ba1c` |
| Matching JavaScriptCore dependency | `libjavascriptcoregtk-4.1-0 (= 2.52.6-1~deb13u1)` |

The installed library exactly matches the member streamed from the cached archive; no archive extraction was needed. See [library-provenance.json](library-provenance.json). Cached APT metadata identifies the Debian trixie-security snapshot package. `.pc` metadata reports `revision=tarball`, not the full Debian build configuration. WebKitWebProcess links the WebKit and JavaScriptCore shared libraries; no separately replaceable `libWebCore.so` or `libSkia.so` was found in this runtime.

The exact-tag [OptionsGTK.cmake](https://raw.githubusercontent.com/WebKit/WebKit/webkitgtk-2.52.6/Source/cmake/OptionsGTK.cmake) defaults little-endian builds to Skia and selects Cairo when Skia is disabled. This is a **compile-time** choice, not an identified runtime print-quality switch. Actual baseline PDFs identify their producer as `Skia/PDF m145`, consistent with that route. The complete Debian build flags have not been recovered, and Cairo's presence in the dynamic dependencies does not prove Cairo is the printing backend. Existing exact-tag source analysis also finds glyph-only drawing on the Cairo route, so changing the backend alone is not an established Unicode repair.

## Why a small runtime patch module is not available

`readelf` finds `.dynsym` and `.gnu_debuglink`, but no ordinary `.symtab`; the library is stripped. Dynamic-symbol searches for `buildTextBlob`, `FontCascade`, `SkPDF`, and `SkTextBlob` find no exported entry point. Public WebKit extensions do not provide an identified supported hook for replacing this internal text-cluster transport.

Preserving original Unicode requires carrying metadata through the text/shaping/drawing path, potentially including display-list recording and replay, before Skia receives the glyph run. It cannot be reconstructed reliably from a glyph ID after aliases or shaping have collapsed different source sequences. A preload wrapper around a public print entry point would not restore that metadata. Binary-offset patching or unsupported internal interposition would bind to exact build layout and does not provide a maintainable ABI or a security-preserving deployment plan; neither was attempted.

A changed C++ file can be incrementally compiled **after** a matching configured full source/build tree exists. It is not an independently installable plugin. Generated headers, compiler flags, internal types and the final shared-library link are required. WebKit also combines translation units into generated unified sources. See the official [unified build description](https://docs.webkit.org/Deep%20Dive/Build/UnifiedBuilds.html). The existing small diagnostic source excerpts are not such a tree.

## Measured environment limits

Recorded at **2026-10-19 05:52:45 UTC**, while an unrelated research application build was active; free space and current memory are transient. Raw command output is retained in [build-environment-inspection.json](build-environment-inspection.json).

| Resource | Measurement |
| --- | --- |
| Persistent workspace available | **357,564,416 B** (about 341 MiB), 99% used |
| Workspace total | 33,770,192,896 B |
| `/tmp` available | 9,423,675,392 B, **tmpfs**, not independent durable storage |
| Container memory limit | **17,179,869,184 B (16 GiB)** |
| Container memory current | 7,848,857,600 B |
| Host swap | 0 B |
| CPU quota | `400000 / 100000`, equivalent to 4 CPUs |
| Workspace free inodes | 1,732,243; not the immediate bottleneck |

Using `/tmp` for engine sources/objects consumes RAM from the same constrained environment and competes with compiler/linker memory. Its nominal free capacity is not a separate 9 GB disk budget. A complete WebKit build's peak disk/RSS has **not** been measured here; no precise build-size or completion-time promise is justified. The stripped runtime library size is not a build-space estimate.

After sourcing the existing environment, GCC 14.2 and Perl are available, but `cmake`, `ninja`, `clang++`, `ld.lld`, `bison`, `flex`, `gperf`, `ruby`, and `unifdef` are not found in PATH. GTK3, libsoup3, GLib, HarfBuzz and ICU development metadata are present. GStreamer development metadata and multiple graphics/security/support development packages are absent, including libavif, libjxl, libseccomp, libdrm, gbm, libmanette, lcms2, libsecret, enchant and libgcrypt. This means development metadata is missing, not that all corresponding runtime libraries are absent.

No matching engine source tree, CMake cache, generated headers, object archives or reusable WebKit link tree was found in the inspected workspace/cloud caches. Freeing application build caches alone would not supply these missing prerequisites. No cleanup was performed.

## Bounded path to a runnable research patch

1. Preserve the current binary, package provenance and failing PDF fixtures. SDK work can prepare a version-scoped patch and source-level regression proposal now; mark it uncompiled until tested.
2. Use a separately provisioned builder with the exact Debian source revision and packaging/build configuration, matching build dependencies, compiler/toolchain and durable storage. Obtaining those inputs is a separate action, not performed here. Do not start an open-ended engine rebuild in this environment.
3. Build an unpatched baseline and the patched engine with the same options. The official GTK route uses CMake with `PORT=GTK` and Ninja; its documentation recommends a prepared SDK. See [WebKit build options](https://docs.webkit.org/Build%20%26%20Debug/BuildOptions.html). Do not run its global installation example on this machine. Begin with bounded compile parallelism and measured disk/RSS; select symbols/linker only after validating the exact source configuration. Keep sandbox and security features enabled.
4. Stage the matched engine/helper/resource outputs in a **private research prefix** and run a disposable isolated test wrapper, without overwriting the existing sysroot or global loader configuration. Validate library resolution and helper provenance. Reusing a SONAME does not establish compatibility of internal WebKit/JSC/helper binaries from different builds; use a matched set unless compatibility has been demonstrated.
5. Run the original Unicode fixtures, strict raw text extraction (no NFKC masking), source-sequence distinctions, mixed scripts, combining sequences, ligatures and emoji; compare all-page pixels against the unpatched baseline. Run actual PDF and GTK Print-to-File, then cancellation, offline-resource restrictions and size/deadline guards. Compile success alone cannot close the existing fidelity failure.

This is a concrete research route, **not a current end-user distribution plan**. No runnable patched engine has been built or tested in this task.

## Terminal delivery under the user's constraints

| Route | Assessment |
| --- | --- |
| Upstream fix, then normal distribution maintenance of the existing WebKit dependency | The route compatible with retaining the dependency and avoiding an extra bundled engine. Requires upstream review/backport and distributor adoption; no acceptance or release date is known. Milkup must not install a custom global library. Existing installations remain affected until their normal maintained engine includes the fix. |
| Private full patched engine packaged with Milkup | Can technically isolate ABI and helper versions, but adds engine payload and maintenance. Even the current WebKit library alone is 96,302,176 B uncompressed, before JSC/helpers/resources; the 24,163,372 B deb is not the full private-runtime cost. This conflicts with the selected size/dependency constraints and is not proposed for delivery. |
| Download a patched private runtime on first export | Moves payload and maintenance to users; violates the requested direction. Not an acceptable workaround. |
| Small preload/binary delta against arbitrary installed WebKit | No supported, version-independent graphics hook identified. A delta would require exact base bytes/build IDs and still create a complete modified engine image; distro/security updates invalidate it. It does not avoid ABI, licensing, maintenance or disk obligations. Not a validated delivery route. |

A binary difference applied to a **private copy** would avoid overwriting the global library, but it is still unvalidated and is not a generic small dynamic patch. Its input would have to match an exact trusted package hash/build ID, architecture and configuration; its reconstructed output would need a trusted reproducible hash and provenance. The application must fail closed on every other base, rather than patching by version string alone. Compiler/linker layout changes can enlarge a delta: **no delta has been generated, so neither download size nor savings is measured**. The current base library already occupies 96,302,176 B; the patched size is unknown. A private-copy design needs storage for the reconstructed library plus safe staging/rollback, and a verified helper/resource/dependency layout. It cannot simply assume that arbitrary system JSC/helpers remain compatible. Each distribution security update changes the base and requires new verification, likely a new delta and renewed regression coverage; retaining an old private copy would bypass that update until maintained. These unresolved version-matrix, storage, lifecycle and rollout requirements prevent calling this a lightweight deliverable now. No difference file, private library copy or replacement was produced.

ABI scope must explicitly distinguish API4.1/GTK3/libsoup3 from other WebKit ports, versions and architectures. A patch for this exact 2.52.6 source does not demonstrate compatibility with every supported Linux distribution. Public API stability does not make internal C++ or helper protocols interchangeable.

Distribution is also a source/licensing and security-maintenance responsibility. WebKit contains both LGPL and BSD licensed code; preserve file-specific notices and review the exact built artifact's source/third-party obligations before distribution. The upstream [licensing overview](https://docs.webkit.org/Other/Licensing.html) describes that mixed licensing. No package compliance approval or distributable artifact is claimed here.

**Delivery status:** currently a researched mechanism and a candidate source-patch direction, with local build prerequisites and terminal rollout unresolved. There is no demonstrated immediate app-only fix satisfying all current constraints. Retain the existing WebKit PDF copy/search failure explicitly until a real patched binary passes and an acceptable deployment path exists.
