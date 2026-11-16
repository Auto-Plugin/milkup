# 43901289344: exact failure, generator closure, bounded corrected completion

## Original evidence

Run [43901289344](https://github.com/Auto-Plugin/milkup/actions/runs/43901289344), candidate `abc4bda0b644d581899092fd868f42ad03231cff`, job 133418288529. Evidence artifact 14250995502, 16,095,038 bytes, SHA-256 `a9fa29ad2f95e878cbceb0067bf5a08e85b32c7be16ac1755886eb6a60def7c4`. The exact original ZIP is preserved as `original-artifact.zip` in this evidence commit, with a temporary working copy at `/tmp/milkup-43901289344-evidence.zip`; selected logs, report, samples and exact producer edge are also readable separately. The Git copy preserves the complete bytes beyond the temporary workspace and Actions retention.

The 367 objects **really restored**; two original PCHs and two LLInt helpers regenerated, followed by a successful native no-op. `normal-all-complete`: 4,398.134 seconds, exit 1, **stopReason null**. 2,061 compiler command attempts, no old-object recompilation. Nine JavaScriptCore B3 units failed on missing `AirOpcodeUtils.h`. No timeout/resource stop: minimum sampled available memory 10,808,930,304 bytes and free disk 85,023,596,544 bytes. The build's sampled process-tree peak was 5,240,396 KiB. Attempted commands do not imply that every object completed or was retained.

A second failure prevented preservation: `frontier_checkpoint.py` rejected a native diagnostic stream above 64 MiB. No new checkpoint uploaded; no CMake staging or runtime retention ran. The earlier 367-object archive remains the only relevant completed checkpoint, with a now-proven incomplete generated-output closure.

## Proven causal mechanism

Official archive SHA `a76345b391bef6211fb5ab6cfab2e86b285d18cda17cbb9ade595f1252b86065` supplies the locked Ruby script, opcode input and JSC CMakeLists. The actual graph declares only `AirOpcode.h` and `AirOpcodeGenerated.h`; the Ruby producer also writes `AirOpcodeUtils.h`.

A real isolated Ruby/Ninja reproduction:

1. Run the unchanged official producer: all three headers are created.
2. Both declared files are byte-identical to the old checkpoint.
3. Delete only the undeclared output: Ninja reports `no work to do` and leaves it missing.
4. A genuinely clean run of the original producer generates the complete set again.

`local-generator-proof.json` contains sizes/hashes, including missing Utils hash `464f844f49a66739d4cafee2d6428b2992b96b4236846f8cff8e34ffb3223ef9`. Local Ruby was extracted from official Debian packages into temporary task space; nothing was installed into the host. This is actual generator/Ninja proof, not native WebKit/PDF acceptance.

## Minimal corrected path

- Audit original source hashes, exact Ruby command and actual output set. **Before any object restore**, reject this incomplete predecessor as an optional accelerator. Run the original normal Ninja `all` graph from the clean configured tree. No empty header, manual substitute output, include-path workaround, engine patch, changed compiler flags or sandbox change.
- This intentionally gives up the 367-object speedup: the previous representative batch took about 4.8 minutes, whereas the prior attempted full graph ran 73.3 minutes. A bounded normal build is preferable to another partial-cache repair/identity experiment. These are observed costs, not promises about next-run completion.
- Future checkpoints include all three locked producer products, even if a frontier has not yet consumed the third. Partially generated sets reject. Native fixture proves unused byproducts are retained/restored while helper/runtime ELF files stay outside the archive.
- Native dependency evidence is losslessly split into 8 MiB parts, at most 256 MiB total, with ordered part hashes, whole-stream hash/length and line count. Reader rejects missing, reordered, truncated or corrupted pieces; no records are discarded.
- The captured full-graph command metadata alone is 40,782,500 bytes, already above the old 32 MiB JSON envelope. New checkpoints explicitly use **frontier-v4**, `manifest.json.gz`, bounded to 32 MiB stored / 128 MiB decoded. The legacy v3 plain envelope cannot accept v4; v4 compressed envelope cannot accept v3. Original transport/member hashes, 2 GiB archive, 8 GiB payload, 256 MiB member, path/type, compiler/SDK/input and no-runtime/PCH-binary boundaries remain. No unbounded decompression or silent format downgrade.

Local full workflow: **48 passed**, including actual official Ruby/Ninja and real CC checkpoint roundtrip. Separate frontier suite: **6 passed, one Clang PCH test skipped locally** because Clang is absent; the SDK-equipped job mandates Ruby and reruns these native prerequisites. YAML/shell/heredoc syntax and whitespace checks passed. All source/behavior patch hashes and original final-prefix configuration remain unchanged.

## Sole proposed follow-up and limits

Use existing manual `current-engine-normal`, one ordinary Ubuntu 26.04 hosted job, no extra paid resources. Hard job limit 355 minutes, internal clock 340 minutes, normal all at most 285 minutes with 30-minute archive/staging reserve. Existing low-memory/disk/stall conditions remain. CMake staging/shared linking remain in this same final job, separate runtime archive only if its space/time guard passes. An incomplete cache is explicitly skipped; no unproved new checkpoint is consumed.

The scope is full engine completion and, if feasible, exact CMake DESTDIR retention. Same-package installation, ordinary-user process mappings, native PDF/print geometry/text/link contracts and daily use still await a real final runtime and the existing `a30cc640` entrance with product `546796b0`. No main merge, publication, production channel/key, notifications, host security or PDF output route changes.
