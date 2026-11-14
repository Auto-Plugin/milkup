# Outline 1.3.1: independent public SDK build

Date: 2026-10-19. Product baseline: `1388f646703ba19c4ed501b0450d123e70388f9a`. Build directory: `/tmp/milkup-p6-outline-external`, outside the Milkup checkout. No product functionality, plugin version, manifest permission, UI, Cargo or root lock change is part of this task. The only repository change is `plugins/outline/README.md`, correcting obsolete SDK 0.1.1 and package 1.2.0 examples and describing dependency-proof limits.

## Deliverable

`milkup.outline-1.3.1.milkup-plugin`, **40,695 bytes**.

SHA-256: `7eea6ffb5bba53155b3c256c6e35d95b04a93199ebbbd04636ee9c7ec5f6f712`

Entry `plugin.js`: 35,501 bytes; SHA-256 `b31335a8d530eaed35652da736666db93371faad2ec111b0e3726c892bedc27a`.

Public SDK: `0.3.6`, archive SHA-256 `2043b0586c73579c06821c76a20eb0d7a852ffd7c7e8181ea555433a0c506cec`. It was installed from the exact local tarball; no private host source or package alias was used. The manifest keeps `>=0.2.0 <0.4.0` and document:read only. This proof does not separately execute the historical SDK 0.2.0 baseline.

## Results

| Check | Evidence | Result |
| --- | --- | --- |
| Independent dependency install | `install-online.log` | Exit 0, 53 packages reused and 3 downloaded; 56 packages added. Ordinary build/test dependencies only. |
| Offline frozen follow-up | `install-frozen.log` | Exit 0; external generated lock accepted without resolving new dependencies. |
| Public SDK type consumption | `typecheck.log` | Exit 0, standalone plugin-owned tsconfig. |
| Source tests | `tests.log` | 24 passed in 2 files, including document/version cancellation and paged outline index tests. |
| Independent bundle/archive | `build.log` | Exit 0, original copied build script. |
| Package/dependency closure | `closure-esm.log`, `verification.json` | Exit 0; 3 inputs, no runtime imports; trusted rebuild equals output; exact archive manifest and embedded module checks. |

The installed versions were pnpm 11.7.0, TypeScript 5.9.3, esbuild 0.25.12 and Vitest 3.2.6; Node v24.19.0. All 132 dependency symlinks resolve inside the external build directory. Bundle inputs resolve only to copied `src/plugin.ts`, `src/outline-index.ts` and the installed public SDK `src/index.js`. There are no workspace source mappings.

Two unsuccessful diagnostic attempts remain visible: `install.log` is the initial offline failure caused by absent registry metadata; `closure.log` is a verification-script CJS resolver failure because the SDK exports an ESM import entry only. The corrected verifier uses `import.meta.resolve`; neither failure was a plugin build/test failure. `closure-esm.log` is the successful result.

## Inputs and reproducibility boundary

- `copied-input/` and `copied-inputs.json` preserve the original plugin files copied from the checkout (including the corrected README).
- `external-input/` and `external-inputs.json` preserve the independently built input, exact SDK tarball, external package manifest, generated lock, Vitest config and closure verifier. No node_modules or runtime binaries are copied into evidence.
- The approved external package mutation replaces SDK 0.2.0 with `file:vendor/plugin-sdk.tgz`, pins the three tool versions above and records packageManager. All other source/package/manifest content is checked unchanged.
- The source plugin still supplies no frozen dependency lock. This is an **external derived lock** proof, followed by a frozen offline install, not a claim that the original repository package was already frozen. The first resolution may use normal package metadata/network; it did here.

Commands used after copying inputs and recording the external manifest:

```sh
# cwd: /tmp/milkup-p6-outline-external
node /workspace/.cache/corepack/v1/pnpm/11.7.0/bin/pnpm.cjs install --ignore-scripts --no-frozen-lockfile --store-dir /tmp/milkup-p5-m06-pnpm-home/store --cache-dir /tmp/milkup-p6-outline-cache --config.manage-package-manager-versions=false --config.verify-store-integrity=true
node /workspace/.cache/corepack/v1/pnpm/11.7.0/bin/pnpm.cjs install --offline --ignore-scripts --frozen-lockfile --store-dir /tmp/milkup-p5-m06-pnpm-home/store --cache-dir /tmp/milkup-p6-outline-cache --config.manage-package-manager-versions=false --config.verify-store-integrity=true
node node_modules/typescript/bin/tsc --noEmit
node node_modules/vitest/vitest.mjs run --config vitest.config.mjs
node scripts/build.mjs
node verify-closure.mjs /workspace/milkup-plugin-lifecycle-evidence/milestone01/outline-external
```

To replay elsewhere, copy `external-input/` into a new external directory and use its frozen lock with an available package cache (or ordinary dependency download if absent). The verifier also reads this evidence directory's original copied-input inventory. Do not silently claim offline reproducibility without the dependencies present.

## Installation example and remaining acceptance

In the host's normal built-in plugin manager select **安装本地插件**, choose the delivered `milkup.outline-1.3.1.milkup-plugin`, inspect the document:read declaration and enable it. Its sidebar contribution is 大纲. Disable/uninstall through the same host manager. No plugin ID special case or private host import is needed.

The artifact and SHA were sent to the parent and plugin UI agent for actual installation acceptance. This task did **not** run native UI or claim the package was installed in a user profile. Windows/macOS, release upload, Runtime delivery, lifecycle transactional upgrade/rollback and broad performance qualification remain outside this proof.
