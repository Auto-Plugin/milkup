# Native release-gap evidence, 2026-11-14

These are scoped test results, not completion of all release gaps or release authorization.

## Signed same-version recovery and actual installed health

Run https://github.com/Auto-Plugin/milkup/actions/runs/43576758581 passed.
Harness `84ddba099fcb40a950eb10757b8882542270000c`; installed application source
`b877746f5dfd236dfc13f718ed23d837b8e4f89d`. Package built once in 43574228722:
`milkup-2.0.0-beta.10-windows-standard-b877746f5dfd.exe`, 7,251,942 bytes,
SHA-256 `c9c5b8bf8e8c75607d3288fc105553dce9cd22bf625fa84d86b45cbd32c7a648`.
This rebuild differs from the preserved original b877 package; it is not a
substitute for that original's byte-specific evidence.

A newly owned pure-standard user (medium integrity, no Administrators membership,
no debug privilege) installed this package, opened/edited/saved a document and
disabled Diagrams by actual UI. The app exited normally before the test removed
only its owned installed executable, retaining its original hash. The real
recovery preparer then authenticated an envelope and these exact installer bytes
with an ephemeral in-memory CI key, inspected the real PE ProductVersion, and
rejected altered bytes, a different signing authority and expired metadata.
No private key was exported or persisted; the public verification material and
signed envelope are retained. The production update configuration stayed empty.

The *prepared recovery copy* was actually used for same-version NSIS repair;
installer exit 0 and exact executable SHA-256 restoration were checked:
`2faf01f73b0a161ae6bb5cb107a74dc5b11fdff39ebf4f2587d5dc0cb1bee854`.
After repair, the same account/profile reopened the exact saved document with
Diagrams still disabled, re-enabled it by UI, rendered a decoded image, edited
and saved again, and closed normally (exit 0). Actual uninstall exited 0 and
preserved the final document. There was no forced product cleanup, no active
process before outer job cleanup, and the owned account/profile/stage were removed.

Final document SHA-256:
`5776941db374510f0d0ad9eeb2d006e909e02b7fd2581b035a63e5de597538ac`.
Artifact 14106895533: ZIP 73,159 bytes,
SHA-256 `829f69254113b8faeb83aa6a7a97a7f550486b7009eff57e080c7a9d490175e6`.
The retained signature was independently verified against the actual saved
package bytes and public test key. Source LF versus Windows checkout CRLF explains
the differing update-channel file hashes; the retained Windows hash exactly
matches the empty source config with CRLF, and the workflow checked before/after.

Earlier failures remain failures: 43575820419 could not find powershell.exe in
the minimal child PATH. 43576325416 reached the PE reader but inherited module
paths made Get-FileHash unavailable. The coordinator now exposes the trusted
system Windows PowerShell path; the PE reader uses framework SHA-256 under a
read-only sharing handle instead of module auto-loading. Final actual Windows
execution verified this fix. Recovery Node tests: 10 passed.

Limits: this is a test-authority **same-version repair**, not production trust,
a cross-version updater download/install, an older-version data migration,
automatic rollback, arbitrary damaged configuration recovery, missing Runtime,
offline Runtime provisioning or formal signing. Preparation receipts intentionally
remain preparation-only; the installation report separately records execution.

## Windows installed IME remains blocked before input

The existing native EDIT positive control works under the original hosted runner
account, but this does not prove a newly created ordinary account's text service.
Latest installed attempt 43576652526 / b7ee22f3 verifies the product PID, creation
time, exact image and unique `Tauri Window` (excluding `Tao Thread Event Target`).
The new user's exact Microsoft Pinyin TIP is configured, observed as canonical
`zh-Hans-CN`, and the original language list is restored afterward.

Even with the helper's own real focused EDIT window, the fresh-account call
`ITfInputProcessorProfiles::ChangeCurrentLanguage(0x804)` returned `0x80004005`
(E_FAIL), before any native keys were sent to Milkup. DOM IME event list is empty.
This is an actual native setup failure, not a demonstrated Milkup input failure.
The candidate's native IME, punctuation, undo/redo and Windows DPI are **not passed**.
A suitable fully initialized ordinary interactive input context is still needed;
no session-wide activation, injected DOM composition, disabled security boundary
or Unicode key substitution was used to make the test pass.

Artifact 14106284610: ZIP 44,997 bytes,
SHA-256 `efc73cfb3a35b188731363c40802992147b833a2500e802e7bcb9918552f4d48`.
The prior helper assumptions and failures are preserved in runs 43575410456,
43575653168, 43575951324 and 43576321726. Do not report successful app close from
failed attempts that required forced cleanup.

## Independent Linux work

Linux installed native IME defect is fixed in `d22d5db3`, accepted in 43574702132;
see the Linux branch's `docs/linux-native-ime-20261114.md` for exact package/hash,
trusted events, GTK scales 1/2, cancelled/repeated composition and normal exits.
That does not settle Windows IME or large-file native composition.

Private WebKit research run 43574464936 / 06ed15c5 remains separate. It builds a
matched runtime and performs PDF acceptance inside the same explicitly dispatched
workflow. No second build or automatic follow-up has been dispatched. Until raw
PDF results are checked, the original/radical Unicode mapping is not declared fixed.

All CI artifacts have seven-day retention. Workspace copies are not guaranteed
permanent storage. No Release, main merge or personal notification changes occurred.
