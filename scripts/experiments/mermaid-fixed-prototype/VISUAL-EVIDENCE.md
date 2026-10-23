# Bounded Windows PNG evidence follow-up

The user authorized self-authored diagram images and test results in the same
Auto-Plugin/milkup repository. The successful standard-user run deleted its PNGs
with its private stage; its JSON does not contain recoverable image bytes.
This follow-up captures actual images without an Actions artifact or product
integration. It does not capture a desktop, environment window or user document.

A commit marked both `[mermaid-fixed-prototype]` and
`[mermaid-visual-evidence]` uses the existing isolated Windows workflow. Before
building, `run-reviewed-windows.ps1` requires the renderer, native launcher,
fixed assets, fixture inputs/manifests, C# supervisor, build script and Cargo
files to be unchanged from successful source
`82fb49e95caf99ea45654f552992eff81f72bee9`.

The original canary runs first, followed by exactly the same 50 positive cases.
The already-passed negative suite is not repeated by this evidence-only mode.
The ordinary-user, AppContainer, Job, profile and directory cleanup gates remain
unchanged. Eight cheap existing Rust tests still precede execution. No dependency,
Runtime, account privilege, firewall, UAC or desktop ACL change is added.

Complete evidence requires all 50 positive PNGs. The collector also supports an
explicit **partial-failed** transport for a stopped positive matrix: its records
must be the exact fixed-manifest prefix, all preceding cases must pass every
render/token/cleanup assertion, and the last case must have failed native tree
cleanup after its Job reached zero and its AppContainer profile was deleted.
The failed case's PNG is never exported. This preserves its original failed
exit code and stops subsequent dispatch. Canary failure produces no PNG stream.

`visual-evidence.ps1` checks the exact fixture/result/file sets, successful native
results and cleanup for every exported image, PNG signature, dimensions and
original SHA-256. It reads only paths constructed from fixed manifest IDs; files
and ancestors must not be reparse points. Each image remains limited to 256 KiB
and their combined raw bytes to **1 MiB**. The checked bytes are cached before
stage deletion and emitted **only after** outer Job, account, actual Windows
profile and full stage cleanup are confirmed. The final account audit follows
the image stream. Missing or uncertain cleanup means no image emission.

Base64 data is emitted in at most 4096-character chunks, carrying run ID,
attempt, exact source, execution name, fixture ID, digest, count and zero-based
sequence number. A final manifest records actual image identities, total bytes, status,
complete=false for partial evidence, failed fixtures and unreached fixtures. The earlier images totalled 551,486 raw bytes (735,360 base64 characters),
so the expected complete log is about 1 MiB. The reader independently checks the terminal cleanup facts;
partial transfer never changes the failed CI conclusion.

The local `read-visual-evidence.py` accepts only a successful same-repository,
same-branch, first-attempt run with zero artifacts and the complete ordered
execution/case/PNG/terminal sequence by default. Its separate
`--allow-partial-failed` option accepts only a matching failed run with the exact
original stopped native-cleanup failure, successful exported cases and final
outer cleanup. Its saved manifest remains partial-failed and complete=false. It checks every chunk, exact base64 length,
digest, PNG CRC, complete independent Pillow decoding, dimensions and nonuniform
pixels. It also rechecks all recorded token/Job/cleanup facts, matches each PNG
against its native case result, and requires final account, actual Windows
profile and stage deletion. Only after all checks pass does it create a fresh
output directory containing the unchanged PNG bytes and a manifest. It never
overwrites an existing evidence directory. Pillow is already installed in the
Linux verification environment; no package is added to the runner or product.

Local reader regression command:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 scripts/experiments/mermaid-fixed-prototype/test-read-visual-evidence.py
```

Those synthetic transport tests are not rendering evidence. Actual Windows
images must subsequently be visually inspected and indexed with the precise
run, dimensions and hashes. Any blank areas, missing labels, clipping or
rendering errors remain reported defects even if automatic PNG checks pass.
This does not add ZenUML/tidy-tree or establish all-grammar, all-DPI, interactive
link or OS-wide network-denial claims.

The first capture run, `39928634251` at `565ac02d80173a0f888a87357b7a30bcbcfe9ca9`,
failed before transport: its canary rendered, then native private-tree deletion
returned Windows error 5. The native output was discarded and the positive
matrix was not started. The outer supervisor subsequently deleted the account,
actual Windows profile and full stage. That does not turn native cleanup into
success, nor does it identify the failing child path or root cause.

The follow-up adds only a bounded, read-only parent diagnostic for an explicitly
retained case root immediately inside the current stage's private temp directory.
After outer Job emptiness, it records at most 64 metadata entries, depth 8,
2 KiB SDDL per entry and 64 KiB total. It does not follow reparse points, read
file content, change permissions or retry Windows error 5. Truncation/errors and
the original failure remain explicit. Renderer/native inputs remain locked to
the successful baseline; a fresh successful run would not establish why the
previous run encountered error 5.

The second capture run, `39930363116` at
`1e77a15693ca8076aa36b67f5cb69f569142491e`, passed the canary and 41 positive
cases. `flow-wide` then rendered a 1280 × 30 PNG but native tree deletion again
returned Windows error 5. The diagnostic rejected its retained-root spelling
before traversal, so it collected no child attributes or ACLs. The exact child
operation and root cause remain unknown. The original all-50 collector exported
no PNGs. The outer Job/account/actual-profile/stage cleanup succeeded; there
were zero Actions artifacts. The retained summary records this failure.

The next diagnostic accepts only the exact expected drive-absolute parent or
that same parent's extended-length spelling, plus the fixed case basename.
Windows pure-string preflight rejects siblings, nested children, UNC and device
paths. It does not generically strip prefixes or modify renderer paths/permissions.
The bounded partial transport prevents already successful pictures being lost
again if the same native failure occurs. It does not retry or ignore error 5.

Compatibility and integration remain unresolved: both host gates reject an
Administrators SID even when deny-only, as well as a limited UAC token. These
results concern the fresh Users-only account, not all non-elevated users. Wide
figures are rasterized at 1280 pixels (the sixteen-stage fixture is only 30 pixels
high), so actual label readability must be reviewed separately. Repeated native
cleanup failures are a reliability gap even when outer cleanup eventually works.
These boundaries accompany the known network-isolation and optional-extension
limits; this prototype is not part of the product or a release package.
