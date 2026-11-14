# P7 M01 evidence archive tools — preparation only

No copy has been authorized or performed by preparing these tools. Root must issue GO after the relevant runs and reports stop changing. Run commands from this directory with `PYTHONDONTWRITEBYTECODE=1`.

1. `python3 archive.py --plan archive-plan.json` reads only selected evidence and writes a plan here; it measures deterministic gzip sizes by streaming to a counter, not a temporary compressed tree. Review all `entries` and `excluded`, especially newly added evidence. Planning does not copy to the repository.
2. After explicit GO: `python3 archive.py --approved-copy archive-plan.json`. The destination is fixed at `/workspace/milkup/docs/evidence/v2-product-phase7-quality/milestone01`, must not exist, and cannot be merged/overwritten. Each original SHA/byte count must still match the plan. A private staging directory is verified then renamed. A failed partial staging directory remains for review; the script never deletes evidence.
3. `python3 verify.py /workspace/milkup/docs/evidence/v2-product-phase7-quality/milestone01` validates archive file size/hash, metadata/index hash, and the decompressed byte count/hash of every gzip payload. It rejects missing/unlisted files and symlinks. Run `index.py DEST` only when intentionally rebuilding the generated index from the unchanged manifest.

The payload manifest hashes every preserved source/script/log/screenshot/package. `archive-metadata-checksums.json` additionally hashes the generated manifest and index; as with a conventional checksum list, that checksum file does not recursively hash itself. Keep its hash in Root's outer evidence index if an independent trust anchor is required. Hashes detect byte changes, not provenance forgery.

Selection uses explicit top-level roots and suffixes. All node_modules/target/install/dist/profile trees, sensitive filenames, symlinks, hidden native recovery `.work` copies, locks, application binaries and unpacked `plugin.js` bundle duplicates are excluded without reading their contents. `native-ui/runtime` and `candidate-runtime` contain known source scripts, not user profiles. Only their reviewed `run-env.sh`, `driver-control.py`, `driver.sh`, and README (when present) are allowed. The six existing scripts were inspected and contain paths, public hashes, ports/PIDs and isolation settings, not credentials; external sourced `.cloud` environment files were not read or copied. Unknown members and `__pycache__` stay excluded. Real profiles under `/tmp/milkup-p7-profiles` are outside the source root and never traversed. Raw log/JSON evidence is copied unchanged, including failures and diagnostic paths. No credentials or browser/profile state are intentionally included. The plan is a bounded evidence selection, not a claim to perform a complete content-level secret audit.

Large synthetic `.md` fixtures in native run directories and named preflight fixtures, plus exact `native-ui/runs/*/samples.json` files, are archived as deterministic gzip when at least 128 KiB (level 6, empty filename, mtime 0). Their original names/bytes/SHA-256 and compressed names/bytes/SHA-256 are mapped in the manifest. Compression streams the original bytes: no JSON parsing, reordering, sample reduction or content rewriting occurs. All original source files remain untouched. The generic gzip verifier checks decompressed bytes/hash for JSON exactly as for Markdown. Small JSON, other JSON filenames, logs, PNG, small fixture Markdown and review documents remain byte-identical. The original 64 MiB planning guard was explicitly raised by Root to 96 MiB after reviewing the approximately 78 MiB complete payload; no samples or original images were removed.

The reviewed outline package and public SDK tarball are intentional exceptions to excluding build/install artifacts. Only `milkup.outline-*.milkup-plugin` and the reviewed `outline/external-1.3.2/inputs/vendor/plugin-sdk-0.3.7.tgz` are allowed; source snapshots, lockfile, manifest, offline logs and closure proofs accompany them. Future package/SDK version paths require explicit selection review. Archive payload is capped at 96 MiB, and copy requires at least predicted size plus 32 MiB free space. There is one staging payload, not a second full staging/source clone.

Do not execute the approved-copy action until Root's GO. Current plan is provisional while new candidate evidence is still being written; regenerate it after the final freeze. New source files added after planning are not implicitly included.

Additional reviewed roots: `performance-candidate` and `quality-review-tools`. Any new top-level directory (including possible future `quality-review` or `quality-candidate`) is reported in `unreviewedRoots` without reading its contents and blocks approved-copy until Root reviews and updates selection. A plan must be regenerated after review.

Root additionally reviewed `performance-repeat`: matched ordinary-Source baseline/candidate repeated runs, inventories, distributions and unchanged-byte proofs; include it without replacing the first runs.

Root additionally reviewed `performance-candidate-03`: final ordinary Source/Live matched runs, process inventories, measurements and exact-save proofs, separate from candidate02.

Root reviewed and approved these exact additional source paths (no credential content):

- `candidate-six-console-02.log`
- `candidate-six-console.log`
- `candidate03-two-console.log`
- `ordinary-source-pair-console.log`
- `browser-fixture-audit/second-startup/focused-artifacts/.last-run.json`
- `browser-fixture-audit/second-startup/focused02-artifacts/.last-run.json`
- `native-ui/runtime/xvfb-control.py`

These exceptions do not permit arbitrary hidden files, runtime files or profiles. The 96 MiB limit is a local Git evidence guard, not authorization for an artifact service or Library upload. Plan02 remains historical blocked evidence under its original 64 MiB cap. Final plan03 and any copy still require Root's separate freeze/GO.
