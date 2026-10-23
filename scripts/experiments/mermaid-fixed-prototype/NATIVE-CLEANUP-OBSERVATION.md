# Bounded native access observation

This diagnostic follows the preserved [failed visual runs](WINDOWS-VISUAL-RESULT-2026-10-23.md).
It is observation in the authorized disposable prototype, not a new deletion
implementation or permission adjustment. No product integration is authorized.

Only after the original `remove_owned_tree` returns OS5, with the owned Job
empty, IPC finished, pin handles dropped and AppContainer profile deletion
confirmed, the same launcher thread observes its process token and thread token.
`OpenThreadToken` uses `TOKEN_QUERY` and `OpenAsSelf=true`; absence and inspection
failure remain distinct. It does not impersonate or adjust privileges.

The only targets are this case's exact root, `code`,
`code/mermaid-fixed-prototype.exe`, and `state`. Existing reparse-ancestor checks
apply. Each target gets one DELETE access-open attempt, and the three directories
get one FILE_LIST_DIRECTORY access-open attempt: at most seven opens across four
paths. This counts explicit access probes; the existing read-only ancestor
metadata checks may internally acquire additional metadata handles. The report
field `fileOpenLimit` refers to those seven explicit access probes. They use all three sharing flags, OPEN_EXISTING, OPEN_REPARSE_POINT and,
for directories, BACKUP_SEMANTICS. Handles are noninheritable and immediately
closed. No directory buffer is enumerated, no contents read, and no deletion
disposition, delete-on-close, ACL/attribute change, privilege change or retry is
performed. The JSON is bounded to 4 KiB and observations do not replace the
original error, stop decision or failed-PNG removal.

The directory LIST probes were separately approved after independent review.
The root agent chose to retain the existing positive matrix **only if** the
canary completely succeeds, to obtain the still-missing approved PNG evidence
without a second cold build. A failed canary still stops immediately; there is
no automatic retry. This differs from the independent reviewer's narrower
canary-only recommendation and is recorded explicitly.

Successful access-open means only that the requested right could be acquired at
that later instant. It does not execute or prove deletion disposition, rule out
an earlier transient state, or locate an unobserved descendant failure. An
observed token difference would need analysis; it is not assumed in advance.

The diagnostic changes native source. CI must lock the entire native source tree
to an explicitly reviewed diagnostic commit, while the official renderer,
assets, input corpus, dependencies and C# supervisor remain locked to the old
rendering baseline. The run log records the existing compiler's verbose version;
no compiler or Runtime is installed or updated for diagnosis. This document is
a protocol description, not a claim that the new Windows diagnostic has run.

The exact reviewed native source commit is `ae2776b3f49cd262a4954e313fd2010b8917beb3`. CI compares
the **entire** `src` tree against that commit and requires its differences from
`82fb49e95caf99ea45654f552992eff81f72bee9` to be only `launcher.rs` and
`launcher/cleanup_observation.rs`. The remainder of the old protected inputs is
still compared directly to 82fb. The execution record and image reader require
separate rendering and native-source baselines and explicitly reject a claim
that the two native source trees are byte-identical.
