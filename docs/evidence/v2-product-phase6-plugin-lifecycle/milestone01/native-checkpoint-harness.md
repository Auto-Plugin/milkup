# P6 first-checkpoint native harness — prepared, not executed

Previous frozen script after approval correction: `tests/native/tauri-p6-lifecycle.mjs`, SHA256 `837460733bb7ef78b13e31342b33bc7c1a862d5a6671105ac81aad4a9e17fc14`. Historical preflight02 retains its original `947be14f…` snapshot.

The existing P5 script is unchanged (`af1eaa490ea09f498bc8aabd216494007d614c7f4ad6fc99f43395d124a9d215`). This new harness reuses its native input, save chooser, GTK Print to File, read-only observations, SVG checks, PDF file/raster validation, clipboard ownership and owned-output-process evidence. It does not build, install or start an app in `--preflight` mode. Root alone runs the UI serially after freezing the P6 production binary.

## Cases

| `MILKUP_P6_CASE`   | Actual runtime actions and evidence                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `outline`          | Replace bundled outline via ordinary remove/install UI; record actual permission review (read-only Worker may already be approved); enable; verify indexed outline; disable with contribution gone and package bytes retained; reenable; remove with registry/contribution/package directory gone. Edit → undo → save exact original SHA after disable and removal. No independent Worker process cleanup claim.  |
| `reject`           | Same official outline installed and enabled. Select four independently recorded candidate files: malformed JSON, file/directory conflict, invalid base64, incompatible SDK. Wait for each actual visible install-failure path, record actual error text; compare complete original registry record, installed recursive file hashes and source SHA unchanged. This is rejection before replacement, not rollback. |
| `cold-output`      | Install pinned independent footnotes/outline/output/diagrams through UI; open exact frozen original print04 source; first export with no renderer warmup. Set format via `MILKUP_P6_FORMAT`.                                                                                                                                                                                                                      |
| `cold-edit`        | Same cold first export, then replace text through real X11 clipboard with derived r2, save exact SHA and require increased observed document version; export r2 and forbid old revision markers.                                                                                                                                                                                                                  |
| `manager-matrix`   | Product preferences select light/dark; actual app zoom keys 100/125/150/200%; X11 sizes 1280×900 and 760×520. 16 list cells require only logo/title/description and each card focus/click bounds; 8 narrow detail cells record state/permissions/actions and focus/scroll each action. Real card/back clicks; destructive actions measured only. Screenshots and clip/ancestor/hit geometry retained.             |
| `all-off`          | Disable every currently enabled installed plugin, preserve all identities, verify all enabled flags false and all contribution UI/commands absent. Source and live mode real Unicode clipboard paste, undo/save, redo/save, restore/save; complete file SHA checked at each transition.                                                                                                                           |
| `all-off-windowed` | Same all-off flow on exact existing P5 large-stage recipe: rich-document + 60,000 repeated blocks. Assert actual native source-document DOM and native large-file notice. Ctrl+End must reach full UTF16 length before each mode edit. Complete file SHA, not a truncated preview, validates each save.                                                                                                           |

The large recipe produces 2,101,585 bytes, 1,381,002 UTF16 code units and 180,060 newline-split lines. It contains 60,000 repeated blocks, **not 60,000 total source lines**. SHA256 `35b50a462dab4ae6e51fe174acacdfc3b717c3e04f26bfe42ddbb43258d194f2`.

## Inputs and runner handoff

`native-preflight02/extra-packages.json` records the new public-SDK independent archives:

- outline 1.3.1: SHA256 `7eea6ffb5bba53155b3c256c6e35d95b04a93199ebbbd04636ee9c7ec5f6f712`.
- footnotes 1.0.1: SHA256 `cf495f6bdf22dc6b24143a06fc34fdce8d2b2ecab90b8296b85fb49773b692a2`.

Use the normal owned native runner/environment, a new profile and new evidence directory for each case. Set `MILKUP_P6_EXTRA_PACKAGES_JSON` to that file's JSON contents, `MILKUP_P6_CASE`, and for cold cases `MILKUP_P6_FORMAT=html|pdf-a4|pdf-letter|print-to-file`. Run:

```sh
node tests/native/tauri-p6-lifecycle.mjs
```

