"""SDK-rooted configuration/resource diagnostic, not an engine or application run.
The outer caller authenticates all packages/source and preserves 24/12 GiB gates.
No host /usr, /lib, /etc, PATH or LD_LIBRARY_PATH is exposed to child tools.
"""
from pathlib import Path
import hashlib,json,os,re,shlex,stat,subprocess,time
from toolgate import Gate,Rejected,digest
PROGRAMS={'sh':['-c','printf sdk-shell-ready'],'uname':['-m'],'readlink':['--version'],'nproc':['--version'],'clang-19':['--version'],'clang++-19':['--version'],'cmake':['--version'],'ninja':['--version'],'ruby':['--version'],'perl':['-e','print $^V'],'python3':['--version'],'pkg-config':['--version'],'gperf':['--version'],'unifdef':['-V'],'bison':['--version'],'flex':['--version'],'glib-compile-resources':['--version'],'wayland-scanner':['--version'],'msgmerge':['--version'],'msgfmt':['--version'],'xgettext':['--version'],'g-ir-scanner':['--version'],'g-ir-compiler':['--version'],'gi-docgen':['--version'],'gdbus-codegen':['--help'],'bwrap':['--version'],'xdg-dbus-proxy':['--version']}
TARGET='WebCore/DerivedSources/UserAgentStyleSheetsData.cpp'
PREFIX='/opt/milkup/runtime-qa/webkitgtk-2.54.3-855e58cc8ad531cc'
def require(ok,message):
 if not ok:raise Rejected(message)
def inventory_tree(root):
 root=root.resolve();result={}
 for f in sorted(root.rglob('*')):
  require(f.resolve().is_relative_to(root),'SDK path escape')
  if f.is_file():
   q=f.resolve();require(stat.S_ISREG(q.stat().st_mode),'Nonregular SDK file');rel=str(q.relative_to(root));result[rel]={'sha256':digest(q)}
 return result

def exact_resource_commands(text):
 lines=text.splitlines();require(len(lines)==4,'Expected exactly four resource commands')
 rows=[shlex.split(l) for l in lines]
 for row in rows:require(row[:1]==['cd'] and row[2:3]==['&&'],'Unexpected shell command structure')
 base='/work/build';source='/source'
 for i,(src,dest) in enumerate([('Source/WTF/Scripts/GeneratePreferences.rb','WTF/Scripts/GeneratePreferences.rb'),('Source/WTF/Scripts/Preferences/UnifiedWebPreferences.yaml','WTF/Scripts/Preferences/UnifiedWebPreferences.yaml')]):
  row=rows[i];require(row[1]==base+'/Source/WTF/wtf' and row[3:6]==['/usr/bin/cmake','-E','copy_if_different'] and len(row)==8,'Changed copy command')
  require(os.path.normpath(row[6])==source+'/'+src and os.path.normpath(row[7])==base+'/'+dest,'Changed preference input/output')
 cat=rows[2];require(cat[1]==base+'/Source/WebCore' and cat[3:6]==['/usr/bin/cmake','-E','cat'],'Changed concatenation command')
 require(cat[-2:]==['>',base+'/WebCore/DerivedSources/ModernMediaControls.css'],'Changed CSS output')
 require(len(cat)>9 and all(x.startswith(source+'/Source/WebCore/Modules/modern-media-controls/controls/') and x.endswith('.css') and '..' not in Path(x).parts for x in cat[6:-2]),'Unexpected CSS input')
 perl=rows[3];require(perl[1]==base+'/Source/WebCore' and perl[3:6]==['/usr/bin/perl',source+'/Source/WebCore/css/make-css-file-arrays.pl','--defines'],'Changed generator/interpreter')
 require(perl[7:9]==[base+'/WebCore/DerivedSources/UserAgentStyleSheets.h',base+'/'+TARGET],'Changed generated output')
 require(perl[-1]==base+'/WebCore/DerivedSources/ModernMediaControls.css','Missing generated CSS dependency')
 require(all(x.startswith(source+'/Source/WebCore/') and x.endswith('.css') and '..' not in Path(x).parts for x in perl[9:-1]),'Unexpected generator input')
 for row in rows:
  require(not any(x in (';','||','|','&','<','>>') or any(c in x for c in ['`','$','\n','\r']) for x in row),'Unadmitted shell expansion')
 return {'commands':4,'sha256':hashlib.sha256(text.encode()).hexdigest(),'interpreters':['/usr/bin/cmake','/usr/bin/perl'],'fullEngine':False}

