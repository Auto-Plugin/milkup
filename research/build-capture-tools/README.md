# Local exact-build capture tools

This is a source-only handoff derived from d1efaa22. No audit reports, source
archives, build products, logs, credentials or runtime are included. Standard
library Python 3.11+ is sufficient for the contracts and dry plan. There is no
network, CI, package-manager or installation operation. Do not run a build merely
because this handoff is present; a separate engineering task owns that execution.

Apply the additive patch to a clean isolated checkout (`git apply --check`, then
`git apply`), or copy this directory alone. Run from this directory:

```sh
python3 -m unittest test_build_provenance_plan test_capture_support
python3 build_provenance_plan.py --help
python3 build_provenance_plan.py plan "$ORIGINAL_EVIDENCE_ZIP" "$FRESH_PLAN"
```

`plan` authenticates the retained exact original evidence ZIP before reading its
Ninja/compile database. Public identity constants are in capture_support.py. It
writes a fresh build ID, a conservative required-input set and explicit bounds;
it does not compile. Review missing/unexecuted graph branches explicitly, never
silently remove them to turn an incomplete collection green.

The receiving task must separately have the locked official source archive,
normal-path-2.54.2.patch and normal-path-2.54.2.json, exact generated build tree,
and the admitted toolchain. Those pre-existing inputs are deliberately not bundled.

```sh
python3 build_provenance_plan.py source-check "$FRESH_PLAN" "$SOURCE_RECEIPT" \
  --archive "$OFFICIAL_ARCHIVE" --patch-directory "$EXISTING_PATCH_DIRECTORY"
python3 build_provenance_plan.py collect "$FRESH_PLAN" "$FRESH_COLLECTION" \
  --build "$EXACT_BUILD_ROOT" --source-receipt "$SOURCE_RECEIPT"
```

Original absolute source/build paths, compiler/tool hashes, generated graph,
CMake cache and generated config remain strict. A different local guest, path or
SDK must not impersonate that identity. If it cannot reproduce those inputs,
stop the old-identity gate and explicitly admit a separately identified new
configuration, with reviewed command/config differences and new tests. This
handoff does NOT implement or approve that rebase. Reusing version numbers is
insufficient. `--patch-directory` only locates the locked patch; it changes no
source/build identity or product flags.

An optional future `build` mode requires `--execute`, non-root, exact identity,
20 GiB free, a fresh evidence directory and a separately authorized supervisor.
It uses normal Ninja all-target arguments plus response-file retention, 12,000 s
work limit, 2 GiB reserve and 256 MiB log bound. Collection is bounded to 1,200 s,
4 GiB total/256 MiB per file. The outer 21,300 s limit must be enforced by the
caller; this tool does not enforce host memory limits or install/configure anything.
It preserves failure receipts and only signals its own spawned process group.
Missing/changed/over-budget inputs do not pass. Do not run concurrently with the
other task's clean build. No build is started by tests/plan/collect.

Linker maps: `link_map_probe.py` is an optional tiny local synthetic GNU C/archive
probe. It compiles but never executes its output. Do not equate that check with
the target linker or runtime. Actual link replay must first identify the exact
selected linker, command and response files; supported map/cref flags are the only
permitted diagnostic delta. Preserve normal final binary, replay hash, input/member
hashes, live/discarded sections and full command. Require exact final-byte equality;
otherwise evidence belongs to a distinct candidate. No automatic replay is included.

`bind_next_package` only conjoins independently verified receipts. It does not
validate payloads or grant license clearance. The package verifier must hash real
new payloads against new staging/application inputs first. Never use new receipts
as proof for an old package. Applicable notices, source/relink delivery, host
provenance and sustainable security maintenance remain separate release gates.
All collected evidence stays local; this handoff does not authorize uploading the
previously refused full provenance report. No native installation/PDF pass implied.
