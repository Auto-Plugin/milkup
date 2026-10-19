# Candidate preparation — not yet built or executed

Root must first signal frozen production source and exclusive build ownership. Then:

```
python3 build-candidate.py candidate-production-01 <exact-HEAD>
```

This snapshots filesystem inputs rather than only tracked Git paths: new `desktop-focus.ts`, untracked source, and ignored bundled plugin archives are included. It records desktop/packages/plugins/scripts inputs, package/lock/config files, before/after hashes, working-tree state, frontend assets and ELF hash. The source-head check does not imply a dirty candidate equals that commit: exact input manifests are authoritative. A source drift, HEAD drift, failed build or changed baseline ELF prevents promotion of a candidate ELF. Existing candidate directories cannot be overwritten. Existing release cache is reused; no installer/runtime/package download step is added.

Candidate runtime is independent of baseline runtime. Source `../native-ui/candidate-runtime/run-env.sh RUN BINARY SHA` (three arguments). It permits only frozen candidate evidence paths, checks successful immutable proof and actual binary hash, and keeps the same :127 / 4477/4478 settings with unique run/profile paths. Its driver controller uses the same PID/birth and normal namespace approval workflow. Baseline runtime and ELF remain unchanged.

After GUI handoff and quiet CPU window, run `run-candidate-performance.py RUN BYTES MODE BINARY SHA` through normal namespace approval. Each invocation records script snapshots/hashes, exact command, exit code, complete samples and violations; it closes the app through the existing harness and stops its owned driver. A failed budget is retained as a failed result rather than hidden behind the harness's otherwise successful exit.

Required serial order, all lineBytes=64 / cycles=20: ordinary Live (65536), ordinary Source (65536), memory Source (179200), memory Live (179200), native large-file Source (10485760), native large-file Live (10485760). Actual fixture sizes include line rounding and must be reported. Preserve the first ordinary-Live run even if the nine baseline misses are not fully resolved. No old baseline samples or targets are replaced.
