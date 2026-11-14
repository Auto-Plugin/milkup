# Alternative Linux runner prerequisite checks — 2026-11-14

**Two alternative runners passed native sandbox navigation. Exact-package GUI/PDF
acceptance remains blocked by private package transfer permissions, not by a claim
that every available Linux runner fails.** No full product build was repeated.

## Selection and bounded execution

Existing repository distribution workflows use only Ubuntu 24.04. Its prior
ordinary-user WebKit failure is preserved in `linux-native-2026-11-14.md`.
GitHub currently documents x64 Ubuntu 22.04, 24.04 and 26.04 labels. Ubuntu 26.04
is generally available; 22.04 is in deprecation until April 17, 2027. We explicitly
selected 26.04 and 22.04 instead of testing `ubuntu-latest` as another environment.
ARM cannot run the x64 deb; the slim unprivileged container is not the desktop VM
candidate. No custom/self-hosted machine was touched.

Sources checked:
- https://docs.github.com/en/actions/how-tos/write-workflows/choose-where-workflows-run/choose-the-runner-for-a-job
- https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2604-Readme.md
- https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2204-Readme.md
- https://github.com/actions/runner-images/issues/14254

The original b877 deb is 9,845,776 bytes, SHA-256
`36c4873d840a06e85bf08398e119f9ddb494c813727eff6479aa4e434141f86e`.
Extracted executable SHA-256:
`b0ad7dd598e13266aa0ba808712445ec37f1bbc58c426fbb8b7a11c193a75cef`.
ELF requirements explicitly include GTK 3, WebKitGTK 4.1, JavaScriptCoreGTK 4.1
and libsoup 3. `GLIBC_2.39` is a **WEAK** version requirement associated with weak
`pidfd_spawnp`/`pidfd_getpid` symbols. The highest strong GLIBC requirement is
**2.34**. The initial coarse 2.39 gate incorrectly skipped 22.04 in run
43557327960; that skip is invalid evidence of incompatibility. Commit 9cba0016
corrected the gate and ran the previously unexecuted 22.04 probe. No actual
sandbox test was repeated on either alternative.

| Environment | Exact probe candidate/run | Runtime and result |
| --- | --- | --- |
| Ubuntu 26.04.1, image 20261111.196.1 | 151f6aaecfb028743191902874032cd2f2a405f0 / [43557327960](https://github.com/Auto-Plugin/milkup/actions/runs/43557327960) | glibc 2.43, WebKitGTK 2.52.6, GTK 3.24.52; sandbox navigation passed, exit 0 |
| Ubuntu 22.04.5, image 20261111.360.2 | 9cba0016479b65a08f0437281f051196f28c2fb1 / [43557393425](https://github.com/Auto-Plugin/milkup/actions/runs/43557393425) | glibc 2.35, WebKitGTK 2.50.4; sandbox navigation passed, exit 0 |

Both ran as uid 1001, with ephemeral WebKit context, sandbox explicitly enabled,
JavaScript disabled and only generated local HTML. No root GUI execution,
AppArmor/user-namespace/sysctl edits, sandbox-disabling environment variables,
firewall or default-printer changes were used. Official Ubuntu GUI dependencies
were installed on the ephemeral CI VM only.

Both logs contain `WEBKIT_SANDBOX_NAVIGATION_PASSED sandbox=1 uri=about:blank`.
Notably, 26.04 still reported `apparmor_restrict_unprivileged_userns=1` and a plain
`unshare -Ur true` failed, yet WebKit's actual sandbox navigation passed. Therefore
the plain unshare test alone cannot classify WebKit availability. We do not infer
which package-specific policy permits the successful path without separate proof.

Both GTK enumerations completed with exactly one printer: **Print to File**,
`virtual=true`, `active=true`, `acceptsPdf=true`, `default=false`. CUPS server/client,
ippeveprinter and ipptool were absent. No queue or job was created. There is no
non-virtual IPP selection/submission/received-content proof.

## Exact-package handoff blocker

Original GitHub artifact 13926127345 now returns HTTP 404. The original local deb
was saved privately to Library, downloaded back using the official transfer
helper, and its exact SHA-256 reverified. This preserves the original bytes; it is
not a rebuild or public release.

To deliver those bytes privately to isolated CI, a temporary repository Actions
secret was attempted. The prerequisite request
`GET /repos/Auto-Plugin/milkup/actions/secrets/public-key` returned **HTTP 403,
Resource not accessible by integration**. The secret was not created and no
package download occurred in CI. No account credentials were exported, and no
private signed download URL was committed, logged, or placed in public inputs.
The operation was not retried or bypassed. Available GitHub connector tools
support artifact download but expose no artifact-upload or secret-management path.

Consequently the exact b877 package's loader/runtime compatibility, real open,
edit/save, normal close and production PDF content/pagination have **not run**.
The source code and original binary were not changed. Ubuntu 26.04 is the preferred
next environment once an authorized private CI transfer route is available;
22.04 also passed the prerequisite but is deprecated. Stop here rather than
repeating builds, weakening security or publicly exposing the package/link.

## Evidence

Raw reports are checked in under the adjacent `linux-alternative-2026-11-14/`
directory. Original archive checks included API SHA-256, exact length, ZIP CRC
and safe member paths:

- [26.04 artifact 14098947592](https://github.com/Auto-Plugin/milkup/actions/runs/43557327960/artifacts/14098947592): 4,251 bytes; SHA-256 `1c7df2f52ddc6bffef565bad4e48e028f5374a67cf2417ac7cfdf157a66dfb0d`; expires 2026-11-21 04:35:55 UTC.
- [22.04 artifact 14098678628](https://github.com/Auto-Plugin/milkup/actions/runs/43557393425/artifacts/14098678628): 4,132 bytes; SHA-256 `d55ffbab48fe0695fd7e39c4cc1419e77bb418549ed59adb14c24eaf649a8afe`; expires 2026-11-21 04:36:54 UTC.

Local archive copies are `/workspace/milkup-linux-alternative-<artifact-id>/` and
are temporary workspace storage. No GUI, PDF, physical printing or fidelity pass
is inferred from a successful prerequisite workflow. No release was published.
