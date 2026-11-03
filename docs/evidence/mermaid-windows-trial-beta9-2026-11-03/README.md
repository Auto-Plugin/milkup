# Verified Windows beta.9 test delivery

The installed dual-account candidate `a5556beea5cdd1570361c528b2326bc0ad8ba0c4`
passed [Actions run 41713129442](https://github.com/Auto-Plugin/milkup/actions/runs/41713129442).
This is an unsigned test installer, not a formal Release. Nothing was merged to main.
The earlier beta.8 ZIP and its Library copy remain unchanged.

## Download and identity

- [GitHub artifact 13270072153](https://github.com/Auto-Plugin/milkup/actions/runs/41713129442/artifacts/13270072153): login required; actual recorded expiry **2026-11-10 20:47:03 UTC**.
- ZIP: `Milkup-2.0.0-beta.9-Mermaid-Windows-x64.zip`, 6,176,973 bytes, SHA-256 `4346d92ccc7f9b47ef14a1b5b70a97db38128baea5176b9250084a2cd28486d2`.
- Installer: `milkup-2.0.0-beta.9-windows-x64-a5556beea5cd-setup.exe`, 5,898,153 bytes, SHA-256 `f7fe28275477e8957653649924348bc06e24b4b49d63f6e1d6a6f08ed65c6fbf`.
- Installed application: 24,040,960 bytes, SHA-256 `5d4df1a7f6e7962be12d624437f620fe5775885e79b7a97b4b519a676ec95d84`.
- The same verified ZIP was also saved as a separate new Library file. No Library identity or signed download URL is published here.

The root independently downloaded the delivery once and matched its API source,
run, length and digest, then verified all 28 checksums in the 29-file ZIP and the
installer hash. A separate three-artifact verifier checked both original evidence
archives, the delivery, all eight copied reports and the actual NSIS application
through read-only 7-Zip inspection. Full official Mermaid 12.2.0 (5,494,801 bytes,
SHA-256 `a8a6a6f805b074a8261a2825c86f99c8054acb3b35f50bb7e24a4f9f2c3c3b9f`)
and the exact bootstrap are present. Root's independent objdump inspection of
that same extracted application matched all 25 Windows import DLL names.
The compiled-to-NSIS complete-byte transformation is evidenced by the original
Windows comparisons; the compiled EXE is not separately uploaded for local replay.

## Installed result

Both actual fresh identities installed the same installer and produced identical
installed EXE bytes. Each passed 10 product steps, seven decoded body images and
four natural UI closes with exit code 0, null signal and drained streams. All
30 admitted native requests completed with verified inner cleanup: 24 successful
renders, three cancellations before Job creation, and three bounded invalid-input
failures. All 30 created profiles were deleted; all 27 created Jobs reached zero;
all owned trees were independently absent. Outer account/profile/stage and install
directory cleanup separately passed. No IPC 995 or directory-delete retry occurred
in either installed product flow.

The actual Windows native suite passed 73 tests with four explicitly ignored child
or opt-in entries. Its controlled generic-inheritance case preserved a writer and
returned 995 on both cancelled reads; its confined counterpart reached EOF while
the separate holder remained alive. This proves the tested inheritance mechanism,
not the historical holder's identity. All started product requests separately
reported the verified non-inheritable protocol-handle proof.

All 34 screenshots were decoded and reviewed against accepted source evidence.
The 14 diagram images were pixel-identical to the accepted versions. C4's tested
left-border gap did not recur; the wide diagram retained all 16 nodes and scrolling.
One initial-source window differed only by a 50-pixel caret. The original automated
`visualReviewAccepted:false` fields remain unchanged; this later review is separate.

See [the complete accepted-run evidence](attempt-41713129442/README.md),
[the preceding failed installed run](attempt-41708284083/README.md), and
[the reviewed hardening preflight](ipc995-hardening-preflight/README.md).

## Use and retained limits

Use Windows x64 with an already installed Evergreen WebView2 Runtime; the actual
tested Runtime was 156.0.4314.50. Installation is current-user only. No Node/pnpm
or additional VC redistributable is required by the verified imports. The installer
does not install a Runtime. Ten plugins are bundled and initially disabled; enable
Diagrams 1.3.0 through plugin management after reviewing its permissions. Separate
plugin archives are supplied for repair, not required for normal bundled use.

Standard users and ordinary non-elevated UAC administrator launches are supported
by this test. Elevated/full-administrator and UAC-disabled administrator launches
remain rejected. The plugin trust boundary, exact launch handle list, AppContainer
capabilities, ACL policy, output validation and cleanup failure gates were not expanded.

The actual writer behind historical IPC 995 in 41692476025 and 41708284083 remains
unidentified. Removing ordinary downstream inheritance does not prove that cause,
eliminate explicit duplication or close the parent's concurrent-inheritance window.
The prior OS 5 retry is separate and bounded; permanent failure still withholds output.
Real system IME, broad DPI coverage, upgrade/rollback, installer interaction and
SmartScreen prompts were not comprehensively tested. Export retains its existing
restricted path; Windows DOM/PDF export is not enabled. C4 acceptance covers the
captured layouts, not every complex diagram. Older hosted-runner profile residue
cannot be retroactively inspected.
