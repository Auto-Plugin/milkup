# Installed Windows wide/C4 visual review

Run **41668620695**, candidate `a5431693a4ea1e1a282c16b9cc9651e17b67f9ea`. Installed EXE SHA256 `5e84d2aefacbed31df509418223df9a3f92edbede1585b6f4333816ba0d2b1f0`. Four retained PNGs were inspected at original resolution and fully decoded locally; all SHA256 values match the harness report.

- **Wide:** 3528×126, nonwhite bounds `[23,23,3505,103)` and 23px exterior margin. All 16 nodes, labels and 15 arrows are complete and readable. The 1028×760 UI screenshot and DOM size show natural-size rendering with a horizontal scrollbar. The screenshot only shows the left viewport; actual scrolling to the right end is not established.
- **C4:** 564×118, nonwhite bounds `[15,15,549,103)` and 15px exterior margin. Labels and arrow remain clear; black text against the sampled blue fill gives approximately 10.3637:1 contrast. A minor cosmetic defect remains: the Presents white backing erases about one pixel of the View left outline near `(331,40..54)`, without obscuring labels or arrow.

Only the two light-theme fixtures at recorded DPR 1 were reviewed. No dark-theme, whole-corpus, DPI, IME or human sign-off claim is made. Original reports and source were unchanged; no remote run was started.

| PNG | SHA256 |
|---|---|
| `installed/07-wide-diagram.png` | `ca08f54c575d5031c1e886b4fdb4a2ec87aec580b67360d202d0449115193617` |
| `installed/07-wide-window.png` | `5359f97944aefcd8fa7f33f301d8f13699366eb2ce1269bdd954ee5d2c0c4d4f` |
| `installed/07-c4-diagram.png` | `0d1e0d18e4f37b427a04f23f42868b719987ab7d17a501e2bc9b3edfec39b846` |
| `installed/07-c4-window.png` | `11d6bf3d422513a75a7c7166c5b0202df684ecf9cc3628a0d81090f65155d205` |
