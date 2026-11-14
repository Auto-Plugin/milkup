# Baseline 41755219329 native GUI findings

The retained raw events independently prove **10 visible console identities**, all titled `C:\Windows\system32\icacls.exe`. Five carry product-descendant attribution and five remain unattributed. Four can additionally be bound by exact PID **and creation time** to a retained `System32\icacls.exe` process whose parent is product PID 8048. Of those four, seq1101 and seq1965 were visible at observation; seq119 and seq275 retain SHOW events after the window had already hidden. SHOW evidence remains a conservative failure.

The earlier preliminary claim of seven exact visible associations was incorrect: it matched PIDs without birth times and included non-visible events. Matching all console event identities by PID+creation yields six, but two contain only invisible CREATE/poll. The strict visible subset yields four. No unmatched PID is attributed by title alone.

| First seq | Window/process identity | Event | Visible now | Attribution | Exact child icacls row |
| --- | --- | --- | --- | --- | --- |
| 114 | 0x2024c:5848:134382298988742741 | show | false | unattributed | not retained |
| 119 | 0x40218:8696:134382298990846120 | show | false | product-descendant | yes |
| 275 | 0x8024e:8476:134382299794499116 | show | false | product-descendant | yes |
| 282 | 0x401ee:3420:134382299795279663 | show | true | unattributed | not retained |
| 287 | 0x501ee:3784:134382299796536351 | show | false | unattributed | not retained |
| 1101 | 0x90064:5792:134382299859892376 | poll | true | product-descendant | yes |
| 1522 | 0x8008e:4204:134382299883273722 | create | true | unattributed | not retained |
| 1524 | 0x9008e:6304:134382299883893911 | poll | true | product-descendant | not retained |
| 1965 | 0xf01ee:6832:134382300682158877 | poll | true | product-descendant | yes |
| 1967 | 0xd0046:5084:134382300682792781 | poll | true | unattributed | not retained |

The summary reports 17 product and 20 unattributed identities, but **cannot be completely recomputed**: the 2048-event array ends at 185916 ms while the observer ran 331270 ms. The process array also reached 256 entries; errors reached 16. Thus this is an incomplete failed baseline, not a measured total of 37 independent flashes. A title match alone cannot distinguish an executable from its console host. The four exact owner rows identify icacls; unrelated conhost rows are insufficient to label other windows.

The positive-control PNG visibly contains the generated console and matching title. The failure PNG contains no visible console; capture occurred after the short window disappeared. It shows Mermaid source, and is not screenshot proof of a visible icacls process.

## Evidence-backed observer defects and fix

- The old live-window cache never removed DESTROYed handles. At 256 entries, newly encountered hidden IME/Chrome/power windows could no longer be remembered, so every poll emitted them again. 1805/2048 retained events belong to open-wide-stable; 766 are IME events. The fix releases only live-cache entries on DESTROY and keeps append-only original event evidence.
- The old process cache retained dead PIDs and eventually exhausted 256 slots. PID reuse overwrote prior rows. The fix replaces the active snapshot, records relevant historical identities separately under PID+creation, and freezes each recorded event's ancestry keys. Missing or unordered ancestry remains unattributed.
- Full process enumeration and image queries ran on the WinEvent message-pump thread. This added latency before observing short-lived windows. Process sampling now runs on a separate bounded worker; console identities are still queried exactly when seen.
- A destroyed child control could produce an unresolved OBJID_WINDOW SHOW event because only live top-level windows had been cached. Previously calling it a top-level show was unjustified. The fix caches positively observed child HWNDs; classification requires the same event thread and a live exact owner PID+creation. Each recovered child classification retains proof. Otherwise the event remains unresolved and final acceptance fails.
- Future reports include source thread IDs, native event uptime, callback delay, unresolved events and explicit overflow reasons. Existing event/process/window/report budgets are unchanged. Known product or unknown visible console candidates still fail; no trust or process-termination authority changed.

The revised observer compiles and passes local cache-turnover, PID-reuse, thread-identity, ABI and path checks. These changes still require actual Windows replay. The new registered-product-only measureProduct command reads GetDpiForWindow, awareness and window/client rectangles; it does not alter display settings or claim a DPI matrix.

Microsoft documents that out-of-context WinEvent hooks deliver asynchronously on the installing message-loop thread and that callbacks can reenter: https://learn.microsoft.com/en-ie/windows/win32/api/winuser/nf-winuser-setwineventhook . This supports minimizing work on that thread; it does not establish the exact class of a lost baseline HWND.

Follow-up commit d141bc29 rejects identities born after a Toolhelp snapshot began, so a PID reused during snapshot traversal cannot inherit the previous process parent. Local contract checks pass for this case; Windows replay remains pending.
