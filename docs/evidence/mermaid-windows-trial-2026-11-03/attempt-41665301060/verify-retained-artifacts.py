import hashlib,io,json,pathlib,stat,zipfile
from PIL import Image
root=pathlib.Path(__file__).resolve().parent
run=json.loads((root/'run-metadata.json').read_text()); assert run['head_sha']=='d525c6a51d2d6a47615ff3a950a8852a2dde48ae'
artifacts=json.loads((root/'artifacts.json').read_text())['artifacts']; result={'runId':run['id'],'runAttempt':run['run_attempt'],'candidateSha':run['head_sha'],'runConclusion':run['conclusion'],'artifacts':[],'deliveryArtifactDownloadedByThisVerifier':False}
for kind,prefix,manifest_name in [('installed','mermaid-installed-evidence-','artifact-manifest.json'),('inspection','mermaid-installer-inspection-','manifest.json')]:
 matches=[a for a in artifacts if a['name']==prefix+str(run['id'])+'-'+str(run['run_attempt'])]
 if not matches:
  result['artifacts'].append({'kind':kind,'present':False});continue
 assert len(matches)==1;a=matches[0];raw=(root/(kind+'.zip')).read_bytes();digest=hashlib.sha256(raw).hexdigest();assert a['digest']=='sha256:'+digest
 target=root/kind;target.mkdir(exist_ok=True); rows=[];images=[]
 with zipfile.ZipFile(io.BytesIO(raw)) as z:
  infos=z.infolist();names=[i.filename for i in infos]
  assert len(names)==len(set(names)) and len(names)<=96 and sum(i.file_size for i in infos)<=128*1024*1024
  for i in infos:
   assert pathlib.PurePosixPath(i.filename).name==i.filename and '\\' not in i.filename and not i.is_dir() and not stat.S_ISLNK(i.external_attr>>16)
   assert i.file_size<=(32 if i.filename.endswith('.png') else 2)*1024*1024
  manifest=json.loads(z.read(manifest_name).decode('utf-8-sig')); assert manifest['candidateSha']==run['head_sha']
  if kind=='installed':assert manifest['workflowRunId']==str(run['id']) and manifest['runAttempt']==str(run['run_attempt'])
  else:assert manifest['includesBinariesOrProfiles'] is False
  assert set(names)=={manifest_name}|{f['name'] for f in manifest['files']}
  for f in manifest['files']:
   b=z.read(f['name']);assert len(b)==f['bytes'] and hashlib.sha256(b).hexdigest()==f['sha256'];(target/f['name']).write_bytes(b);rows.append(dict(f,verified=True))
   if f['name'].endswith('.png'):
    im=Image.open(io.BytesIO(b));assert 0<im.width<=8192 and 0<im.height<=8192 and im.width*im.height<=16777216;im.load();assert im.format=='PNG';rgba=im.convert('RGBA'); ext=rgba.getextrema();assert any(x!=y for x,y in ext)
    images.append({'file':f['name'],'width':im.width,'height':im.height,'pngSha256':f['sha256'],'pixelSha256':hashlib.sha256(rgba.tobytes()).hexdigest(),'fullyDecoded':True,'nonuniform':True})
  (target/manifest_name).write_bytes(z.read(manifest_name))
 result['artifacts'].append({'kind':kind,'present':True,'id':a['id'],'name':a['name'],'zipSha256':digest,'githubDigestMatched':True,'manifestFiles':rows,'images':images})
(root/'artifact-verification.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({k:v for k,v in result.items()if k!='artifacts'}));print(json.dumps([{'kind':a['kind'],'present':a['present'],'files':len(a.get('manifestFiles',[])),'png':len(a.get('images',[]))}for a in result['artifacts']]))
