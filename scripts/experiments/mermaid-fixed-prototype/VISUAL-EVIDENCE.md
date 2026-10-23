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

Only the 50 positive PNGs are exported, after their supervisor reports success
and an empty Job. `visual-evidence.ps1` checks the exact fixture/result/file sets,
per-case successful native results and cleanup, PNG signature, dimensions and
original SHA-256. It reads only paths constructed from the fixed manifest IDs;
files and ancestors must not be reparse points. Each image remains limited to
256 KiB and their combined raw bytes to **1 MiB**. The entire set is checked
before the first image is emitted.

Base64 data is emitted in at most 4096-character chunks, carrying run ID,
attempt, exact source, execution name, fixture ID, digest, count and zero-based
sequence number. A final manifest records the 50 image identities and total
bytes. The earlier images totalled 551,486 raw bytes (735,360 base64 characters),
so the expected complete log is about 1 MiB. Transfer completion does not imply
successful account/profile/stage cleanup: the original finally block still runs,
and any failure keeps the CI result failed.

The local `read-visual-evidence.py` accepts only a successful same-repository,
same-branch, first-attempt run with zero artifacts and the complete ordered
execution/case/PNG/terminal sequence. It checks every chunk, exact base64 length,
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
