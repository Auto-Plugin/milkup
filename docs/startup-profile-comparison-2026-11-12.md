# Controlled Windows WebView profile startup comparison, 2026-11-12

Diagnostic only; no new installer, performance fix, or release acceptance.

## Controls

The explicit diagnostic workflow launches the same linked executable and fixed
WebView runtime eight times per disposable account. The order is A new, A reuse,
B new, B reuse, A reuse, C new, C reuse, B reuse. Temporary directories retain
exact filesystem identity across reuse. No existing user profile is touched.
Normal UI close, exit 0, stdio EOF, exact PID + creation identity retirement,
and absence of owned WebView runtime processes are required before the next
launch. Directory reuse does not keep a live browser process warm.

The ordinary Markdown, first-image observation, and early WebDriver attachment
are held constant. There is no editor input before decode. Only the first launch
initializes the plugin catalogue. Subsequent catalogue snapshots must preserve
package identity, approvals, enabled state, and every other field except the
existing two durable startup transition revisions for each enabled plugin.

No system cache is flushed. Interleaving fresh and retained directories within
one VM controls profile state after earlier runtime use; it does not establish
a truly cold OS disk cache. These are small diagnostic samples, not population
latency percentiles. Account order and a different hosted VM must not be silently
pooled as equivalent conditions.

## Failed first attempt retained

- Candidate `af14b6219b9eddc4695eea75da008972c11efbd7`.
- Run https://github.com/Auto-Plugin/milkup/actions/runs/43195595935.
- Artifact `13933951023`, 83,881 bytes, SHA-256
  `fb2a13c031434ee19c9c6e660ca06f5d3e971da28c8531c017a3727e421ceef6`.
- Both first images decoded and products closed normally with exit 0 and EOF.
  Neither account executed a second launch. The all-process SID census attempted
  to inspect unrelated protected processes with a standard token. Both snapshots
  had 116 access-denied errors and correctly remained incomplete. This was a
  diagnostic permission/scope bug, not proof that WebView processes remained.
- `29551c34300b1a0ffb3a3fdabe26b8cbec914692` scopes this diagnostic census to
  complete kernel-enumerated WebView image names. Unknown names, unknown candidate
  SIDs, incomplete enumeration, live owned runtimes, and budget excess still fail.
  The separate all-process account/profile deletion census remains strict.
  The existing application, plugins, Wry, lockfiles, and packages are unchanged.
- All 347 relevant local Node tests passed. Native filter and PowerShell tests
  must also pass in the actual Windows workflow.

The failed run still contains partial first-launch measurements. Pure-standard
first decode was 5,888.3 ms after spawn. Filtered-admin first decode was 22,369.4
ms: constructor 4,499.143 ms, navigation-to-Wry callback 14,669 ms, actual Wry
request handling 3.098 ms. The five same browser-process generations used a
combined 390.625 ms CPU during the 14,684 ms navigation-to-content-loading
interval. All 59 main-thread queue probes returned, maximum 6.075 ms. These
counters do not measure I/O wait, page faults, or scheduler delay. They locate
the large interval before frontend execution but do not identify its internal
runtime or operating-system cause.

## Optimization boundary

The pinned Tauri 2.11.5 manager already defaults to the application's local data
directory and creates it only when absent. Production does not allocate a new
profile per diagram. The frontend Mermaid owner retains one engine connection.
Profile retention and connection reuse are already present; the diagnostic must
measure their benefit rather than advertise them as a new optimization.

Microsoft recommends local UDF storage and avoiding redundant WebView controls:
https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/performance.
A native lightweight startup indicator could provide feedback before the WebView
loads, but would not by itself reduce first-image latency. Runtime ETW/OS traces
would be needed to attribute unobserved internal waits; current counters do not
justify disabling security, changing proxy settings, weakening persistence, or
replacing the message pump.

## Completed standard-first comparison

- Exact tested candidate `29551c34300b1a0ffb3a3fdabe26b8cbec914692`.
- Run https://github.com/Auto-Plugin/milkup/actions/runs/43197922164 completed successfully.
- Full artifact `13934966004`, 434,453 bytes, ZIP SHA-256
  `ca34cefe63b31b0e4f69ebad9bcd6b4b232f927c8ee9b8201a7e3435abc77961`.
