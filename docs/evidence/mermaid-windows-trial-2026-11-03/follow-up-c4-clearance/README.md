# C4 label edge clearance after the delivered beta.8

The delivered beta.8 installer, its original source and all earlier screenshots
remain unchanged. This follow-up changes only the product-private bootstrap and
its local browser tests. Windows product acceptance of this follow-up is pending.

## Cause and bounded correction

The fixed Mermaid 12.2.0 `drawRels` passes a relationship midpoint as the text-box
left coordinate; `byTspan` adds half the measured label width. For `Presents`,
this puts the text centre 24.5 SVG units to the right of the line midpoint. The
existing private backing adds three units on each horizontal side. Chromium
readback before correction placed its right edge at 333.672 while View's left
edge was 332 with a two-unit stroke. This reproduces the delivered Windows
outline overlap without attributing it to a missing node or cropped image.

The private correction translates an offending label/background horizontally by
at most eight SVG units, only when it can clear every node's stroke by one unit.
It also refuses a candidate that intersects another relationship label's bounds
plus one unit or an unrelated connector's conservative bounds plus eight units.
Parallel/curved relationship groups are skipped. All labels exist before this
check, and authored offsets that do not graze a node remain unchanged. Line
endpoints, node geometry, vertical label position and fixed Mermaid bytes do not
change. If no safe small shift exists, the original layout is retained; this is
not a general C4 layout solver.

The corrected `Presents` backing ends at 330, leaving one unit before View's
outer stroke at 331. [Before DOM](baseline-c4.json) and
[final DOM](final-dom/baseline-c4.json) retain the measurements and full SVGs.
The [official C4 documentation](https://github.com/mermaid-js/mermaid/blob/develop/packages/mermaid/src/docs/syntax/c4.md)
describes authored relationship offsets; cause analysis used the actual fixed
asset, not a claim that the current development branch is the bundled version.

## Actual validation

- **22/22 Chromium tests:** light/dark node clearance, unchanged endpoints,
  authored offsets, crowded neighbouring-label refusal, existing wide-geometry,
  contrast, input-budget, HTML/link safety and appearance checks. This local
  browser test is not native Windows evidence.
- **Native Linux before/final: 3/3 each**, using installed WebKitGTK 2.52.6 with
  sandbox enabled and dedicated user/PID namespaces/displays. Ordinary and wide
  PNGs are byte-identical; C4 stays 564×127 and changes only 345 pixels in bounds
  `[279,40,334,61)`. [Pixel comparison](native-pixel-comparison.json) retains hashes.
- Actual native C4 images were directly viewed. The border is restored, while
  the relation text, arrow and node text remain readable. At `(331,45)` the old
  white pixel becomes the expected blue outline `(120,168,216,255)`; the outline
  outside the affected label region is unchanged. Original PNGs were not edited.
- All six before/final helpers exited normally, removed their exact private
  directories and left no active helper processes. Owned Xvfb/window-manager
  service groups were reaped. The first unprivileged wrapper attempt failed at
  `bwrap` UID mapping before any PNG/helper creation; the same bounded command
  then received tool approval and ran with isolation retained. Failed output is
  preserved, and no WebKit sandbox bypass was used.

The final direct-helper executable is a development ELF with production assets,
SHA-256 `cf63ed142f795ac4f7ed3a08d63090e81760a72762361b8389780324679c92ab`.
Its exact embedded bootstrap is
`8e1d9505dd50ee5319612aca7160978e7b9995ad8314f92d884ca834b66fc1b1`.
[Binary content proof](binary-content-proof.json) locates the complete bootstrap
and unchanged 5,494,801-byte official engine inside both compared executables.
This test does not establish product UI, Registry lease, Windows, high-DPI,
export, IME or every C4 layout acceptance. No binary or installer is committed
with this evidence. The initial implementation's separate native results are
also retained under `native-after`; final results are under `native-final`.
