# Windows DPI/topology and offline-install prerequisites

The one bounded read-only run [43681940229](https://github.com/Auto-Plugin/milkup/actions/runs/43681940229) completed successfully as **capability collection**, not Milkup DPI acceptance. It establishes one actual 96-DPI display, with DPI virtualization explicitly excluded for the owned probe. No new product build, installation, user-setting change or product GUI matrix was run.

## Exact package and prior evidence

The latest tested standard installer remains `milkup-2.0.0-beta.10-windows-standard-8e0ce998f71b.exe`, source **8e0ce998f71b2360829368e85506dd45b2f2c3a1**, 7,258,784 bytes, SHA-256 **9a9993bc12fd6b2d887da103d3c86b1b9c49428b4ed30eef7a99fc7544113997**. Its bytes were rechecked locally, not rebuilt. Product integration is **8f7fefdfcdf88f0179721c98215b1e0c9afe8452**; package identity continues to use the actual build SHA. The prior installed run [43680250007](https://github.com/Auto-Plugin/milkup/actions/runs/43680250007) proves its explicitly scoped Mermaid render-mode entry and close/uninstall behavior, not OS DPI or cross-monitor behavior.

The retained original logs from [43571722987](https://github.com/Auto-Plugin/milkup/actions/runs/43571722987) showed Windows 2022 and 2025 each with one 1024×768 display, system/probe DPI 96. Those older observations did not bind complete display identity, session protocol and effective probe-window awareness. Earlier browser zoom or Linux GTK scale results are not Windows OS DPI evidence. The latest run addresses these specific measurement omissions rather than repeating installation tests.

## What the new native probe actually observed

Harness **bd6b9622b2acdcaeba5d7c2f18e7410952933310**, branch `dot/windows-display-preflight-20261115`; Windows image `win25-vs2026`, version `20261103.298.1`.

| Measurement | Original native result |
| --- | --- |
| Current / active console session | **2 / 2** |
| WTS client protocol / SM_REMOTESESSION | **0 (console) / false** |
| Thread and each owned window awareness | **Per-Monitor V2**, awareness **2** |
| Native topology | **one** `\\.\DISPLAY1`, bounds `[0,0,1024,768]` |
| Work area | `[0,0,1024,720]` |
| Adapter / attached display | **Microsoft Hyper-V Video / Generic PnP Monitor** |
| System DPI / owned window DPI | **96 / 96** |
| Independent OS scale factor | **100%** |
| Probe-window destruction / thread-awareness restoration | **true / true** |
| Errors | **none** |

The probe used `EnumDisplayMonitors`, `GetMonitorInfoW`, `EnumDisplayDevicesW`, `GetScaleFactorForMonitor`, `GetWindowDpiAwarenessContext` and `GetDpiForWindow`. It created only hidden owned windows on the observed monitor, verified their effective Per-Monitor V2 context, then destroyed them. Its temporary thread context was restored. It did not change a process or system DPI setting, send input, alter a display driver, activate a UI window or run Milkup. The probe caller was the hosted runner administrator, explicitly **not** a product ordinary-user token.

This distinction matters: an unaware window's `GetDpiForWindow` returns 96 regardless of its monitor; per-monitor-aware windows return their monitor DPI. [Microsoft API contract](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getdpiforwindow). Thus the result is a real single 100% topology observation, not a browser DPR override or an unverified DPI-awareness claim.

The classifier ran locally and on Windows with positive/negative fixtures: browser DPR/requested scale cannot create native DPI evidence; two distinct-DPI topologies authorize only a future transition test; missing awareness, inconsistent DPI/scale, duplicate monitor identity and incomplete cleanup reject evidence. Offline replay of the original JSON produced the same classification. This is not evidence that the application itself supports all those cases.

## Remaining quality gates and stop decision

| Requested gate | Evidence now | Status |
| --- | --- | --- |
| Window DPI and topology | Owned native probe has verified 96 DPI and one monitor | **Precondition only**, no Milkup HWND DPI capture |
| 125/150/200% OS-scale layout | No alternative native DPI was observed; no scale setting was changed | **Not run** |
| Menu, window controls, editing, scroll and Mermaid clipping under changed OS scale | Existing package is available, but no qualifying changed-scale environment is established | **Not run**, not inferred from old 100% or browser results |
| Different-DPI cross-monitor move | Only one native monitor | **Blocked by observed topology** |
| Normal application close at changed DPI | No product launched in this preflight | **Not run**; the prior package's normal close remains separately accepted |

Following the requested single-monitor stop condition, no product installation or synthetic high-DPI run followed. Settings executable presence is **not** proof that changing scale is offered, works without logoff, or is safe in a newly created ordinary-account session. Conversely, this is a **console** session: the Microsoft RDP restriction article must not be used to claim RDP blocked this runner. Single-screen OS scale switching remains untested, not disproved.

Microsoft's desktop DPI guidance identifies moving between different-scale displays, changing OS scale and connecting from differently scaled remote desktops as distinct scenarios. [Official DPI guidance](https://learn.microsoft.com/en-us/windows/win32/hidpi/high-dpi-desktop-application-development-on-windows). A future real test must record the candidate's PID+creation time+image, its own HWND DPI before/after, monitor identities, real input and UI geometry, decoded diagram clipping, document hashes and normal exit. A browser emulation factor or injected `WM_DPICHANGED` is not an acceptable substitute.

## Dedicated environment and offline path

Read-only GitHub capability checks returned:

- Repository self-hosted runner list: **403**, `Resource not accessible by integration`. This is an access limitation, not proof that no runner exists.
- Organization hosted-runner list: **404**, `GitHub hosted runners are not supported for this organization`. No paid/custom runner was created or configured.

GitHub documents that organization/enterprise owners manage larger runners and can select available Windows desktop/custom images; that alone does not promise a multi-DPI display topology. [Official runner management](https://docs.github.com/en/actions/how-tos/manage-runners/larger-runners/manage-larger-runners). The smallest useful new environment is an authorized dedicated Windows interactive test desktop with an initialized ordinary user and real OS scaling. For cross-screen acceptance it must expose **two actual displays with different native DPIs**. Run the native preflight there before reusing the exact existing installer. Access to such a runner/environment must be supplied by its owner; none was configured here. A supported isolated RDP session may help single-scale testing, but only after verifying resulting native DPI; it does not automatically establish two-display behavior. [Official RDP display properties](https://learn.microsoft.com/en-us/azure/virtual-desktop/rdp-properties#display-settings).

Non-invasive offline-path inventory in the same run found:

- existing WebView2 **156.0.4314.58**;
- hypervisor present, `mstsc.exe` present;
- `vmconnect.exe` absent;
- no VHD/VHDX images in the two known CI provisioning roots;
- Settings executable present, but not opened;
- no guest started, Runtime removed, network adapter disabled or security policy changed.

Prior [43573109537](https://github.com/Auto-Plugin/milkup/actions/runs/43573109537) could start and remove an owned blank no-disk/no-network VM. It explicitly recorded `guestOsBooted=false` and no provided guest image. That result is preserved, not rerun or upgraded to Windows/offline-install acceptance. The current inventory does not prove that no image exists anywhere; it means no usable Windows guest has been established through the inspected facilities.

The original **b877** offline installer is still locally readable: 225,032,492 bytes, SHA-256 **bf6ae351d874dd51e38d981afca86338d790d331098d3ce98cb45dca828150d0**, matching its retained receipt. This is an older candidate, not an offline build of 8e0ce998. No new offline package was built and no missing-Runtime or network-isolated installation was claimed. Progress on that path requires a licensed/authorized clean Windows guest with enough resources and a verifiably absent Runtime, created independently of the existing host Runtime; it cannot be manufactured by deleting the hosted runner's Runtime.

## Execution and retention

No equivalent active task existed at dispatch. The initial new workflow filename was not registered (HTTP 404) and created **no run**. The existing manual `release-gap-native-capabilities.yml` entry was then used only on this isolated branch for the single five-minute-bounded run above. No main workflow, necessary CI, account notification or production configuration changed. No Release or main merge occurred.

Artifact **14148543463**, 1,250 bytes, SHA-256 **1efe0a711145fb83870251e9319f6e74425b3b86f12598041d15be33cc578882**, expires `2026-11-22T05:38:43Z`. Original ZIP bytes, CRC and path-bounded extraction were verified. Workspace evidence is `/workspace/milkup-display-prerequisites-43681940229` (temporary): original ZIP/JSON, independent classification, run/jobs metadata and workflow log. No screenshots, real user documents, credentials or raw traces were collected.

Private persistent copy: Library `libfile_fde3_f-3861acff93ac819184a90b510f4fbe82_0ca5afc9150881919eb83108db749c2b`, `/milkup-windows-display-prerequisites-43681940229.zip`, version 0, **18,118 bytes**, SHA-256 `b4dda6b32b883c9a9d2c5027e3a15c5c36d2839d53ac62ef95368f78a86571aa`. Save succeeded and local identity metadata was applied. Contains original artifact and textual evidence/report before this retention paragraph. No additional CI run followed.
