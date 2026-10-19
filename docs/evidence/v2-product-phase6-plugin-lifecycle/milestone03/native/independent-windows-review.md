# Independent Windows catalog review — P6 M03

Reviewed 2026-10-19 at commit `eef31bc4a7208d909426e181ba1cd7cbaf9760e9`, plus the proposed narrow rename correction discussed below. Read-only product review; no UI/CI or tests were executed by this reviewer. Official Microsoft documentation was fetched directly. **The reviewed Windows backend is not accepted GREEN: actual Windows CI02 has 9 passes / 27 failures.** A candidate correction requires a subsequent real Windows run.

## Findings requiring action

### 1. Blocking: atomic replacement fails on actual Windows sharing rules

`plugin_catalog_windows.rs:488–545` passes the directory handle as `FILE_RENAME_INFORMATION.RootDirectory`; every pinned directory currently requests list access and only SHARE_READ. Microsoft's rename documentation describes an internal relative target-open and its access-sharing interaction. I flagged this before the Windows result became available. CI02 `windows_replace_is_complete_or_preserves_old_on_sharing_failure` and most transaction tests then failed with NT `0xc0000043` / Win32 error 32. This is a confirmed platform functionality blocker, not an inferred security escape. [Microsoft FILE_RENAME_INFORMATION](https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/ntifs/ns-ntifs-_file_rename_information).

Native owner's proposed fix is deliberately narrower than permitting directory writes: atomic always renames its still-open fresh temporary file to a validated simple leaf in the same directory, so use `RootDirectory = NULL`, the documented same-directory form. The temporary file and all ancestors remain open without DELETE sharing; no pathname parent reconstruction or cross-directory operation is introduced. The leaf rejects separators and ADS syntax. This is structurally sound, but whether it removes the observed sharing failure must be tested on Windows. Do not turn this review into a GREEN claim before CI.

### 2. Medium: rename buffer length differs from documented contract

At the reviewed commit, `length = offset_of!(RenameInfo, file_name) + encoded_name_bytes`. The Microsoft rename page states a minimum based on `sizeof(FILE_RENAME_INFORMATION)` plus name bytes. The vector's alignment is appropriate, but capacity rounding does not change the smaller Length sent to the kernel. Request a conservatively sized buffer/Length satisfying the documented minimum; native owner agreed to this adjustment. This is a contract concern, not proof of an observed out-of-bounds write or a second demonstrated Windows failure. Keep the real sharing-failure diagnosis distinct.

### 3. Lower-priority retained boundary: failed atomic temp files accumulate

After creating `.catalog-tmp-*`, write/flush/rename failure returns without exact-handle temp cleanup. `Store::gc` only reclaims generation directories, not root temp catalog files. Repeated blocked publication can consume disk. The Unix implementation already has the same class of residue, so this is not a new Windows path escape. A future correction should delete only the known temporary handle on pre-publication failure, preserve errors, and never remove a successfully renamed destination after an ambiguous post-rename flush failure. Keep this limitation recorded; no cleanup expansion was made in this review.

## Containment and permissions reviewed

