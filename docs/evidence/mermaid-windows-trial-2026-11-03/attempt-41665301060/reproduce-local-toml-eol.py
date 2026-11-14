#!/usr/bin/env python3
"""Local-only model: exact CLI serialization and isolated Git newline treatment."""
from pathlib import Path
import datetime, hashlib, json, os, platform, subprocess, tempfile, tomllib
BASE = Path(__file__).resolve().parent
ROOT = Path((BASE / 'local-eol-experiment-root.txt').read_text().strip())
BINARY = ROOT / 'target/debug/mermaid-toml-eol-repro'
ENV = {**os.environ, 'GIT_CONFIG_SYSTEM': '/dev/null', 'GIT_CONFIG_GLOBAL': '/dev/null'}

def command(args, cwd=ROOT):
    p = subprocess.run(args, cwd=cwd, env=ENV, capture_output=True)
    record = {'args': args, 'exitCode': p.returncode, 'stdout': p.stdout.decode('utf-8'), 'stderr': p.stderr.decode('utf-8')}
    if p.returncode:
        raise RuntimeError(record)
    return record

def git(repo, *args):
    return command(['git', '-c', 'core.hooksPath=/dev/null', *args], repo)

def proof(data):
    return {'sha256': hashlib.sha256(data).hexdigest(), 'bytes':len(data),
        'crlf':data.count(b'\r\n'), 'lf':data.count(b'\n'),
        'bareLf':data.count(b'\n')-data.count(b'\r\n'),
        'bareCr':data.count(b'\r')-data.count(b'\r\n')}

candidate=(BASE/'candidate-Cargo.toml.txt').read_bytes()
assert b'\r' not in candidate
original_lock=tomllib.loads((BASE/'tauri-cli-2.11.4-Cargo.lock.txt').read_text())
actual_lock=tomllib.loads((ROOT/'Cargo.lock').read_text())
lookup={(p['name'],p['version']):p for p in original_lock['package']}
packages=[]
for p in actual_lock['package']:
    if p['name']=='mermaid-toml-eol-repro': continue
    source=lookup[(p['name'],p['version'])]
    assert p.get('checksum')==source.get('checksum') and p.get('source')==source.get('source')
    packages.append({k:p[k] for k in ('name','version','checksum')})
edit=next(p for p in packages if p['name']=='toml_edit')
assert edit['version']=='0.25.4+spec-1.1.0'
assert edit['checksum']=='7193cbd0ce53dc966037f54351dbbcf0d5a642c7f0038c382ef9e677ce8c13f2'
archive=next(Path('/workspace/.cargo/registry/cache').glob('*/toml_edit-0.25.4+spec-1.1.0.crate'))
assert proof(archive.read_bytes())['sha256']==edit['checksum']

