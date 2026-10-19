# Independent outline 1.3.3 build

Frozen archive: `milkup.outline-1.3.3.milkup-plugin`, 42,792 bytes, SHA256 `80a9ce947c4abf2998eb72c36c327d5d826f0d30fa22dad61f903ff4713ca5c6`.

Combines bounded passive scan-progress coalescing and at most two concurrent four-page read batches. No SDK API changes; full headings, 24-page resident cache and rendering limits remain. See source README in inputs for behavior/bounds. Native candidate04 latency validation is pending; unit concurrency is not proof of a native latency gain.

Build root `/tmp/milkup-p7-outline-1.3.3-external` is outside the repository. Source files were copied, never linked back to product source. Dependencies were copied from the existing verified `/tmp/milkup-p7-outline-external/node_modules`, hardlinking immutable package/tool files and retaining relative symlinks inside the new external root. No install command, network download, repository-private alias or source import was used. The public SDK0.3.7 tar is retained in inputs/vendor; SHA256 `58973ba8b0db0dd062be5612d4c3058e339205275ebee45f2b31395e5ec965b0`.

`run-build.sh` lists the exact no-install build/check sequence. For a newly recreated build directory, restore `inputs/` and provide the locked existing/offline dependencies first; the script does not silently fetch them. `dependency-reuse.json`, copied-inputs.json and verification.json record provenance. Package.json changes only external build-tool pins/public SDK file dependency, while source package devSDK0.2.0 baseline is preserved.

Validation:

- Four new sparse-fold regression tests failed before implementation; `../prefetch/red-01.log` retains all four failures.
- Full repository outline suite40 PASS after implementation; independent external suite40 PASS, including all progress tests and both 8775/18000 complete-heading oracles.
- Production TypeScript check PASS. Additional strict typecheck including all tests initially found incomplete older SDK mocks (missing host methods, viewport bounds, scan query), retained in test-types.log. Exact required fields and fail-fast unused-host stubs were added; final all-test strict typecheck PASS. No product behavior was changed for this correction.
- Build PASS, independent esbuild reconstruction byte-identical, zero runtime imports, every dependency symlink resolves inside the external build root (132 links), and installed SDK files match the retained public tar byte-for-byte.
- README and test-only cleanup were copied again and reverified. verification-first.json/copied-inputs-first.json preserve the first closure. Archive hash is unchanged by these non-bundled edits.

Source freeze is `../outline-1.3.3-freeze.json`. `../bundled-outline-update.json` proves exactly one ignored runtime outline archive changed from1.3.2 to1.3.3, with all other10 archives identical. M01's original1.3.2 archive is unchanged. No artifact uploaded, installed system-wide, committed or published by this subagent.
