# Fixed Mermaid prototype: first Windows execution

The bounded prototype was executed on Windows, but **no diagram reached WebView2**. The suspended child's `TokenElevation=true` failed the prototype's explicit admission check. This is an environment/admission blocker, not evidence that Mermaid or AppContainer rendering is broken. The prototype remains separate from the product; no integration or release is authorized by this result.

## Exact run and preserved evidence

- Source: [`5a77d939f5ca83c096f273f21b652f0f8f9328bd`](https://github.com/Auto-Plugin/milkup/commit/5a77d939f5ca83c096f273f21b652f0f8f9328bd), author and committer LarryZhu-dev `<larryzhu@foxmail.com>`.
- Run: [39893819391](https://github.com/Auto-Plugin/milkup/actions/runs/39893819391), job `120219481592`, 2026-10-23 03:13:09–03:15:09 UTC, conclusion **failure**.
- Artifact: [12475642607](https://github.com/Auto-Plugin/milkup/actions/runs/39893819391/artifacts/12475642607), 101,689 bytes, expires 2026-10-24 03:15:03 UTC. ZIP SHA-256: `c0c56887adab45d0efb78a65177b2fa07d81c43687f674450beadbe8bff41ac9`.
- The ZIP digest, CRCs, extraction paths and file types were checked after download. Original ZIP, complete 50-case report, build/run log, compiler/executable metadata and root verification are preserved under [evidence/windows-run-39893819391](evidence/windows-run-39893819391/SHA256SUMS). No PNG was produced.
- Existing compiler: Rust 1.99.1, `x86_64-pc-windows-msvc`. Existing WebView2: `155.0.4283.62`. Locked dependency fetch, Windows compilation/linking and all four Rust tests passed. No compiler or Runtime installation occurred.

The normal CLI artifact redirect returned HTTP Forbidden. The GitHub connector successfully read the same artifact; its returned download reference was materialized locally and verified against the GitHub artifact digest. No second test run, new upload destination or arbitrary downloaded executable was used.

## Actual execution boundary

All 50 cases reported the same suspended-child admission failure. Each child had:

- `isAppContainer=true`, zero capabilities, the expected per-case package SID, low integrity RID 4096;
- `SeDebugPrivilege` absent;
- `TokenElevation=true`, elevation type 1, and Administrators group attributes 15.

The host was the existing elevated `runneradmin` account, with Administrators membership and SeDebugPrivilege already enabled. The prototype only observed these fields; it did not enable/disable privileges, replace tokens, switch accounts, request elevation, change UAC/firewall, or modify existing system/Runtime ACLs.

The conjunction rejects the elevated flag even though the other recorded AppContainer and Job facts matched. All 50 stopped **before `ResumeThread`**, before execution-ancestry access probes, before helper ready, before WebView2 initialization, and before diagram text delivery. Therefore:

| Evidence                                                   | Result                                 |
| ---------------------------------------------------------- | -------------------------------------- |
| Native suspended AppContainer/process creation             | Observed for 50 cases                  |
| Job binding and one suspended helper per case              | Observed for 50 cases                  |
| Job empty after termination                                | Confirmed for 50 cases                 |
| Profile deletion and folder absence                        | Confirmed for 50 cases                 |
| Private tree deletion and no cleanup errors                | Confirmed for 50 cases                 |
| File access denial under the child identity                | Not reached                            |
| Actual WebView2/browser token and Job ownership            | Not reached                            |
| Official Mermaid rendering, PNG capture, visible pixels    | 0 cases; not reached                   |
| Four asserted negative/security cases plus one observation | Not reached; positive run failed first |
| Ordinary-user behavior                                     | Not verified                           |

The first run dispatched all 50 fixtures because cleanup was certain; it did not stop the matrix for this repeated admission failure. These are fifty repetitions of one environment failure, not fifty grammar failures. There was no unchanged-runner retry.

## Why the gate was retained

Microsoft documents AppContainer access to DACL-protected resources as the intersection of user/group access and AppContainer access. Thus the elevated flag or Administrators SID alone does **not** prove the container's file boundary was bypassed. However, the `TOKEN_ELEVATION` contract does not establish that this flag is meaningless or safe to ignore for this token. Type 1 means no linked token; it does not establish standard-user identity. The evidence does not justify silently removing the explicit admission condition. [AppContainer model](https://learn.microsoft.com/en-us/windows/win32/secauthz/implementing-an-appcontainer), [TOKEN_ELEVATION](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-token_elevation), [TOKEN_ELEVATION_TYPE](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ne-winnt-token_elevation_type).

To continue while retaining the current gate, the missing resource is an **existing nonadministrator, nonelevated Windows test context with WebView2 already installed**. GitHub's ordinary hosted Windows VMs use an administrator account with UAC disabled; choosing another such label is not evidence that this condition will change. Creating an account, changing a token or security setting, installing a Runtime, or registering a new runner/credential was not performed. [GitHub runner privileges](https://docs.github.com/en/actions/reference/runners/github-hosted-runners#administrative-privileges).

The known UDP/WebRTC residual network risk remains as disclosed before authorization. This run neither re-tested that risk nor established an OS-wide network guarantee. No installer ran, no user documents/computer were accessed, and no prototype was included in a product package.

## Coverage and size still needing a decision

The 50 positive fixtures cover the fixed full Mermaid 12.2.0 bundle's **37 built-in registration IDs**, with parser evidence and selected feature combinations. They are not exhaustive grammar coverage and now have **no successful Windows render evidence**. The official version-matched distribution also offers `@mermaid-js/mermaid-zenuml@1.0.1`, with `@zenuml/core` locked upstream to 3.49.2. That syntax family is absent from this prototype; its parse adapter is empty, so actual rendering is necessary. The public `tidy-tree` layout is another optional official module, `@mermaid-js/layout-tidy-tree@1.0.1`; it is a layout gap rather than a new diagram registration. ELK is already in the full 12.2.0 bundle. External icon packs are separate assets, not proof of additional syntax support. No additional module was installed or added in this checkpoint. [ZenUML manifest](https://github.com/mermaid-js/mermaid/blob/mermaid%4012.2.0/packages/mermaid-zenuml/package.json), [fixed upstream lockfile](https://github.com/mermaid-js/mermaid/blob/mermaid%4012.2.0/pnpm-lock.yaml), [ZenUML parse adapter](https://github.com/mermaid-js/mermaid/blob/mermaid%4012.2.0/packages/mermaid-zenuml/src/parser.ts), [version-matched layouts](https://github.com/mermaid-js/mermaid/blob/mermaid%4012.2.0/packages/mermaid/src/docs/config/layouts.md).

The linked Windows prototype executable is **7,673,344 bytes**, SHA-256 `7371274d1fecc3ecbdb771f58d337e0cd18a8a2fce5584a076c5ec8a1447b7f6`; only its metadata was uploaded. The fixed official script is 5,494,801 bytes; gzip level 9 produces 1,566,718 bytes. These are measurements of this unoptimized standalone experiment/script, **not an NSIS increment or final product package estimate**. Optional official modules and raster integration are not included.

The independent UI work is available at [`7cc4edc6747abf5fbc31b60cccf4bd73174af6f8`](https://github.com/Auto-Plugin/milkup/commit/7cc4edc6747abf5fbc31b60cccf4bd73174af6f8): host context actions, three-action plugin cap, floating toolbar, source/live race fix, full tests and Linux native evidence. Its Windows GUI behavior remains unverified. No new beta package is being presented as completing full Mermaid support.
