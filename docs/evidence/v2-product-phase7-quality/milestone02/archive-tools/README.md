# M02 provisional archive policy

Preparation only. M01 remains immutable. No archive copy, gzip run, final hash inventory, or claim of frozen completeness has occurred. Final source, test and native runs are still pending. This directory is a local Git evidence plan, not installation, distribution, upload or release authorization.

Current roots reviewed by name: validation, environment, outline, build-tools, review, archive-tools. The metadata-only inventory refuses to silently accept new roots/extensions/runtime paths; its requiresReview list must be empty after explicit review before a final plan is approved. Never traverse user profiles, dependency/cache trees or symlinks. Actual native profiles are outside the evidence tree under /tmp/milkup-p7-m02-profiles; do not copy them.

Include source/test snapshots, public small scripts, JSON samples and results, original logs and PNG, input hashes, environment/driver ownership records, source manifests and build metadata. Runtime script whitelist is exactly outline/runtime/{run-env.sh,driver.sh,driver-control.py,xvfb-control.py}; these four scripts were read and contain public paths/ports/process control, no credentials. Do not read or copy their externally sourced environment files.

Exclude ELF, native builds/installers, .work recovery copies, node_modules, user profiles, diagnostic .milkup-plugin archives, SDK .tgz files, and generated dist/plugin.js. Retain diagnostic plugin prepared/build source and small dist/build-meta.json plus build-proof.json/inventory.json instead. No Windows validation is claimed. Exclusion does not delete any original evidence.

All original failures and samples remain: complete browser-full01 (196 passed / 1 failed), target01 (zero tests due to incorrectly anchored grep), target02 (single case passed, zero retries). The targeted pass does not repair or replace the failed full suite. Preserve original native failures and overlap disclosures. Future trace.zip requires explicit review and a size check; do not silently discard a retained failure trace.

At freeze, synthetic outline/runs/*/*.md fixtures >=128 KiB map to original-name.md.gz using streaming deterministic gzip level 6, empty filename and mtime=0. Preserve original name, byte length and SHA256; verify gzip decompression length/hash. Original source Markdown stays untouched. Current large fixture is 26,018,029 bytes; the dense fixture is 1,489,012 bytes. No sample reduction, JSON rewriting, PNG recompression or historical result replacement is allowed.

Proposed payload cap: 16 MiB. Current size is only a metadata estimate until gzip is measured; do not claim actual compressed bytes. If new outputs exceed it, stop and report concrete contributors rather than raising the cap or dropping evidence. Final freeze steps: inventory all roots; hash approved source inputs; measure deterministic compression; review concrete plan; obtain COPY GO; copy into a new staging directory; generate manifest/index/checksums; verify original and stored hashes including gzip; atomically publish to docs/evidence/v2-product-phase7-quality/milestone02; independently verify with python3 -B/PYTHONDONTWRITEBYTECODE=1. Destination must not already exist. Final source drift or new unknown roots blocks copy.

Run inventory only during an authorized lightweight preparation slot:

    python3 -B inventory.py provisional-inventory01.json

Generated provisional inventories are external review records, excluded from recursive payload enumeration. Final archive metadata must preserve the final excluded-path reasons separately. Source scripts are included for reproducibility.

## Candidate04 / final validation additions (prepared only)

Root approved candidate-production-04 only for proof-before.json, proof.json, build.log, build-exit.txt and optional frontend-assets.json/assets-metadata.json. proof.json already embeds frontendAssets SHA metadata. The extensionless milkup-desktop ELF is explicitly excluded; other candidate paths stop for review. No native executable, installer or copied frontend distribution is archived.

Allow outline/runtime04 exactly run-env.sh, driver.sh, driver-control.py. These three scripts were read as source, use checked candidate04 proof/hash and owned process controls, and contain no credentials. Do not follow sourced external env or profile paths. outline/candidate04-inputs contains approved harness/test source snapshots and is included under the existing outline source rules. New runtime filenames still require review.

Exclude outline/external-1.3.3/plugin.js as a generated bundle as well as every .milkup-plugin and SDK .tgz. Preserve independent input source, lock/config, build-meta.json, copied-inputs and verification hash proofs. This intentionally means archives referenced by external build instructions must be supplied separately for reproduction; the Git evidence does not ship them.

To remain within 16 MiB, at the eventual frozen planning slot all selected .json or .log files >=128 KiB may also map to .gz, in addition to the synthetic Markdown rule. Gzip is streaming level6 / mtime0 / empty filename, preserves exact original bytes without JSON parsing, line rewriting or sample changes. Manifest must retain original path/name, original byte length and SHA256 plus stored path/bytes/SHA256; independent verify must decompress every gzip and compare original length/hash. Report links must use the final mapping. This policy has not yet been executed; provisional-inventory01 is historical and does not reflect these additions.

Final verification has independently run a complete 197/197 pass, while the earlier complete 196/197 failure and unknown historical root cause remain. See validation/README-final01.md. The final archive is still blocked on native completion, source/evidence freeze, measured plan review and Root COPY GO. Do not run inventory/hash/compression while another agent owns the native CPU slot.

## Final archive execution authorization

Root authorized final inventory/whitelist review, deterministic gzip, copy and independent verification after native completion. Candidate04 README.md, bundle-continuity.json and freeze-final.json are now explicitly approved alongside the earlier proof/log/asset metadata. The reusable M02 tools are common.py/archive.py/index.py/verify.py plus inventory.py. Invoke Python with -B / PYTHONDONTWRITEBYTECODE=1 to avoid unlisted bytecode files. The final plan records exact selected source hashes and measured compressed sizes; --approved-copy refuses destination overwrite, unknown paths, source drift, insufficient space and a total archive (including metadata) exceeding16MiB. Source evidence, including all historical failures, is never removed. Execution outcomes are recorded externally; authoritative final archive contents are its manifest/index/checksums. Earlier provisional status text above is retained as the preparation history, not a claim that no final archive can later exist.
