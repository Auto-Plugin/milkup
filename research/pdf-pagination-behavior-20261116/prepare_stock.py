#!/usr/bin/env python3
"""Read official Ubuntu source/build prerequisites in a private CI workspace."""
import hashlib,json,os,pathlib,re,shutil,subprocess,time,traceback
root=pathlib.Path(os.environ['RUNNER_TEMP'])/'milkup-stock-paper-control'
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
 run('stock-runtime-install',['sudo','apt-get','-c',str(conf),'-y','--no-install-recommends','--no-remove','install',
  'libwebkit2gtk-4.1-0='+version,'libjavascriptcoregtk-4.1-0='+version,'libgtk-3-0t64',
  'xvfb','xauth','xdotool','x11-utils','fonts-noto-cjk=1:20240730+repack1-1build1',
  'fonts-noto-color-emoji','fonts-dejavu-core','poppler-utils=26.01.0-2ubuntu0.3',
  'python3-lxml','python3-pil','python3-fitz=1.26.7+ds1-1build1'],timeout=360)
 report['status']='stock-runtime-ready-no-engine-build';resources('ready')
except Exception as error:
 report.update(status='failed',error=repr(error));persist();raise
finally:persist()
