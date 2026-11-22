"""One owned Ubuntu SDK/configuration job. No installation, upload, or default build."""
from pathlib import Path, PurePosixPath
import concurrent.futures, datetime, email.utils, hashlib, json, lzma, os, re, shutil, signal, subprocess, sys, tarfile, time, urllib.parse, urllib.request, urllib.error
BASE='fce75b5e24dc7e9364cd995d9f7267775bf76f10'
SOURCE='2779c1b46f88762e8400650271ba14452dc4e30b37059981552d8b562b7d0862'
PATCH='855e58cc8ad531cc32e893b8274983a6264e6fdfc248c13e80c5ef0e01d7a4e5'
PLAN='9b086c788b74669e6e577da7cfd762a343dd78c21c50cc6168647fbeffef9a41'
FROZEN='a6c7e94a0633d1949a33e54327b8fc59742199b5c5a03b4486c6ff47f9f08481'
DEBIAN={'04B54C3CDCA79751B16BC6B5225629DF75B188BD','B8B80B5B623EAB6AD8775C45B7C5D7D6350947F8'}
UBUNTU={'F6ECB3762474EDA9D21B7022871920D1991BC93C'}
BAD={'BADSIG','ERRSIG','EXPSIG','EXPKEYSIG','REVKEYSIG','KEYEXPIRED','SIGEXPIRED','FAILURE','NO_PUBKEY'}
TARGET='WebCore/DerivedSources/UserAgentStyleSheetsData.cpp'
D=Path(__file__).resolve().parent
START=time.monotonic();DEADLINE=START+3300;WORK=None;ENV=None;PHASE='start'
def sha(p):
 with Path(p).open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
def emit(**x): print(json.dumps(dict(phase=PHASE,seconds=round(time.monotonic()-START,2),**x)),flush=True)
def room():
 assert time.monotonic()<DEADLINE,'Global 3300-second boundary'
 if WORK:assert shutil.disk_usage(WORK).free>=12*1024**3,'12 GiB disk reserve reached'
def run(args,label,timeout=300,env=None,cwd=None):
 room();log=WORK/(label+'.log');limit=min(timeout,max(1,DEADLINE-time.monotonic()))
 with log.open('wb') as out:
  proc=subprocess.Popen(list(map(str,args)),stdout=out,stderr=subprocess.STDOUT,env=env or ENV,cwd=cwd or WORK,start_new_session=True)
  stop=None;end=time.monotonic()+limit
  try:
   while proc.poll() is None:
    if time.monotonic()>=end:stop='stage deadline';break
    if log.stat().st_size>8*1024**2:stop='bounded stage log exceeded';break
    room();time.sleep(.2)
  finally:
   if proc.poll() is None:
    os.killpg(proc.pid,signal.SIGTERM)
    try:proc.wait(timeout=5)
    except subprocess.TimeoutExpired:os.killpg(proc.pid,signal.SIGKILL);proc.wait(timeout=5)
 if label!='package-metadata':emit(stage=label,exitCode=proc.returncode,stop=stop,logSha256=sha(log),commandSha256=hashlib.sha256(json.dumps(list(map(str,args))).encode()).hexdigest())
 if proc.returncode or stop:
  print(log.read_text(errors='replace')[-6000:],flush=True);raise RuntimeError(label+' failed')
 return log.read_text(errors='strict')
def fields(text):
 d={};key=None
 for line in text.splitlines():
  if line.startswith((' ','\t')):
   assert key;d[key]+='\n'+line
  else:
   key,sep,val=line.partition(':');assert sep and key not in d;d[key]=val.lstrip()
 return d
def table(text):
 d={}
 for line in text.splitlines():
  if not line.strip():continue
  h,n,p=line.split();assert re.fullmatch('[a-f0-9]{64}',h) and n.isdigit()
  path=PurePosixPath(p);assert not path.is_absolute() and '..' not in path.parts and p not in d
  d[p]={'sha256':h,'bytes':int(n)}
 return d
def dates(r,rolling=True):
 now=datetime.datetime.now(datetime.timezone.utc);date=email.utils.parsedate_to_datetime(r['Date'])
 assert date<=now,'Future Release'
 if 'Valid-Until' in r:assert now<email.utils.parsedate_to_datetime(r['Valid-Until']),'Expired Release'
 if rolling:assert now-date<datetime.timedelta(days=2),'Stale rolling Release'
