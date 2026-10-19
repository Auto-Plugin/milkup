#!/usr/bin/env python3
"""Metadata-only provisional inventory; no hashing, compression, copy, or deletion."""
import collections,json,os,sys
from pathlib import Path
SOURCE=Path('/workspace/milkup-p7-quality-evidence/milestone02')
ROOTS={'validation','environment','outline','build-tools','review','archive-tools','candidate-production-04'}
PRUNE={'node_modules','target','.git','__pycache__','profile','profiles','runtime-profiles','user-data','user-data-dir','cache','secrets','credentials','.aws','.ssh','.gnupg','install','installed'}
EXTENSIONS={'.py','.sh','.mjs','.cjs','.ts','.js','.json','.jsonl','.md','.log','.txt','.png','.patch','.diff','.yaml','.yml','.exit'}
RUNTIME={'outline/runtime/run-env.sh','outline/runtime/driver.sh','outline/runtime/driver-control.py','outline/runtime/xvfb-control.py','outline/runtime04/run-env.sh','outline/runtime04/driver.sh','outline/runtime04/driver-control.py'}
def classify(rel,n):
 p=Path(rel);parts=p.parts
 if parts[0] not in ROOTS:return 'unreviewed root'
 if any(word in p.name.lower() for word in ('credential','secret','token','cookie','password','private-key')) or p.name.lower().startswith('.env'):return 'sensitive filename; not read'
 if parts[0]=='candidate-production-04':
  if p.name=='milkup-desktop':return 'excluded native ELF; proof retains SHA and byte length'
  if len(parts)!=2 or p.name not in {'proof-before.json','proof.json','build.log','build-exit.txt','frontend-assets.json','assets-metadata.json','README.md','bundle-continuity.json','freeze-final.json'}:return 'unreviewed candidate production path'
 if rel=='outline/external-1.3.3/plugin.js':return 'generated external plugin bundle; retain source and build-meta/hash proof'
 if p.suffix in {'.work','.milkup-plugin','.tgz','.deb','.rpm','.exe','.dll','.so','.dmg','.msi','.AppImage'}:return 'working file or excluded binary/package/runtime artifact'
 if 'dist' in parts and p.name!='build-meta.json':return 'generated distribution output; retain source and build-meta/hash proof'
 if any(v.startswith('.') for v in parts):
  if not (parts[0]=='validation' and p.name=='.last-run.json' and len(parts)==3 and parts[1].endswith('-artifacts')):return 'hidden artifact'
 if any(v in {'runtime','runtime04'} for v in parts) and rel not in RUNTIME:return 'unreviewed runtime path'
 if parts[0]=='archive-tools' and p.name not in {'inventory.py','common.py','archive.py','index.py','verify.py','README.md','report-outline.md'}:return 'generated archive inventory/report; avoid recursive inclusion'
 if p.suffix not in EXTENSIONS:return 'unreviewed extension'
 return None
def inventory():
 selected=[];excluded=[]
 for base,dirs,files in os.walk(SOURCE,followlinks=False):
  for name in list(dirs):
   p=Path(base)/name;rel=p.relative_to(SOURCE)
   reason='excluded private/cache/dependency subtree; not read' if name in PRUNE else 'symlink; not followed' if p.is_symlink() else 'unreviewed root; not read' if len(rel.parts)==1 and name not in ROOTS else None
   if reason:excluded.append({'path':str(rel),'reason':reason});dirs.remove(name)
  for name in sorted(files):
   p=Path(base)/name;rel=p.relative_to(SOURCE);n=p.lstat().st_size
   reason='symlink; not followed' if p.is_symlink() else classify(str(rel),n)
   if reason:excluded.append({'path':str(rel),'bytes':n,'reason':reason});continue
   compress=n>=128*1024 and (rel.suffix in {'.json','.log'} or (len(rel.parts)==4 and rel.parts[:2]==('outline','runs') and rel.suffix=='.md'))
   selected.append({'source':str(rel),'path':str(rel)+('.gz' if compress else ''),'originalBytes':n,'encoding':'gzip' if compress else 'identity','sha256':'PENDING_FREEZE'})
 selected.sort(key=lambda row:row['path']);groups=collections.defaultdict(lambda:{'files':0,'originalBytes':0})
 for e in selected:
  g=groups[e['source'].split('/')[0]];g['files']+=1;g['originalBytes']+=e['originalBytes']
 return {'status':'PROVISIONAL_METADATA_ONLY_NOT_COPIED','sourceRoot':str(SOURCE),'destination':'/workspace/milkup/docs/evidence/v2-product-phase7-quality/milestone02','proposedPayloadCapBytes':16*1024*1024,'selectedFiles':len(selected),'identityBytes':sum(e['originalBytes'] for e in selected if e['encoding']=='identity'),'gzipOriginalBytes':sum(e['originalBytes'] for e in selected if e['encoding']=='gzip'),'actualCompressedBytes':None,'roots':groups,'requiresReview':[e for e in excluded if 'unreviewed' in e['reason']],'entries':selected,'excluded':excluded}
if __name__=='__main__':
 output=Path(sys.argv[1]);assert not output.exists(),'Preserve earlier inventory'
 result=inventory();output.write_text(json.dumps(result,indent=2)+'\n')
 print(json.dumps({k:v for k,v in result.items() if k not in {'entries','excluded'}}))
