import pathlib,json,subprocess,hashlib,datetime
root=pathlib.Path('/workspace/mermaid-rebuild-evidence/linux-close-0e3912db')
repo=pathlib.Path('/workspace/milkup-mermaid-rebuild')
rows=[]
for p in pathlib.Path('/proc').iterdir():
 if not p.name.isdigit():continue
 try:
  argv=(p/'cmdline').read_bytes().decode(errors='replace').split('\0')
  stat=(p/'stat').read_text();fields=stat[stat.rfind(')')+2:].split()
  if fields[0]=='Z':continue
  owned=(argv[0].startswith('/tmp/milkup-mermaid-normal-close-') or (pathlib.Path(argv[0]).name in ['Xvfb','tauri-driver','xfwm4','xfconfd','WebKitWebDriver'] and (':144' in argv or '4450' in argv or '4451' in argv)))
  if owned:rows.append({'pid':int(p.name),'birth':fields[19],'argv':argv})
 except (OSError,ValueError):pass
ports=[]
for file in ['/proc/net/tcp','/proc/net/tcp6']:
 for line in pathlib.Path(file).read_text().splitlines()[1:]:
  f=line.split();port=int(f[1].split(':')[1],16)
  if f[3]=='0A' and port in [4450,4451]:ports.append({'source':file,'port':port,'record':line})
record={'recordedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'sourceCandidateForBinary':'0e3912db3f2cc4d77dd73513ce73d5440ec36f54','currentWorktreeHead':subprocess.check_output(['git','rev-parse','HEAD'],cwd=repo,text=True).strip(),'currentWorktreeStatus':subprocess.check_output(['git','status','--porcelain=v1'],cwd=repo,text=True),'binarySha256':hashlib.sha256((repo/'apps/desktop/src-tauri/target/debug/milkup-desktop').read_bytes()).hexdigest(),'activeOwnedProcesses':rows,'listeningPorts':ports,'displayLockExists':pathlib.Path('/tmp/.X144-lock').exists(),'displaySocketExists':pathlib.Path('/tmp/.X11-unix/X144').exists()}
record['passed']=not rows and not ports and not record['displayLockExists'] and not record['displaySocketExists']
with (root/'post-run04-cleanup.json').open('x') as f:json.dump(record,f,indent=2);f.write('\n')
print(json.dumps(record,indent=2))