def signed(name,key,signers):
 gpg=shutil.which('gpg',path=ENV['PATH']);assert gpg
 out=run([gpg,'--batch','--no-options','--homedir',WORK/'gnupg','--show-keys','--with-colons',D/key],name+'-key',30)
 primary=[];pending=False
 for row in out.splitlines():
  a=row.split(':')
  if a[0]=='pub':pending=True
  elif a[0]=='sub':pending=False
  elif a[0]=='fpr' and pending:primary.append(a[9]);pending=False
 assert set(primary)==signers,'Wrong pinned trust-anchor fingerprint'
 binary=WORK/(name+'.gpg')
 run([gpg,'--batch','--no-options','--homedir',WORK/'gnupg','--output',binary,'--dearmor',D/key],name+'-dearmor',30)
 status=run([gpg,'--batch','--no-options','--homedir',WORK/'gnupg','--no-default-keyring','--keyring',binary,'--status-fd','1','--verify',D/name],name+'-signature',30)
 rows=[l.split()[1:] for l in status.splitlines() if l.startswith('[GNUPG:] ')];assert not any(r and r[0] in BAD for r in rows)
 valid={r[-1] for r in rows if r and r[0]=='VALIDSIG'};assert valid==signers,'Signature issuer set mismatch'
 signedtext=(D/name).read_text();body=signedtext.split('\n\n',1)[1].split('-----BEGIN PGP SIGNATURE-----',1)[0]
 return fields('\n'.join(l[2:] if l.startswith('- ') else l for l in body.splitlines()).strip())
def download(url,path,size,digest):
 assert url.startswith(('https://archive.ubuntu.com/ubuntu/','https://security.ubuntu.com/ubuntu/','https://deb.debian.org/debian/','https://webkitgtk.org/releases/'))
 assert 0<size<=200*1024**2;room()
 if not path.exists():
  response=None
  for attempt in range(3):
   try:response=urllib.request.urlopen(url,timeout=30);break
   except urllib.error.HTTPError as error:
    if error.code not in (429,500,502,503,504) or attempt==2:raise
    room();time.sleep(attempt+1)
  assert response is not None
  with response,path.open('xb') as out:
   assert response.url.startswith(('https://archive.ubuntu.com/ubuntu/','https://security.ubuntu.com/ubuntu/','https://deb.debian.org/debian/','https://webkitgtk.org/releases/'))
   left=size
   while left:
    room();b=response.read(min(left,1024**2));assert b,'Truncated download';out.write(b);left-=len(b)
   assert not response.read(1),'Oversized download'
 assert path.stat().st_size==size and sha(path)==digest,'Downloaded identity mismatch'
 return path
def index_records(path,expected):
 h=hashlib.sha256();n=0;para=[];psize=0
 with lzma.open(path,'rb') as f:
  for line in f:
   n+=len(line);assert n<=expected['bytes']<=200*1024**2;h.update(line)
   if line.strip():para.append(line);psize+=len(line);assert psize<4*1024**2
   elif para:yield fields(b''.join(para).decode());para=[];psize=0
  if para:yield fields(b''.join(para).decode())
 assert n==expected['bytes'] and h.hexdigest()==expected['sha256'],'Decompressed index mismatch'
