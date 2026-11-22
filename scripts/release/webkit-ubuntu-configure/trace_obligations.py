"""Bind unresolved static sites to complete actual CMake trace; never turn a
missing/partial trace into a successful configuration claim."""
from pathlib import Path
import json,hashlib

def _digest(path):
 with path.open('rb') as stream:return hashlib.file_digest(stream,'sha256').hexdigest()

def classify(obligations,trace,source,sdk,*,configure_succeeded):
 assert trace.is_file() and 0<trace.stat().st_size<=64*1024**2,'Bounded actual trace required'
 sites={};version=False
 with trace.open() as f:
  for line in f:
   assert len(line)<=2*1024**2,'Trace record too large';r=json.loads(line)
   if 'version' in r:
    assert not version and r['version'].get('major')==1;version=True;continue
   assert version and isinstance(r.get('args'),list) and isinstance(r.get('file'),str) and isinstance(r.get('line'),int),'Malformed actual trace'
   raw=Path(r['file']);logical=r['file']
   if raw.is_relative_to(source):logical='/source/'+str(raw.relative_to(source))
   elif raw.is_relative_to(sdk):logical='/'+str(raw.relative_to(sdk))
   sites.setdefault((logical,r['line'],r.get('cmd','').lower()),[]).append(r['args'])
 assert version
 result=[]
 for item in obligations['items']:
  path=item['file'];f=source/path[len('/source/'):] if path.startswith('/source/') else sdk/path.lstrip('/')
  assert f.is_file() and _digest(f)==item['sourceSha256'],'Obligation source changed'
  args=sites.get((path,item['line'],item['command']),[])
  result.append(dict(item,actualExpandedArguments=args,newUbuntuStatus='executed-in-actual-trace' if args else ('not-executed-in-this-successful-configure' if configure_succeeded else 'unresolved-in-incomplete-configure')))
 return {'configureSucceeded':configure_succeeded,'traceSha256':_digest(trace),'items':result,'staticScanIsAcceptance':False}