- Only absolute drive or verbatim-drive paths are accepted; UNC/device/drive-relative/non-NTFS/remote roots are rejected. The Win32 root acquisition is followed by component-at-a-time native opens relative to pinned parent handles. No fallback reconstructs a child pathname after rejection.
- Every component rejects traversal, separators, ADS colons, controls, trailing dot/space and reserved aliases. Native case-insensitive lookup does not change the exact sealed file-set checks in the common store.
- Each child open requests OPEN_REPARSE and checks returned attributes before use. Regular files require link count exactly one; this covers aliases that lack a reparse flag. The NT API documents directory-relative object names and bypassing reparse processing, and the handle-information API exposes NTFS link counts. These properties support the code path; real junction/hardlink regressions independently exercise it. [NtCreateFile](https://learn.microsoft.com/en-us/windows/win32/api/winternl/nf-winternl-ntcreatefile), [BY_HANDLE_FILE_INFORMATION](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/ns-fileapi-by_handle_file_information).
- Ancestor Arc<File> handles are retained without SHARE_DELETE. Ordinary read/new-file handles also omit SHARE_WRITE; mutable file content is not reopened by an unchecked path. Existing target validation in atomic briefly permits all sharing, but rename replaces the directory entry rather than incrementally overwriting that prior target's contents. A target race cannot introduce a separator into the validated destination name.
- Sharing denies later conflicting opens, including rename/delete access. This is a real protection while handles stay open; it is not an ACL sandbox against a privileged or already-compromised same-user native process. Inherited DACLs remain the stated boundary. [CreateFileW sharing rules](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-createfilew).

**Important correction constraint:** do not blanket-add SHARE_WRITE to directory pins merely to make rename succeed. That expands which reparse-mutating handles can coexist. If the narrow same-directory fix proves insufficient, the next design needs an explicit actual-Windows test: pin an initially empty directory, attempt to add a junction through a second writable handle, then exercise relative read/create/atomic/delete and verify the outside sentinel and directory remain untouched. Checking reparse attributes once before a later race is not by itself sufficient. The proposed NULL-root rename preserves current deny-write pins and does not introduce this new sharing surface.

## FFI, locking, deletion and state integration

- `extern "system"`, pointer-sized handles, BOOLEAN u8, NTSTATUS i32 and repr(C) layouts are consistent with the inspected API structures. The rename union is used with class 10, not the extended flags class. Pointer-aligned vector storage avoids an unaligned struct cast. The prepared ABI test checks key x64 sizes/offsets; it is not proof for unexecuted x86/ARM64 runtimes.
- Synchronous native opens request SYNCHRONIZE; read lengths and directory-entry offsets are bounded. Directory enumeration uses the held handle, then reopens and validates each child. Failures are returned, not interpreted as an empty directory. [NtQueryDirectoryFile](https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/ntifs/nf-ntifs-ntquerydirectoryfile).
- Removal recursively opens exact children with DELETE rights and uses FileDispositionInformation, then closes them; it does not follow reparse entries. Class 10 rename and class 13 disposition require DELETE, which the corresponding source handles request. [NtSetInformationFile](https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/ntifs/nf-ntifs-ntsetinformationfile).
- `Store` holds its `fs2` nonblocking exclusive lock for the operation, with the lock file pinned against deletion and checked against hardlinks. Common CAS/revision/state logic is unchanged. GC retains active/previous/pending and recovery-backup generation references; unknown entries and IO failure stop cleanup explicitly. Reparse/hardlink entries are not silently followed or deleted.
- Candidate sidecar trial and activation remain explicitly rejected in the shared state machine. This Windows IO backend does not make sidecar execution safe or expand its support.

## Publication and durability wording

Fresh-file content is written through and checked file flushes occur before publication and on the same handle after rename. Post-rename flush failure explicitly reports that the replacement may already be committed, requiring reread rather than blind replay. Backup/primary checksums and sealed generation verification remain common authority logic.

`Dir.sync()` on Windows only validates the held directory. It does not implement a directory-metadata flush, and the module/design document accurately avoid a POSIX-directory-fsync or arbitrary-power-loss claim. Microsoft's file flush API covers file buffers and a separate privileged volume-flush mechanism; that stronger mechanism is not implemented here. [FlushFileBuffers](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-flushfilebuffers). Process-restart regressions and successful ordinary rename cannot establish physical power-loss durability.

## Evidence actually reviewed

- Linux shared tests: 30 pass + three real-process tests pass. These validate Linux/shared logic only.
- Windows MSVC cross-check: succeeded for x86_64-pc-windows-msvc, runtime not executed. It cannot validate sharing, junction, rename or kernel ABI behavior.
- CI01 failed during checkout, not a Windows product test result.
- CI02 `windows-ci-02.log`: fixed baseline executed on Microsoft Windows NT 10.0.26100.0 / NTFS and produced the required named unsupported-platform RED (exit 101). Current code executed 36 tests: nine passed, 27 failed; source tests exit 101. Junction rejection, hardlink rejection, ancestor pinning and lock-exclusion tests passed, but successful catalog publication did not. The separate process suite cannot be claimed complete after the failing library suite.
- CI02 was read from saved logs only; this reviewer neither invoked nor retried CI. Any later GREEN must identify its own source hashes and Windows runtime results, including replacement/GC and process tests.

## Original review source/log hashes

- `apps/desktop/src-tauri/src/plugin_catalog_windows.rs` at eef31bc4: `8f63fa88df0a0d36d0aad0ef8dac61b61f27eacdd7b6cea2fb1615ff654a748d`
- `apps/desktop/src-tauri/src/plugin_catalog.rs` at eef31bc4: `04ecc4f926d4060a6123eade65c207cef32b060744ecefbfb108d16c6fcba273`
- `apps/desktop/src-tauri/src/plugin_catalog_tests.rs` at eef31bc4: `487249b6d0a783d694af190c664ac2d5e8d9ed931e8529f526a7f1731e2911af`
- `windows-ci-02.log`: `46b239264329731d8e055222bc83efc44184d5e0aa03a2d939dac9b9d37fcfea`

## CI03 candidate diff review — runtime result pending

The working-tree diff against `eef31bc4` was independently read after native owner marked it ready. It contains exactly three changes: `offset_of` is imported only for tests; rename Length/allocation now use `size_of::<RenameInfo>() + UTF-16 name bytes`; and `RootDirectory` becomes NULL with the same-directory explanation. `git diff --check` on this file returned 0. No Windows execution was performed by this reviewer.

Candidate `plugin_catalog_windows.rs` SHA-256: `7ae1b70cbe638d2495c6dde68ba9de23b167834968136ad281972f48e6ad0ce5`.

**Static assessment: suitable for the next actual Windows regression run.** The source temp file is exclusively created within this Dir, its exact handle stays open across rename, and the destination remains a validated single component. The existing parent/ancestor and source-file handles deny deletion/rename by conflicting open handles, so this change does not introduce a pathname traversal or require re-opening a mutable parent path. The NULL-root, simple-name form is documented for same-directory renaming. Buffer allocation and the supplied Length both now satisfy the conservative documented size. FileNameLength remains the actual name byte length, and unused allocation bytes are initialized to zero.

All raw-open desired-access masks, share modes, reparse/hardlink checks, ancestor retention, flush error propagation, lock and GC logic are unchanged. In particular, the patch does **not** add directory SHARE_WRITE or SHARE_DELETE and does not relax child-file write sharing. The earlier failed-publication temporary-file residue remains unchanged and documented.

This subsection supersedes only the static buffer-contract concern and reviews the proposed rename adjustment. It does not overwrite CI02's actual 9-pass/27-fail result or establish that the sharing failure is fixed. Await root-provided CI03 platform results before making any Windows GREEN statement; preserve any subsequent failure as a separate result.

## CI03 actual Windows result — accepted for tested catalog-core scope

Root supplied the completed original log and metadata after the candidate review. I independently read both and compared Git object bytes at exact commit `d6a740fdb15075aa479874864d37078c0fca6859`. [CI03 run 39236553133](https://github.com/Auto-Plugin/milkup/actions/runs/39236553133) is completed/success, job 118006907212. The metadata reports zero uploaded artifacts. No CI invocation or rerun was performed by this reviewer.

**The atomic-publication blocker is now resolved for the tested actual Windows NTFS catalog-core environment.** This updates the current conclusion; the earlier CI02 failure and pre-CI03 uncertainty above remain an accurate history. Platform: Microsoft Windows NT 10.0.26100.0; host/target x86_64-pc-windows-msvc; Rust 1.99.0. Current tests finished at 10:20:17 UTC.

| Evidence | Baseline / CI02 | CI03 actual result |
| --- | --- | --- |
| Original unsupported baseline | fixed baseline 4e0d305b | Named runtime test fails exactly as expected: 0 pass / 1 fail, exit 101, expectedRedVerified true; this is the required RED, not a current failure |
| Current library tests | CI02 9 pass / 27 fail, sharing violation | 36 pass / 0 fail / 0 ignored |
| Actual Windows backend checks | CI02 replacement test failed | All seven pass: ABI, hardlinks, junctions, lock exclusion, pinned ancestors, invalid/nonlocal paths, replacement/sharing failure plus recursive GC |
| Separate child-process contracts | CI02 library failure prevented acceptance | 3 pass / 0 fail / 0 ignored: interrupted startup recovery, interrupted trial recovery, cross-process lock exclusion |
| Current suite exit | CI02 101 | 0 |

The source diff from eef31bc4 to the tested d6a740fd commit contains only the reviewed Windows-file changes (12 additions / three removals). Shared state/tests and lock are unchanged. No test deletion, skip, broadened permissions or relaxed sharing mask explains the GREEN.

### Independent source hash correspondence

Windows checkout uses CRLF; Git object bytes use LF. I independently loaded all four exact Git objects, confirmed they contain no CR, converted each LF byte to CRLF, and matched every resulting digest to its named log entry. This explains the different hashes without assuming source drift away:

| Input | Git LF SHA-256 | Actual CI CRLF SHA-256 |
| --- | --- | --- |
| `apps/desktop/src-tauri/src/plugin_catalog.rs` | `04ecc4f926d4060a6123eade65c207cef32b060744ecefbfb108d16c6fcba273` | `6656a5598e23c22fdf0a1e98375b945ebc5731764829f63724f3a6035856a5e6` |
| `apps/desktop/src-tauri/src/plugin_catalog_tests.rs` | `487249b6d0a783d694af190c664ac2d5e8d9ed931e8529f526a7f1731e2911af` | `8fbb779ddd09e0818473505447142b591d69c46c8fb3c3eab0ccc13c6ae85a7e` |
| `apps/desktop/src-tauri/src/plugin_catalog_windows.rs` | `7ae1b70cbe638d2495c6dde68ba9de23b167834968136ad281972f48e6ad0ce5` | `9aec5f50d42dc580c6a66a20c85a54394dbbd5d717af48cae9014eeeaa65c18f` |
| `tests/native/catalog-core/Cargo.lock` | `d91eec98f523984849f402801842e643da05823512ecca0e985aefd0b4e260bd` | `22fa93a309eed0916cb8c39521eace34e2b535f2ed22913172dfdc553487c107` |

The previously reviewed Windows candidate LF hash (`7ae1b70c…`) is exactly the Git source tested by CI03 after this checkout newline transformation. Full machine-readable correspondence and log/metadata hashes are retained in [independent-ci03-proof.json](independent-ci03-proof.json).

### Remaining boundaries

This is actual Windows runtime evidence for the catalog-core filesystem/state tests, unlike the earlier Linux tests or MSVC cross-check. It does not establish desktop Tauri/WebView2 UI, installer behavior, x86/ARM64 or non-NTFS support, directory-metadata power-loss durability, or a full malicious-native-process sandbox. Sidecar execution remains rejected; its test passed because the refusal is preserved. The temporary-file accumulation issue remains a documented low-priority inherited limitation, not silently fixed. Initial reparse/hardlink and pinned-ancestor test coverage passed; arbitrary privileged concurrent mutations beyond the supported threat model were not exhaustively proved safe.