- Actual application SHA-256:
  `76e602911ffee5dd8986e8e3e2980d51240e49c84a55ea5bd7e56d4ec9133066`.
- Existing installed Evergreen runtime `156.0.4314.58`, exact selected executable
  SHA-256 `8b6fabdf9f4ebb331cb7325bb9947e4e3f9a2b5345602feeacf277b1f9f355be`.
  The test did not install a runtime. Both accounts used the same binary bytes.

Both original account reports and outer audits passed. Independent replay
verified all 16 PNGs against the exact launch generation's frontend audit,
filesystem directory identities, approved catalogue snapshots, real UI close,
exit 0, stdio EOF, owner release, and complete zero-owned-WebView censuses.
Every census passed on its first attempt. Each restart made exactly the two
expected durable catalogue revisions; package identities and choices were
unchanged. Temporary accounts, profiles, group memberships, and stages were
cleaned up with no recorded cleanup errors.

The explicit reports have zero ordinary acceptance steps. Full GUI regression
was intentionally skipped; these 16 startup trials do not replace the earlier
product/GUI or installed-package acceptance.

Candidate 29551c34300b1a0ffb3a3fdabe26b8cbec914692; run 43197922164; diagnostic only.

| Account        | Trial/profile              | First decode from spawn (ms) | Constructor (ms) | Environment API (ms) | Controller total (ms) | Navigation to handler (ms) |
| -------------- | -------------------------- | ---------------------------: | ---------------: | -------------------: | --------------------: | -------------------------: |
| pure-standard  | 1: a new + first catalogue |                      11753.8 |           7022.3 |               3048.9 |                2782.3 |                       33.0 |
| pure-standard  | 2: a reuse                 |                       2707.7 |            634.1 |                  6.8 |                 465.2 |                        4.0 |
| pure-standard  | 3: b new                   |                      20289.3 |           2811.6 |                  7.6 |                2115.0 |                    14105.0 |
| pure-standard  | 4: b reuse                 |                       3258.9 |            843.3 |                  6.0 |                 608.4 |                        3.0 |
| pure-standard  | 5: a reuse                 |                       3243.1 |            782.3 |                  3.8 |                 559.7 |                        3.0 |
| pure-standard  | 6: c new                   |                       4104.0 |            804.7 |                  5.3 |                 599.7 |                     1110.0 |
| pure-standard  | 7: c reuse                 |                       3427.9 |            792.5 |                  4.1 |                 600.0 |                        3.0 |
| pure-standard  | 8: b reuse                 |                       3426.1 |            829.3 |                  4.0 |                 573.2 |                       14.0 |
| filtered-admin | 1: a new + first catalogue |                       3448.4 |            937.4 |                  8.2 |                 527.4 |                      526.0 |
| filtered-admin | 2: a reuse                 |                       2653.9 |            641.2 |                  3.5 |                 474.8 |                        3.0 |
| filtered-admin | 3: b new                   |                       3269.6 |            799.8 |                  3.8 |                 475.0 |                      545.0 |
| filtered-admin | 4: b reuse                 |                       2652.6 |            594.8 |                  4.7 |                 399.7 |                        4.0 |
| filtered-admin | 5: a reuse                 |                       2843.5 |            638.7 |                  3.3 |                 471.0 |                        4.0 |
| filtered-admin | 6: c new                   |                       3129.9 |            716.8 |                  3.6 |                 444.2 |                      551.0 |
| filtered-admin | 7: c reuse                 |                       2586.6 |            587.9 |                  4.6 |                 424.2 |                        3.0 |
| filtered-admin | 8: b reuse                 |                       2591.2 |            632.7 |                  3.9 |                 459.5 |                        4.0 |

Within-account adjacent new→reuse pairs (B and C only; catalogue initialization excluded):
pure-standard b: 20289.3 → 3258.9 ms; difference -17030.4 ms.
pure-standard c: 4104.0 → 3427.9 ms; difference -676.1 ms.
filtered-admin b: 3269.6 → 2652.6 ms; difference -617.0 ms.
filtered-admin c: 3129.9 → 2586.6 ms; difference -543.3 ms.

