# Actual beta.9 installed run 41708284083

The final GitHub API identifies candidate
`0811b899ea4c4f98294046f66524d4503307d279`, attempt 1, and conclusion
`failure`. Release NSIS construction and the strict source gate passed. The
dual-account installed-product step failed for the pure standard account.
Finalization and delivery upload were skipped. No delivery artifact exists.

The two retained artifacts were downloaded once each, checked against their
actual API run/source/size/SHA256/expiry, and parsed with the closed archive
validator before extraction. All 73 installed-evidence files and 15 inspection
files retain their original bytes. Both account artifact manifests and the
inspection manifest were independently checked. See `two-artifact-integrity.json`.

| Artifact | Bytes | SHA256 | Actual expiry UTC |
| --- | ---: | --- | --- |
| installed, 13266058451 | 378751 | 61836b13defd778edf2e73e1603a03b5048cea5b186c6acfa12fcb6af320794a | 2026-11-10T20:15:33Z |
| inspection, 13266078497 | 22672 | cad1f9c26a3c4ae869c694ebe6249da968c85914936d7d8af6a328d0402c13d5 | 2026-11-10T20:15:34Z |

The pure standard account passed initial disabled-source display, then timed out
waiting for a decoded editor PNG at step 2. Native request
`7b60396d899c44c39ed512d12f3a68c8` captured 2606 bytes but published zero. After the
job became empty, stdout remained in `trailing-byte` and stderr in `stderr-read`.
The bounded join requested cancellation, and both reads ended with Win32 995;
the recorded joins took 59 and 60 ms. Cleanup remained uncertain with the four
original stdout/stderr join/protocol/read failure kinds. This reproduces the
historical IPC 995 symptom; its underlying pipe-lifetime cause remains unknown.

The private tree retry worked in this same failed request: the first removal
returned Win32 5, the second completed after 143 ms, and a separate absence check
confirmed removal. The native profile was deleted and the owned job reported
zero active processes. These facts do not override the IPC cleanup failure.

Pure-standard normal UI close also failed: the 15-second exit wait expired,
the owned fallback terminated the process, `exitCode` was null, and `signal`
was `SIGTERM`. The outer profile, account and staging cleanup succeeded. They
do not establish product inner cleanup or natural exit.

The non-elevated filtered administrator independently passed the frozen strict
product replay: 10 UI steps, 7 native-hash-bound diagram PNGs, 12 finished jobs
(9 successful, 1 cancelled, 2 bounded invalid-grammar results), and 4 natural
closes with held exit 0 and null signal. All native cleanup observations passed.

Both fresh accounts installed the same 5,894,168-byte installer (SHA256
`b2b284793a84475644939a45797419138deb3367db04146628d7af97a7f6cf26`)
and launched the same installed 24,025,600-byte EXE (SHA256
`754129317aebd11d9c773525a4ed1b3047c98c320cb8e5d4b991415596c3d4d6`).
Their actual medium, non-elevated caller/held-installer identities matched the
required distinct accounts. FileVersion and ProductVersion were 2.0.0-beta.9;
all 10 embedded plugin versions were observed initially disabled.
These package identities bind original Windows reports. No installer bytes
were uploaded, so no local static NSIS inspection or complete three-artifact
acceptance was possible.

`failed-installed-run-analysis.json` contains the independently replayed checks;
`analyze-failed-installed-run.py` is its reproducible read-only analysis entry
point (the output path must be absent). Original final API responses, job log,
ZIP bytes and extracted evidence remain alongside it. No repository edits,
remote mutation, CI retry, Windows process execution or beta.8 replacement was
performed during this verification.
