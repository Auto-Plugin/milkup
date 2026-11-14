#!/usr/bin/env python3
"""Read official Ubuntu source/build prerequisites in a private CI workspace."""
import hashlib,json,os,pathlib,re,shutil,subprocess,time,traceback
root=pathlib.Path(os.environ['RUNNER_TEMP'])/'milkup-webkit-research'
evidence=root/'evidence';evidence.mkdir(parents=True,exist_ok=True)
version='2.52.6-0ubuntu0.26.04.1'
report={'status':'running','sourceVersionRequested':version,'uid':os.getuid(),'harnessSha':os.environ['GITHUB_SHA'],'runtimeModified':False,'engineBuildAttempted':False,'steps':[]}
def persist(): (evidence/'result.json').write_text(json.dumps(report,indent=2)+'\n')
def resources(label):
 mem={}
 for line in pathlib.Path('/proc/meminfo').read_text().splitlines():
  key,value=line.split(':',1);mem[key]=value.strip()
 row={'at':time.time(),'label':label,'cpuCount':os.cpu_count(),'meminfo':mem,'disk':{str(p):dict(zip(['total','used','free'],shutil.disk_usage(p)))for p in [root,pathlib.Path('/'),pathlib.Path('/tmp')]},'image':os.environ.get('ImageVersion')}
 for p in ['/sys/fs/cgroup/memory.max','/sys/fs/cgroup/cpu.max','/proc/swaps']:
  if pathlib.Path(p).exists():row[p]=pathlib.Path(p).read_text().strip()
 report.setdefault('resources',[]).append(row);persist()
def run(name,args,timeout=600,cwd=None,allow_failure=False):
 report['stage']=name;persist();at=time.monotonic()
 with (evidence/(name+'.log')).open('w')as log:
  try:p=subprocess.run(args,cwd=cwd,text=True,stdout=log,stderr=subprocess.STDOUT,timeout=timeout)
  except subprocess.TimeoutExpired:
   report['steps'].append({'name':name,'args':args,'timeoutSeconds':timeout,'status':'timeout'});persist();raise
 report['steps'].append({'name':name,'args':args,'exitCode':p.returncode,'durationSeconds':round(time.monotonic()-at,3)});persist()
 if p.returncode and not allow_failure:raise RuntimeError(f'{name} failed with code {p.returncode}; see retained log')
 return (evidence/(name+'.log')).read_text()
