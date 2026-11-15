#!/usr/bin/env bash
set -euo pipefail
test "$(id -u)" != 0
test "${GITHUB_ACTIONS:-}" = true
mkdir -p "$RUNNER_TEMP/private-cups-downloads" "$RUNNER_TEMP/private-cups-tools" "$RUNNER_TEMP/linux-native-evidence/tools"
cd "$RUNNER_TEMP/private-cups-downloads"
# Download/extract official packages only. In particular, never execute the
# cups-daemon package maintainer scripts or start/modify a system print service.
apt-cache depends --recurse --no-recommends --no-suggests --no-conflicts --no-breaks --no-replaces --no-enhances cups-daemon cups-client cups-common cups-ipp-utils cups-filters-core-drivers > dependency-closure.txt
python3 - <<'PY'
from pathlib import Path
import re,subprocess,json
names={'cups-daemon','cups-client','cups-common','cups-ipp-utils','cups-filters-core-drivers'}
for line in Path('dependency-closure.txt').read_text().splitlines():
    if re.fullmatch(r'[a-z0-9][a-z0-9+.-]+',line) and line.startswith('lib'):
        names.add(line)
assert len(names)<160
Path('download-names.json').write_text(json.dumps(sorted(names),indent=2))
subprocess.run(['apt-get','download',*sorted(names)],check=True,timeout=180)
PY
for package in ./*.deb; do dpkg-deb --extract "$package" "$RUNNER_TEMP/private-cups-tools"; done
sha256sum ./*.deb > "$RUNNER_TEMP/linux-native-evidence/tools/downloaded-package-sha256.txt"
cp dependency-closure.txt download-names.json "$RUNNER_TEMP/linux-native-evidence/tools/"
curl --fail --location --max-time 60 https://github.com/OpenPrinting/cups/releases/download/v2.4.10/cups-2.4.10-source.tar.gz --output cups-source.tar.gz
echo 'd75757c2bc0f7a28b02ee4d52ca9e4b1aa1ba2affe16b985854f5336940e5ad7  cups-source.tar.gz' | sha256sum --check
tar xzf cups-source.tar.gz
cd cups-2.4.10
# Official build-time option; no source patch, no DNS-SD/system bus required.
./configure --with-dnssd=no --disable-shared --disable-gssapi --disable-pam --prefix="$RUNNER_TEMP/private-cups-unused-prefix" > "$RUNNER_TEMP/linux-native-evidence/tools/configure.txt" 2>&1
make -C cups -j2 libcups.a > "$RUNNER_TEMP/linux-native-evidence/tools/build.txt" 2>&1
make -C tools -j2 ippeveprinter >> "$RUNNER_TEMP/linux-native-evidence/tools/build.txt" 2>&1
sha256sum tools/ippeveprinter > "$RUNNER_TEMP/linux-native-evidence/tools/receiver-sha256.txt"
cp config.h "$RUNNER_TEMP/linux-native-evidence/tools/receiver-config.h"
