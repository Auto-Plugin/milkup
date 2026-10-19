# M06 final decision: bounded export queue deadline correction

Adopt only the proven separation of the existing absolute preparation deadline from the isolated owner's unchanged 2-second execution watchdog. The actual RPC queue RED reproduces the false cancellation; seven queue GREEN cases plus deadline/late-result tests pass. No renderer ID special case, public SDK API, success-cache key relaxation, new rendering engine or dependency is introduced. Diagrams stays 1.1.1. The preloading 1.1.2 experiment is rejected and its source changes were restored to 53f043e8.

Production-queue ELF: 6e6c004030fe06146b58d9e40cbd22c7c7d3315c306ceb741f3f58e119ed9d2a. Independent diagrams 1.1.1 archive: 2351692438a2083a72bcb8cddce28c7a530a8557734926992a3a2e3120c68a19. Output 1.0.0 archive: 08cd8532ecd209f4794f88de1880e06c16c586ae2997e326450687e1be2181b9. Actual UI runs, source and artifact hashes, screenshots, raw failures and per-request traces are retained.

Nine formal runs include seven harness completions and two preserved harness failures. Completion is not full content acceptance. All 24 native requests were accepted before the original execution deadline; no frontend queue duration was measured. These samples do not resolve historical Print04's genuine native 2000.313 ms failure.

Actual SVGs/diagram pixels are present in HTML, A4, Letter, GTK Print-to-File, native large-file output and post-cancellation r2. First HTML/A4/Letter, first original print and r2 retry still carry incomplete warnings; first original print also preserves footnotes as source. Repeated HTML and original print improve without code changes. Large-diagrams has all three diagrams and 1,032 body markers, with no artifact warning. Full P5 remains incomplete. PDF Unicode copy/search and long-block pagination remain engine blockers. No physical printer, Windows or macOS verification occurred.

The first print harness selected a screenshot filename through GTK Tab completion; print-02 corrects the driver and retains the initial failure. The first cancel run failed the exact r2 SHA after non-BMP WebDriver key actions duplicated three emoji codepoints. cancel-02 uses the existing real X11 clipboard helper and passes the unchanged original Unicode hash, version advancement and new-output checks. The keyboard-driver failure is preserved, not normalized away.

All-off acceptance disables every enabled plugin, including outline, through UI, then verifies source/live input, undo, redo, and exact saved/restored hashes. No outline or plugin implementation is changed. Prior broad scale/theme matrices are historical evidence, not rerun claims for this checkpoint.

Binary/plugin archive files and SDK tarballs remain only in local workspace; excluded-local-binaries.json lists their hashes. Historical candidate frozen manifests reference the original local build closure and are not a promise that omitted packages are uploaded. The top-level index.json describes this committed evidence subset. Older candidate/readme pending claims remain historical and are superseded by this decision.

No Chromium product dependency, Runtime download, CI artifact upload, release, deployment, main/v2/quality integration, or engine rebuild was performed. Only the isolated authorized P5 work branch is to be committed and pushed.