Required runtime variables: `TAURI_APP_PATH`, `MILKUP_NATIVE_EXPECTED_BINARY_SHA256`, `MILKUP_NATIVE_EVIDENCE_DIR`, `MILKUP_P6_BINARY_CONFIRMED=1`, `MILKUP_NATIVE_EXCLUSIVE_DISPLAY=1`, `DISPLAY`, `TAURI_DRIVER_URL`, `MILKUP_NATIVE_PROFILE_ROOT`, owned `XDG_DATA_HOME`/`XDG_CONFIG_HOME`/`XDG_CACHE_HOME`, `MILKUP_DOM_DIAGNOSTICS=1`, and existing owned stderr file `MILKUP_P6_NATIVE_LOG`. The evidence directory gets an exclusive lock and cannot silently overwrite a previous run. Freeze wrapper/environment before launch.

P5 default output archive is 1.0.0 SHA `08cd8532ecd209f4794f88de1880e06c16c586ae2997e326450687e1be2181b9`; default diagrams archive is 1.1.1 SHA `2351692438a2083a72bcb8cddce28c7a530a8557734926992a3a2e3120c68a19`. Custom diagram path requires explicit SHA and version. No host private IPC is used for actions.

Run outline/reject, then matrix/all-off cases in separate fresh profiles, followed by cold output per format. `cold-edit` includes its own first export and r2, so it can replace `cold-output` for a selected format without a separate warmup run. No full format × case Cartesian matrix is required.

## Evidence limits and static verification

`native-preflight02/result.json`: all seven setup cases exit 0; uses an explicitly labelled historical P5 frozen binary for path/hash preparation only. It is **not P6 product acceptance**. `node --check`, Prettier check, diff whitespace check and parsing all 34 embedded execute scripts passed. No UI, app installation, production build or physical printer was run by this agent.

HTML checks require actual graph geometry and closed SVG references, footnote forward/backlinks, MathML and exact embedded PNG hash. PDF keeps real PDF files and page rasters; diagram pixel fidelity remains pending separate review. First export does not prove first render, because the editor can prerender. Timing logs remain raw. Errors/failed cells remain failures rather than inferred success.

Upgrade rollback, permission-delta transactions, activation failure/hang acceptance, malicious JS execution, physical printing and complete Worker resource teardown are not implemented by these cases. Invalid archive parsing and incompatible SDK rejection cover only the stated first checkpoint. Output process sampling is not evidence of independent Worker/DOM host lifecycle cleanup.

Disk was 296 MiB free before these preflights; this preparation adds only small script/JSON fixtures and one 2.1 MB source. Run serially, avoid copying binaries/profiles, retain failures, and keep the existing reserved free-space margin. PDF rasters and fresh profiles still require Root's existing budget discipline.

## Approval observation correction after p6-outline-02

The preserved `p6-outline-02` run failed because the harness assumed every independent install requires an approval button. Its actual outline detail showed the Worker/read-only document capability already approved. This is a harness expectation failure, not evidence of failed product installation. The corrected script records `installed-permission-review-<id>` and `explicitApprovalRequired`. When the approval button exists it is used normally. If absent, only an explicitly declared Worker whose permissions are empty or entirely `document:read` is accepted, and the current registry must already approve the Worker host with an available Enable button. DOM and output permissions cannot use this exception. Outline installation does not claim an explicit approval click when the product requires none. The original failure and preflight02 snapshot remain unchanged.

Correction checks: `native-approval-guard03/checks.json` records seven pure permission-guard branches and 35 embedded script parses, all passing; Node syntax check also passes. No native UI was started.

## Executed outline-03 review scope

External review: `native-ui/review/outline03.json`. The successful outline run verifies indexing, disable/reenable/removal, and edit → undo → save in **source mode**. The original `outline-live.png` filename and observation label are retained but do not mean live editor mode: `app.probe().mode` is `source` for that fixture throughout. Earlier installation observations are live mode only on the launcher document and cannot support a live-mode outline lifecycle claim. The original completion `visualReview` remains untouched; this external review records pixel findings and limits.

## HTML text-marker counting correction

Current frozen harness SHA256: `72648e9fdd3873cc488e3d90aac14a7e17ffe8495e61ec372ce66b4b2c86028b`. The preserved `p6-cold-html-01` failure counted `P5-FOOTNOTE-MARKER` twice in raw markup: once in an aria-label and once as actual text. The corrected HTML check counts decoded body text after removing tags/attributes, style/script content and comments. Raw old-version rejection, actual SVG geometry/references, footnote anchors, MathML and PNG checks remain unchanged. `native-html-marker04/checks.json` records a passing full offline artifact check against that original file, raw count 2 versus text count 1, and a regression proving two real text occurrences still count as 2. This offline pass does not rewrite the original native failure or substitute for a clean native rerun.
