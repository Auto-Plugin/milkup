# One targeted Windows I/O diagnostic

This is a CI-only diagnostic, not product acceptance or a performance fix.
No product source, persistence, security setting, installed filter, Defender setting,
network configuration or user profile is changed. No release is published.

## Gate and stop rule

Read-only capability run `43519157181` confirmed existing Microsoft-signed WPR
and the built-in `FileIO`, `Minifilter`, `DiskIO` profiles on image `20261103.298.1`.
No application or recording was started by that preflight.
The capture re-exports and checks the preserved reference hashes and full configuration content before its one start
attempt; mismatch or unavailable capability stops before application launch. Only provider
definition/reference sibling order is normalized; all other content remains strict.
The existing pinned official WebView CPU profile remains byte-identical.

Run `43519784207` stopped before recording (`recordingAttempts=0`) because official
WPR export provider order changes between processes. Read-only metadata run
`43521245222` proved the mismatch at FileIO SHA comparison; no provider content
changed. Run `43521464066` also stopped with `recordingAttempts=0`: Git's Windows
checkout conversion changed the pinned reference bytes. Local `core.autocrlf=true`
reproduction confirmed this, and byte-preserving attributes plus an early Windows
hash test correct it. These are diagnostic-wrapper failures, not application failures.

Read-only run `43522696437` then verified all three full configurations with no
errors and no recording. Candidate `f4f7bcc036bd477045866fe9babb6d2db3c7c9a9`,
run `43522696501`, is the single actual capture attempt. It permits exactly two application launches:
a fresh temporary A profile and one reuse of the same directory generation.
The existing exact process/runtime/binary/document and normal-close checks remain.
Recording stops at completion, 120 seconds or 512 MiB of intermediate files,
whichever occurs first. Merge can add rundown data beyond that intermediate size.
No retry, additional fresh profile or ordinary comparison is authorized by this plan.
No reproduction, event loss, missing correlation or insufficient provider coverage
must be reported as a limitation, not solved by another capture.

## Questions and evidence

1. Correlate file operation begin/end by IRP, file object, issuing thread and time;
   distinguish the Cookie DB/journal from unrelated work. Do not join on address
   alone across reuse or use an interrupted DPC's process as the issuer.
2. Correlate minifilter pre/post callbacks with the same operation and filter identity.
   Separate callback residence, callback CPU and downstream pending I/O. Presence
   of a filter module on a stack is not a measured exclusive delay.
3. Match disk initiation/completion and StorPort request dispatch/completion where
   stable request identifiers exist. Distinguish guest filesystem/queue/device
   boundaries; a VM trace does not establish host physical-device service time.
4. Compare these intervals with blocked-thread, ready-thread and phase markers.
   Preserve unresolved intervals and avoid adding overlapping durations.
5. The previous 5.141 s flush and 1.390 s NTFS-resource waits belong to an older
   trace. New evidence cannot retroactively fill missing old events. It can only
   support a mechanism if that mechanism is observed again with sufficient linkage.

Raw ETL and exported payloads remain authenticated-encrypted in Actions artifacts.
Only allowlisted metadata and sanitized aggregate findings are retained in this
repository. Even a successful attribution describes this hosted CI machine;
user-machine causation or optimization benefit requires separate evidence.

Official tools: [WPR options](https://learn.microsoft.com/en-us/windows-hardware/test/wpt/wpr-command-line-options)
and [Xperf dumper](https://learn.microsoft.com/en-us/windows-hardware/test/wpt/dumper).
