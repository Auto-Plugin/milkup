# Candidate03 ordinary Source outline compatibility smoke

Prepared only; no native UI has run. Wait for Root's exact candidate03 ELF/SHA and exclusive GUI slot after candidate performance. This phase makes no timing or cold-start claims and does not repeat 20-sample measurements.

The new `smoke` phase in `tests/native/tauri-p7-outline-performance.mjs` uses the original eight-heading ordinary fixture. Existing observer/measurement and performance/scroll blocks remain byte-for-byte unchanged, verified in `smoke-preflight-01.json`.

Checks use normal native installation, approved public outline 1.3.2, real pointer/key input and read-only observations:

1. Full index and all eight rendered headings, then Source mode.
2. Real public heading click; exact editor cursor offset and current outline heading.
3. Native single ASCII `X` inserted inside the first heading title; document version advances and the full index displays `XGuide` with eight headings.
4. Undo and save; original title, eight headings, dirty false and byte-exact source SHA restored.
5. Shift+F6 and at most ten real Tabs into the tree; End focuses rank 7, Home rank 0. Record focus details and screenshots, and assert source remains unchanged.

The independent archive stays fixed at SHA `c4f1bc3b3333fc8ae8919487cd2c20e59b622af98c97ce26e14ff9fdaf3b0f0f`. The wrapper accepts the separately confirmed ELF/SHA; it does not substitute candidate02. Use one fresh run/profile and preserve failures.

After Root supplies `RUN`, `ELF`, and `SHA`:

```bash
python3 /workspace/milkup-p7-quality-evidence/milestone01/native-ui/candidate-runtime/driver-control.py start "$RUN" "$ELF" "$SHA"
bash /workspace/milkup-p7-quality-evidence/milestone01/outline/run-smoke.sh "$RUN" "$ELF" "$SHA"
python3 /workspace/milkup-p7-quality-evidence/milestone01/native-ui/candidate-runtime/driver-control.py stop "$RUN"
```

`RUN` must begin with `p7-candidate-`. Stop the recorded owned driver even if the harness fails; do not stop other agents' processes. Preserve candidate02's matched report separately and do not attribute those timings to candidate03.
