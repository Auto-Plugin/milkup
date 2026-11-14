# Frozen plugin SDK staging audit

Date: 2026-10-19. Read-only analysis; no production code, frozen dependency profile, lock, installed package or staged bundle was changed. No install/build/test was run for this audit. The current failure is retained in `checks/bundled-stage.log`.

## Finding

`prepare-bundled-plugins.mjs` passes the current host SDK version to `resolvePublicPluginSdkEntry(pluginRoot, checkout, version)`. That helper demands that the locally installed SDK both have that exact version and contain an index.js identical to current checkout source. This conflates the host-supported SDK with the frozen plugin's reviewed build input.

The host SDK is now 0.3.6 and diagrams' reviewed SDK is 0.3.4. Baseline `1388f646` already had host SDK 0.3.5 and the same resolver, so the incompatibility exists in the baseline source as well. This is a source-derived finding; this audit did not rerun the old staging command.

The current log rejects `0.3.4 !== 0.3.6` before the bundle is prepared. Installed and checkout index.js happen to share SHA-256 `08c69a21ee6cf0de394bef80f52d01a906ceeb9ba09ab09cf46c01f4b3a0d7cb`; this coincidence must not be the acceptance policy. It would fail again when future SDK JavaScript changes even if old frozen plugins remain compatible.

There is a second instance in `verify-public-plugin-builds.mjs`: its frozen branch verifies the newly packed **host** SDK bytes against each frozen profile and writes those same host bytes into vendor/plugin-sdk.tgz. It then calls the same resolver with the host version. Fixing only the staging call site leaves the public external proof broken.

## Existing reviewed SDK evidence

diagrams profile declares tarball SHA-256 `1717c0114aa165fa3e48a1bfa7687ffd0d9b2e5392d33e99d8b2dc59a1f3ad4f`, matching the existing `plugins/diagrams/vendor/plugin-sdk.tgz`. Read-only archive inspection, without extraction, found all four regular members identical to the installed SDK bytes:

| Archive member | Bytes | SHA-256 |
| --- | ---: | --- |
| package/package.json | 556 | a10b511618230e3c88beb24c0a7f39470247727a30958525aae774f100d7ac6b |
| package/src/index.js | 3553 | 08c69a21ee6cf0de394bef80f52d01a906ceeb9ba09ab09cf46c01f4b3a0d7cb |
| package/src/index.d.ts | 39508 | f5ad0a499ed19aa10d27acef222a465f8e3df9e8b399d358213fc48f558315ac |
| package/README.md | 32676 | 8062ff5ca9c0d87bf408d3bc66c6ccb7ab1473047e21468ef647354718d6d929 |

The tar's package metadata declares @milkup/plugin-sdk 0.3.4 and the expected import entry `./src/index.js`. These facts support the proposed local check; they do not constitute a successful full staging run.

## Minimal correct change

1. Add a common frozen-SDK reader/resolver to `scripts/ci/public-plugin-build-contract.mjs`. Input is the plugin root and validated frozen entry/profile, not the current host SDK version. Read the fixed vendor/plugin-sdk.tgz using `publicBuildFile`, verify its SHA against the reviewed profile first, and obtain the public SDK package metadata and entry bytes from that verified archive without executing it.
2. Preserve the existing realpath containment requirement: SDK must be installed inside this plugin's node_modules and never linked to checkout source. Require the expected package name, valid complete SDK version, and fixed import/type entry names. Compare installed package.json, src/index.js and src/index.d.ts against the verified archive bytes (comparing README as well is cheap and supported by the current archive). Do not merely trust installed version metadata, tar hash alone, or similarity to current host code.
3. Return a small record such as `{entryPath, sdkVersion, sdkTarballSha256}`. `prepare-bundled-plugins.mjs` uses that path for its existing exact esbuild alias and the frozen build version for its per-plugin provenance. The current host SDK can remain a separately named hostSdkVersion. Do not report host 0.3.6 as the frozen plugin's build SDK 0.3.4.
4. In `verify-public-plugin-builds.mjs`, retain host tarball generation for legacy plugins. For each frozen plugin, copy its **existing reviewed** vendor tar bytes after hash verification; never replace them with the host tar. Verify copied bytes before/after the frozen install and use the common resolver after installation. Keep package.json, profile, lock and copied sources unchanged. If the reviewed tar is absent, fail with a clear missing-artifact error, without falling back to the host tar or resolving a registry SDK.
5. Leave runtime/manifest engine compatibility validation separate and intact. A frozen build SDK need not equal the running host SDK. This fix does not declare every frozen plugin compatible with every host; normal manifest engine checks still govern installation/activation.

No Mermaid closure, notices, input hash set, profile, standalone lock, SDK tarball or plugin product source needs to change. Preserve the exact reviewed dependency checks in verifyPublicPluginBundle and the staging script's existing validate-all-before-writing discipline. Do not simply delete the version/source assertions or add a diagrams ID special case.

Archive reading should be deliberately small and bounded. A trusted reviewed hash is the authenticity anchor, but decompression/member parsing still needs explicit size limits, duplicate/path/type rejection and required-member checks. Read into memory; do not extract links or paths into the working tree. A strict reader for the existing four ordinary npm-pack members is sufficient; unknown tar formats should fail closed rather than silently accepting unbounded PAX/link semantics. There is no need to add a package dependency or invoke an install solely to read these reviewed bytes.

## Necessary tests

Primary location: `tests/ci/public-plugin-dom-build.test.mjs`, extending the existing synthetic closure fixtures; alternatively a focused `public-plugin-sdk-artifact.test.mjs` alongside it. Current fixtures use literal `sdk tarball` bytes for the hash-only test, so valid compressed SDK tar fixtures are needed for the new archive reader. Existing `public-plugin-build-contract.test.mjs` continues to cover global host SDK metadata/path grammar.

- Frozen SDK 0.3.4 passes under host 0.3.6 with host index.js deliberately different; aliases resolve only to the matching installed frozen SDK.
- Installed JS, d.ts or package metadata alteration fails even when version text and tar hash are unchanged.
- Changed/missing tar, wrong package name/export entry, duplicate/missing member, truncated archive, link/path traversal and decompression/member budget excess fail closed.
- SDK node_modules symlink to checkout or outside the plugin fails; changing host source must not rescue a bad installed frozen SDK.
- Multiple frozen plugins with different reviewed SDK tarballs remain independent; legacy plugins continue to use the current host public SDK under their existing non-frozen policy.
- External verifier chooses each frozen plugin's original reviewed vendor bytes, not the just-packed host tar; copied-input/hash checks remain intact. A focused fixture should exercise the actual helper used by both consumers, not only string-match script text.
- Staging provenance identifies host SDK and per-plugin build SDK correctly; a later invalid frozen entry prevents any staged writes.

These are small build-tool tests with temporary fixtures. No browser/native runtime, new engine build or dependency installation is necessary to establish the resolver contract. Full all-plugin staging should only be claimed after running the repaired script successfully; manual copying of separately verified bundles remains a distinct, accurately labelled operation.

## Scope assessment

Safe to fix within the current P6 scope as a focused build-contract correction: one shared helper, two consumers and targeted CI tests. It is not necessary to upgrade diagrams or regenerate any frozen hash/lock. The archive-byte verification must accompany decoupling; removing equality alone would weaken the existing source-integrity assertion. This report is a proposal only, and no fix or full staging success is claimed.