PROBE=r'''import os,sys,json,subprocess,hashlib,ctypes
from pathlib import Path
assert os.getuid()!=0
assert sys.executable.startswith('/usr/bin/')
assert os.environ['PATH']=='/usr/bin:/bin'
assert 'LD_LIBRARY_PATH' not in os.environ and 'PYTHONPATH' not in os.environ
assert not Path(sys.argv[1]).exists(), 'Host-only sentinel leaked into SDK root'
assert Path('/etc/os-release').read_text().find('26.04')>=0
libc=ctypes.CDLL(None);libc.gnu_get_libc_version.restype=ctypes.c_char_p
assert libc.gnu_get_libc_version()==b'2.43'
def file_sha(p):
 with p.open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
def mappings():
 paths=set()
 for l in Path('/proc/self/maps').read_text().splitlines():
  a=l.split(None,5)
  if len(a)==6 and a[5].startswith('/'):
   p=a[5];assert not p.endswith(' (deleted)');paths.add(p)
 return {p:file_sha(Path(p)) for p in sorted(paths)}
child=subprocess.run(['/usr/bin/perl','-e','use Config; use Getopt::Long; print "$^V\n$Config{archname}\n"; for my $k (sort keys %INC) { print "MODULE\t$k\t$INC{$k}\n"; }'],check=True,capture_output=True,text=True,env=dict(os.environ))
modules=[]
for l in child.stdout.splitlines():
 if l.startswith('MODULE\t'):
  _,name,p=l.split('\t');assert p.startswith('/usr/');modules.append({'name':name,'path':p,'sha256':file_sha(Path(p))})
print(json.dumps({'uid':os.getuid(),'glibc':'2.43','python':sys.version.split()[0],'executable':os.readlink('/proc/self/exe'),'maps':mappings(),'perlModules':modules,'hostSentinelAbsent':True,'pid':os.getpid(),'startTicks':Path('/proc/self/stat').read_text().rsplit(')',1)[1].split()[19]}))
'''
class Namespace:
 def __init__(self,runner,sdk,source,execution):
  self.m=runner;self.sdk=sdk.resolve();self.source=source.resolve();self.execution=execution.resolve()
  for child in [self.sdk,self.source]:require(not child.is_relative_to(self.execution),'Writable work mount must not expose SDK/source')
  b=Path('/usr/bin/bwrap');require(b.is_file() and b.stat().st_uid==0 and not b.stat().st_mode&0o022,'Trusted stock bwrap required');self.bwrap=b
 def argv(self,args,cwd='/work'):
  require(cwd=='/work' or cwd.startswith('/work/'),'Unexpected child cwd')
  return [str(self.bwrap),'--die-with-parent','--new-session','--unshare-user','--unshare-pid','--unshare-net','--unshare-ipc','--unshare-uts','--clearenv','--ro-bind',str(self.sdk),'/','--proc','/proc','--dev','/dev','--tmpfs','/tmp','--ro-bind',str(self.source),'/source','--bind',str(self.execution),'/work','--chdir',cwd,'--setenv','PATH','/usr/bin:/bin','--setenv','HOME','/work/home','--setenv','TMPDIR','/work/tmp','--setenv','LANG','C.UTF-8','--setenv','LC_ALL','C.UTF-8','--',*map(str,args)]
 def call(self,args,label,seconds=30,cwd='/work'):
  return self.m.run(self.argv(args,cwd),label,seconds,{'PATH':'/usr/bin:/bin','LANG':'C.UTF-8'},self.execution)

def map_receipt(receipt,sdk,inventory):
 require(receipt['hostSentinelAbsent'] is True and receipt['glibc']=='2.43' and receipt['uid']>0,'Namespace identity failed')
 paths=dict(receipt['maps']);paths.update({m['path']:m['sha256'] for m in receipt['perlModules']})
 for path,h in paths.items():
  require(path.startswith('/usr/') or path.startswith('/lib'),'Unexpected mapped runtime input')
  q=Gate(sdk,inventory).target(path);require(digest(q)==h,'Child mapped different SDK bytes')
 exe=Gate(sdk,inventory).target(receipt['executable']);require(digest(exe) in receipt['maps'].values(),'Executable not in actual mappings')
 return len(paths)