No OS cache reset, no live browser retained between launches, same early attachment. These paired samples do not identify the internal cause of a platform wait or establish a population performance guarantee.

All ten retained-profile samples decoded within 2,586.6–3,427.9 ms. Three of the
four adjacent B/C new-to-reuse pairs improved by 543.3–676.1 ms; the fourth
included a 20,289.3 ms outlier. These differences are observations, not a causal
estimate or guarantee. The slow B-new launch occurred after A had already
launched twice in the same account, so this tail is not confined to the VM's
first runtime use. Its navigation-to-Wry interval was 14,105 ms; all 57 main-loop
probes returned within 4.329 ms. The matched successful render took 395 ms.
Retained profiles avoiding a tail in ten samples does not prove they cannot
experience it later, or that OS caches caused the difference.

Each account's first catalogue initialization had one cancelled render request
followed by one successful request. The other fourteen launches each had one
successful request. Both initial driver readiness probes recorded a transient
GET /status failure. Six execute/sync probes were aborted during real UI-close
exit waits; all corresponding products exited normally with EOF. These original
records are retained, not removed to make the run appear error-free.

## Completed filtered-first repeat

- Same source candidate `29551c34300b1a0ffb3a3fdabe26b8cbec914692`.
- Run https://github.com/Auto-Plugin/milkup/actions/runs/43200029365 completed successfully.
- Full artifact `13935881026`, 435,864 bytes, ZIP SHA-256
  `8da7440de6ce22c1e4ef8328f5f2bea6ba808bcc427dc21b1a10909b91e6a8bd`.
- Application SHA-256 for this build:
  `2e62059b0fbda2f716aef053be0e85a6a0bdeec249770910f39b9d2de7876b05`.
- Same selected runtime version and executable hash as the first run. Both
  accounts within this repeat used the same application bytes. Actual report
  timestamps confirm filtered-admin finished before pure-standard started.

This is a separately built executable on another hosted VM. Its EXE hash differs
from the first run. Exact source identity does **not** establish byte-identical
reproduction. Each run's within-account profile comparison remains controlled;
cross-run differences cannot be attributed solely to account execution order.

Candidate 29551c34300b1a0ffb3a3fdabe26b8cbec914692; run 43200029365; diagnostic only.

| Account        | Trial/profile              | First decode from spawn (ms) | Constructor (ms) | Environment API (ms) | Controller total (ms) | Navigation to handler (ms) |
| -------------- | -------------------------- | ---------------------------: | ---------------: | -------------------: | --------------------: | -------------------------: |
| pure-standard  | 1: a new + first catalogue |                       3419.7 |            880.2 |                  5.5 |                 700.1 |                      732.0 |
| pure-standard  | 2: a reuse                 |                       2767.5 |            675.2 |                  3.5 |                 507.6 |                        4.0 |
| pure-standard  | 3: b new                   |                       3346.0 |            675.0 |                  3.4 |                 508.6 |                      777.0 |
| pure-standard  | 4: b reuse                 |                       2747.5 |            664.0 |                  3.5 |                 499.9 |                        7.0 |
| pure-standard  | 5: a reuse                 |                       2661.9 |            650.8 |                  4.7 |                 486.1 |                        4.0 |
| pure-standard  | 6: c new                   |                       3604.0 |            637.2 |                  3.9 |                 464.8 |                     1125.0 |
| pure-standard  | 7: c reuse                 |                       2882.9 |            737.0 |                  4.5 |                 481.0 |                        3.0 |
| pure-standard  | 8: b reuse                 |                       2637.3 |            645.8 |                  3.4 |                 474.6 |                        3.0 |
| filtered-admin | 1: a new + first catalogue |                       5554.5 |           2894.7 |                545.9 |                1623.5 |                        8.0 |
| filtered-admin | 2: a reuse                 |                       2638.4 |            633.0 |                  5.2 |                 464.1 |                        3.0 |
| filtered-admin | 3: b new                   |                      19661.9 |           1264.5 |                  4.7 |                 684.6 |                    15060.0 |
| filtered-admin | 4: b reuse                 |                       3227.7 |            839.0 |                  3.4 |                 545.9 |                        3.0 |
| filtered-admin | 5: a reuse                 |                       3408.1 |            916.7 |                  5.9 |                 699.1 |                        3.0 |
| filtered-admin | 6: c new                   |                       9484.3 |            837.4 |                  4.0 |                 555.4 |                     6532.0 |
| filtered-admin | 7: c reuse                 |                       3291.2 |            736.1 |                  4.8 |                 548.9 |                        4.0 |
| filtered-admin | 8: b reuse                 |                       2561.5 |            607.2 |                  4.4 |                 424.3 |                        4.0 |

