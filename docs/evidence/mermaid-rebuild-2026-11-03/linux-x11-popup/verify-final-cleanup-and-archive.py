from pathlib import Path
import json,hashlib,datetime,os,subprocess
repo=Path('/workspace/milkup-mermaid-rebuild');base=repo/'docs/evidence/mermaid-rebuild-2026-11-03'
binary=repo/'apps/desktop/src-tauri/target/debug/milkup-desktop'
expected='9bfce3146a9d6f5b44a2c769a3e55b72521fdb33beed8247980aaa412742347a'
owned_binary_paths={str(binary),'/workspace/mermaid-rebuild-evidence/linux-x11-popup/native-corpus-ee305c4c-01/binary/milkup-desktop'}
for family in ['linux-close-0e3912db','linux-x11-popup']:
 for f in (base/family).rglob('run.json'):
  a=json.loads(f.read_text())
  if 'root' in a:owned_binary_paths.add(str(Path(a['root'])/'binary/milkup-desktop'))
active=[]
for p in Path('/proc').iterdir():
 if not p.name.isdigit():continue
 try:
  argv=(p/'cmdline').read_bytes().decode(errors='replace').split('\0');s=(p/'stat').read_text();fields=s[s.rfind(')')+2:].split()
  if fields[0]=='Z':continue
  name=Path(argv[0]).name
  owned=argv[0] in owned_binary_paths or (name=='Xvfb' and any(d in argv for d in [':143',':144'])) or (name in ['tauri-driver','WebKitWebDriver'] and any(port in argv for port in ['4450','4451']))
  if owned:active.append({'pid':int(p.name),'birth':fields[19],'argv':argv})
 except (OSError,ValueError):pass
ports=[]
for file in ['/proc/net/tcp','/proc/net/tcp6']:
 for line in Path(file).read_text().splitlines()[1:]:
  f=line.split();port=int(f[1].split(':')[1],16)
  if f[3]=='0A' and port in [4450,4451]:ports.append({'port':port,'source':file})
displays=[{'display':display,'lockExists':Path('/tmp/.X'+display+'-lock').exists(),'socketExists':Path('/tmp/.X11-unix/X'+display).exists()} for display in ['143','144']]
archives=[]
for family in ['linux-close-0e3912db','linux-x11-popup']:
 root=base/family;m=json.loads((root/'evidence-manifest.json').read_text());rows=m['files']
 for item in rows:
  p=root/item['path'];assert not p.is_symlink();b=p.read_bytes()
  assert len(b)==item['bytes'] and hashlib.sha256(b).hexdigest()==item['sha256'],p
  assert not b.startswith(b'\x7fELF'),p
  assert p.suffix not in ['.so','.exe','.dll','.pyc'],p
  assert not any(part in ['binary','config','cache','data','runtime','runtime-tmp','__pycache__'] for part in p.relative_to(root).parts),p
 archives.append({'directory':str(root),'files':len(rows),'bytes':sum(r['bytes'] for r in rows),'manifestSha256':hashlib.sha256((root/'evidence-manifest.json').read_bytes()).hexdigest(),'hashesVerified':True,'excludedBinaryProfileCacheRuntime':True})
actual=hashlib.sha256(binary.read_bytes()).hexdigest();assert actual==expected
report={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'sourceCandidateForFrozenBinary':'ee305c4c8e8fc2e2a8fb7356170a6ec59b6674e4','frozenBinarySha256':actual,'currentWorktreeHead':subprocess.check_output(['git','rev-parse','HEAD'],cwd=repo,text=True).strip(),'currentWorktreeStatus':subprocess.check_output(['git','status','--porcelain=v1'],cwd=repo,text=True),'activeOwnedProductsDriversDisplays':active,'listeningPorts':ports,'displays':displays,'archives':archives,'note':'Owned native private-root absence and guardian/service-group cleanup are verified in per-run and corpus reports. Fresh test profiles are not included in archives; no claim that entire profile directories were deleted.'}
report['passed']=not active and not ports and all(not x['lockExists'] and not x['socketExists'] for x in displays)
assert report['passed']
out=Path('/workspace/mermaid-rebuild-evidence/linux-x11-popup/final-cleanup-and-archive-verification.json');out.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
