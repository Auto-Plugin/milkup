"""Bounded, explicit evidence selection. Does not traverse profiles or dependencies."""
import gzip, hashlib, os, stat
from pathlib import Path
SOURCE = Path('/workspace/milkup-p7-quality-evidence/milestone01')
DEST = Path('/workspace/milkup/docs/evidence/v2-product-phase7-quality/milestone01')
ROOTS = {'browser-fixture-audit','validation','native-ui','input-a11y','environment','outline','build-tools','quality-harness-preflight','live-performance','baseline-production','performance-baseline','performance-candidate','performance-repeat','performance-candidate-03','quality-review-tools','archive-tools'}
EXTS = {'.json','.jsonl','.md','.log','.txt','.exit','.py','.mjs','.cjs','.ts','.sh','.patch','.diff','.yaml','.png','.html'}
DENIED_DIRS = {'node_modules','target','.git','__pycache__','runtime','candidate-runtime','profile','profiles','user-data','userdata','secrets','credentials','.aws','.ssh','.gnupg','install','installed','dist'}
RUNTIME_DIRS = {('native-ui','runtime'), ('native-ui','candidate-runtime')}
RUNTIME_FILES = {'run-env.sh','driver-control.py','driver.sh','README','README.md'}
EXACT_APPROVED_FILES = {
    'candidate-six-console-02.log', 'candidate-six-console.log',
    'candidate03-two-console.log', 'ordinary-source-pair-console.log',
    'browser-fixture-audit/second-startup/focused-artifacts/.last-run.json',
    'browser-fixture-audit/second-startup/focused02-artifacts/.last-run.json',
    'native-ui/runtime/xvfb-control.py',
}
TOOLS = {'common.py','archive.py','index.py','verify.py','README.md'}
LIMIT = 96*1024*1024

def safe_relative(value):
    p=Path(value)
    if p.is_absolute() or not p.parts or any(x in ('..','.') for x in p.parts): raise ValueError('Unsafe relative path')
    return p

def allowed(rel):
    parts=rel.parts; name=rel.name
    if rel.as_posix() in EXACT_APPROVED_FILES:
        return None
    if parts[:2] in RUNTIME_DIRS:
        return None if len(parts)==3 and name in RUNTIME_FILES else 'unreviewed runtime-directory member (not read)'
    if any(p in DENIED_DIRS or (p.startswith('.') and not (p=='.last-run.json' and parts[0]=='validation')) for p in parts): return 'private/runtime/cache or hidden artifact'
    lower=name.lower()
    if any(x in lower for x in ('credential','secret','token','cookie','password','private-key')) or lower.startswith('.env'): return 'sensitive filename'
    if parts[0] not in ROOTS and not parts[0].startswith('candidate-production-'): return 'unreviewed top-level directory'
    if parts[0]=='archive-tools': return None if len(parts)==2 and name in TOOLS else 'generated archive plan/report'
    if name.endswith('.milkup-plugin'): return None if name.startswith('milkup.outline-') else 'non-outline package'
    if rel.suffix=='.tgz': return None if parts[:3]==('outline','external-1.3.2','inputs') and 'vendor' in parts and name=='plugin-sdk-0.3.7.tgz' else 'unreviewed archive'
    if name=='plugin.js': return 'unpacked generated bundle (package retained)'
    if rel.suffix not in EXTS: return 'binary/build/work/lock or unreviewed extension'
    return None

def candidates():
    for root,dirs,files in os.walk(SOURCE,followlinks=False):
        here=Path(root)
        for d in list(dirs):
            p=here/d; rel=p.relative_to(SOURCE)
            if (here==SOURCE and d not in ROOTS and not d.startswith('candidate-production-')):
                dirs.remove(d); yield rel, 'unreviewed top-level directory (not read)', None
            elif p.is_symlink() or (d in DENIED_DIRS and rel.parts not in RUNTIME_DIRS) or d.startswith('.'):
                dirs.remove(d); yield rel, 'excluded subtree (not read)', None
        for name in sorted(files):
            p=here/name; rel=p.relative_to(SOURCE); s=p.lstat()
            reason=allowed(rel)
            if not stat.S_ISREG(s.st_mode): reason='not a regular file (not followed)'
            yield rel,reason,s.st_size

def digest(path):
    h=hashlib.sha256(); n=0
    with path.open('rb') as f:
        while b:=f.read(1024*1024): h.update(b); n+=len(b)
    return n,h.hexdigest()

class CountingSink:
    def __init__(self): self.count=0
    def write(self,b): self.count+=len(b); return len(b)
    def flush(self): pass

def gzip_size(path):
    sink=CountingSink()
    with gzip.GzipFile(filename='',mode='wb',fileobj=sink,mtime=0,compresslevel=6) as z, path.open('rb') as f:
        while b:=f.read(1024*1024): z.write(b)
    return sink.count

def compress_fixture(rel,size):
    if size < 128*1024:
        return False
    native_run = rel.parts[:2] == ('native-ui', 'runs')
    if native_run and len(rel.parts) == 4 and rel.name == 'samples.json':
        return True
    return rel.suffix == '.md' and (native_run or (rel.parts[0] == 'quality-harness-preflight' and rel.name in {'windowed-source.md','windowed-live.md','ordinary-source.md','ordinary-live.md'}))
