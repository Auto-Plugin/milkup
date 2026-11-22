"""Read exact SDK ELF/interpreter closure; never resolve libraries from the host.
Explicit ELF execution is permitted only after identity/ABI validation and a
real loader --list result exclusively within the SDK. Not a native app gate.
"""
from pathlib import Path
import argparse,hashlib,json,os,re,subprocess,sys
class Rejected(Exception):pass
def require(ok,msg):
 if not ok:raise Rejected(msg)
def digest(p):
 with p.open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
def prefix(p,n):
 with p.open('rb') as f:return f.read(n)
class Gate:
 def __init__(self,root,inventory):
  self.root=Path(root).resolve();self.inventory=inventory;self.cache={};self.files={};self.edges=[]
 def owned(self,p):
  p=Path(p);require(p.is_file(),'Missing input: '+str(p));r=p.resolve();require(r.is_relative_to(self.root),'Input escapes SDK: '+str(p))
  rel=str(r.relative_to(self.root));require(rel in self.inventory,'Unrecorded SDK file: '+rel);expected=self.inventory[rel]['sha256'];require(digest(r)==expected,'Changed package file: '+rel);self.files[rel]=expected;return r
 def target(self,path):
  require(path.startswith('/'),'Target path must be absolute');return self.owned(self.root/path.lstrip('/'))
 def elf(self,p):
  p=self.owned(p)
  if p in self.cache:return self.cache[p]
  require(prefix(p,4)==b'\x7fELF','Not ELF: '+str(p))
  t=subprocess.check_output(['/usr/bin/readelf','-W','-h','-l','-d','--version-info',str(p)],text=True,timeout=15)
  require('ELF64' in t and 'little endian' in t and 'Advanced Micro Devices X86-64' in t,'ELF architecture mismatch')
  needed=re.findall(r'Shared library: \[([^]]+)\]',t);inter=re.search(r'Requesting program interpreter: ([^\]]+)',t)
  paths=[]
  for kind,value in re.findall(r'\((RPATH|RUNPATH)\).*?\[([^]]*)\]',t):
   for v in value.split(':'):
    require(bool(v),'Empty search entry would admit cwd');v=v.replace('${ORIGIN}',str(p.parent)).replace('$ORIGIN',str(p.parent))
    if v.startswith(str(self.root)):q=Path(v).resolve()
    elif v.startswith('/'):q=(self.root/v.lstrip('/')).resolve()
    else:raise Rejected('Relative/unresolved RPATH: '+v)
    require(q.is_relative_to(self.root),'RPATH escapes SDK');paths.append(q)
  needs={};defs=set();section=None;soname=None
  for line in t.splitlines():
   if 'Version needs section' in line:section='needs';soname=None
   elif 'Version definition section' in line:section='defs'
   elif 'Version symbols section' in line:section=None
   if section=='needs':
    m=re.search(r'File: (\S+)',line)
    if m:soname=m.group(1);needs.setdefault(soname,set())
    m=re.search(r'Name: (\S+)',line)
    if m and soname:needs[soname].add(m.group(1))
   elif section=='defs':
    m=re.search(r'Name: (\S+)',line)
    if m:defs.add(m.group(1))
  result=dict(path=p,needed=needed,interpreter=inter.group(1) if inter else None,paths=paths,needs=needs,definitions=defs)
  self.cache[p]=result;return result
 def resolve(self,name,extra):
  require('/' not in name,'Path-valued DT_NEEDED rejected')
  dirs=extra+[self.root/'usr/lib/x86_64-linux-gnu',self.root/'lib/x86_64-linux-gnu',self.root/'usr/lib',self.root/'lib']
  for d in dirs:
   q=d/name
   if q.exists():return self.owned(q)
  raise Rejected('Missing target library (host fallback forbidden): '+name)
 def validate(self,path):
  first=self.target(path);queue=[first];visited=set();scripts=[]
  while queue:
   p=self.owned(queue.pop())
   if p in visited:continue
   visited.add(p);raw=prefix(p,512)
   if raw.startswith(b'#!'):
    line=raw.splitlines()[0][2:].decode().strip();parts=line.split();require(len(parts)==1,'env/argument shebang requires explicit audited interpreter policy');interp=self.target(parts[0]);queue.append(interp);scripts.append(dict(path=str(p),interpreter=str(interp)));continue
   e=self.elf(p)
   if e['interpreter']:queue.append(self.target(e['interpreter']))
   for n in e['needed']:
    q=self.resolve(n,e['paths']);provider=self.elf(q);missing=e['needs'].get(n,set())-provider['definitions'];require(not missing,'Unsatisfied symbol versions in '+n+': '+','.join(sorted(missing)));queue.append(q);self.edges.append(dict(consumer=str(p.relative_to(self.root)),needed=n,provider=str(q.relative_to(self.root))))
  return dict(status='static-closure-passed',program=path,files=self.files.copy(),edges=self.edges,scripts=scripts,hostFallback=False)
 def execute(self,path,args):
  receipt=self.validate(path);require(not receipt['scripts'],'Script runtime/module execution requires separate admission')
  exe=self.target(path);e=self.elf(exe);require(e['interpreter'],'Dynamic ELF interpreter required');loader=self.target(e['interpreter'])
  libraries=':'.join(str(self.root/d) for d in ['usr/lib/x86_64-linux-gnu','usr/lib'])
  env={'PATH':str(self.root/'usr/bin'),'LANG':'C','LC_ALL':'C'}
  loader_argv=[str(loader),'--inhibit-cache','--library-path',libraries]
  listing=subprocess.run(loader_argv+['--list',str(exe)],env=env,capture_output=True,text=True,timeout=15)
  require(listing.returncode==0,'Real loader resolution failed: '+listing.stderr)
  mapped=[]
  for line in listing.stdout.splitlines():
   if 'linux-vdso' in line:continue
   m=re.search(r'=>\s+(\S+)',line) or re.match(r'\s*(/\S+)',line)
   if m:
    val=m.group(1)
    # The ELF PT_INTERP path is printed by glibc using its conventional name;
    # require the explicit invoked SDK loader identity, never accept another host mapping.
    if val==e['interpreter'] and '=>' not in line:continue
    q=self.owned(Path(val));require(str(q.relative_to(self.root)) in receipt['files'],'Loader mapping differs from validated dependency closure');mapped.append(str(q))
  require(mapped,'No real loader dependency mapping')
  result=subprocess.run(loader_argv+['--argv0',str(self.root/path.lstrip('/')),str(exe),*args],env=env,capture_output=True,text=True,timeout=30)
  for rel,h in receipt['files'].items():require(digest(self.root/rel)==h,'Input changed during execution')
  return dict(receipt,executionExit=result.returncode,stdout=result.stdout,stderr=result.stderr,loaderSha256=digest(loader),loaderList=listing.stdout,mapped=mapped)
def main():
 a=argparse.ArgumentParser();a.add_argument('--root',required=True);a.add_argument('--inventory',required=True);a.add_argument('--program',required=True);a.add_argument('--execute',action='store_true');a.add_argument('args',nargs='*');x=a.parse_args()
 g=Gate(x.root,json.loads(Path(x.inventory).read_text()));r=g.execute(x.program,x.args) if x.execute else g.validate(x.program);print(json.dumps(r,indent=2))
if __name__=='__main__':main()