cases=[]
for explicit_lf in (False,True):
    name='explicit-lf' if explicit_lf else 'autocrlf-default'
    repo=Path(tempfile.mkdtemp(prefix=name+'-',dir=ROOT))
    git(repo,'init','-q')
    for key,value in (('core.autocrlf','true'),('user.name','Local model'),('user.email','local-model@example.invalid')):
        git(repo,'config','--local',key,value)
    path=repo/'Cargo.toml'
    path.write_bytes(candidate)
    if explicit_lf:
        (repo/'.gitattributes').write_bytes(b'Cargo.toml text eol=lf\n')
    add=git(repo,'add','.')
    git(repo,'commit','-qm','Local clean baseline')
    # Force an actual checkout conversion, rather than accepting the stat cache.
    path.unlink()
    checkout=git(repo,'checkout-index','--index','--all','--force')
    baseline=path.read_bytes()
    initial_status=git(repo,'status','--porcelain=v1','--untracked-files=all')
    assert initial_status['stdout']=='',initial_status
    assert proof(baseline)['crlf']==(0 if explicit_lf else proof(candidate)['lf'])
    before_attrs=git(repo,'ls-files','--eol','--','Cargo.toml')
    (BASE/(name+'-baseline-Cargo.toml.txt')).write_bytes(baseline)
    rewrite=command([str(BINARY),str(path)])
    rewritten=path.read_bytes()
    # Capture raw status before asking Git for content-diff comparison.
    first_status=git(repo,'status','--porcelain=v1','--untracked-files=all')
    after_attrs=git(repo,'ls-files','--eol','--','Cargo.toml')
    diff=git(repo,'diff','--no-ext-diff','--','Cargo.toml')
    (BASE/(name+'-serialized-Cargo.toml.txt')).write_bytes(rewritten)
    normalize=lambda value:value.replace(b'\r\n',b'\n')
    assert normalize(baseline)==normalize(rewritten)
    assert proof(rewritten)['crlf']==0 and rewritten==candidate
    repeated=command([str(BINARY),str(path)])
    second=path.read_bytes()
    repeated_status=git(repo,'status','--porcelain=v1','--untracked-files=all')
    assert second==rewritten
    if explicit_lf:
        assert initial_status['stdout']==first_status['stdout']==repeated_status['stdout']==''
    cases.append({'name':name,'repository':str(repo),'config':git(repo,'config','--local','--list'),
        'initialAdd':add,'forcedCheckout':checkout,'baseline':proof(baseline),
        'baselineStatus':initial_status,'baselineEol':before_attrs,'firstSerialization':rewrite,
        'serialized':proof(rewritten),'rawBytesChanged':baseline!=rewritten,
        'normalizedContentEqual':normalize(baseline)==normalize(rewritten),
        'statusAfterSerialization':first_status,'eolAfterSerialization':after_attrs,
        'diffAfterSerialization':diff,'secondSerialization':repeated,
        'secondRawBytesUnchanged':second==rewritten,'statusAfterSecondSerialization':repeated_status})
report={'schema':1,'kind':'local-causal-model-not-original-Windows-raw-evidence',
    'createdAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'platform':platform.platform(),'gitVersion':command(['git','--version'])['stdout'].strip(),
    'candidateCommit':json.loads((BASE/'run.json').read_text())['headSha'],
    'relatedRunUrl':json.loads((BASE/'run.json').read_text())['url'],
    'originalRunnerRawManifestAvailable':False,'candidateInput':proof(candidate),
    'cliManifestSource':proof((BASE/'tauri-cli-2.11.4-manifest.rs.txt').read_bytes()),
    'cliCargoLock':proof((BASE/'tauri-cli-2.11.4-Cargo.lock.txt').read_bytes()),
    'experimentSource':proof((ROOT/'src/main.rs').read_bytes()),
    'experimentCargoLock':proof((ROOT/'Cargo.lock').read_bytes()),
    'dependencyVersionsAndChecksumsMatchCliLock':True,'dependencies':packages,
    'serializedUsingExactCliFunction':True,'experimentDoesNotCallInjectFeatures':True,
    'cases':cases,'productWorktreeMutated':False,'remoteTasksTriggered':False,
    'conclusion':{'crlfSerializedToLf':cases[0]['rawBytesChanged'],
        'normalizedContentUnchanged':all(c['normalizedContentEqual'] for c in cases),
        'defaultAutocrlfStatusModifiedDespiteEmptyDiff':bool(cases[0]['statusAfterSerialization']['stdout']) and not cases[0]['diffAfterSerialization']['stdout'],
        'explicitLfRemainedClean':not cases[1]['statusAfterSecondSerialization']['stdout']}}
(BASE/'local-toml-eol-reproduction.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
for src,name in ((ROOT/'src/main.rs','local-eol-main.rs.txt'),(ROOT/'Cargo.toml','local-eol-Cargo.toml.txt'),(ROOT/'Cargo.lock','local-eol-Cargo.lock.txt')):
    (BASE/name).write_bytes(src.read_bytes())
print(json.dumps(report['conclusion'],indent=2))
