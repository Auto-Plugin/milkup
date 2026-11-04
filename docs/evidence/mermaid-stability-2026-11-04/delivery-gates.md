# beta.10 delivery verification

This records the verification code and its limits, not a Windows acceptance result.
The previously delivered beta.9 archive and its reports remain unchanged.

The finalizer keeps the original installed-product gate: the same NSIS installer
must pass all ten product steps independently under a fresh standard user and a
fresh, non-elevated filtered administrator, with exact installed-image bytes and
both native and outer cleanup. A separate GUI matrix is additionally mandatory
for beta.10 and later.

```text
node scripts/ci/prepare-mermaid-trial-payload.mjs finalize \
  <build-evidence> <prepared-delivery> <installed-product-parent> <installed-gui-parent>
```

Both evidence parents must contain exactly `pure-standard` and `filtered-admin`.
The GUI runs use separately installed instances of that same installer. Their
reports retain `productAcceptance: not-run-gui-only`; they cannot substitute for
the original ten-step reports.

The additional gate verifies:

- Exact current application and harness commit, installer/compiled/installed
  image hashes, GUI script and contract hashes, and native observer source hashes.
- Actual installer identity, token/account kind, two distinct account SIDs,
  current-user installation, installed resources/plugins, and existing Evergreen.
- Original GUI and native-window reports with their recorded byte hashes; native
  job identity, PNG correspondence, busy-close overlap, resource release proof,
  console visibility positive control, and no product-time visible console.
- The window observer's actual account token, session and input desktop, plus
  both held product PID/creation-time/image identities and their signaled exit.
  The four installations across the two matrices must use four different SIDs.
- The complete GUI sequence, including two 75-second idle intervals, actual window
  resizing, repeated native file opening, two diagrams, and idle/busy close.
- The outer copy manifest and actual PNG bytes: eight window captures, four
  diagram images including both diagrams, and the visible-console positive control.
- Inner product cleanup separately from outer account, profile, directory and
  group cleanup. Missing or uncertain observations fail the gate.

Only after both matrices pass does the finalizer mark `deliveryReady`, add
`guiAcceptance`, copy original GUI records and pixels to `reports/gui-<kind>`, and
write the delivery checksum inventory. The prepared README explicitly describes
pending acceptance; it cannot claim the new GUI scenarios passed beforehand.
The original 32-file budget remains in place, with only the exact 42 additional
GUI report/pixel paths allowed. The aggregate limit remains 128 MiB. Final
metadata and checksum sizes are checked before writing a delivery-ready marker.

The updated candidate uses Windows ACL APIs instead of launching `icacls`, fits
the image to the editor viewport, reserves scrollbar space, and retains completed
trusted Mermaid images within existing authority and memory limits. The old
Win32 995 pipe ownership root cause remains unresolved. Failed protocol output
remains rejected; allowing close requires complete owned-resource release proof.

Synthetic verifier tests exercise valid evidence structure and rejection cases.
They do not install or execute Windows code, and do not constitute GUI acceptance.
Observed desktop DPI does not establish a complete Windows DPI matrix, system
Chinese IME behavior, arbitrary diagrams, or an independent human visual review.
