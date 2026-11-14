# Exact Windows access-denial retry preflight

The actual 41699494037 failure is preserved in commit390593e9: first remove call returned OS5, no absence check, no IPC failure. This candidate only adds exact raw OS5 to the existing bounded removal retry set, and accurately names retry eligibility. It does not establish the denied object or root cause. The API, ownership, 31-call/100ms/3s limits, independent absence check, and all earlier failure gates remain unchanged.

Linux Rust64/64 passed; Windows GNU lib/tests check passed (no Windows execution). Worst audit is started4250/finished7388 bytes within8192. Three added regressions cover5→success+absence, permanent5 exhaustion, and5→87 immediate failure; existing absence-probe5/still-present failures remain covered. Two known compatibility-wrapper dead-code warnings remain in the cross-check.

The linked JSON contains commands, exact source hashes, logs and primary Rust1.99 source locations. All historical raw evidence and delivered beta.8 files remain unchanged. A new same-candidate two-account product run is required; old IPC995 remains an independent blocker if it recurs.
