# Linux native GUI / printing prerequisite result — 2026-11-14

**Blocked before Milkup execution; no GUI, PDF or print acceptance pass.**

Branch: `dot/linux-native-acceptance-20261114`. Application baseline:
`b877746f5dfd236dfc13f718ed23d837b8e4f89d`. Only capability/test files were changed;
no application code, sandbox policy or printing configuration was changed.
Tested harness: `b1f952641367069febd5f0a4dcd87757eb3991cf`.

## Actual checks

The managed workspace is Debian 13, ordinary uid 1000, without Xvfb, GTK/WebKitGTK,
WebKitWebDriver, CUPS or ippeveprinter. DISPLAY and WAYLAND_DISPLAY were unset.
Environment metadata advertises an on-demand desktop but no desktop JavaScript
or viewer tool was available in this turn. This alone was not used to conclude
that an isolated CI runner could not work.

Read-only [run 43556782796](https://github.com/Auto-Plugin/milkup/actions/runs/43556782796)
used hosted Ubuntu 24.04.5, image 20261111.370.1, uid 1001. It found GTK 3 and Xvfb,
but no WebKitGTK, native driver, xdotool, CUPS server/client, ippeveprinter or
ipptool. Ordinary-user `unshare -Ur true` failed writing `/proc/self/uid_map`
with Operation not permitted. Both `kernel.unprivileged_userns_clone` and
`kernel.apparmor_restrict_unprivileged_userns` were 1. They were read, not changed.

[Run 43556889033](https://github.com/Auto-Plugin/milkup/actions/runs/43556889033)
installed the project's official Ubuntu GUI/build dependencies and test tools
using normal signed APT sources. Runtime installed: WebKitGTK
`2.52.6-0ubuntu0.24.04.1`, GTK `3.24.41-4ubuntu1.3`; Xvfb
`2:21.1.12-1ubuntu1.9`. No printing server/IPP tools were installed.

The small C prerequisite program successfully compiled and initialized GTK on a
private Xvfb display/session bus as uid 1001. It used an ephemeral WebKit context,
explicitly enabled and checked the sandbox, disabled JavaScript, and attempted
only a generated local HTML marker. It did not modify security settings or
set a sandbox-disabling environment variable. The actual attempt failed:

```text
bwrap: setting up uid map: Permission denied
Failed to fully launch dbus-proxy: Child process exited with code 1
```

Exit status: **133**. There was no successful navigation marker. Earlier EGL/DRI3
and accessibility-bus warnings are retained, but not asserted to be the cause.
The observed failure is sandbox process setup/UID mapping. Without audit-provider
evidence we do not attribute the denial to a specific AppArmor rule alone.
This is an environment prerequisite failure, not a tested Milkup application bug.

The retained original b877 Linux deb remains available locally: 9,845,776 bytes,
SHA-256 `36c4873d840a06e85bf08398e119f9ddb494c813727eff6479aa4e434141f86e`.
Its metadata and hash were rechecked; it was not executed or replaced/rebuilt
and that check does not establish GUI health.

## Explicitly not executed

- Milkup real open, edit/save and normal close.
- Production PDF output, content, geometry or pagination.
- GTK selection and non-virtual classification of an IPP queue.
- WebKit print submission, job ID, received content or negotiated format.
- Physical paper output or printer fidelity.

CUPS/ippeveprinter were absent even after GUI dependency installation. No queue,
printer default, firewall, sandbox or security policy was changed, and no user
machine or real document was touched. No release was published.

## Next executable prerequisites

Use an isolated Linux desktop/runner whose existing approved policy already lets
ordinary-user WebKitGTK create its sandbox. Run this same minimal navigation
probe first, then the exact candidate's production GUI, edit/save/normal-close
and PDF content/pagination tests using a disposable profile. Do not disable
WebKit's sandbox or relax host policy to manufacture a pass.

Only when existing CUPS/ippeveprinter facilities are available should a dedicated
isolated IPP queue be assessed. First verify GTK exposes it as selectable and
non-virtual, distinct from Print to File; then correlate a unique generated
marker with the WebKit submission, exact IPP job ID, received bytes and MIME
format. Receipt still would not prove physical output or fidelity.

## Evidence retention

[Original artifact 14098697454](https://github.com/Auto-Plugin/milkup/actions/runs/43556889033/artifacts/14098697454):
3,092 bytes; SHA-256
`433be58896c895c85054e7892c407884946a11a889e6210c29d866841bfdd29f`.
API digest, downloaded bytes, ZIP CRC and member paths were independently checked.
Expiry: **2026-11-21 04:30:25 UTC**. Selected original reports are committed beside
this document; local archive/extraction is
`/workspace/milkup-linux-native-results-43556889033/` and is temporary workspace
storage, not a durable archive claim. The original preflight and runtime failures
remain failures; no result is reclassified as GUI acceptance.
