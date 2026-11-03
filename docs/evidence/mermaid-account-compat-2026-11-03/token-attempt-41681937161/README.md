# Token diagnostic attempt 41681937161 — failed before account creation

Run: https://github.com/Auto-Plugin/milkup/actions/runs/41681937161

Exact source: `93755eb640b2dc8a1b614c3bd7cf175b253c6ab8`, attempt 1.

Windows compilation and the private Rust suite passed (43 passed, 3 explicitly
ignored); Windows wrapper regressions passed 27 cases. All three read-only
source snapshots remained clean. The two-account observation step then failed.

Both failures are the same wrapper argument error: `New-LocalUser -Description`
received `Mermaid token probe ` plus the full 32-character local run ID, totaling
52 characters; Windows permits at most 48. Parameter validation failed before
either account was created. Each original audit records `accountCreated:false`,
`accountSid:null`, `supervisor:null`, `childResult:null`, `stageRemoved:true`, and
no cleanup errors. The elevated runner coordinator was observed, but **neither
the native parent test nor an AppContainer self probe ran**. There is no new
linked-token, child privilege, browser, PNG, or rendering-compatibility evidence.

Original artifact `13254385627` was downloaded once: 9,386 bytes, SHA-256
`9e29e8be677a79d44cbf09d1ba7d5cc38566d345dca1f7087c7a0f91ecd59f22`.
It retains 10 of the 20 allowed files: five root records, two account audits and
their respective evidence lists, and the root manifest. Missing account reports
are accurately absent because no account child ran. ZIP/API identity and every
retained manifest byte count/hash were checked before extraction. A successful
archive integrity check is not a successful diagnostic observation.

`raw.log` and public run/jobs/artifact metadata preserve the original result.
`extracted/` contains unchanged original artifact bytes. `analysis.json`
separates compilation and collection from the unexecuted token experiment.
No test executable, credentials, profile, signed download URL, or user document
is retained. The delivered beta.8 package and all production render gates remain
unchanged. The narrow follow-up is to shorten only the fixed account-description
prefix while keeping the complete unique run ID and exact ownership checks.
