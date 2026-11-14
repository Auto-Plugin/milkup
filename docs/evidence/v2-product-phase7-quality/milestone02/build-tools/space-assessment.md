# Read-only space assessment

Observed while preparing the M02 builder on HEAD `78e9329004d2ff244585d98dbe0d7cdd98ab9495`.

- Overlay available: 339,111,936 bytes (about 323 MiB); `/tmp` is a separate filesystem with 3,873,861,632 bytes free.
- Existing release tree: approximately 2.2 GiB. Current release ELF: 23,138,832 bytes. The future frozen candidate copy costs approximately another 23 MiB; the compiler/linker also needs transient space, so the current free-space figure is not a guarantee that compilation will finish.
- Release build cache is 231,748 KiB, release fingerprints 12,504 KiB and release incremental only 4 KiB. Removing release intermediates would defeat reuse and could increase next-build space/time. Leave them untouched for candidate04.
- Debug `build` and `incremental` already point to separate `/tmp/milkup-p7-rebuildable-cache` locations. Deleting/moving those again would not free the corresponding overlay cache footprint. They are not part of this production build.
- Debug `.fingerprint` is 20,556 KiB and debug `deps` approximately 6.37 GiB. The latter contains rebuildable `.rlib`/`.rmeta` compiler outputs as well as historical test executables. Some files have multiple hardlinks, so pathname sizes cannot be treated as reclaimable bytes. No executables or evidence have been classified as disposable.

No cleanup is currently required to prepare the script, and no files were removed or relocated. If a later build-space check is insufficient, a narrowly reviewed subset of stale debug `.rlib`/`.rmeta` outputs could be considered: establish active Cargo absence, inode/link ownership and absence of evidence references first; record the exact candidate paths and anticipated actual reclaim. This is a possible follow-up, not permission to delete them now. Never delete historical evidence, profiles, unique binaries, source, unfinished work, or release inputs required for cache reuse. Do not copy old binaries/large target trees into M02.

The builder records free bytes before/after actual compilation. Source-freeze/CPU authorization remains a separate prerequisite; no build or cleanup has been run here.
