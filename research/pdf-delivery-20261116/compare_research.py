"""Rebuild the locked passed research tree in a bounded overlay, then diff it.
This is a review artifact, not a claim that changed normal behavior is accepted.
"""
import difflib,hashlib,importlib.util,json,pathlib,shutil,tempfile
HERE=pathlib.Path(__file__).resolve().parent
RESEARCH=HERE.parent/'pdf-combined-20261116'
def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def compare(preimage,normal,output):
 spec=importlib.util.spec_from_file_location('locked_research',RESEARCH/'prepare.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
 with tempfile.TemporaryDirectory(prefix='research-normal-review-')as tmp:
  root=pathlib.Path(tmp)/'tree';root.mkdir()
  lock=json.loads((RESEARCH/'source-lock.json').read_text())
  extra=['Source/WebCore/rendering/'+n for n in ['FragmentKeepPolicy.h','RootTrailingMarginPolicy.h','MilkupPaginationResearch.h','MilkupTailResearch.h']]
  for rel in set(lock)|set(extra):
   p=preimage/rel
   if p.exists():q=root/rel;q.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(p,q)
  receipt=m.build(root,pathlib.Path(tmp)/'combined.patch',write=True)
  assert receipt['patchSha256']=='21eef8e16614a44cfe0be023812617b17865cbd29fce66b172905bef7b052008'
  files=set(lock)|set(extra)|{str(p.relative_to(normal))for p in normal.rglob('*')if p.is_file()}
  chunks=[];changes=[]
  for rel in sorted(files):
   a=root/rel;b=normal/rel
   old=a.read_text()if a.exists()else'';new=b.read_text()if b.exists()else''
   if old==new:continue
   chunks.append(''.join(difflib.unified_diff(old.splitlines(True),new.splitlines(True),fromfile='a/'+rel if a.exists()else'/dev/null',tofile='b/'+rel if b.exists()else'/dev/null')))
   changes.append({'path':rel,'researchSha256':digest(a)if a.exists()else None,'normalSha256':digest(b)if b.exists()else None})
  output.write_text(''.join(chunks))
  result={'scope':'Source review only; normal-path native validation required','researchCombinedPatchSha256':receipt['patchSha256'],'normalPatchSha256':digest(HERE/'normal-path-2.52.6.patch'),'differenceSha256':digest(output),'changes':changes}
  output.with_suffix('.json').write_text(json.dumps(result,indent=2)+'\n');return result
if __name__=='__main__':
 import argparse
 p=argparse.ArgumentParser();p.add_argument('preimage',type=pathlib.Path);p.add_argument('normal',type=pathlib.Path);p.add_argument('output',type=pathlib.Path);a=p.parse_args();r=compare(a.preimage,a.normal,a.output);print(json.dumps({'changedFiles':len(r['changes']),'differenceSha256':r['differenceSha256']}))
