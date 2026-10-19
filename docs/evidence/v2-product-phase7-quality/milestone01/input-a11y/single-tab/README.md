# Optional host focus navigation: single sequential stop

The actual SourceDocumentView + desktop moveDesktopFocus component regression exposed an extra sequential root stop: input Shift+Tab focused the editor root instead of leaving the editor. This was parity work beyond the earlier two-step no-trap test.

When `onFocusNavigation` is provided, the root now has tabindex -1 and the input proxy remains tabindex 0. The root remains programmatically focusable and handles its own keyboard events. Without the optional callback, standalone root/input tabindex 0 behavior is unchanged. This is an additive view-dom configuration hook, not a core or plugin SDK API or permission change. Read-only source/live views also have one sequential stop in host mode.

Evidence:
- `harness-path-failure.log`: wrong initial shell-relative fixture path; exit 1, not a product RED.
- `red.log`: actual new component integration before the fix, 4 failures / 2 passes, exit 1.
- `green.log`: 58 tests passed after the fix, exit 0.
- `../document-navigation/final-green.log`: subsequent combined six-suite run, 180 passed, exit 0, including the single-stop integration and existing Unicode/source suites.

The integration uses the real view and desktop focus helper with jsdom layout visibility supplied by the test. It verifies one forward/backward navigation request leaves the editor without changing its selection or editing content. It does not substitute for real native keyboard or operating-system IME acceptance.

Root owns desktop focus order and main hooks; this change only changes the optional host-mode root stop and associated component tests. Prior audit proofs remain historical snapshots.