Within-account adjacent new→reuse pairs (B and C only; catalogue initialization excluded):
pure-standard b: 3346.0 → 2747.5 ms; difference -598.5 ms.
pure-standard c: 3604.0 → 2882.9 ms; difference -721.1 ms.
filtered-admin b: 19661.9 → 3227.7 ms; difference -16434.2 ms.
filtered-admin c: 9484.3 → 3291.2 ms; difference -6193.1 ms.

No OS cache reset, no live browser retained between launches, same early attachment. These paired samples do not identify the internal cause of a platform wait or establish a population performance guarantee.

Independent replay again verified all 16 images, exact launch generations,
directory identities, catalogue transitions, normal UI closes, exit 0, EOF,
owner release, and final complete zero-owned-WebView censuses. Filtered-admin
trials 1 and 5 needed respectively three and two bounded census attempts before
completeness/absence was established; they were not force-killed or allowed to
proceed using incomplete evidence. The attempt summaries retain completeness
and match counts; only the final full snapshot is retained, so the transient
incomplete snapshots' detailed cause cannot be reconstructed. All other censuses
passed on the first attempt. Temporary account/profile/stage cleanup passed.

The first catalogue startup in each account produced two successful requests;
the other fourteen starts each produced one. Driver readiness transiently failed
once per account. One aborted execute/sync probe and four target-gone 404 probes
occurred after the exact product's real UI-close request and before its normal
exit/EOF. These records are retained; the run is not described as error-free.

The filtered-admin B-new launch decoded at 19,661.9 ms, with 15,060 ms before the
Wry page handler and a 347 ms matched successful render. All 61 main-loop probes
returned, maximum 12.414 ms. C-new decoded at 9,484.3 ms with 6,532 ms before the
page handler. The ten retained-profile samples were 2,561.5–3,408.1 ms.

## What the two completed experiments establish

There are 32 verified launches, with 20 retained-profile samples between
2,561.5 and 3,427.9 ms. That is a descriptive observed range across two builds
and VMs, not a statistical guarantee. Five of the eight adjacent B/C pairs
improved by 543.3–721.1 ms; the other three included long new-profile samples.
Large navigation delays appeared under the first-tested account in each run,
including filtered-admin when the execution order was reversed. The evidence
does not support treating the delay as specific to the pure-standard token.
It also does not isolate OS cache, host load, profile initialization, or runtime
internals as the cause.

Early WebDriver attachment was held constant. In the first run's long B-new
sample, attachment completed 57 ms before application setup. A measurement-tool
contribution is therefore not excluded. Temporary browser profiles are under
the owned CI work directory, rather than an existing user's normal LocalAppData
profile. Runtime/app hashes are read by the harness; no disk-cache coldness is
claimed. The existing installed-package comparison remains separate.

For the first completed run, engine resource timing was 186.2–322.8 ms, and all
16 resource observations reported the same 5,495,101-byte transfer size. It does
not explain the 14-second pre-handler wait. This is not proof of a Mermaid asset
cache improvement either.

No application performance optimization was made. Existing local profile
retention and one frontend engine connection should remain intact. An early
native startup indicator is a possible feedback improvement, not evidence of
reduced first-image latency. Further attribution needs a controlled late/no-
attachment comparison for this profile matrix and bounded runtime/OS timing
evidence. Current observations do not justify disabling security, bypassing
persistent writes, introducing arbitrary delays, or calling the platform cause
uncontrollable. No installation/export tests were repeated and nothing was
released.
