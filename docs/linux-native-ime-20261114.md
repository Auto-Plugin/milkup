# Installed Linux native IME acceptance — 2026-11-14

Application fix: `d22d5db3cc2ec17dc7ba192694bc0b27a1b8240d`.
Harness: `502cb8b919613310e3b39b3d3b83baa0d8fc0788`.
Explicit run: https://github.com/Auto-Plugin/milkup/actions/runs/43574702132

The prior b877 application duplicated one native IBus commit: physical
`zhongwen` + Space produced `中文中文`. Run 43573970344 captured trusted
`beforeinput(insertFromComposition, isComposing=true)`, `input` and then
`compositionend`, with no DOM compositionstart/update (external OS preedit).
The input handler previously committed before compositionend. The fix establishes
composition ownership from a composing InputEvent and leaves the final commit to
compositionend. It does not deduplicate equal text or use a time window.

The new exact-source DEB was installed on Ubuntu 26.04 using system WebKitGTK
2.52.6, the default sandbox policy and an ordinary user. Both GTK scale 1 and 2
passed all six native stages: GTK positive control; installed launch/scale;
source input; live input; trusted-event contract; normal close and reopen.
Physical ASCII Pinyin keys, Space and punctuation keys were used, not Unicode
injection. Both modes verified one initial commit, a second intentional identical
commit, `，。？！：；`, cancelled preedit, subsequent Latin text, exact saved
UTF-8 bytes and delayed stability. Source mode additionally exercised undo/redo.
The four product launches exited after native close, without forced termination.
The final file intentionally contains two `中文` commits in each mode; this is
not the old single-commit duplication. Both scales have the same file hash:
`592e75ec297d01998769e8b3ab2973f82919e487f939121a69d546c81dbfd575`.

Package:
`milkup-2.0.0-beta.10-linux-deb-d22d5db3cc2e.deb`, 9,853,754 bytes,
SHA-256 `ddc7294d8b233e6ff13e80211de93149159568a7772f88f76a5844817029d31a`.
Installed executable SHA-256:
`ead33435f3d3a64e92d0a0e8ac1b6fef243af0b8796d39124159890f11368cb7`.

Retained CI evidence artifact 14105702804: ZIP 580,998 bytes,
SHA-256 `3645500c8b5dc4d5fd4784dafd6441930ab5f999331e24910d122b04a5ec863b`.
Package artifact 14105737833: ZIP 9,855,193 bytes,
SHA-256 `5099461b6948dc5a5c84830e9c20716c08bc31757c610ebc41f789f572690a5f`.
Both ZIP CRCs and installer manifest/length/hash were independently verified.
Raw evidence includes trusted event sequences, screenshots, UTF-8 fixture,
installed binary hash, process birth identities and close requests. Local copies
under `/workspace/milkup-gap-artifacts/` are workspace copies, not a promise of
permanent storage; CI retention is seven days.

Limits: not Microsoft Pinyin, all IMEs, Windows system DPI/multiple monitors,
large-file native IME, PDF Unicode fidelity, signed delivery or release approval.
The ordinary and windowed view implementations have automated regression tests,
but this native fixture is a small document. The separate private WebKit build
43574464936 remains an independent, unfinished PDF research validation.
