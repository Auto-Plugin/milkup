# Locked 2.54.2 dependency audit before the corrected TU run

The full official tar stream was hashed as `a76345b391bef6211fb5ab6cfab2e86b285d18cda17cbb9ade595f1252b86065`. We scanned 229 CMake inputs (1,685,722 bytes); the ZIP preserves 91 files containing dependency, option, or failure declarations. `source-lock.json` binds every scanned file and the retained ZIP. No full local build/extraction was attempted.

The comparison uses the original `43847602183` configure log and `installed-package-inventory.log` inside its retained, hash-verified ZIP. It distinguishes a prior real CMake discovery from package inventory only. It is not a claim that the new CMake configuration succeeds.

| Active path / requirement | Previous runner evidence | Action |
| --- | --- | --- |
| OptionsGTK unconditional GLib/GioUnix/Thread/Module, Cairo, Gcrypt, Soup3, Tasn1, HarfBuzz ICU, ICU data/i18n/uc, JPEG, Epoxy, XML2, PNG, SQLite3, Threads, zlib, WebP/demux | Actual CMake discovery succeeds; minimum versions satisfied | Retain exact feature profile and CMake checks |
| GTK3 and gtk-unix-print | Actual 3.24.52 discovery succeeds | Keep generated printing/API 4.1 assertions |
| Enabled Manette, XSLT, Secret, introspection, DRM/GBM, Flite, Enchant, X11, Wayland/protocols, JPEGXL, Hyphen, FreeType, AVIF, Journald, LCMS, backtrace | Actual discovery succeeds; FreeType WOFF2 capability test succeeds | No new package or feature suppression |
| Bubblewrap sandbox: seccomp, bwrap >=0.3.1, xdg-dbus-proxy | CMake passed this section before GStreamer; inventory seccomp 2.6.0, bwrap 0.11.1, proxy 0.1.7 | Preserve sandbox; record executable identity/version |
| GStreamer app/pbutils/video/mpegts/tag/gl/audio/fft >=1.18.4 | All required components found at 1.28.2 except MPEGTS | ec26fdae adds official libgstreamer-plugins-bad1.0-dev; retained official .pc/deb inspection and negative metadata tests; fail early on actual pkg-config resolution |
| Skia Fontconfig >=2.13, FreeType >=2.9; WebP mux when USE_SKIA_ENCODERS; Expat when default-on USE_SKIA_OPENTYPE_SVG | FreeType discovery passed. SDK inventory has fontconfig-dev 2.17.1, webp-dev 1.5.0, expat-dev 2.7.4; later CMake checks not yet executed | Add actual pre-configure pkg-config checks for fontconfig/expat/libwebpmux, leave original CMake checks intact |
| Source system sysprof-capture | SDK inventory libsysprof-capture-4-dev 50.0 | Add actual pkg-config check; original CMake still required |
| Common generators: Perl >=5.10 + English/FindBin/JSON::PP, Python, Ruby >=2.5 | Actual discovery: Perl 5.40.1, Python 3.14.4, Ruby 3.3.8 | Retain checks |
| Post-OptionsGTK gperf >=3.0.1, optional system unifdef path | SDK inventory gperf 3.3 and unifdef 2.12; later CMake not yet reached | Record actual executable hashes/versions; no unsupported tool fallback |

Explicitly excluded from the active requirement list: other ports, bundled ANGLE CTS tests, mimalloc standalone tests; OpenMP absent from this profile; USE_GSTREAMER_FULL is not selected; GTK disables WebRTC by default (prior log confirms), so its OpenSSL/Rice path is inactive; Spiel is off while Flite is on; Vulkan/OpenXR/Thunder are conditional and not selected in the unchanged profile. gi-docgen is not required with documentation off. Missing optional GStreamer discovery components alone are not treated as required failures.

No further **concrete missing package** was found. Package presence is weaker than successful CMake link metadata, so the downstream checks now execute on the runner before expensive configuration. Full generated options/configuration remain authoritative. The runner's PATH CMake was 4.4 despite APT's 4.2.3 package; this is recorded by resolved executable hash and version, not silently substituted or blamed without evidence.

The next run remains manual, one 30-minute job, 1,560-second work deadline and evidence reserve. It only configures, generates strictly inspected headers, and compiles the 10 changed source files' actual TUs. No old cache, full engine target, runtime install, PDF or application claim.