def verify_inputs():
 assert sha(D/'frozen-sdk-plan.json')==FROZEN and sha(D/'configure-packages.json')==PLAN
 assert sha(D/'normal-path-2.54.3.patch')==PATCH
 frozen=json.loads((D/'frozen-sdk-plan.json').read_text());plan=json.loads((D/'configure-packages.json').read_text());pkgs=plan['packages']
 assert len(pkgs)==833 and len({p['package'] for p in pkgs})==833
 byname={p['package']:p for p in pkgs}
 for old in frozen['packages']:
  assert all(byname[old['package']][k]==old[k] for k in ('version','sha256','bytes','architecture'))
 assert len(frozen['packages'])==716
 # The source's expired upstream detached signature is NOT an admitted route.
 r=signed('debian-sid.InRelease','debian-archive.asc',DEBIAN);assert (r['Origin'],r['Suite'],r['Codename'])==('Debian','unstable','sid');dates(r)
 t=table(r['SHA256']);e=t['main/source/Sources.xz'];x=download('https://deb.debian.org/debian/dists/sid/main/source/by-hash/SHA256/'+e['sha256'],WORK/'Sources.xz',e['bytes'],e['sha256'])
 selections=[s for s in index_records(x,t['main/source/Sources']) if s.get('Package')=='webkit2gtk' and s.get('Version')=='2.54.3-1'];assert len(selections)==1
 src=selections[0];assert src['Directory']=='pool/main/w/webkit2gtk';orig=table(src['Checksums-Sha256'])['webkit2gtk_2.54.3.orig.tar.xz'];assert orig=={'sha256':SOURCE,'bytes':50038244}
 emit(sourceProvenance='Debian archive InRelease/Sources/exact orig',sourceSha256=SOURCE,upstreamDetachedSignature='rejected-expired-key',debianReleaseSha256=sha(D/'debian-sid.InRelease'))
 verified=set()
 for suite,host in [('resolute','archive.ubuntu.com'),('resolute-updates','archive.ubuntu.com'),('resolute-security','security.ubuntu.com')]:
  r=signed(suite+'.InRelease','ubuntu-archive.asc',UBUNTU);assert (r['Origin'],r['Suite'],r['Codename'])==('Ubuntu',suite,'resolute');dates(r,suite!='resolute');t=table(r['SHA256'])
  for component in ('main','universe'):
   name=f'{host}_ubuntu_dists_{suite}_{component}_binary-amd64_Packages';wanted={p['package']:p for p in pkgs if p['index']==name}
   raw=f'{component}/binary-amd64/Packages';e=t[raw+'.xz'];path=download(f'https://{host}/ubuntu/dists/{suite}/{component}/binary-amd64/by-hash/SHA256/'+e['sha256'],WORK/(suite+'-'+component+'.xz'),e['bytes'],e['sha256'])
   for f in index_records(path,t[raw]):
    q=wanted.get(f.get('Package'))
    if not q or f.get('Version')!=q['version']:continue
    assert f['SHA256']==q['sha256'] and int(f['Size'])==q['bytes'] and f['Architecture']==q['architecture']
    assert urllib.parse.unquote(urllib.parse.urlparse(q['url']).path)=='/ubuntu/'+f['Filename']
    assert q['package'] not in verified;verified.add(q['package'])
 assert verified==set(byname),'Unsigned/unverified package entry'
 emit(verifiedSdkPackages=len(verified),preservedFrozenPackages=716,planSha256=PLAN)
 return pkgs,orig

def unpack(tar,root,budget):
 total=0;count=0;masked=0
 for m in tar:
  room();n=PurePosixPath(m.name);assert not n.is_absolute() and '..' not in n.parts
  dest=root.joinpath(*n.parts);assert dest==root or dest.parent.resolve().is_relative_to(root.resolve()),'Escaping parent'
  if m.isdir():dest.mkdir(parents=True,exist_ok=True);continue
  dest.parent.mkdir(parents=True,exist_ok=True)
  if m.issym():
   target=m.linkname
   if target.startswith('/'):target=os.path.relpath(root/target.lstrip('/'),dest.parent)
   assert (dest.parent/target).resolve().is_relative_to(root.resolve()),'Escaping link'
   if dest.is_symlink():assert os.readlink(dest)==target
   else:assert not dest.exists();dest.symlink_to(target)
  elif m.islnk():
   link=PurePosixPath(m.linkname);assert not link.is_absolute() and '..' not in link.parts
   source=root.joinpath(*link.parts);assert source.is_file() and source.resolve().is_relative_to(root.resolve())
   if dest.exists():assert sha(dest)==sha(source)
   else:os.link(source,dest)
  else:
   assert m.isfile(),'Special filesystem entry forbidden';total+=m.size;assert total<=budget
   assert not dest.is_symlink();f=tar.extractfile(m);h=hashlib.sha256()
   if dest.exists():
    for b in iter(lambda:f.read(1024**2),b''):h.update(b)
    assert sha(dest)==h.hexdigest(),'Non-identical duplicate payload'
   else:
    with dest.open('xb') as out:
     for b in iter(lambda:f.read(1024**2),b''):out.write(b);h.update(b)
    dest.chmod(m.mode&0o777) # no package set-ID privilege is recreated
   masked+=bool(m.mode&0o6000)
  count+=1
 return total,count,masked

