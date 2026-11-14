"""Read-only exact-deb compatibility gate, before any GUI dependency install."""
import json,os,pathlib,platform,subprocess,sys
out=pathlib.Path(sys.argv[1]);out.mkdir(parents=True,exist_ok=True)
def call(args):
 p=subprocess.run(args,text=True,capture_output=True,timeout=30)
 return {'exit':p.returncode,'stdout':p.stdout,'stderr':p.stderr}
libc=call(['getconf','GNU_LIBC_VERSION']);version=libc['stdout'].strip().split()[-1]
policy=call(['apt-cache','policy','libwebkit2gtk-4.1-dev','libgtk-3-dev'])
packages={}
for name in ['libwebkit2gtk-4.1-dev','libgtk-3-dev']:
 p=call(['apt-cache','policy',name]);lines=[x.strip().split(':',1)[1].strip() for x in p['stdout'].splitlines() if x.strip().startswith('Candidate:')];packages[name]=lines[0] if lines else None
requirements=json.loads(pathlib.Path('docs/acceptance/linux-native-2026-11-14/b877-elf-requirements.json').read_text())
minimum=requirements['minimumRequiredGlibc']
abi=platform.machine()=='x86_64' and tuple(map(int,version.split('.'))) >= tuple(map(int,minimum.split('.')))
available=all(v and v!='(none)' for v in packages.values())
r={'sourceSha':os.environ['GITHUB_SHA'],'runner':os.environ['PROBE_RUNNER'],'image':os.environ.get('ImageVersion'),'uid':os.getuid(),'architecture':platform.machine(),'glibc':libc,'minimumGlibc':minimum,'weakRequirementsIgnored':True,'packageCandidates':packages,'aptPolicy':policy,'abiCompatible':abi,'guiDependenciesAvailable':available,'eligibleForSandboxProbe':abi and available,'productExecuted':False,'stopReason':None if abi and available else ('exact-b877-glibc-or-architecture-incompatible' if not abi else 'required-WebKitGTK-4.1-or-GTK3-package-unavailable')}
(out/'compatibility.json').write_text(json.dumps(r,indent=2)+'\n');print(json.dumps(r,indent=2))
with open(os.environ['GITHUB_OUTPUT'],'a') as f:f.write('eligible='+str(r['eligibleForSandboxProbe']).lower()+'\n')
