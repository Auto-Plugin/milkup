# M02 candidate production 04

Linux production ELF build completed with exit 0 using `tauri build --no-bundle --ci`, existing caches and `COREPACK_ENABLE_NETWORK=0`. No installer, native UI run, upload, runtime download or dependency-install step was performed.

Artifact: `milkup-desktop`, 23,138,632 bytes, SHA-256 `fb767f5a06555681c99323e5f2c5e763cfb4c6333f62f634e06405601ddfc9d2`.

Source HEAD remained `78e9329004d2ff244585d98dbe0d7cdd98ab9495`. Frozen working-tree changes are recorded explicitly; this ELF is not asserted to equal the clean HEAD alone. `proof-before.json` and `proof.json` record all 677 filesystem inputs (including new sources and ignored embedded archives), exact commands, before/after hashes, working-tree status, frontend assets, raw build exit and disk observations. Input drift is empty. All four protected M01 ELF hashes remained unchanged.

There are exactly 11 bundled plugin identities with one version each. Outline is 1.3.3, SHA-256 `80a9ce947c4abf2998eb72c36c327d5d826f0d30fa22dad61f903ff4713ca5c6`. `bundle-continuity.json` confirms the other ten archives match M01 candidate03 byte hashes.

M01 remains unmodified. Existing release/build symlink cache was reused in place. Root has received CPU build release; native acceptance is separate and not established by this build record.
