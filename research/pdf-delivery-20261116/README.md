# Normal-path extraction and current-source delivery candidate — 2026-11-16

**Source and staging-audit candidate only. No new runtime, deb, installed result or release acceptance.**

Base repository commit: `34216c7c59fbe25905f4be0edc2d5813cc36a6e1`.
The previous [43836771926 research run](https://github.com/Auto-Plugin/milkup/actions/runs/43836771926) passed its 15-case contract using WebKitGTK 2.52.6 with observation code. It is preserved, not repeated and not inherited by this candidate.

## Implemented normal behavior

`prepare.py` reconstructs a source-locked 2.52.6 patch, removing research loggers, fixture title checks, environment triggers, nominal-only negative-control switches, and all PrintContext/RenderBox/RenderLayer observer changes. It retains the first-fragment/table-header pagination, trailing root-margin correction and bounded source-text bridge. The exact research-to-normal diff and both sides' hashes are retained.

URI duplicate filtering is now a local production helper. Its set exists for one element's focus-ring collection in one actual paint call, using exact raw LayoutUnit x/y/width/height. It does not store URLs, page-global state, or cross-call rectangles; distinct neighboring/overlapping regions and calls on later pages remain. The current Skia transform/clip is unchanged. This replaces the fixture-gated research filter, so it **requires new native verification**, not just deletion of logging. Internal named destinations retain the upstream branch and have no new acceptance claim.

| Artifact | SHA-256 | Status |
|---|---|---|
| `normal-path-2.52.6.patch` | `9dff7a751f6521dd60a7b5837c39f6e846d979ccbf11df907e11e57196d83083` | extraction/reference, not a current-security delivery choice |
| `research-to-normal-2.52.6.patch` | `7fabea729862eac7e19439743858c38ad75f683a5ea73b4b701e43f8d3c0fb01` | 16-file explicit review diff |
| `normal-path-2.54.2.patch` | `855e58cc8ad531cc32e893b8274983a6264e6fdfc248c13e80c5ef0e01d7a4e5` | 22-file current-source candidate; no real TU build yet |

## Actual current-source rebase

The [official stable release index](https://webkitgtk.org/releases/) lists 2.54.2. We streamed the [official source](https://webkitgtk.org/releases/webkitgtk-2.54.2.tar.xz), verified its full compressed SHA-256 against the [official sums](https://webkitgtk.org/releases/webkitgtk-2.54.2.tar.xz.sums), and retained only 45 selected files plus receipt: 49,989,232 compressed bytes verified, 2,206,983 source bytes retained. Full archive SHA-256: `a76345b391bef6211fb5ab6cfab2e86b285d18cda17cbb9ade595f1252b86065`. No full source/build tree or installed runtime is represented by this selection.

Direct application of the 2.52.6 normal patch rejected eight files. `rebase_current.py` requires exactly that known rejection set and locked preimages, then makes explicit adaptations:

- Preserve current `Ref` ownership and `fontData.get()` calls.
- Carry TextRun provenance through the **new** `displayListForGlyphBuffer` method. Glyph-only callers receive no invented source metadata. Blindly applying the older hunk would have referenced out-of-scope `run/from/destination` here.
- Preserve current `encodingParseURL`, not the older URL parser.
- Restore three narrow, read-only table-section accessors over the existing weak fields.
- Place the retained pagination row adjustment before the new row layout-state/lambda construction, preserving current cell-growth order. This is a real version-sensitive layout adaptation and **must be checked in actual TUs and PDF output**.
- Keep current null border reset and header locations.

The examined current source still lacks these scalar/Skia-URI/pagination changes. [WebKit issue 302265](https://bugs.webkit.org/show_bug.cgi?id=302265) remains a relevant upstream URI target, not proof of a delivered fix. No maintained distribution backport with native evidence was identified in this work; that is not an exhaustive claim about all distributions. No issue/comment/PR was sent.

## Local evidence (14 tests passed)

Run from checkout, without downloading or modifying system source:

```
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s research/pdf-delivery-20261116 -p 'test_*py' -v
```

Tests restore bounded, hash-locked selected public-source ZIPs into temporary directories. They regenerate both patches exactly, reject changed preimages, compile actual policy headers with C++20 warnings-as-errors, and execute current source-text helper contracts using real HarfBuzz samples. Coverage includes independent digits and guarded complex/fallback cases; it **does not establish correct PDF extraction of all complex scripts**.

URI helper tests cover empty/no-link collections, exact duplicates, neighboring/near/overlapping regions, multiline regions, independent page/paint calls, stable ordering and 200,000 inputs. Existing pure pagination tests cover tight/roomy/oversized/forced-break/margin/long-row cases. These are **not WebKit translation units or a browser layout test**.

The staging checker is exercised with seven real, tiny synthetic ELF files compiled locally but never executed. It rejects altered source/build hashes, missing components, host WebKit fallback, unknown host dependencies, extra files, directory symlinks, unsafe permissions, wrong actual ELF search paths even with matching hashes, developer/sandbox configuration changes, contradictory generated defines, and unknown license declarations. Synthetic ELF/SBOM fixtures are **not actual WebKit build evidence or a deliverable package**. Output explicitly says staging-only.

## Final-path package boundary implemented, package not yet built

`qa-final-path-profile.json` fixes a version-and-patch-specific QA-only prefix:

```
/opt/milkup/runtime-qa/webkitgtk-2.54.2-855e58cc8ad531cc
```

`package_boundary.py` validates an enumerated staging tree without running it, installing it, changing loader environment, copying a research prefix or invoking a package manager. It requires the application, matching WebKit/JSC, Web/Network/GPU helpers, injected bundle, explicit resources, notices and SBOM. ELF SONAME/NEEDED/build IDs and final search paths are read with `readelf`; private WebKit/JSC cannot fall back to a host copy. No unlisted files or SDK payload are permitted. The initial candidate accepts real SONAME files rather than unresolved symlink layouts; a later packaging adapter must derive these from the actual CMake install artifacts, not silently strip symlinks from an existing research tree.

Build config requires release/non-developer/default bubblewrap sandbox and GTK3/API4.1. Source inspection confirms normal helper paths use compiled PKGLIBEXECDIR, and the existing sandbox binds compiled LIBDIR and PKGLIBEXECDIR. **This is source evidence, not successful installed sandbox loading.** `WEBKIT_INJECTED_BUNDLE_PATH` is still read by upstream outside developer mode; native tests must prove it is absent and that the compiled bundle path is used. No blanket claim that developer OFF removes all overrides.

Compile graph/config hashes are checked against actual supplied files; generated ABI/developer/sandbox defines are checked separately from CMakeCache. This does not authenticate an arbitrary producer: trusted build provenance, all generated configuration, actual resource discovery, the installed app/children's maps, and package ownership remain separate mandatory gates. The SBOM checker verifies declared structure, hashes and license presence; completeness requires the full build's static dependency inventory. No real SBOM or licenses for a newly built runtime have been fabricated.

## Hard execution boundary and minimal next gate

At this turn's check the local filesystem had approximately **61 MiB free**, no CMake/clang++/ccache, and no current generated headers/build graph. Existing successful objects/workflows are tied to **2.52.6**, while the normal candidate is **2.54.2** with changed APIs/configuration. They are not a valid current-version cache. No fresh full engine build was attempted locally or remotely.

Remote branch inspection found no queued/in-progress run; latest was 43836771926. **New CI dispatches this turn: zero. Unique running link/time budget: none.** The prior 2400-second/160-miss warm-cache allowance cannot honestly be applied to an uncached current version.

Next distinct gate, before authorizing a full engine/package run:

1. On an existing isolated compatible runner, lock official 2.54.2 source and supported host dependencies (GTK3, Soup3, ICU, HarfBuzz and normal sandbox tooling), configure non-developer release directly for the final QA prefix. Reject unused critical CMake variables, missing unix-print support or incompatible generated API defines. Measure disk/RAM and actual Ninja graph. Limit this configure/generated-header/changed-TU stage to 30 minutes; no implicit whole-engine target.
2. Compile all actual affected TUs with that graph's real flags. Preserve generated header/config/graph/compiler/source identities. Current policy/helper compilation does not substitute. Establish a new content-bound object archive and budget from measured progress; do not resume old 2.52.6 objects as current evidence.
3. Only with a feasible measured build and evidence-retention budget, build the normal app against the same final runtime path, stage only proven necessary artifacts/resources, generate real dependency/license inventory, and run the checker. No LD_LIBRARY_PATH wrapper, system-library replacement, developer prefix or sandbox downgrade.
4. Then perform isolated native install, same-runtime/editor/IME/plugin/exit and the unchanged 15-case PDF contract, plus normal-path duplicate behavior. Record package SHA, app/guard, real PID and exact mapped components for every case. Keep install/update-failure recovery/uninstall, actual clipboard/click/internal destinations/complex text and #255 ride-along as unexecuted until those tests occur.

These are technical missing inputs, not a request to weaken standards or use a different output. No claimed runtime/package exists to install in this turn.

## Security maintenance and original release gates

An app-isolated runtime no longer automatically inherits the distribution's WebKit security updates. It is acceptable only with an assigned, reviewable owner/process: check current stable/security advisories, preserve upstream fixes, review patch rejects, regenerate dependency/SBOM identities, rerun actual source/API/layout plus installed integration gates, and retire vulnerable bundles. Review the [current security advisory index](https://webkitgtk.org/security/) at each candidate; a version constant is not a maintenance plan. `maintenance.state` is explicitly `unassigned-not-production-approved`.

Keep the old known-good app/runtime pair during a tested upgrade; switch the whole pair only after package verification/health checks. Any recovery must select a verified compatible pair and preserve user data. This is a proposed gate, **not implemented automatic rollback**. A distribution-maintained backport remains preferable if actually available and proven on the supported system. Drafts remain internal.

Default native PDF/printing entry/output and all original release gates remain. There is no claim of a release-ready Linux PDF, physical printing, full complex-script correctness, manual copy/click, or complete five-item release acceptance. No main merge, release, production endpoint/key, personal notification, system runtime or security-setting change occurred.
