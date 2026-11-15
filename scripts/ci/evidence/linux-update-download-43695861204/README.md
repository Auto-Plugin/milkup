# Corrected bounded Linux update run: native harness failure, not a verification pass

[Run 43695861204](https://github.com/Auto-Plugin/milkup/actions/runs/43695861204), tested QA SHA `e5b6bb8a25f3a866e91dbc2a425c46c6f136af19`, ended **failure** on 2026-11-15 at 08:52 UTC, job duration 8m46s. This was the single separately authorized corrected attempt after 43694772284. No further dispatch or automatic continuation was made. The earlier failure evidence is unchanged in the sibling directory.

## Actual execution

- Ordinary runner UID **1001**, default WebKit sandbox preflight passed. All declared commands, Node imports/syntax, shell syntax and real driver HTTP status passed before application compilation. The independent GTK plumbing window received native text, rejected the wrong-PID close request and closed normally for its exact owner. This proves plumbing only.
- Exact retained target deb was read and verified, not rebuilt or installed: source `58c78973101acb0a22ca0cb5d24ef24bd9edc199`, `milkup` `2.0.0-beta.10` amd64, **9,854,742 bytes**, SHA-256 `9e71e2b6f6c5cd030f7307d35679ded1d4f5605127d77320db1d455d90c1ddde`.
- Isolated current-source beta.9 version fixture built successfully with `ci-update-fixture`; the Rust loopback URL test actually ran **1 passed, 0 failed, 0 ignored** and the corrected Node log gate passed. Fixture executable SHA-256 **`02d7fb99e85e9dd09c8f8ce944e2c632c3eedd86428ed7681470324ed1e85014`**. This is not historical beta.9 and is not a distributable candidate. Only its hash/features were retained, not the executable bytes.
- Application CLI open passed in **2,240 ms**. Native pointer input opened the menu and About; the visible version was beta.9.
- First signature case failed after **30,519 ms**: `Timeout: matching current endpoint request bad-manifest`. About DOM explicitly contained **`CI fixture absent`**. The loopback endpoint recorded **zero requests and zero transferred bytes**.
- Finally, exact PID **13229**, birth tick **50440**, window **2097168** received supported `WM_DELETE_WINDOW`; the original document was clean, process disappearance was verified, normal close passed in **177 ms**, with no forced failure cleanup.

## Confirmed cause and unexecuted scope

The assistant-authored wrapper started tauri-driver before Node set `MILKUP_CI_UPDATE_FIXTURE`. The driver/native-driver process tree launches the application, while session capabilities carry only application and document arguments. Setting the variable in the later Node process does not change that existing tree. The native `CI fixture absent` error and empty endpoint ledger confirm the suspected harness wiring defect. The new dependency/syntax/input preflight did not cover this application launch environment and therefore was insufficient.

About navigation and a visible update error occurred, but **wrong-signature rejection was not reached**. Signed manifest acceptance, HTTP download rejection, corrupt deb rejection, successful download/signature verification, clearing a verified package and post-download editing were all **not executed**. Zero traffic must not be called a security negative test. There is no Linux application-update acceptance pass from this run.

## No-authorization boundary

The UI input record contains only menu/About pointer actions; `installRequested=false`, `credentialsEntered=false`. More strongly, this exact QA feature compiles error-only host and vendor install entry points, and excludes the whole Linux installer implementation containing pkexec, graphical password and sudo/dpkg paths. The build feature graph is in the original ZIP. No application install or authorization command was requested. These are compile/source and action-path proofs, not an assertion that every host exec was traced. Official build-dependency provisioning in CI is distinct from the application's privilege path. No credentials, target installation, package-policy or system security changes occurred in this acceptance test.

Production channel JSON, Tauri configuration/capabilities and pnpm lock match integration `8d93519b`, tested SHA and follow-up commit; hashes are recorded. Main, product integration, production authority, notifications and release state are unchanged.

## Prepared follow-up, not run

Commit **`acd87554`** exports the predetermined public fixture path before starting the driver, rejects a missing/wrong inherited path in Node, and records only whether the exact owned application inherited that key. The public file still becomes 0600 before application launch. An actual-wrapper local test uses inert process stand-ins: the original missing export fails and the early-export version passes. **5 Node contracts and 2 Python missing-dependency tests pass**, plus Node/shell syntax and diff checks. No product logic, signature gate or privilege protection was loosened.

This correction has **no native result**. The permitted one corrected run is exhausted; it was not automatically retried. No already-built fixture executable is available for byte-identical reuse. Any later native decision must explicitly account for that, rather than claim this local correction or the retained hash is a tested binary.

## Evidence retained

`original-artifact.zip` is the original **27,506-byte** artifact **14154816243**, SHA-256 **`f645f4dc66875c2d182830ebf8f38fbebfa02df902bb23281d058a5c26823262`**. Retrieval length/hash, ZIP CRC, safe paths and bounded expanded size passed. The original GitHub artifact expires **2026-11-22 08:52:37 UTC**; the byte-identical Git copy does not depend on that expiry. It contains only synthetic-document evidence, public ephemeral fixture authority/certificate and logs; no private key, real user document or executable.

`job.log.gz` losslessly retains the original decoded **217,131-byte** job log, raw SHA-256 **`40c1c59b610fcb182102f68dc299208c484a0afdb1e25ab9db0b5cf15a50972e`**. `receipt.json` records all original file lengths and hashes. Important JSON reports are also extracted unchanged for review. Local originals: `/workspace/milkup-linux-update-corrected-evidence-20261115/`.
