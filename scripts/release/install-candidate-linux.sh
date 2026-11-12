#!/usr/bin/env bash
set -euo pipefail
# Ephemeral runner install/remove only. No GUI, OS IME or fidelity claim.
test "${GITHUB_ACTIONS:-}" = true
test "${RUNNER_OS:-}" = Linux
candidate_dir=$1
candidate_sha=$2
evidence_dir=$3
test ! -e "$evidence_dir"
mkdir "$evidence_dir"
status=failed
trap 'printf "%s\n" "$status" > "$evidence_dir/status.txt"' EXIT
node scripts/release/verify-candidate.mjs "$candidate_dir" "$candidate_sha" linux-deb > "$evidence_dir/verified-receipt.json"
installer_path=$(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).installer.path' "$evidence_dir/verified-receipt.json")
package_name=$(dpkg-deb --field "$installer_path" Package)
case "$package_name" in milkup|milkup-desktop) ;; *) exit 1;; esac
if dpkg-query --status "$package_name" >/dev/null 2>&1; then
  echo 'Candidate must not replace an existing package' >&2
  exit 1
fi
printf '# Keep this document\n\n中文与 emoji 😀\n' > "$evidence_dir/document.md"
sha256sum "$evidence_dir/document.md" > "$evidence_dir/document.sha256"
sudo apt-get install -y --no-install-recommends "$installer_path" 2>&1 | tee "$evidence_dir/install.log"
dpkg-query --show --showformat='${Package} ${Version} ${Status}\n' "$package_name" > "$evidence_dir/installed-package.txt"
test -x /usr/bin/milkup-desktop
sha256sum /usr/bin/milkup-desktop > "$evidence_dir/installed-binary.sha256"
sudo dpkg --remove "$package_name" 2>&1 | tee "$evidence_dir/uninstall.log"
test ! -e /usr/bin/milkup-desktop
sha256sum --check "$evidence_dir/document.sha256" > "$evidence_dir/document-after.txt"
printf 'Install/remove and fixture preservation only; GUI/upgrade/offline/rollback not run.\n' > "$evidence_dir/boundary.txt"
status=passed
