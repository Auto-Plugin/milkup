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

Execution update: [39936547225](https://github.com/Auto-Plugin/milkup/actions/runs/39936547225)
actually passed all three observation tests among 11 Windows tests. Its canary
timed out before native ready; private-tree removal succeeded, so the OS5-only
observation did not execute. This is not evidence that the earlier OS5 cause
has been resolved.

The cleanup-only reviewed native source commit was `ae2776b3f49cd262a4954e313fd2010b8917beb3`. That candidate compared
the **entire** `src` tree against that commit and requires its differences from
`82fb49e95caf99ea45654f552992eff81f72bee9` to be only `launcher.rs` and
`launcher/cleanup_observation.rs`. The remainder of the old protected inputs is
still compared directly to 82fb. The execution record and image reader require
separate rendering and native-source baselines and explicitly reject a claim
that the two native source trees are byte-identical.

## Preparation observation follow-up

The next reviewed candidate supplements the native observation with fixed
stderr preparation phases and a projection of existing case-report fields.
Parent `readyWaitElapsedMs` is recorded after the original `recv_timeout`
returns, before applying the unchanged result. Its origin remains immediately
before `ResumeThread`. The helper's relative phase times start at `engine::run`
entry; its existing 10-second initialization deadline still starts only after
COM initialization. These are distinct clocks, not extra or restarted deadlines.

The helper emits at most 17 short lines from a fixed 19-name allowlist, including
the mutually exclusive environment/controller callback outcomes. Only phase,
relative microseconds and optional numeric HRESULT are written; no input, URL,
path or arbitrary error text is added. Writes use the existing stderr pipe and
ignore diagnostic write errors. Call results and callback results retain their
original propagation. The original 16 KiB reader, stdout IPC, two deadlines,
permissions, Job and cleanup behavior remain unchanged.

The case summary projects existing ready/timing/deadline/IPC fields and bounded
pre-stop Job counts, image basenames and token facts. It emits at most 24 known
stderr lines / 2 KiB; unknown stderr text is represented only by omitted count
and the UTF-8 length/hash of the launcher's already lossy-decoded string. It
does not claim that hash identifies original undecoded bytes. Null fields,
truncation and inspection errors remain distinguishable. The projection is
bounded to 8 KiB and is diagnostic only, never an acceptance or permission gate.

Phase absence is not proof that an API never ran: abrupt termination, failed
writes or incomplete reader joins can leave only a prefix. Callback success
does not prove browser ownership/token checks, and `ready-frame-flushed` does
not prove the parent received or accepted it. The positive matrix remains
conditional on a completely passing canary; no retry or longer timeout is added.
The fixed official JavaScript, fixtures, dependency and security inputs stay
byte-identical to 82fb; native source will be pinned to the new exact reviewed
commit, including both the existing OS5 observer and preparation changes.

The exact preparation-plus-observer source is now
`7aa222e85859d217c33eedcb244e89ca1089ebbb`. The entire native tree is pinned to
it. The only native paths differing from 82fb must be `engine.rs`, `launcher.rs`
and `launcher/cleanup_observation.rs`; the observer itself remains byte-identical
to its previously reviewed source. The execution record and image consumer
require this exact new baseline, rather than excluding native files from checks.
The selected existing Runtime's file and product version are sampled read-only
and recorded separately from its directory version, without updating it or
performing any online signature check.
