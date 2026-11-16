# Current-source gate: original failure and local parser correction

- Run: https://github.com/Auto-Plugin/milkup/actions/runs/43846281602
- Tested SHA: `0cdd4978b182023c819882f1d3fbc5248bfe13c4`.
- Job started 2026-11-16 10:09:34 UTC; completed **failure** 10:10:39 UTC. Hard limit was 10:39:34 UTC (30 minutes); no timeout or retry occurred. Driver elapsed 60.917 seconds, source child 4.873 seconds.
- Original artifact `14215421441`, 46,370 bytes, SHA-256 `1e35ce4a7864e98da3d476abe6dfb04fa8a338b3d92df0ff59a0f74cbc97507d`. Stored unchanged as `original.zip`; GitHub expiry 2026-11-23 10:10:37 UTC. ZIP integrity and digest verified. Extracted `result.json` and `official-source.log` are copies for reading.

## Actually completed

The ten dependency-free scope/transport/configuration-contract tests passed on the real runner. Official APT source metadata, both dependency simulations and SDK installs completed. No old object cache was restored. Initial measured resources: four CPUs, 16,366,640 KiB total memory, 14,899,216 KiB available memory, 91,637,854,208 free disk bytes; image `20261111.196.1`.

Authenticated Ubuntu build-dependency source version was `2.52.6-0ubuntu0.26.04.1`; this is the SDK dependency set, **not substitution of the target 2.54.2 source**. Additional explicit SDK packages installed successfully. Inventory includes clang21 21.1.8, CMake4.2.3, Ninja1.13.2, GTK3.24.52, Soup3.6.6, ICU78.2, HarfBuzz12.3.2, bubblewrap0.11.1 and xdg-dbus-proxy0.1.7. Their compatibility with a fully configured current build remains untested.

The full official 49,989,232-byte compressed source download passed the locked SHA-256 check. The child then failed at `validate_members`, before extraction, on the unconditional duplicate-name rejection. This is a **harness source-archive parsing failure**, not a WebKit compile, ABI, sandbox or behavior failure.

## Exact root cause and narrow correction

Read-only streaming inspection of the same full hash-verified official archive found 36,446 entries, 462,178,208 regular-file bytes, and exactly one duplicated path:

```
webkitgtk-2.54.2/Source/WebKit/Resources/gtk/gtk-theme.css
```

Both records are regular files, 990 bytes, mode0664, no link target, and content SHA-256 `37813ec43856d3773483539a95c088d010cdaed14b1effbd28f423297be9d96a`. `official-archive-duplicates.json` retains the independent scan; `gtk-theme-original.zip` retains the public-source bytes.

The corrected parser allows only this known pair with exact type/size/mode/content hash, and extracts the first identical record once. It rejects a third occurrence, altered bytes, incomplete pair, any other repeated path, noncanonical paths, traversal, special files and existing size/count overages. The full official archive digest remains mandatory. It does not generally allow tar overwrites.

The corrected parser was applied locally to all 36,446 entries from the exact official archive; it passed (`corrected-archive-preflight.json`). No full local extraction was attempted with approximately 61 MiB free. All **25 local tests** passed, including changed-content/third-copy/unrelated-duplicate negative cases. Patch SHA remains `855e58cc8ad531cc32e893b8274983a6264e6fdfc248c13e80c5ef0e01d7a4e5`.

## Not executed / no inherited result

Source extraction, patch application on the full tree, CMake configuration, actual generated ABI/printing/sandbox definitions, header generation, actual TUs, engine build, install/runtime mappings and native PDF were all **not executed**. Zero completed objects, therefore no reusable object archive. Original first-run failure is retained.

Exactly one CI dispatch was made. There is no automatic continuation or second run. The parser correction and independent same-package support/dependency/security/recovery design are ready for review; they are not a successful current-source preflight or a deliverable runtime package. The next distinct execution can use the corrected parser and the same bounded gate, without any old cache, but has not been dispatched. No product behavior patch, security/notification/production setting, main branch or release changed.
