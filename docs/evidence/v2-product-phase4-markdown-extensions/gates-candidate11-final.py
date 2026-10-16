"""Prepared only. After root GO: source /workspace/.cloud/milkup-v2/env.sh, then run with --execute.
Never overwrite a previous attempt. Candidate11 manifest must be frozen before execution.
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
EXECUTION = OUT / 'candidate11-final-gate-execution.json'


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
    assert MANIFEST.is_file(), f'Freeze {MANIFEST.name} first'
    manifest = json.loads(MANIFEST.read_text())
    manifest_sha = sha(MANIFEST)
    assert manifest['files'], 'Empty source manifest is not a gate'
    assert not changed(manifest), changed(manifest)
    assert not EXECUTION.exists(), f'Preserve previous execution: {EXECUTION}'
    browser_output = OUT / 'browser-candidate11-final'
    assert not browser_output.exists(), f'Preserve previous browser evidence: {browser_output}'
    steps = [
        ('unit', ['pnpm', 'test']),
        ('types', ['pnpm', 'typecheck']),
        ('build', ['pnpm', 'build']),
        ('format', ['pnpm', 'lint']),
        ('browser', ['pnpm', 'exec', 'playwright', 'test', '--workers=1', '--retries=0',
                     '--output=' + str(browser_output)]),
    ]
    logs = {name: OUT / (('browser-full' if name == 'browser' else 'full-' + name)
                        + '-candidate11-final.log') for name, _ in steps}
    assert not any(log.exists() for log in logs.values()), 'Previous gate logs must be preserved'
    results = []
    for name, command in steps:
        assert sha(MANIFEST) == manifest_sha, 'Frozen manifest itself changed'
        assert not changed(manifest), changed(manifest)
        started = now()
        with logs[name].open('x') as log:
            result = subprocess.run(command, cwd=ROOT, stdout=log, stderr=subprocess.STDOUT)
        changes = changed(manifest)
        results.append({'gate': name, 'command': command, 'log': logs[name].name,
                        'started': started, 'finished': now(), 'exitCode': result.returncode})
        report = {'manifest': MANIFEST.name, 'manifestSHA256': manifest_sha,
                  'sourceFiles': len(manifest['files']), 'steps': results,
                  'sourceChanges': changes, 'manifestChanged': sha(MANIFEST) != manifest_sha}
        EXECUTION.write_text(json.dumps(report, indent=2) + '\n')
        print(name, result.returncode, flush=True)
        if result.returncode or changes or report['manifestChanged']:
            raise SystemExit(result.returncode or 2)
    print('All five gates completed; frozen source verified.', flush=True)


if __name__ == '__main__':
    main()
