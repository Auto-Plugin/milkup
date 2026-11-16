"""Read-only inventory of the pinned real 2.54.2 graph, not build timing."""
import collections,gzip,hashlib,json,pathlib,re,shlex,zipfile
from current_object_restore import ARTIFACT,ARTIFACT_SHA

def inventory():
 assert hashlib.sha256(ARTIFACT.read_bytes()).hexdigest()==ARTIFACT_SHA
 with zipfile.ZipFile(ARTIFACT)as z:
  report=json.loads(z.read('result.json'))
  def read(name):
   meta=report['retainedConfigurationFiles'][name]
   if meta['encoding']=='raw':raw=z.read('graph/'+name)
   else:
    assert meta['encoding']=='ordered-gzip-parts';parts=[]
    for row in meta['parts']:
     stored=z.read('graph/'+str(pathlib.PurePosixPath(name).parent/row['file']))
     assert len(stored)==row['storedBytes']and hashlib.sha256(stored).hexdigest()==row['storedSha256']
     part=gzip.decompress(stored);assert len(part)==row['rawBytes']and hashlib.sha256(part).hexdigest()==row['rawSha256'];parts.append(part)
    raw=b''.join(parts)
   assert len(raw)==meta['rawBytes']and hashlib.sha256(raw).hexdigest()==meta['rawSha256'];return raw
  graph=read('build.ninja').decode();commands=json.loads(read('compile_commands.json'));groups=collections.Counter();pch=[]
  for entry in commands:
   args=entry.get('arguments')or shlex.split(entry['command']);target=args[args.index('-o')+1]
   group=re.search(r'CMakeFiles/([^/]+)\.dir/',target);groups[group[1]if group else'other']+=1
   if target.endswith('.pch'):pch.append(target)
  links=[]
  for line in graph.splitlines():
   if not line.startswith('build ')or ': 'not in line:continue
   target,rest=line[6:].split(': ',1);tokens=rest.split();rule=tokens[0]
   if not any(v in rule for v in ['SHARED_LIBRARY_LINKER','EXECUTABLE_LINKER','STATIC_LIBRARY_LINKER']):continue
   deps=tokens[1:];explicit=deps[:min([deps.index(v)for v in ['|','||']if v in deps]or[len(deps)])]
   links.append({'outputs':target.split(),'rule':rule,'directObjectInputs':sum(x.endswith('.o')for x in explicit),'explicitInputs':len(explicit)})
 return {'sourceRun':43852458294,'scope':'actual configured graph only; no complete-build timing or link proof','compileDatabaseSha256':report['compileDatabaseSha256'],'compileEntries':len(commands),'groups':dict(groups.most_common()),'pchTargets':pch,'linkEdges':links}
if __name__=='__main__':
 result=inventory();expected=json.loads(pathlib.Path(__file__).with_name('full-build-graph-inventory.json').read_text());assert result==expected
 print(json.dumps({'verified':True,'compileEntries':result['compileEntries'],'pchTargets':len(result['pchTargets']),'linkEdges':len(result['linkEdges'])},indent=2))
