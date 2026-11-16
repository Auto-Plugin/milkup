# Same-runtime combined native gate: passed, research only

[Run 43836771926](https://github.com/Auto-Plugin/milkup/actions/runs/43836771926)
completed successfully on 2026-11-16 at 09:32:32 UTC. Tested checkout:
`cd3964b4d4cfd59853d49b96d109c19aeb6af6e9`. This evidence commit does not
change the tested engine or product. No second run was dispatched.

The unchanged combined patch is
`21eef8e16614a44cfe0be023812617b17865cbd29fce66b172905bef7b052008`.
All fifteen current cases ran in this job; the `reference/` directory in the
raw ZIP contains historical controls and is explicitly excluded from the
fifteen-case result. Old passes are not substituted.

## Build and original product identity

- Entire local workflow-order non-engine preflight: 101 tests passed. Real
  HarfBuzz/metadata and corrected ten-glyph fixture probes also passed.
  `local-preflight-summary.json` records local missing ccache/clang explicitly;
  real cache and compiler gates were executed on the CI runner.
- Proven six-field object archive 14199955883 from 43808221193 was restored.
  Cross-process first invocations passed. Thirteen modified source files mapped
  to eleven actual unique translation units, all compiled successfully.
- Full combined engine: **566.746 seconds, 3234 new hits / 29 new misses**,
  3263 completed objects, exit 0, no stop reason. Limits remained 2400 seconds /
  160 misses; no cold fallback. System library hashes stayed identical.
- Native batch: **25.589 seconds**, within the unchanged 550-second wrapper.
- Exact installed deb SHA-256:
  `9e71e2b6f6c5cd030f7307d35679ded1d4f5605127d77320db1d455d90c1ddde`.
  Binary: `42394c4bdcaeea078c7d553acbe6edc7a75f13b16ce5b70cba2d0a3a02176ed6`.
  Original guard: `296131695cb15814252edd02e76e111fef293b7585c4e7597101d8ec05b852fa`.
- WebKit: `b502921bf1586b1eb628e85999d43900d30c79ac3898230c5702e362c4eae9c4`;
  JavaScriptCore: `0780da5c018100ca0a8e342c9ee3f8eb993db28a2855938efc90e602b72c7a2a`;
  WebProcess: `2820356018e65dabb904679271952d6d861335bd6967737cc3c18f860696d737`.
  These bytes equal the earlier 43829429928 build; the new fifteen-case
  execution, not that earlier first PDF, supplies this result.

## Actual cases

| Current native case | Pages | Result |
| --- | ---: | --- |
| A4 portrait tight long table | 8 | Passed |
| A4 portrait edge short table | 5 | Passed |
| A4 portrait roomy long table | 7 | Passed |
| A4 portrait roomy short table | 4 | Passed |
| A4 landscape | 12 | Passed |
| Letter portrait | 8 | Passed |
| Letter landscape | 11 | Passed |
| Deliberate forced blank page | 6 | Passed; blank page 5 retained, following marker page 6 |
| Real visual overflow | 7 | Passed; page 6 retains 413695 nonwhite pixels |
| Noto digit baseline | 2 | Expected digit failure reproduced, negative control passed |
| Noto digit candidate | 2 | Exact digits/collision/source contract passed |
| Paint/layout links | 4 | Passed; 37 URI annotations |
| Paint/layout no-links | 4 | Passed; zero annotations |
| Multipage source with links | 3 | Source/URI page-set checks passed; 10 annotations |
| Multipage source without links | 3 | Source/control equality passed; zero annotations |

All seven original paper cases pass title/header/first-row placement, required
repeated headers, paragraph/table/code order and content/edge contracts. All
seven plus both root controls retain exact diagnostic Chinese, intentional
radicals and digits, with the diagnostic URI. The original blank-page contract
was not waived: only the explicit synthetic forced-blank and painted-overflow
controls use their independently specified expectations.

The same-run Noto baseline shows all ten substituted glyphs 63153–63162 mapped
to U+0000; the candidate maps them to U+0030–0039. `noto-mapping-audit.json`
independently reads raw Type3 encoding and ToUnicode. Same-glyph/different-code
`1212` uses per-occurrence ActualText for `2`. Baseline/candidate raster hashes
match for both pages. Ligature, combining, Arabic RTL and Indic negative-page
extraction is unchanged, **not necessarily correct**; this is not full complex
script fidelity. HarfBuzz/source-cluster guards also passed in this job.

Geometry passes use independently captured final print fragments and actual
paint clipping, including neighboring links, multiline regions, same URI on
different pages, rectangular clipping and per-call duplicate discrimination.
The separate `links`/`no-links` source audit intentionally retains its
`diagnostic-not-accepted` geometry label; its source equality and URI/page-set
checks are distinct from the strict geometry fixtures. No threshold changed.

## Identity and cleanup recheck

`verify_retained.py` rechecks only current raw bytes and existing contracts:
all **2391** records match their kernel sender hashes and the same live captured
WebProcess per case; every actual page has ordered combined begin/end records.
All fifteen processes have exact private family paths/mapped-file identities,
UID 1001, two bubblewrap ancestors, NoNewPrivs 1, Seccomp 2 and CapEff 0. Native
validation additionally hashed the actual mapped family and WebProcess files
and checked ownership/permissions before accepting each result. The retained
recheck does not claim to remap those remote files locally.

Each case has its own verified 1024x768 product output window, guardian exit 0
and private directory removal. There were **94 transient xdotool window-search
misses** (38 in the first case); all are retained, all are window-search exit 1,
and each case subsequently captured the exact owned window. There are no
collector-fatal/live-capture errors or unresolved record identities in this run.
The run-owned installed package was removed successfully.

## Raw retention

ZIP bytes were downloaded through the authorized connector and verified against
GitHub SHA-256, exact length and every ZIP CRC. See `raw-sha256.json` and
`artifacts.json`. Selective reads avoid unnecessary expanded build objects.

- Native [artifact 14212877165](https://github.com/Auto-Plugin/milkup/actions/runs/43836771926/artifacts/14212877165):
  19011843 bytes; expires 2026-11-23 09:32:23 UTC. Original ZIP retained here.
- Build [artifact 14212966904](https://github.com/Auto-Plugin/milkup/actions/runs/43836771926/artifacts/14212966904):
  7025050 bytes; expires 2026-11-23 09:32:25 UTC. Original ZIP retained here.
- Objects [artifact 14212039559](https://github.com/Auto-Plugin/milkup/actions/runs/43836771926/artifacts/14212039559):
  558080447 bytes; expires 2026-11-23 09:31:17 UTC. Metadata retained, not
  downloaded locally. This new seven-field archive is **not** proven in a
  later job; never feed it to the old six-field restore path.
- Completed job log retained from the authorized connector. A direct CLI log
  download was forbidden by the storage endpoint; it was not used as evidence.

The initial offline enumerator also counted the nine `reference/` reports and
correctly stopped at the fifteen-count assertion. It was corrected to require
exact equality with the current report's case set, then passed; no reference
case is counted and no native result or acceptance threshold changed.

## Not product-ready

`productAcceptancePassed` remains **false**. This is a private research runtime,
not a normal maintained distro package or an application-isolated delivery.
The URI dedup still uses research fixture/flag gating. Removing observers and
extracting normal-path fixes requires review and fresh product evidence.
The maintained security-update/rebase/install/recovery path is not implemented
or accepted. The current application launches its own executable as the output
helper; choosing a runtime for that executable also requires normal editor,
plugins, IME and shutdown validation, not only PDF-helper checks.

Manual viewer clipboard/clicks, internal destinations, arbitrary transformed or
nonrectangular clips, subframes, full complex text, physical printing and other
five-item release gates remain unaccepted where previously untested. #255's
ordinary-keyboard caret scenario is still pending a planned installed-editor
run; it did not run in this PDF helper batch. No main merge, publication,
upstream message, production channel/key, notification or safety change occurred.