def run_pipeline(m,sdk,source):
 execution=m.WORK/'execution';execution.mkdir();(execution/'home').mkdir();(execution/'tmp').mkdir()
 # Mountpoints must exist before the SDK root is read-only. These are owned
 # empty directories, not package scripts or host filesystem modifications.
 for name in ['source','work','proc','dev','tmp']:
  d=sdk/name
  require(not d.is_symlink(),'SDK mountpoint symlink rejected')
  d.mkdir(exist_ok=True)
  require(d.is_dir(),'SDK mountpoint must be a directory')
  if name in ['source','work']:require(not any(d.iterdir()),'SDK bind destination must be empty')
 inv=inventory_tree(sdk);(m.WORK/'sdk-file-inventory.json').write_text(json.dumps(inv,sort_keys=True))
 require((sdk/'etc/os-release').is_file(),'Target Ubuntu identity missing')
 static=[]
 for name in PROGRAMS:static.append(Gate(sdk,inv).validate('/usr/bin/'+name))
 (m.WORK/'tool-static-closure.json').write_text(json.dumps(static))
 ns=Namespace(m,sdk,source,execution);(execution/'probe.py').write_text(PROBE)
 m.emit(hostNamespaceToolSha256=digest(ns.bwrap),sdkInventorySha256=digest(m.WORK/'sdk-file-inventory.json'),hostUsrMounted=False,namespaceRoutingProven=False)
 sentinel=m.WORK/'host-only-sentinel';sentinel.write_text('non-secret namespace visibility control\n')
 m.PHASE='actual-isolated-sdk-routing'
 receipt=json.loads(ns.call(['/usr/bin/python3','/work/probe.py',str(sentinel)],'namespace-routing',45));count=map_receipt(receipt,sdk,inv)
 m.emit(isolatedRouting=True,mappedInputs=count,hostFallback=False,uid=receipt['uid'],glibc=receipt['glibc'],python=receipt['python'],pid=receipt['pid'],startTicks=receipt['startTicks'],executable=receipt['executable'],actualMaps=receipt['maps'],perlModules=receipt['perlModules'])
 from locale_gate import run_locale_pair
 run_locale_pair(m,ns,sdk,inv)
 for name,args in PROGRAMS.items():
  out=ns.call(['/usr/bin/'+name,*args],'isolated-'+name,30)
  m.emit(tool=name,sha256=digest(Gate(sdk,inv).target('/usr/bin/'+name)),version=out[:180].strip())
 (execution/'smoke.cpp').write_text('#include <string>\nint main(){std::string s="sdk";return s.size()!=3;}\n')
 ns.call(['/usr/bin/clang++-19','--sysroot=/','--gcc-toolchain=/usr','/work/smoke.cpp','-o','/work/smoke'],'isolated-real-clang-compile-link',60)
 ns.call(['/work/smoke'],'isolated-real-clang-execute',15)
 m.emit(compilerFixtureSha256=digest(execution/'smoke'))
 m.PHASE='actual-isolated-webkit-configure'
 common='--gcc-toolchain=/usr -g1 -O2 -ffile-prefix-map=/workspace=. -fstack-protector-strong -fstack-clash-protection -Wformat -Werror=format-security -fcf-protection -Wdate-time -D_FORTIFY_SOURCE=2'
 cmd=['/usr/bin/cmake','-G','Ninja','-S','/source','-B','/work/build','--trace-expand','--trace-format=json-v1','--trace-redirect=/work/cmake-trace.fifo','-DPORT=GTK','-DCMAKE_BUILD_TYPE=Release','-DDEVELOPER_MODE=OFF','-DENABLE_BUBBLEWRAP_SANDBOX=ON','-DUSE_GTK4=OFF','-DENABLE_MINIBROWSER=OFF','-DCMAKE_INSTALL_PREFIX='+PREFIX,'-DLIB_INSTALL_DIR='+PREFIX+'/lib/x86_64-linux-gnu','-DLIBEXEC_INSTALL_DIR='+PREFIX+'/lib/x86_64-linux-gnu/webkit2gtk-4.1','-DCMAKE_INSTALL_RPATH='+PREFIX+'/lib/x86_64-linux-gnu','-DCMAKE_INSTALL_RPATH_USE_LINK_PATH=OFF','-DCMAKE_SKIP_INSTALL_RPATH=OFF','-DCMAKE_EXPORT_COMPILE_COMMANDS=ON','-DCMAKE_C_COMPILER=/usr/bin/clang-19','-DCMAKE_CXX_COMPILER=/usr/bin/clang++-19','-DCMAKE_FIND_ROOT_PATH=/','-DCMAKE_FIND_ROOT_PATH_MODE_PROGRAM=ONLY','-DCMAKE_PREFIX_PATH=/usr','-DCMAKE_SYSROOT=/','-DCMAKE_C_FLAGS_RELEASE=','-DCMAKE_CXX_FLAGS_RELEASE=','-DCMAKE_C_FLAGS='+common+' -Werror=implicit-function-declaration','-DCMAKE_CXX_FLAGS='+common,'-DCMAKE_EXE_LINKER_FLAGS=-Wl,-z,relro -Wl,-z,now','-DCMAKE_SHARED_LINKER_FLAGS=-Wl,-z,relro -Wl,-z,now']
 from stream_trace import run_traced,require_complete
 obligations=json.loads((Path(__file__).parent/'deferred-cmake-obligations.json').read_text())
 summary=run_traced(ns.argv(cmd),fifo=execution/'cmake-trace.fifo',log=m.WORK/'isolated-webkit-cmake.log',obligations=obligations,mounts={'/source':source,'/usr':sdk/'usr','/work':execution},env={'PATH':'/usr/bin:/bin','LANG':'C.UTF-8'},cwd=execution,timeout=min(900,max(1,m.DEADLINE-time.monotonic())),room=m.room)
 summary_bytes=json.dumps(summary,sort_keys=True).encode();require(len(summary_bytes)<=32*1024**2,'Summary serialization bound')
 (m.WORK/'actual-cmake-stream-summary.json').write_bytes(summary_bytes)
 m.emit(actualCmakeStream=summary)
 require_complete(summary)
 build=execution/'build'
 certificate=verify_generated_configure(summary,build,m.WORK/'isolated-webkit-cmake.log')
 m.emit(**certificate)
 m.PHASE='bounded-isolated-generated-resource'
 commands=ns.call(['/usr/bin/ninja','-C','/work/build','-t','commands',TARGET],'isolated-resource-command-closure',30)
 contract=admit_resource(summary,certificate,build,commands);m.emit(admittedResourceCommands=commands.splitlines());graph_hash=digest(build/'build.ninja')
 ns.call(['/usr/bin/ninja','-C','/work/build','-j2','-v',TARGET],'isolated-generate-actual-resource',300)
 require(digest(build/'build.ninja')==graph_hash,'Graph changed during resource execution')
 resource=build/TARGET;require(resource.is_file() and resource.stat().st_size>1000,'Real generated resource required')
 m.emit(status='passed-isolated-Ubuntu-configure-and-four-resource-commands-only',resourceBytes=resource.stat().st_size,resourceSha256=digest(resource),commandCount=contract['commands'],commandSha256=contract['sha256'],fullEngine=False,installed=False,nativeAcceptance=False,releaseReady=False)


