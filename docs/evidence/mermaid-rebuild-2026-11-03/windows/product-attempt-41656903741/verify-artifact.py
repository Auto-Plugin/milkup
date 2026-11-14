import hashlib,io,json,pathlib,stat,sys,zipfile
from PIL import Image
root=pathlib.Path(sys.argv[1]); run=json.loads((root/'run-metadata.json').read_text()); artifacts=json.loads((root/'artifacts.json').read_text())['artifacts']; assert len(artifacts)==1
artifact=artifacts[0]; raw=(root/'artifact.zip').read_bytes(); digest=hashlib.sha256(raw).hexdigest(); assert artifact['digest']=='sha256:'+digest
out=root/'artifact';out.mkdir(exist_ok=True)
with zipfile.ZipFile(io.BytesIO(raw)) as z:
 infos=z.infolist(); assert len(infos)<=96 and sum(i.file_size for i in infos)<=128*1024*1024
 names=[i.filename for i in infos];assert len(set(names))==len(names)
 for i in infos:
  assert pathlib.PurePosixPath(i.filename).name==i.filename and '\\' not in i.filename and not i.is_dir()
  assert not stat.S_ISLNK(i.external_attr>>16)
  assert i.file_size<=(32 if i.filename.endswith('.png') else 2)*1024*1024
 manifest=json.loads(z.read('artifact-manifest.json')); assert manifest['candidateSha']==run['head_sha'];assert manifest['workflowRunId']==str(run['id']);assert manifest['runAttempt']==str(run['run_attempt'])
 assert set(names)=={'artifact-manifest.json'}|{f['name'] for f in manifest['files']}
 verified=[];images=[]
 for f in manifest['files']:
  b=z.read(f['name']);assert len(b)==f['bytes'] and hashlib.sha256(b).hexdigest()==f['sha256']
  verified.append(dict(f,verified=True));(out/f['name']).write_bytes(b)
  if f['name'].endswith('.png'):
   im=Image.open(io.BytesIO(b)); im.load();assert im.format=='PNG';rgba=im.convert('RGBA'); pixels=rgba.tobytes();ext=rgba.getextrema()
   images.append({'file':f['name'],'width':im.width,'height':im.height,'fullyDecoded':True,'nonuniform':any(a!=b for a,b in ext),'pixelSha256':hashlib.sha256(pixels).hexdigest(),'pngSha256':hashlib.sha256(b).hexdigest()})
 (out/'artifact-manifest.json').write_bytes(z.read('artifact-manifest.json'))
phases=[]
for f in sorted(out.glob('mermaid-source-*.json')):
 d=json.loads(f.read_text(encoding='utf-8-sig'));assert d['candidateSha']==run['head_sha']
 phases.append({'phase':d['phase'],'strictClean':d['rawStatus']=='','headIndexWorktreeEqual':all(x['head']['sha256']==x['index']['sha256']==x['worktree']['sha256'] for x in d['files']),'readOnly':d['readOnly'],'refreshedIndex':d['refreshedIndex']})
report={'runUrl':run['html_url'],'runAttempt':run['run_attempt'],'candidateSha':run['head_sha'],'conclusion':run['conclusion'],'artifactId':artifact['id'],'artifactZipSha256':digest,'gitHubArtifactDigestMatched':True,'manifestFiles':verified,'sourcePhases':phases,'images':images}
(root/'verification.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({'files':len(verified),'images':len(images),'zipSha256':digest,'sourcePhases':phases,'report':str(root/'verification.json')},indent=2))
