# Release editor quality: gaps 4 and 5

Subsequent implemented performance changes and paired results are recorded in
[performance-follow-up.md](performance-follow-up.md); this page retains the initial checkpoint.

Source baseline: `ef221deb1bde9b56b6bc5faf09105d5bcbd059d7`.
Test-contract fix: `8f02ff66a17ab92a23b9a1d55de14571419f22d0`.
Application remains `2.0.0-beta.10`; Outline remains `1.3.3`.
This checkpoint is **not** final-candidate native acceptance or a release approval.

## Reproduced and fixed

`tests/windows/plugin-offline-delivery.test.mjs` rejected every `alias:` in the
public plugin verifier. The frozen DOM rebuild deliberately binds only
`@milkup/plugin-sdk` to a local installation whose complete bytes match the
reviewed SDK tarball. The old prohibition rejected this correct independent
build path. It is replaced by an exact, single permitted mapping plus checks that
its target comes from the verified resolver and participates in bundle input
verification. Shell execution and additional aliases remain prohibited.

The dynamic SDK/closure tests still reject changed tar hashes, installed bytes,
checkout-linked SDKs, source symlink escapes, unknown dependencies and runtime
imports. No application implementation or security boundary was relaxed.

## Executed in this Linux cloud checkout

- `pnpm test`: 3,171 Vitest cases and four native-bootstrap Node cases passed.
  This includes desktop 1,030, view-dom 1,001, plugin 622 and regressions 12.
  Playground has no tests; it is not counted as coverage.
- `pnpm test:outline`: 40 cases passed.
- `pnpm typecheck`: all workspace type-check commands passed.
- `node --test tests/windows/*.test.mjs scripts/ci/*.test.mjs tests/ci/*.test.mjs`:
  507 cases passed, including the formerly failing offline-delivery gate.
  These are contract/helper tests on Linux, **not Windows execution**.
- Focused offline delivery/public SDK suite: 75 cases passed.
- Modified-test Prettier check, `git diff --check`, version consistency passed.
- Existing offline Outline index and DOM keyboard benchmarks executed; raw
  results and source hashes are adjacent JSON files.

Node: 24.22.1. The available pnpm executable reports 11.25.0; workspace dependency
installation used the unchanged frozen lock. This is not the separately pinned
11.7.0 external plugin build proof. No lock or package versions were modified.

### Outline measurements and their limits

Three in-memory repetitions each used 8, 8,775 and 18,000 headings, plus 512
exceptionally long labels. Complete label/position oracle checks, bounded page
and batch sizes, fold/unfold, tail/middle scrolling and rank lookup all passed.
For 18,000 headings, append/finish took 197.75 / 241.53 / 225.82 ms; local root
collapse plus rows took 0.81 / 0.57 / 1.15 ms. These omit native scanning, storage
latency, IPC, DOM painting and input dispatch. They **do not close** the earlier
native dense-fold p95 observation of 256 ms against a 250 ms target.

The DOM keyboard case used the real Outline output and host tree controller:
ArrowDown moved to the expected item and retained one tab stop. It is not a
real keyboard or screen-reader measurement.

## Browser/native execution blocker

The 287-case desktop Playwright project was attempted with installed Chromium
156.0.8078.79. Browser launch failed before application interaction:

```text
FATAL:chrome/browser/process_singleton_posix.cc:297
Check failed: . socket() failed: Operation not permitted (1)
```

The supported escalated command path was also attempted with a writable browser
HOME and a five-failure stop limit; it failed with the same socket restriction.
No browser result is claimed passed or treated as a reproduced application bug.
Do not remove browser isolation or weaken tests to manufacture a result. Run the
existing suite on a browser-capable executor instead. Environment discovery
listed only the current cloud computer; no user Windows desktop was connected.

## Remaining exact-candidate acceptance matrix

Keep each row pending until evidence names the final source SHA, installed binary
hash, platform/runtime, fixture, input method and original result files. Prior
July debug IME evidence and November Mermaid-only package runs are valuable
history, not acceptance of a later integrated release candidate.

| Area             | Required final-candidate check                                                                                                                                                                                                  | Current status                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Daily editing    | Ordinary/windowed source and live editing; literal `-` versus `- `; single task marker and clickable checkbox; fenced code; history; tables; image assets; context menus; themes; no plugin controls leaking into editor chrome | Unit/contract coverage passed; browser/native replay pending                    |
| IME              | Actual Microsoft Pinyin preedit visibility, cancel, single commit and undo in plain text, lists, inline markers and Mermaid source; mode/focus transitions during composition                                                   | Pending actual OS IME; synthetic composition cannot close it                    |
| Save/recovery    | Save failure retains dirty data; canceled Save As; external modification/deletion conflict; crash checkpoint recovery; recovery interrupted during write; original file bytes and resource preservation                         | Unit coverage passed; final installed lifecycle replay pending                  |
| Plugins          | Install/enable/disable/uninstall without restart; busy disable/close; settings persistence; all-plugins-disabled baseline; no editor-global Mermaid control                                                                     | Prior exact beta10 Mermaid evidence exists; integrated candidate replay pending |
| OS accessibility | Real system 100/125/150/200% DPI and actual screen reader; focus/Tab/Escape and narrow-window layout                                                                                                                            | Pending; browser zoom and DOM accessibility checks are not OS evidence          |
| Mermaid          | Cold process to first decoded graph, preparation/render/decode measured on consistent clocks; repeated cold/warm samples; rapid scroll before prefetch; long revisit; caret reuse and plugin-only source/render/mixed           | Existing warm-prefetch evidence is not a cold latency distribution; pending     |
| Outline          | 18,000-title dense fold/unfold p50/p95, 26 MiB full index and active-heading follow; scroll/lifecycle/cancel/retry; original 250 ms fold target unchanged                                                                       | Offline algorithm checks passed; native remeasurement pending                   |

Useful existing entry points (inspect platform assumptions before using):

- `tests/e2e/desktop-*.spec.ts` and `tests/browser/frontend-mermaid.browser.mjs`.
- `tests/native/tauri-p7-quality.mjs` and `tauri-p7-all-plugins-disabled.mjs`.
- `tests/native/tauri-p7-outline-performance.mjs`: ordinary/large/dense plus
  performance/keyboard/scroll/lifecycle phases. Some native helpers assume GTK
  or XTest; do not call them Windows coverage without adapting and verifying them.
- `tests/native/tauri-recovery-*.mjs` and `tauri-crash-recovery.mjs`.
- The Windows Mermaid product/GUI/installed workflows already bind exact
  candidate hashes; extend/reuse their real input/ownership gates rather than
  substituting helper tests.

No speculative product performance change was made without reproducing the
bottleneck. No installer, formal Release, merge or native acceptance was produced
by this checkpoint.
