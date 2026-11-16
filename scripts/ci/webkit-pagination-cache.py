#!/usr/bin/env python3
"""Content-bound compiler cache transfer, never a runtime/workspace archive.

Uses ccache's checksummed M/R format and normal dependency validation on reuse.
Every result is extracted in a temporary directory and must contain ET_REL.
Configuration, statistics, temporary files and all other paths are excluded.
"""
import hashlib,json,os,pathlib,re,shutil,subprocess,sys,tempfile,time
ROOT=pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'research/pdf-pagination-mechanism-20261116/budget-review'))
import object_bundle as objects

LIMIT=2*1024**3
ENTRY=re.compile(r'(?:[0-9a-f]/){1,3}[0-9A-Za-z]+[MR]')

def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def canonical(v):return hashlib.sha256(json.dumps(v,sort_keys=True,separators=(',',':')).encode()).hexdigest()
def identity(evidence):
 p=json.loads((evidence/'pagination-build-result.json').read_text());g=json.loads((evidence/'pagination-object-gate/result.json').read_text())
 assert p['status']=='passed-four-tu-only-not-native'and g['status']=='passed'
 return {'sourceArchives':canonical(p['cacheReceipt']['archives']),'observationPatch':p['patchSha256'],'compiler':p['compilerSha256'],'configureArgs':canonical(p['configureArgs']),'compileDatabase':g['compileDatabaseSha256'],'generatedHeaders':digest(evidence/'pagination-object-gate/generated-header-sha256.json')}

def regular(p):
 assert not p.is_symlink()and p.is_file()and p.stat().st_nlink==1,'Only owned regular cache entries'
 assert p.stat().st_size<=objects.MAX_OBJECT,'Oversized compressed cache entry'

def inspect(entry):
 subprocess.run(['ccache','--inspect',str(entry)],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE,timeout=10)
 if entry.name.endswith('R'):
  with tempfile.TemporaryDirectory(prefix='milkup-cache-inspect-')as tmp:
   p=pathlib.Path(tmp)
   subprocess.run(['ccache','--extract-result',str(entry)],cwd=p,check=True,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE,timeout=10)
   names={x.name for x in p.iterdir()}
   assert 'ccache-result.o'in names and names<={'ccache-result.o','ccache-result.d','ccache-result.stderr','ccache-result.stdout'},'Not an object/dependency result'
   objects.read_object(p,'ccache-result.o')
   for name in names-{'ccache-result.o'}:
    regular(p/name);assert (p/name).stat().st_size<4*1024**2

def capture(cache,destination,expected,budget=600):
 assert not destination.exists()and cache.resolve()!=destination.resolve()
 key=objects.key(expected);started=time.monotonic();rows=[];total=0
 destination.mkdir(parents=True)
 try:
  for p in sorted(cache.rglob('*')):
   assert not p.is_symlink(),'Symlink in compiler cache'
   if p.is_dir():continue
   relative=str(p.relative_to(cache))
   if not ENTRY.fullmatch(relative):continue # Never copy configuration, temp, env or arbitrary files.
   assert time.monotonic()-started<budget,'Capture deadline'
   regular(p);inspect(p)
   total+=p.stat().st_size;assert total<=LIMIT and len(rows)<20000,'Cache capacity'
   original_hash=digest(p)
   target=destination/relative;target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(p,target)
   assert digest(target)==original_hash==digest(p),'Cache entry changed during capture'
   rows.append({'path':relative,'bytes':target.stat().st_size,'sha256':original_hash})
  assert rows and any(x['path'].endswith('R')for x in rows)
  receipt={'key':key,'identity':expected,'entries':rows,'bytes':total,'seconds':round(time.monotonic()-started,3),'containsRuntime':False}
  (destination/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n');return receipt
 except Exception:
  shutil.rmtree(destination);raise

def restore(bundle,destination,expected):
 assert not destination.exists()and not bundle.is_symlink()
 assert not any(p.is_symlink()for p in bundle.rglob('*')),'Symlink in transferred cache'
 regular(bundle/'receipt.json');assert(bundle/'receipt.json').stat().st_size<8*1024**2
 receipt=json.loads((bundle/'receipt.json').read_text());assert receipt['identity']==expected and receipt['key']==objects.key(expected),'Wrong source/compiler/flags/path/patch cache identity'
 assert 0<len(receipt['entries'])<=20000 and receipt['bytes']<=LIMIT
 paths=set();total=0
 for row in receipt['entries']:
  name=row['path'];assert ENTRY.fullmatch(name)and name not in paths
  paths.add(name);p=bundle/name;regular(p)
  assert p.stat().st_size==row['bytes']and digest(p)==row['sha256'],'Truncated or altered cache'
  total+=row['bytes']
 assert total==receipt['bytes']
 assert {str(p.relative_to(bundle))for p in bundle.rglob('*')if p.is_file()}==paths|{'receipt.json'}
 destination.mkdir(parents=True)
 for name in paths:
  target=destination/name;target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(bundle/name,target)
 return receipt

def main():
 import argparse
 p=argparse.ArgumentParser();p.add_argument('operation',choices=['snapshot','restore']);p.add_argument('--cache',type=pathlib.Path,required=True);p.add_argument('--bundle',type=pathlib.Path,required=True);p.add_argument('--evidence',type=pathlib.Path,required=True);a=p.parse_args()
 i=identity(a.evidence)
 if a.operation=='snapshot':r=capture(a.cache,a.bundle,i)
 else:r=restore(a.bundle,a.cache,i)
 print(json.dumps({k:v for k,v in r.items()if k!='entries'}))
if __name__=='__main__':main()