def main():
 global WORK,ENV,PHASE
 assert len(sys.argv)==2;WORK=Path(sys.argv[1]);assert not WORK.exists();WORK.mkdir(mode=0o700)
 ENV={'PATH':'/usr/local/bin:/usr/bin:/bin','LANG':'C.UTF-8','HOME':str(WORK/'home'),'TMPDIR':str(WORK/'tmp')}
 for n in ('home','tmp','gnupg','packages','sdk','source'): (WORK/n).mkdir(mode=0o700)
 assert os.geteuid()!=0,'Ordinary job user required'
 osr=dict(l.strip().split('=',1) for l in Path('/etc/os-release').read_text().splitlines() if '=' in l)
 assert osr.get('ID','').strip('"')=='ubuntu' and osr.get('VERSION_ID','').strip('"')=='26.04','Matching Ubuntu 26.04 host required; host ABI substitution forbidden'
 assert os.uname().machine=='x86_64';free=shutil.disk_usage(WORK).free;assert free>=24*1024**3
 mem=int(re.search(r'MemAvailable:\s+(\d+)',Path('/proc/meminfo').read_text()).group(1))*1024;assert mem>=8*1024**3
 emit(ubuntu=osr.get('VERSION'),diskFreeBytes=free,memoryAvailableBytes=mem,maxSeconds=3300,fullEngine=False,uploads=False)
 PHASE='authenticated-inputs';pkgs,orig=verify_inputs()
 PHASE='sdk-download'
 def fetch(q):return download(q['url'],WORK/'packages'/q['file'],q['bytes'],q['sha256'])
 with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:list(pool.map(fetch,pkgs))
 emit(downloadedPackages=len(pkgs),archiveBytes=sum(q['bytes'] for q in pkgs))
 PHASE='sdk-extraction';total=0;masked=0;sdk=WORK/'sdk'
 for i,q in enumerate(pkgs):
  meta=run(['dpkg-deb','-f',WORK/'packages'/q['file'],'Package','Version','Architecture'],'package-metadata',30)
  f=fields(meta);assert (f['Package'],f['Version'],f['Architecture'])==(q['package'],q['version'],q['architecture'])
  proc=subprocess.Popen(['dpkg-deb','--fsys-tarfile',str(WORK/'packages'/q['file'])],stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,env=ENV)
  try:
   with tarfile.open(fileobj=proc.stdout,mode='r|') as tar:n,_,m=unpack(tar,sdk,5*1024**3-total)
   assert proc.wait(timeout=30)==0
  finally:
   if proc.poll() is None:proc.kill();proc.wait(timeout=5)
  total+=n;masked+=m
  if (i+1)%100==0:emit(extracted=i+1,regularBytes=total)
 emit(extracted=len(pkgs),regularBytes=total,setIdModesNotRecreated=masked,maintainerScripts=False)
 PHASE='source-and-patch';archive=download('https://webkitgtk.org/releases/webkitgtk-2.54.3.tar.xz',WORK/'source.tar.xz',orig['bytes'],SOURCE)
 with tarfile.open(archive,'r:xz') as tar:unpack(tar,WORK/'source',2*1024**3)
 source=WORK/'source/webkitgtk-2.54.3';assert source.is_dir()
 run(['patch','--batch','--fuzz=0','-p1','-i',D/'normal-path-2.54.3.patch'],'apply-reviewed-patch',60,cwd=source)
 locks=json.loads((D/'patched-files.json').read_text())
 for path,h in locks.items():assert sha(source/path)==h,'Patched file identity mismatch: '+path
 emit(patchSha256=PATCH,lockedPatchedFiles=len(locks),sourceSha256=SOURCE)
 PHASE='sdk-isolated-entry'
 assert (sdk/'lib').is_symlink() and (sdk/'lib').resolve()==(sdk/'usr/lib').resolve()
 assert (sdk/'usr/include').is_dir() and not (sdk/'include').exists()
 (sdk/'include').symlink_to('usr/include')
 from isolated_configure import run_pipeline
 run_pipeline(sys.modules[__name__],sdk,source)
if __name__=='__main__':
 try:main()
 except Exception as e:emit(status='failed',errorType=type(e).__name__,error=str(e)[:1500],fullEngine=False,installed=False,releaseReady=False);sys.exit(1)
