# Installed beta.9 verification — accepted

Candidate `a5556beea5cdd1570361c528b2326bc0ad8ba0c4`, run 41713129442,
attempt 1, job 126186137116. The final raw GitHub API reports success. Independent
three-artifact verification reports `overallAccepted=true` with no errors in
`three-artifact-verification.json`. This document does not replace separate human
visual review or the explicitly untested operating-system/IME/DPI/upgrade matrix.

The installed-evidence and inspection ZIPs were each downloaded exactly once.
Their actual API run/source/size/SHA256/expiry and all 94 + 17 retained files were
checked before safe extraction. Root independently downloaded the delivery ZIP
once; the verifier read that local file and checked its API identity, all 29
members, checksum manifest and eight original account reports byte for byte.

| Artifact | Bytes | SHA256 | Actual API expiry UTC |
| --- | ---: | --- | --- |
| installed, 13269367430 | 552783 | 9eaf40f7c7284f39e1f966b8e184736e6e75f418c207efd2616083710a907bc1 | 2026-11-10T20:47:00Z |
| inspection, 13269052647 | 30551 | 49f402da70dd38bf60868940fbcd0a3367ca60fcc00f9984f63f07798c3c6695 | 2026-11-10T20:47:02Z |
| delivery, 13270072153 | 6176973 | 4346d92ccc7f9b47ef14a1b5b70a97db38128baea5176b9250084a2cd28486d2 | 2026-11-10T20:47:03Z |

Both distinct fresh accounts installed and launched the same version
2.0.0-beta.9 application, with matching actual medium non-elevated caller and
held-installer identities. All 10 embedded plugin IDs/versions were observed
initially disabled. Both accounts completed 10 UI steps and 7 native-hash-bound
diagram PNGs, followed by 4 natural UI closes each with held exit 0, null signal,
no forced fallback, complete IPC/native cleanup and separate outer cleanup.

The standard account had 18 native jobs (15 successful, 1 cancelled, 2 bounded
invalid results); the filtered administrator had 12 (9 successful, 2 cancelled,
1 bounded invalid result). All 30 finished with `cleanupUncertain=false`. Actual
helper proof requires `helperProtocolHandlesNonInheritable=true` after verified
Ready in the exact frozen candidate harness. No product request recorded 995 or
a private-tree error 5 retry in this run.

The new actual Windows regression log separately contains the ordered control
pair: unconfined stdout/stderr both error 995; confined stdout/stderr both EOF.
The independent holder remained alive at both pipe results. Both renderer and
holder Jobs emptied and held processes signaled afterward. The native test suite
completed with 73 passed, 4 ignored. `historicalHolderIdentified=false` is retained:
this demonstrates a generic-child inheritance mechanism, not the identity of the
process holding pipes in a historical failed run.

`helper-process-exit-statistics.json` preserves every helper observation and
original outcome. All 27 created Jobs had both zero-time helper snapshots present
(17 standard, 10 filtered): both before and immediately after the termination
request were `timeout`, not `signaled`. Later owned-Job accounting and actual IPC
EOF independently passed. Three requests that did not create a Job retained null
observations. No missing observation for a created Job was found. These diagnostic
snapshots do not substitute for Job, EOF or cleanup acceptance.

Official Linux 7zz statically inspected the exact delivered NSIS member without
executing Windows code:

- Installer `milkup-2.0.0-beta.9-windows-x64-a5556beea5cd-setup.exe`:
  5,898,153 bytes, SHA256
  `f7fe28275477e8957653649924348bc06e24b4b49d63f6e1d6a6f08ed65c6fbf`.
- Exact installed `milkup-desktop.exe`: 24,040,960 bytes, SHA256
  `5d4df1a7f6e7962be12d624437f620fe5775885e79b7a97b4b519a676ec95d84`.
- Complete official Mermaid 12.2.0: 5,494,801 bytes, SHA256
  `a8a6a6f805b074a8261a2825c86f99c8054acb3b35f50bb7e24a4f9f2c3c3b9f`.
- Exact bootstrap: 17,312 bytes, SHA256
  `8e1d9505dd50ee5319612aca7160978e7b9995ad8314f92d884ca834b66fc1b1`.

The actual PE dependency report and Common Controls manifest are bound to the
installed image. Compiled EXE/dist are not uploaded: the original Windows
full-byte compiled-to-NSS and AST observations are bound to the artifacts, but
are not independently recomputed locally. The local independent check concerns
the actual NSIS application and complete engine/bootstrap bytes.

This is an unsigned current-user trial requiring the existing Evergreen runtime;
no official release, updater publication, main merge or runtime installation was
performed. The old beta.8 package and historical failure evidence remain intact.
