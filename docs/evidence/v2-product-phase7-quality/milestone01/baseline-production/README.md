# Frozen P7 baseline production ELF

Source HEAD: `fa530b399a5ebbd020f9bfa7ca039378604c8282`.

`milkup-desktop`: SHA-256 `f15c476a4f6e7b5f254e325692d57e9bfaa798580441dd3554f6c4fe1e9d802e`, 23,138,832 bytes.

`build.log` and `build-exit.txt` preserve the successful `tauri build --no-bundle --ci` execution. `proof-building.json` is the pre-build source manifest; `proof.json` verifies all 458 inputs unchanged and records frontend asset hashes. This is a Linux ELF, not an installer or Windows artifact. Native UI/IME/performance results belong to their separate runs.
