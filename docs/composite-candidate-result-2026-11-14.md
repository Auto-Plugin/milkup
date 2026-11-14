# Composite candidate native result

Actual build SHA: `383c0712f21071467f2549d73a022b03db4b69aa`.
Application/packages/plugins/vendor/release/build inputs compare unchanged from
product candidate `46c754b8ca1012a42cf1ed6a7b72ad9cfc772b4f` (d8d2860b adds
documentation). This is a non-release, unsigned candidate; production update
configuration remains empty.

## Original packages and native evidence

Build run https://github.com/Auto-Plugin/milkup/actions/runs/43616134287 built
both exact packages. The run remains failed because its Windows smoke never
reached installation: its isolated child invoked `node` by PATH, absent from the
ordinary user's environment. Native PE tests did run: all five passed, including
the actual built installer and strict version rejection cases.

| Package | Bytes | SHA-256 |
| --- | ---: | --- |
| milkup-2.0.0-beta.10-windows-standard-383c0712f210.exe | 7256557 | `6fe28bcd235dc04993b1889f3c4bb5086e4e86cc2ad06da0172098ba1f974902` |
| milkup-2.0.0-beta.10-linux-deb-383c0712f210.deb | 9853866 | `8cd091ac83ffea06e2bac6c34ce3a9353047722fc0dbf7d64b1491341acfc860` |

Linux's original job passed its six selected steps: GTK preflight, ordinary-user
installed source/live Pinyin composition and deliberate same-text repeat,
punctuation/cancel, trusted-event contract, save and normal close/reopen. Both
product closes were normal, without forced termination. Final document SHA-256:
`592e75ec297d01998769e8b3ab2973f82919e487f939121a69d546c81dbfd575`.
This was scale 1, not a new full DPI or Windows IME matrix. No Linux rerun occurred.

## Windows correction and same-byte retest

Harness 81d089eb passes the parent-verified absolute Node path for InstallOnly
and uses the existing bounded native launcher. Local and Windows tests exercise
the actual branch and an empty-PATH subprocess. It retains hash/identity gates.

Reuse run 43622531829 at d9d418a0 verified the original installer and installed
successfully, then hit an independent StrictMode error: startup evidence read
`$debugPort` although RepairHealth was false. Its forced cleanup means that run
does not prove normal startup/close/uninstall. Fix dd6e003f only adds health fields
when health mode is active. Tests execute the actual evidence construction with
undefined health variables and check that repair diagnostics remain present.

Final narrow retest:
https://github.com/Auto-Plugin/milkup/actions/runs/43622992106
at harness `dd6e003f7a7b3235fb4f42190a464f512e264311` **passed**.
It downloaded original artifact 14122777302, verified its API/ZIP identity and
internal manifest/package hash, and did not rebuild or rerun PE/Linux acceptance.

Raw child and held-Job supervisor evidence independently confirm:

- Real pure-standard token, no Administrators membership/deny-only group,
  medium integrity, expected owned SID; parent environment not inherited.
- Installer exit 0; installed binary beta.10 SHA-256
  `5845ef28a2c27d87c2cd459c0c583e6f984b4323518408cd073288b6426cc433`.
- Exact process birth/image and unique visible Tauri root verified;
  launch-to-native-window 4145.1337 ms. This is not first paint, interactive
  readiness or Mermaid latency.
- Actual UI close exit 0, no forced cleanup. Actual owned uninstaller exit 0,
  application removed, document SHA-256 preserved
  `1f71a49833535bb3c521661aa7f434a9148b926171a54c8015193f422a7b7bf6`.
- Child exit 0, Job empty before outer cleanup, temporary account/profile/stage
  removed, cleanup errors empty. Outer cleanup does not substitute for app proof.

Final evidence artifact 14124613848, 9755-byte original ZIP, SHA-256
`713b3225a08559243c8e4378b47afe449377ca489f5fb422d9a508bb075c3cca`.
ZIP/hash/CRC and raw child/supervisor JSON were independently checked.

## Retention and limits

Original package artifacts 14122777302 and 14121749762 expire on 2026-11-21.
Verified original package bytes, non-screenshot raw evidence, PDF research outputs
and per-file SHA manifest are privately retained in Library file
`libfile_fde3_f-1e7082beca4481918bad749120210d66_0ca5afc9150881919eb83108db749c2b`.
Original downloaded ZIPs also exist in the task workspace; that workspace alone
is not durable retention. Private WebKit linked binaries were not uploaded by
their original workflow and are not in this bundle.

Windows scope is InstallOnly, despite the coordinator's historical repair-health
name. Same-version repair, new full editing/plugin checks, dual-account GUI,
Windows IME, missing-Runtime/offline provisioning and automatic rollback were not
run or claimed here. Earlier accepted update/repair evidence remains separate.
No production endpoint/key, runtime removal, security-policy/desktop-ACL change,
main merge or release occurred. The research WebKit patch is not in this product.