try:
 assert os.getuid()!=0 and os.environ.get('GITHUB_ACTIONS')=='true'
 assert not os.environ.get('WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS')
 resources('initial')
 source=pathlib.Path('/etc/apt/sources.list.d/ubuntu.sources');text=source.read_text()
 records=[]
 for stanza in re.split(r'\n\s*\n',text.strip()):
  fields={k:v.strip()for k,v in re.findall(r'^([A-Za-z-]+):\s*(.*)$',stanza,re.M)}
  if not fields:continue
  uris=fields.get('URIs','').split()
  official=lambda u:bool(re.fullmatch(r'https?://(?:[a-z0-9-]+\.)?(?:archive|security)\.ubuntu\.com/ubuntu/?',u))
  resolved=[]
  for uri in uris:
   if uri.startswith('mirror+file:'):
    mirror_path=pathlib.Path(uri.removeprefix('mirror+file:'))
    assert str(mirror_path)in ['/etc/apt/apt-mirrors.txt','/etc/apt/apt-security-mirrors.txt']
    mirrors=mirror_path.read_text();(evidence/mirror_path.name).write_text(mirrors)
    candidates=[line.split()[0]for line in mirrors.splitlines()if line.strip()and not line.lstrip().startswith('#')]
    candidates=[u for u in candidates if official(u)]
    assert candidates, 'No approved official Ubuntu URL in '+str(mirror_path)
    resolved.append(candidates[0])
   else:
    assert official(uri),uri
    resolved.append(uri)
  assert resolved
  stanza=re.sub(r'^URIs:.*$','URIs: '+' '.join(resolved),stanza,flags=re.M)
  assert fields.get('Signed-By')=='/usr/share/keyrings/ubuntu-archive-keyring.gpg'
  assert all(x in ['resolute','resolute-updates','resolute-security','resolute-backports']for x in fields.get('Suites','').split())
  records.append(re.sub(r'^Types:.*$','Types: deb deb-src',stanza,flags=re.M))
 assert records
 sources=root/'official.sources';sources.write_text('\n\n'.join(records)+'\n')
 (evidence/'official.sources').write_text(sources.read_text())
 for p in ['lists/partial','cache/archives/partial','source-download']:(root/p).mkdir(parents=True,exist_ok=True)
 conf=root/'apt.conf';conf.write_text(f'Dir::Etc::sourcelist "{sources}";\nDir::Etc::sourceparts "-";\nDir::State::lists "{root}/lists";\nDir::Cache "{root}/cache";\nAcquire::Languages "none";\n')
 run('official-apt-update',['apt-get','-c',str(conf),'update'])
 metadata=run('official-source-metadata',['apt-cache','-c',str(conf),'showsrc','webkit2gtk'])
 stanzas=[s for s in re.split(r'\n\s*\n',metadata)if re.search(r'^Version: '+re.escape(version)+r'$',s,re.M)]
 report['availableSourceVersions']=re.findall(r'^Version: (.+)$',metadata,re.M);persist()
 if not stanzas:raise RuntimeError('Exact previously tested Ubuntu source version unavailable; no silent version substitution')
 selected=stanzas[0];(evidence/'selected-source.dsc-metadata.txt').write_text(selected+'\n')
 run('source-download',['apt-get','-c',str(conf),'source','--download-only','--only-source',f'webkit2gtk={version}'],timeout=900,cwd=root/'source-download')
 checks=re.search(r'^Checksums-Sha256:\n((?: .+\n)+)',selected+'\n',re.M);assert checks
 archives=[]
 for line in checks[1].splitlines():
  digest,size,name=line.split();assert pathlib.Path(name).name==name
  p=root/'source-download'/name;b=p.read_bytes();assert len(b)==int(size)and hashlib.sha256(b).hexdigest()==digest
  archives.append({'name':name,'bytes':len(b),'sha256':digest})
 report['archives']=archives;persist()
 dsc=list((root/'source-download').glob('*.dsc'));assert len(dsc)==1
 run('source-extract',['dpkg-source','--no-check','-x',str(dsc[0]),str(root/'source')],timeout=900)
 # --no-check skips a second maintainer-key signature lookup, not source trust:
 # authenticated Ubuntu APT metadata and every archive SHA-256 were checked above.
 resources('source-extracted')
 report['sourceExtractedBytes']=int(subprocess.check_output(['du','-sb',str(root/'source')],text=True).split()[0])
 report['sourceFileCount']=sum(len(files)for _,_,files in os.walk(root/'source'))
 for f in ['debian/rules','debian/control','debian/changelog','Source/cmake/OptionsGTK.cmake','Source/cmake/OptionsCommon.cmake','Source/cmake/WebKitCompilerFlags.cmake','CMakeLists.txt']:
  p=root/'source'/f
  if p.exists():
   target=evidence/'build-inputs'/f;target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(p,target)
 patch=pathlib.Path(os.environ['GITHUB_WORKSPACE'])/'research/linux-pdf-unicode-20261114/0002-research-only-scalar-source-to-skia.patch'
 run('research-patch-apply-check',['git','apply','--check',str(patch)],cwd=root/'source')
 simulation=run('official-build-deps-simulation',['apt-get','-c',str(conf),'--simulate','--no-install-recommends','--no-remove','build-dep',f'webkit2gtk={version}'],allow_failure=True)
 report['buildDependencySimulationSucceeded']=report['steps'][-1]['exitCode']==0
 report['simulatedInstalls']=re.findall(r'^Inst (\S+).*$',simulation,re.M)
 report['simulatedRemovals']=re.findall(r'^Remv (\S+).*$',simulation,re.M)
 report['wouldChangeWebKitPackages']=[p for p in report['simulatedInstalls']if re.search('webkit|javascriptcore',p,re.I)]
 resources('probe-complete')
 report['status']='probe-complete';report['next']='Review exact distro build flags, dependency plan and measured limits before isolated engine compilation.'
except Exception as e:
 report['status']='blocked';report['error']=str(e);(evidence/'exception.txt').write_text(traceback.format_exc())
finally:persist();print(json.dumps({k:report.get(k)for k in ['status','stage','error','sourceVersionRequested','availableSourceVersions','sourceExtractedBytes','sourceFileCount','buildDependencySimulationSucceeded','wouldChangeWebKitPackages']},indent=2))
if report['status']!='probe-complete':raise SystemExit(1)
