# Explicit segmented observation build

This supersedes the previous decision to wait for assurance of a complete
single build. A useful **retained** partial build is now an authorized outcome;
it is not PDF acceptance and must not trigger an automatic loop.

## Transfer boundary

The existing manual workflow gains `pagination-segment`. It uses the same
Ubuntu 26.04 runner, authenticated 2.52.6 source, observation-only patch,
compiler and ABI. The observation patch remains
`3a84a75ae9aad83e8f93940c4d55b886c6cf2cba069ca087893fa2efe2e443c8`.
Four unchanged real-TU acceptance results are inherited from 43789957637 only
after exact source/command/compiler/flags/generated-header comparison. The
four standalone acceptance compiles are not rerun. A normal full build may
need to produce their missing objects because the prior gate did not retain
the bytes; this is not counted as new TU acceptance.

`object_bundle.key` supplies the tested six-input identity contract. Actual
resumption uses **ccache's native object and dependency metadata**, rather than
dropping `.o` files into Ninja and bypassing dependency checks. Transfer code:

* Selects only ccache M/R entry names from the isolated compiler-cache root.
* Inspects checksummed entries with official ccache, extracts each result in
  a temporary directory, and requires an ELF64 ET_REL object. Only object,
  dependency, compiler stderr/stdout records are allowed. These came from
  controlled official WebKit source, not user documents.
* Excludes configuration, environment, temp/debug files, runtime, keys and
  workspace content. Rejects links, extra files, changed bytes and >2 GiB.
* Binds the complete entry inventory to source archives, observation patch,
  compiler bytes, configure arguments (including paths), compile database,
  generated-header manifest. Restore checks all bytes before copying.
* Runs the actual two bmalloc commands in fresh ccache processes after a fresh
  directory restore, demanding **first-call hit=1 and miss=0 each**. No warmed
  repeat can satisfy this gate. ccache dependency/race protection is unchanged.

The native compiler cache includes older research entries. They are candidates
for ccache's normal validation, never proof of identity by filename alone.
The latest 43672149274 baseline already gave 2,309 hits and is retained as the
fastest evidenced compatible pool. Its 220-second historical full build used
different scalar/URI headers and cannot be used as this build's duration or
final PDF baseline. No old layout-changing patch is reapplied to gain hits.

`pagination_restore_run`, when deliberately supplied on a later manual run,
downloads only that completed research-branch run's object artifact; exact
current input identity and first-call hits are required again. There is no
automatic subsequent dispatch or fallback after identity failure.

## Budget and progress

Job hard limit: **180 min**. Compilation: at most **90 min**, shortened to
reserve **60 min** within the job for snapshot, upload, private installation,
original native batch, cleanup and evidence. Require at least 30 min of compile
budget before starting. Stop at >1,024 new misses, 15 min with no completed
Ninja edge, <2 GiB available memory or <8 GiB disk. Initial requirements remain
4 CPUs, 14 GiB RAM and 20 GiB disk.

On controlled stop or complete build, preserve the actual current build.ninja,
compile database, full command graph, Ninja log, unique completed object list,
cache hit/miss deltas and resource timeline. A separately verified snapshot
with entry count, byte count and hashes is uploaded as
`milkup-pagination-objects-RUN_ID`, seven-day retention. The following ordinary
evidence artifact holds the graph, key, transfer and progress records. Neither
contains the private runtime. Unknown compiler termination refuses snapshot.

A controlled incomplete build keeps its nonzero outcome. Saving objects does
not turn it into successful runtime/PDF acceptance. Only a complete engine
can reach the original unchanged native batch. Normal cleanup is still owned
and verified; external hard termination can prevent finalizers and is not a
retention guarantee.

Before considering another segment, compare actual completed targets with
43789957637 and the saved entry delta/bytes, prove a subsequent first hit from
the saved pool, and account for remaining graph work. No-progress, recurring
misses for the same inputs, failed snapshot, or exhausted capacity is a stop
condition requiring analysis rather than another identical run.

## Local evidence

`local-transfer-evidence/passed.json`: real GCC and locally extracted official
Debian ccache 4.7.5, synthetic source only. Fresh restore: hit=1/miss=0, object
SHA unchanged. Changed header and semantically relevant macro: miss=1 each.
This does not replace Ubuntu's format/real-command gate. No system tool was
installed or security setting changed.

The first local negative used an **unused** macro and legitimately hit the
preprocessed cache; retained as `unused-define-control.json`. The test was
corrected to change generated code, not to forbid valid ccache reuse. Seven
transfer contracts (including a real ET_REL versus renamed shared library)
and the existing 30 observation/native contracts pass locally. Original PDF
contracts, baseline failures and system-library/sandbox checks remain intact.
