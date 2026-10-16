"""Prepared only. After root GO and five successful gates, source env.sh and use --execute.
Builds the local Linux DEB only. No upload, extraction, installation, or native UI execution.
"""
from pathlib import Path
import datetime
import hashlib
import json
import subprocess
import sys

ROOT = Path('/workspace/milkup')
OUT = Path('/workspace/milkup-markdown-extensions-phase4-evidence')
MANIFEST = OUT / 'candidate11-final-source-manifest.json'
GATES = OUT / 'candidate11-final-gate-execution.json'
LOG = OUT / 'linux-production-candidate11-final.log'
PROOF = OUT / 'candidate11-final-production-build.json'


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def changed(manifest):
    return [item['path'] for item in manifest['files']
            if not (ROOT / item['path']).is_file()
            or sha(ROOT / item['path']) != item['sha256']]


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def main():
    if sys.argv[1:] != ['--execute']:
        raise SystemExit('Prepared, not executed. Requires root GO and explicit --execute.')
    manifest = json.loads(MANIFEST.read_text())
    manifest_sha = sha(MANIFEST)
    gates = json.loads(GATES.read_text())
    assert gates['manifestSHA256'] == manifest_sha, 'Build must use the gated source manifest'
    assert [s['gate'] for s in gates['steps']] == ['unit', 'types', 'build', 'format', 'browser']
    assert all(s['exitCode'] == 0 for s in gates['steps']), 'All five gates must pass first'
    assert gates['sourceChanges'] == [] and gates['manifestChanged'] is False
    assert manifest['files'] and not changed(manifest), changed(manifest)
    assert not LOG.exists() and not PROOF.exists(), 'Previous build evidence must be preserved'
    command = ['pnpm', '--filter', '@milkup/desktop', 'tauri', 'build', '--bundles', 'deb']
    started = now()
    with LOG.open('x') as log:
        result = subprocess.run(command, cwd=ROOT, stdout=log, stderr=subprocess.STDOUT)
    proof = {'command': command, 'started': started, 'finished': now(),
             'exitCode': result.returncode, 'manifest': MANIFEST.name,
             'manifestSHA256': manifest_sha, 'gateExecutionSHA256': sha(GATES),
             'sourceChanges': changed(manifest), 'manifestChanged': sha(MANIFEST) != manifest_sha,
             'nativeAcceptanceExecuted': False, 'uploaded': False}
    PROOF.write_text(json.dumps(proof, indent=2) + '\n')
    print(json.dumps(proof, indent=2), flush=True)
    if result.returncode or proof['sourceChanges'] or proof['manifestChanged']:
        raise SystemExit(result.returncode or 2)


if __name__ == '__main__':
    main()
