# Outline 1.3.2 independent build

The source plugin is copied to `/tmp/milkup-p7-outline-external`, outside the checkout. Public SDK **0.3.7** is installed from the existing local archive; no new library, network download, host-source alias or runtime import is used.

Artifact: `milkup.outline-1.3.2.milkup-plugin`, 41,359 bytes, SHA256 `c4f1bc3b3333fc8ae8919487cd2c20e59b622af98c97ce26e14ff9fdaf3b0f0f`.

SDK tar SHA256: `58973ba8b0db0dd062be5612d4c3058e339205275ebee45f2b31395e5ec965b0`. Every installed SDK file is compared byte-for-byte against that tar. All 132 dependency symlinks resolve within the external root; the three bundle inputs are copied plugin.ts, copied outline-index.ts and installed public SDK index.js. A separate trusted esbuild invocation produces identical module bytes; the archive contains exactly that manifest/module and zero residual runtime imports.

`run-build.sh` records commands. Both the offline dependency resolution and subsequent frozen offline install passed. Standalone TypeScript, 25 tests and original plugin build script passed. See corresponding logs and `verification.json`.

`inputs/` preserves the external manifest, derived lock, exact public SDK tar, sources, verifier and configs. `copied-inputs.json` hashes original checkout inputs; package.json alone is intentionally changed in the external copy to use the local SDK file and pin esbuild 0.25.12, TypeScript 5.9.3, Vitest 3.2.6 and pnpm 11.7.0. The source dependency remains its original public SDK 0.2.0 baseline. This is a derived-lock proof, not a claim the source package had a frozen lock.

To reproduce, copy `inputs/` into a new directory outside the checkout, then run the same offline/frozen install with an available pnpm cache, followed by tsc, Vitest and `node scripts/build.mjs`. The supplied verifier records this original proof directory and source inventory; update its evidence destination for a separate replay, preserving the original evidence. No upload/publication or native installation is claimed by these build results.

The previous independently built 1.3.1 archive remains unchanged in the P6 evidence. The previously bundled 1.3.1 was a different byte sequence and is preserved under `../preinstalled-before-1.3.1/`. `../bundled-outline-update.json` proves only outline changed in the runtime bundle directory, with a single 1.3.2 candidate there to avoid duplicate-ID first-package selection.
