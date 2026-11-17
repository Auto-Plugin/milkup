# Branch-only QuickJS reconstruction experiment

Review target: `dot/quickjs-repro-trial-20261117`. Seven additive files only:
this directory's six files and `.github/workflows/quickjs-repro-research.yml`.
No existing workflow, product code, PDF settings, packaging gate or release is
changed. This is a prepared patch, not authorization to push or run it.

The exact branch push trigger, repository guard, pinned checkout/upload/download
Actions and second-job receipt verification follow the successful isolated
provenance smoke pattern. No workflow_dispatch, pull_request or tag trigger;
read-only contents permission, no saved checkout credentials or user secrets.
The two jobs are capped at 30 and 5 minutes. Compiler containers are capped at
one CPU, 2 GiB and 10 minutes each. Toolchain pulls occur only on the hosted
runner, anonymously from the official vendor repository by fixed amd64 digest.
No toolchain install or download is needed on Dot.

## What the experiment actually checks

The driver fetches commit-pinned official Mozilla generator and Bellard QuickJS
archives with fixed SHA256/length checks. It applies the exact upstream patch
with zero fuzz and stages **only** the 18 declared, post-patch hashed source and
header files plus the hash-pinned unchanged upstream compile.sh. This source
closure excludes the compiler/sysroot, which is separately bound to the image.

It fetches and verifies the official OCI manifest/configuration bytes, pulls
that exact manifest, and checks actual local image configuration ID, manifest,
Linux/amd64 platform. It records actual emcc/clang/wasm-opt/node identities and
selected compiler binary/runtime source hashes inside each container. Both
builds have no network, a read-only root/source, dropped capabilities,
no-new-privileges and an unprivileged user. Only output/cache and bounded tmpfs
are writable. SIGTERM/SIGINT unwind named-container cleanup; a final always-run
step removes only containers bearing this run/attempt's exact ownership label
and verifies absence. There is no global prune. Existing image caches are copied, not populated from the network.

The unchanged compile script preserves all exports and compiler options. The
first run adds link-map/trace flags; the second does not. Raw JS/WASM byte equality
across the runs is mandatory, so trace-flag neutrality is tested, not assumed.
Both retain pre-Closure Emscripten debug intermediates inside the job. Each
output runs the offline, bounded ABI oracle. Official release JS/WASM are also
hash checked and run through that same oracle before compiler trials.

A matching reference result proves an independently pinned reproduction of
those bytes, **not** the original historical compiler's identity. A repeatable
but differing result is labelled `reproducible-different`, not substituted into
WebKit. Nonrepeatability, compiler failure or ABI failure fails the research job.

## Public artifact boundary

Only one closed-schema `status.json` (<=4096 bytes) is uploaded. It contains
fixed outcomes, times, digests, ABI disposition and conservative false flags.
No source, compiler output, generated JS/WASM, raw logs, trace, link map,
manifest, path, error text or derived audit report is uploaded. Invalid/missing
private state becomes an incomplete receipt. Tests reject unknown nested fields,
links, extra public files, unsupported completion claims and false identity
comparisons. The clean verification job checks the artifact's SHA and schema.
Raw evidence is job-local and expires with the runner; hashes alone do NOT make
it durable or sufficient for subsequent release provenance.

## Still unresolved / later binding to the product

The historical generator used `emscripten/emsdk:latest`. Neither PDF.js's release
workflow nor its npm provenance identified the historical compiler image. The
6.0.0 image here is prospective. Full emitted runtime/source copyright notice
mapping, Emscripten/sysroot notice closure and native PDF behavior remain open.
The standalone oracle is not a PDF viewer, form/scripting integration, printing,
download/export or native runtime test.

Before replacing the publication blocker, a separately reviewed candidate-bound
process must retain and verify all raw source/compiler/transformation receipts,
map emitted code through pre-Closure intermediates/link inputs to exact applicable
notices, include corresponding source/build materials, extract actual PDF.js
resources from the exact built WebKit GResource and compare them to admitted
outputs, and pass existing packaging gates and native PDF parity tests. Current
WebKit's removal of companion WASM is not permission to disable scripting, add
or remove resources, or claim feature parity. No such changes occur here.
Never turn a producer's boolean, this compact research receipt, or a new image
pin into `licenseClosureComplete`, `packageBound` or `publicationReady`.

## Local verification (not hosted execution)

`python3 -m unittest discover -s research/quickjs-repro-tools -p 'test*.py'`
exercises schemas, artifact isolation, image checks, archive controls, container
arguments, Python -O fail-closed behavior, JS and shell syntax. Optional
`QUICKJS_LOCAL_FIXTURE` points to previously hash-verified official archives and
reference files for offline real-source preparation and oracle tests.
`actionlint` should be run if available; absence is reported, not treated as a
successful lint. Actual Docker/cache/compiler behavior is only proved by the
hosted trial, which this patch has not launched.
