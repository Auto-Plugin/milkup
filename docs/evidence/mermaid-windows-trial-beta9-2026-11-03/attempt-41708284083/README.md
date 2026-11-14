# beta.9 installed-product attempt 41708284083 — failed, no delivery

Candidate `0811b899ea4c4f98294046f66524d4503307d279`, workflow
`mermaid-windows-trial-delivery.yml`, attempt 1, job `126169360083`.
The final raw API reports **failure**. Release NSIS construction and the strict
source gate passed. The pure-standard installed-product test failed; finalization
and delivery upload were skipped. **There is no new test package to deliver.**

Run: <https://github.com/Auto-Plugin/milkup/actions/runs/41708284083>

## Actual result

The pure standard account passed initial disabled-source display and then timed
out at step 2 waiting for a decoded editor PNG. Request
`7b60396d899c44c39ed512d12f3a68c8` captured 2,606 PNG bytes but published zero.
stdout remained at `trailing-byte` and stderr at `stderr-read` after the owned
job reported zero active processes. The bounded joins cancelled both reads;
Win32 **995** was recorded for both, with joins taking 59/60 ms. Native cleanup
remained uncertain. This repeats the historical IPC 995 symptom; its underlying
pipe-lifetime cause is not established by these reports.

The same request's first private-tree removal returned **Win32 5**, then the
second attempt completed after **143 ms**, with a separate absence check true.
The AppContainer profile was deleted. The bounded deletion retry therefore
worked; it does not override the separate IPC failure.

Pure-standard UI close exhausted the 15-second wait and required exact owned
process termination: `exitCode=null`, `signal=SIGTERM`, `closedByUi=false`.
The external profile, account, staging and group-membership cleanup succeeded.
Those outer outcomes do not establish product inner cleanup or natural exit.

The non-elevated filtered administrator passed independent frozen-harness
replay: **10 steps, 7 native-hash-bound diagram PNGs, 4 natural closes** with held
exit 0 and null signal. Its 12 native jobs comprised 9 successful, 1 cancelled,
and 2 bounded invalid-grammar results. All recorded native cleanup observations
passed. The cancellation occurred before Job creation, so only 11 Jobs existed.

Two distinct fresh medium, non-elevated accounts actually ran the same installer
and installed EXE. Both FileVersion/ProductVersion were `2.0.0-beta.9`, and all
10 embedded plugin IDs/versions were observed initially disabled.

| Windows observation | Bytes | SHA256 |
| --- | ---: | --- |
| Installer | 5894168 | b2b284793a84475644939a45797419138deb3367db04146628d7af97a7f6cf26 |
| Installed EXE | 24025600 | 754129317aebd11d9c773525a4ed1b3047c98c320cb8e5d4b991415596c3d4d6 |

These are bound actual Windows report identities. Installer/compiled EXE bytes
were not uploaded. They are not local independent installer hash measurements,
static NSIS extraction, or a local replay of the compiled-to-NSS transformation.
`installation.status=passed` for the pure-standard account coexists with
`productAcceptance=failed` and must not be read as product acceptance.

## Preserved evidence

Both original artifacts were downloaded exactly once. Actual API source/run,
size, SHA256 and expiry were checked before bounded ZIP parsing and extraction.
All 73 installed-evidence and 15 inspection files retain their original bytes.

| Artifact ID | Bytes | SHA256 | API expiry UTC |
| --- | ---: | --- | --- |
| 13266058451, installed | 378751 | 61836b13defd778edf2e73e1603a03b5048cea5b186c6acfa12fcb6af320794a | 2026-11-10T20:15:33Z |
| 13266078497, inspection | 22672 | cad1f9c26a3c4ae869c694ebe6249da968c85914936d7d8af6a328d0402c13d5 | 2026-11-10T20:15:34Z |

The ZIPs, full connector-decoded job log, initial/final API responses, timestamped
observations, frozen candidate sources and harness, original extracted files,
diagnostics and external verifier modules are included here. The normalized
connector snapshots are labelled separately from the full raw API responses.
`preserved-source-bytes.json` records the source-to-archive byte comparisons.
`SHA256SUMS.txt` covers the archived files except itself.

## Reproduce the failure analysis

From the repository root, with its candidate Git object available:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 \
  docs/evidence/mermaid-windows-trial-beta9-2026-11-03/attempt-41708284083/replay-failed-installed-run.py \
  --repo "$PWD" --output /tmp/milkup-41708284083-replay.json
```

The output path must be new. This entry point freshly revalidates both API-bound
ZIPs, all extracted file bytes/sets, manifests, final run identity and the frozen
cleanup source/harness. It then replays the original native, PNG, close and outer
cleanup checks, and separately binds the actual installation reports. Expected
product results are pure-standard false, filtered-admin true, delivery false.
Exit code 0 means analysis completed; it does **not** mean product acceptance.

`archived-replay-result.json` is the recorded portable-entry result. Original
`analyze-failed-installed-run.py` and `failed-installed-run-analysis.json` remain
unchanged: that earlier entry used absolute paths and trusted the earlier
integrity JSON instead of rechecking the ZIP chain. Its `installationFacts` was
a subset of report bindings; the portable entry adds held-installer and comparison
report checks. Original `cleanupObservations.passed` only indicated no exception;
the nested `observationEvidenceVerified` must also be read. The portable entry
explicitly requires that nested field. Observation validity includes valid
failure observations and never overrides native-ledger rejection.

Runtime used: Python 3.12.14, Pillow 12.3.0, Node 24.19.0, and Git. Node executes
only trusted frozen harness validation exports; no Windows EXE, installer or
plugin payload is run. The 60 verifier tests are synthetic component tests and
do not replace actual Windows acceptance. The standalone cleanup module's
`--self-test` references an absent test module and is not a supported entry point.

The archive verifier also enforces that original API `expires_at` is still in
the future. After the dates above it will reject current download eligibility
even if preserved ZIP bytes are unchanged. Do not alter the original API records
or silently bypass this gate. `sha256sum -c SHA256SUMS.txt` from this directory
remains available to verify preserved local bytes after download expiry.

The general `verifier/verify_installed_dual.py` requires all three artifacts,
including delivery, plus an explicitly supplied official Linux 7zz for static
NSIS inspection. This failed run cannot satisfy that acceptance entry point.
No main merge, release publication, runtime installation or beta.8 replacement
was performed by this evidence-archiving work.
