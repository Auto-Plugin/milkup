# P7 keyboard native baseline review

Run `../native-ui/runs/p7-keyboard-baseline-01` used the frozen pre-fix production ELF SHA-256 `f15c476a4f6e7b5f254e325692d57e9bfaa798580441dd3554f6c4fe1e9d802e`. The harness completed all 24 samples: 16 passed and eight failed, with zero fixture-level or fatal harness errors. Driver and application were closed after the run; performance sampling was not concurrent.

| Behavior | Ordinary source/live | Native windowed source/live |
| --- | --- | --- |
| Route and full document end | PASS | PASS: 180,060 lines, exact bytes above native threshold, shipped native-line-window diagnostics and nonempty virtual bounds |
| Plain paragraph Tab | PASS | FAIL: inserts indentation, focus remains in editor |
| Plain paragraph Shift+Tab | PASS | FAIL: focus remains in editor |
| F6 / Shift+F6 with selection | PASS | PASS |
| Menu Escape returns to opener | FAIL | FAIL |
| Unicode clipboard paste/save/undo/redo/restore | PASS | PASS |

Menu-to-editor return was the earlier product contract; opener return is a P7 experience improvement, not a newly introduced regression. All four failed menu samples preserve the editor selection. The windowed Tab failures were not hidden: each records dirty/version change and screenshot before recovery. The harness then uses native Ctrl+Z and Ctrl+S; the next sample records a clean document and the original hash. `keyboard-baseline-independent-checks.json` extracts those before/after observations and independently rehashes the four final physical files. Every final file matches its frozen initial bytes.

The ordinary live menu screenshot was independently viewed: its visible selected first paragraph and table/emphasis/task/code content correspond to the observed state. A screenshot does not itself identify the focused hidden input; that assertion uses the accompanying activeElement observation. All keyboard samples include trusted native key events; helper focus is separately recorded as setup assistance. Clipboard uses real GTK X11 ownership and Ctrl+V, not simulated composition. This run does not validate a real IME, screen reader, system DPI, Windows UI or CRLF fixtures.

The full matrix implementation is prepared and syntax checked but has not been executed by this reviewer. It remains a separate native acceptance step, with the environment interface in `tests/native/p7-quality-README.md`. Earlier performance deadline violations remain separate failed evidence and are not superseded by this keyboard run.
