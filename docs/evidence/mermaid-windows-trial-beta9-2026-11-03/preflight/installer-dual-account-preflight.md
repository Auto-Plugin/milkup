# Dual-account installed-product wrapper preflight

Commit4b558b68 changes only six Windows test-wrapper/test/document files. Explicit account kind reaches the coordinator and actual held installer token gates using the existing strict matcher. Elevated/full/enabled-admin/unknown/cross-kind tokens remain rejected. The same installed EXE path/hash/version, full image comparison, resources, default-disabled plugin inventory and final profile/directory cleanup are still required.

Local results: installer admission40/40; account policy57/57; C# compilation and five real Node process/pipe/wait/deadline cases passed. The helper report also retains exact NSIS argument and early rejection checks (24 grouped local checks). These are local tests, not Windows installer or identity-API execution. Independent six-file review found no blocking issue.

The JSON records exact source and evidence hashes. Initial PowerShell initialization errors from read-only default home cache/data paths are retained; only per-command XDG_CACHE_HOME/XDG_CONFIG_HOME/XDG_DATA_HOME were redirected to newly owned workspace test directories. No accepted native/render source, global ACL/UAC or installed Runtime was changed. A new exact-candidate dual-account installed-product CI run remains required; historical IPC995 is not claimed resolved.