def verify_generated_configure(summary,build,log):
 from stream_trace import require_complete
 require_complete(summary)
 cache=(build/'CMakeCache.txt').read_text();cfg=(build/'cmakeconfig.h').read_text()
 for token in ['#define USE_GTK4 0','#define ENABLE_BUBBLEWRAP_SANDBOX 1','#define HAVE_GTK_UNIX_PRINTING 1','#define WEBKITGTK_API_VERSION "4.1"','#define ENABLE_DEVELOPER_MODE 0']:
  name=token.split()[1];definitions=[line for line in cfg.splitlines() if re.match(r'^#define\s+'+re.escape(name)+r'(?:\s|$)',line)]
  require(definitions==[token],'Missing/ambiguous generated feature: '+token)
 for token in ['DEVELOPER_MODE:BOOL=OFF','USE_GTK4:BOOL=OFF']:
  name=token.split(':')[0];entries=[line for line in cache.splitlines() if line.startswith(name+':')];require(entries==[token],'Feature cache mismatch/ambiguity')
 require('Manually-specified variables were not used' not in log.read_text(),'Unused required CMake option')
 commands=json.loads((build/'compile_commands.json').read_text());require(isinstance(commands,list) and commands,'Actual compile database required')
 graph=build/'build.ninja';require(graph.is_file() and graph.stat().st_size>0,'Generated Ninja graph required')
 return {'configurationArtifactsVerified':True,'streamSha256':summary['rawSha256'],'cmakeCacheSha256':digest(build/'CMakeCache.txt'),'generatedConfigSha256':digest(build/'cmakeconfig.h'),'ninjaGraphSha256':digest(graph),'compileDbSha256':digest(build/'compile_commands.json'),'api':'GTK3/API4.1','sandboxEnabled':True}

def admit_resource(summary,certificate,build,commands):
 from stream_trace import require_complete
 require_complete(summary)
 require(certificate.get('configurationArtifactsVerified') is True and certificate['streamSha256']==summary['rawSha256'],'Independent configuration certificate required')
 for key,name in [('cmakeCacheSha256','CMakeCache.txt'),('generatedConfigSha256','cmakeconfig.h'),('ninjaGraphSha256','build.ninja'),('compileDbSha256','compile_commands.json')]:require(digest(build/name)==certificate[key],'Generated evidence changed before resource admission')
 return exact_resource_commands(commands)
