# Exact-source Linux rebuild and installed acceptance

No release is published. Application source is `b877746f5dfd236dfc13f718ed23d837b8e4f89d`; only the CI acceptance harness changes. Default Ubuntu 26.04 security policy is retained.

## Build and first installed attempt

Run [43558261633](https://github.com/Auto-Plugin/milkup/actions/runs/43558261633), harness `87c63ad580e890d4e75541f85a2f95fb886604bf`, used the baseline official `scripts/release/build-candidate.mjs`, frozen dependencies and an independent exact-source checkout. The ordinary-user WebKitGTK sandbox preflight, release DEB build, install, installed/extracted executable comparison and package removal passed.

- New DEB: `milkup-2.0.0-beta.10-linux-deb-b877746f5dfd.deb`, 9,853,762 bytes, SHA-256 `4941f3a1ab85b7c7ed1d96edf4807c388a7c883240a2aa32ee13c062661fc813`.
- Original preserved DEB SHA-256: `36c4873d840a06e85bf08398e119f9ddb494c813727eff6479aa4e434141f86e`. **Different bytes**; the rebuilt candidate never substitutes acceptance of the original.
- New installed executable SHA-256: `1f2eb69ca6fda7f2cad047fe72aed483d571209b4659a33d3adbe7494723fcfa`.
- New package artifact: `14099980957`; ZIP SHA-256 `6ea16526fdda7904bf54279bc2b03dfa9d546d7411abde02bcb53b9beeef3db1`, 9,811,122 bytes.
- Evidence artifact: `14099651532`; ZIP SHA-256 `922287dc1cc3b16342f869a94b47fb402ee0d2571c41f926aa9f0efed2afd0bb`, 138,657 bytes.

Installed ordinary-user GUI open passed in 2,593 ms and exact edit/save passed in 1,505 ms. Normal close failed; reopen and PDF were **not executed**. Failure cleanup was forced and is not normal-close proof.

The harness incorrectly focused the Windows-only close button, hidden by the Linux stylesheet, and sent Return. The failure screenshot shows an extra newline and dirty state. This does not establish an application close failure. The corrected harness sends the supported X11 `WM_DELETE_WINDOW` protocol only after checking the owned process generation and window PID. Other UI actions use native pointer input with visible-target hit checks. It never uses XDestroyWindow or a signal as a successful close.

The next run reuses the exact new package artifact, verifying ZIP size/hash/CRC, manifest source identity and DEB size/hash before installation. It does not rebuild, transfer the preserved private original or configure repository secrets.

## Pending acceptance

Real normal close and reopen, A4 portrait and Letter landscape PDF body completeness/pagination, and exact copyable Chinese remain pending. The generated source and expected markers are written before execution; PDFs and text extraction are retained even on assertion failure. Text extraction is not a manual PDF-viewer clipboard test. No physical printer, print job or physical fidelity is claimed.
