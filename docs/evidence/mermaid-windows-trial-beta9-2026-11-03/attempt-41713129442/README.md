# beta.9 installed-product attempt 41713129442 — accepted

Candidate `a5556beea5cdd1570361c528b2326bc0ad8ba0c4`, workflow
`mermaid-windows-trial-delivery.yml`, attempt 1, job `126186137116`.
[The actual run](https://github.com/Auto-Plugin/milkup/actions/runs/41713129442)
completed successfully. The independent three-artifact verifier returned
`overallAccepted=true`, `errors=[]`; the separate actual 34-PNG visual review
also passed within the captured light-theme/DPR 1 fixtures.

Both fresh accounts installed the same package, observed version 2.0.0-beta.9
and 10 initially disabled embedded plugins, completed 10 product steps and 7
native-hash-bound diagram PNGs each, and naturally closed 4 times each. All eight
held exits were 0 with null signal and no forced fallback. Inner native cleanup
and outer account/profile/staging/group cleanup were independently checked.

| Account | Finished native requests | Successful | Cancelled | Bounded invalid grammar | Actual created Jobs |
| --- | ---: | ---: | ---: | ---: | ---: |
| Pure standard | 18 | 15 | 1 | 2 | 17 |
| Non-elevated filtered administrator | 12 | 9 | 2 | 1 | 10 |
| Total | 30 | 24 | 3 | 3 | 27 |

All 30 requests had certain cleanup and **no observed product IPC 995 or tree
error 5 retry**. Three cancellations occurred before Job creation; their created
profiles were still deleted. All 27 helper process observations were present;
both zero-time snapshots were `timeout/258`. Subsequent owned-Job zero accounting
and actual IPC EOF passed separately. A helper snapshot is not an EOF/cleanup
substitute. See `helper-process-exit-statistics.json` for the original per-request
snapshots and outcomes, and `three-artifact-verification.json` for acceptance.

The native regression log provides both actual controls: unconfined stdout and
stderr error 995, versus confined EOF on both, while the separate holder remains
alive. Both owned Jobs emptied and held processes signaled afterward. The suite
reported 73 passed, 4 ignored. `historicalHolderIdentified=false` is preserved.
The specific holder in the historical 995 failures remains unknown; neither a
passing mechanism test nor this successful run retroactively identifies it.

## Exact delivery and access

The [GitHub test artifact](https://github.com/Auto-Plugin/milkup/actions/runs/41713129442/artifacts/13270072153)
requires GitHub login and has the actual API expiry **2026-11-10 20:47:03 UTC**.
It is a trial artifact, not a formal release.

| Payload | Bytes | SHA256 |
| --- | ---: | --- |
| Delivery ZIP, `Milkup-2.0.0-beta.9-Mermaid-Windows-x64.zip` | 6176973 | 4346d92ccc7f9b47ef14a1b5b70a97db38128baea5176b9250084a2cd28486d2 |
| `milkup-2.0.0-beta.9-windows-x64-a5556beea5cd-setup.exe` | 5898153 | f7fe28275477e8957653649924348bc06e24b4b49d63f6e1d6a6f08ed65c6fbf |
| Exact NSIS/installed `milkup-desktop.exe` | 24040960 | 5d4df1a7f6e7962be12d624437f620fe5775885e79b7a97b4b519a676ec95d84 |

The delivery ZIP, installer and EXE are deliberately **not committed here**.
No signed download URL, Library private identifier, or Library metadata/xattr is
included. Root downloaded delivery once; this verifier used that same local ZIP.
The two evidence artifacts were also each downloaded exactly once:

| Evidence artifact | Bytes | SHA256 | Actual API expiry UTC |
| --- | ---: | --- | --- |
| installed, 13269367430 | 552783 | 9eaf40f7c7284f39e1f966b8e184736e6e75f418c207efd2616083710a907bc1 | 2026-11-10T20:47:00Z |
| inspection, 13269052647 | 30551 | 49f402da70dd38bf60868940fbcd0a3367ca60fcc00f9984f63f07798c3c6695 | 2026-11-10T20:47:02Z |

Both original evidence ZIPs and all **111 extracted original files** (94 + 17)
are preserved, with raw API/jobs/job log, frozen candidate/harness provenance,
live verifier and its earlier preflight snapshot, strict results, diagnostic
statistics, visual report, implementation delta and old-package preservation.
Root's additional independent replay of original reports confirms all 30 created
profiles deleted, all 27 created Jobs empty, no cancelled product IPC reads, and
all eight natural UI exits. `root-review-originals.py` preserves its original
absolute execution path and is an audit record; the portable entry is the wrapper
below. No claim is made that this original root script ran from the archive path.
`root-verification/` holds the independent delivery, payload and static dependency
checks. All eight original reports inside delivery were byte-bound to these
evidence files. `preserved-source-bytes.json` records exact original copies;
`SHA256SUMS.txt` covers every archived file except itself. Local Git attributes
prevent line-ending conversion.
Portability is established for the new wrapper below. Preserved original scripts,
examples and reports retain their original absolute paths; do not assume those
old paths refer to the archive or were executed from it.

## Reproduce acceptance without executing Windows software

The repository must contain the candidate Git object. Supply the exact external
delivery ZIP above and the separately verified official 7-Zip 26.05 Linux x64
`7zz` executable (SHA256
`d32657a7a0e4cdc0a8aa57cafe474746944d76e861e753e9c902b9c9356fa886`).
Use a new output path:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 \
  docs/evidence/mermaid-windows-trial-beta9-2026-11-03/attempt-41713129442/replay-installed-verification.py \
  --repo "$PWD" --delivery-zip /path/to/Milkup-2.0.0-beta.9-Mermaid-Windows-x64.zip \
  --sevenzip /path/to/7zz --output /tmp/milkup-41713129442-verification.json
```

The CLI rechecks actual API source/run/size/hash/expiry, closed ZIP members and
manifests, all package/report bindings, complete engine/bootstrap bytes in the
exact NSIS EXE, frozen-harness native/PNG/close and account cleanup gates, and the
actual inheritance control pair. Python 3.12.14, Pillow 12.3.0, Node 24.19.0 and
Git were used. Node runs only trusted frozen validation exports; Linux 7zz reads
the exact NSIS member. No installer, Windows EXE or plugin payload is executed.

The native/helper statistics entry is diagnostic only and requires already
verified artifacts. Its exit 0 is not acceptance. The main three-artifact CLI
requires `overallAccepted=true` and no errors. The 70 verifier and 7 helper
statistics tests are synthetic component checks, not Windows acceptance.

API files are preserved offline snapshots, not live freshness queries. The
verifier also requires the recorded `expires_at` to remain in the future. After
expiry it rejects current download eligibility even when ZIP bytes are intact;
do not modify API records or silently bypass the gate. From this directory,
`sha256sum -c SHA256SUMS.txt` still verifies preserved local bytes after expiry.

## Scope and remaining limits

The complete official Mermaid 12.2.0 engine (5,494,801 bytes) and exact bootstrap
were independently found in the actual installed image. Root separately parsed
the same image with objdump: all 25 imported DLLs match the Windows dumpbin report,
with no extra VC runtime imports. Its first verbose scratch probe hit a 2 MiB
output cap; the successful repeat retained only import lines. No product gate
changed. Compiled EXE and built dist are not uploaded, so their original Windows
compiled-to-NSS/AST reports are bound but not locally recomputed.

The unsigned current-user trial requires an existing Evergreen WebView2 runtime.
Elevated execution and untested UAC configurations remain outside acceptance;
no plugin trust boundary was expanded. Same-user upgrade/rollback, side-by-side
installation, full IME/DPI/dark-theme matrices and export are not established by
these fixtures. No main merge, updater/formal release or runtime installation
was performed. The old beta.8 package and historical failed runs remain
separate and unchanged.
