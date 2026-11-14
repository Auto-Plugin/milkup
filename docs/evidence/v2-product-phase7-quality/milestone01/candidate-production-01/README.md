# Candidate production 01

Linux no-bundle production build completed with exit 0. ELF `milkup-desktop` is 23,138,864 bytes, SHA-256 `a3626806d3009b022ffb5a82e1de67b295f3e03e3cc39a6556b6a028f4b4c674`.

HEAD remained `fa530b399a5ebbd020f9bfa7ca039378604c8282`, with frozen working-tree changes captured explicitly. This candidate is **not** identical to the clean fa530 baseline. `proof-before.json` records working-tree status and all 674 input hashes, including newly added `desktop-focus.ts` and all 11 embedded plugin archives. `proof.json` confirms no input or HEAD drift, records built frontend assets and frozen ELF identity, and verifies the original baseline ELF remained unchanged.

Bundled Outline 1.3.2 archive SHA-256 is `c4f1bc3b3333fc8ae8919487cd2c20e59b622af98c97ce26e14ff9fdaf3b0f0f`. Raw build output and exit code are retained. No installer bundle, dependency/runtime download, or native UI acceptance is implied by this build.

Runtime entry: source `../native-ui/candidate-runtime/run-env.sh RUN ABSOLUTE_ELF_PATH SHA256`. Start/stop its driver via the sibling `driver-control.py`, using normal namespace approval. Each candidate performance run uses its own fresh profile. Runtime execution waits for the root-controlled exclusive CPU/display slot.
