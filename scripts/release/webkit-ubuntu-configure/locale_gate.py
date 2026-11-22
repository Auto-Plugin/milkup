"""Same SDK-root locale A/B gate. A host loader probe is not admissible here."""
from pathlib import Path
import json,os
from toolgate import Gate,Rejected,digest
def require(ok,message):
 if not ok:raise Rejected(message)
SCRIPT=r'''import locale,json,os,subprocess,hashlib
from pathlib import Path
assert os.getuid()!=0 and 'LOCPATH' not in os.environ and 'LD_LIBRARY_PATH' not in os.environ
assert os.environ['LC_ALL']=='C.UTF-8'
def sha(p):
 with p.open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
root=Path('/usr/lib/locale');files={str(p):sha(p) for p in sorted(root.rglob('*')) if p.is_file()}
try:
 effective=locale.setlocale(locale.LC_ALL,'C.UTF-8');available=True
except locale.Error:
 effective=locale.setlocale(locale.LC_ALL);available=False
child=subprocess.run(['/usr/bin/perl','-MPOSIX','-e','my $x=setlocale(LC_ALL,"C.UTF-8"); print defined($x)?"locale=$x\\n":"locale=UNAVAILABLE\\n"; exit(defined($x)?0:7);'],capture_output=True,text=True,env=dict(os.environ),timeout=15)
maps={}
for line in Path('/proc/self/maps').read_text().splitlines():
 a=line.split(None,5)
 if len(a)==6 and a[5].startswith('/usr/lib/locale/'):
  assert not a[5].endswith(' (deleted)');maps[a[5]]=sha(Path(a[5]))
print(json.dumps({'uid':os.getuid(),'pid':os.getpid(),'startTicks':Path('/proc/self/stat').read_text().rsplit(')',1)[1].split()[19],'localeAvailable':available,'effectiveLocale':effective,'localeFiles':files,'localeMaps':maps,'perlExit':child.returncode,'perlStdout':child.stdout,'perlStderr':child.stderr}))
'''
def locale_files(sdk,inventory):
 root=sdk/'usr/lib/locale';require(root.is_dir() and not root.is_symlink(),'Authenticated target locale root required')
 files={}
 for f in sorted(root.rglob('*')):
  require(not f.is_symlink(),'Locale symlink rejected')
  if f.is_file():
   q=Gate(sdk,inventory).owned(f);files['/'+str(q.relative_to(sdk.resolve()))]=digest(q)
 require(len(files)==12 and all(k.startswith('/usr/lib/locale/C.utf8/') for k in files),'Exact C.utf8 locale data closure required')
 return files

def negative_argv(namespace,args,empty):
 empty=Path(empty);require(empty.is_dir() and not empty.is_symlink() and empty.stat().st_uid==os.getuid() and not any(empty.iterdir()),'Owned empty negative locale directory required')
 require(empty.resolve().is_relative_to(namespace.execution),'Negative fixture must stay in owned work')
 argv=namespace.argv(args);i=argv.index('--');argv[i:i]=['--ro-bind',str(empty),'/usr/lib/locale'];return argv

def verify_pair(positive,negative,expected):
 for r in [positive,negative]:
  require(type(r.get('uid')) is int and r['uid']>0 and type(r.get('pid')) is int and r['pid']>0 and str(r.get('startTicks','')).isdigit(),'Actual ordinary child identity required')
 require(positive['localeAvailable'] is True and positive['effectiveLocale'] in ['C.UTF-8','C.utf8'],'Effective target UTF-8 locale required')
 require(positive['localeFiles']==expected and positive['localeMaps'] and all(expected.get(k)==v for k,v in positive['localeMaps'].items()),'Positive locale bytes/mappings mismatch')
 require(positive['perlExit']==0 and positive['perlStdout'] in ['locale=C.UTF-8\n','locale=C.utf8\n'] and positive['perlStderr']=='','Target Perl locale failure/warning')
 require(negative['localeAvailable'] is False and negative['effectiveLocale'] in ['C','POSIX'] and negative['localeFiles']=={} and negative['localeMaps']=={},'No-data control fell back to locale data')
 require(negative['perlExit']==7 and negative['perlStdout']=='locale=UNAVAILABLE\n' and 'Setting locale failed' in negative['perlStderr'],'Expected target-data-absent rejection required')
 return {'localePairVerified':True,'localeFiles':len(expected),'hostFallback':False,'localeNegativeExit':7,'positivePid':positive['pid'],'positiveStartTicks':positive['startTicks'],'negativePid':negative['pid'],'negativeStartTicks':negative['startTicks']}

def run_locale_pair(m,ns,sdk,inventory):
 expected=locale_files(sdk,inventory);script=ns.execution/'locale-probe.py';script.write_text(SCRIPT)
 positive=json.loads(ns.call(['/usr/bin/python3','/work/locale-probe.py'],'actual-locale-present',45))
 empty=ns.execution/'locale-absent';empty.mkdir(mode=0o700)
 argv=negative_argv(ns,['/usr/bin/python3','/work/locale-probe.py'],empty)
 negative=json.loads(m.run(argv,'actual-locale-absent',45,{'PATH':'/usr/bin:/bin','LANG':'C.UTF-8'},ns.execution))
 receipt={'positive':positive,'negative':negative,'status':'unverified'};path=m.WORK/'locale-pair.json';path.write_text(json.dumps(receipt,indent=2))
 try:result=verify_pair(positive,negative,expected)
 except Exception as error:
  receipt.update(status='rejected',error=str(error));path.write_text(json.dumps(receipt,indent=2));raise
 receipt.update(status='passed',result=result);path.write_text(json.dumps(receipt,indent=2))
 m.emit(actualLocalePair={'positive':positive,'negative':negative,'result':result})
 return result
