"""Prepare build-only SDK metadata for the exact product and retained runtime.

No installation, build, ELF execution, source edit or runtime loader override.
Only derived pkg-config prefix/libdir and an exact final RPATH are added; the
original CMake files and libraries remain unchanged and hash-bound.
"""
import argparse
import json
import os
from pathlib import Path
import re
import shlex
import subprocess

import install_gate
import runtime_intake

MODULES=('javascriptcoregtk-4.1','webkit2gtk-4.1','webkit2gtk-web-extension-4.1')
SOURCE_INPUTS=('package.json','pnpm-lock.yaml','release/update-channel.json',
    'apps/desktop/package.json','apps/desktop/src-tauri/Cargo.toml',
    'apps/desktop/src-tauri/Cargo.lock','apps/desktop/src-tauri/tauri.conf.json',
    'apps/desktop/src-tauri/build.rs','apps/desktop/src-tauri/src/plugin_dom_guard.c',
    'apps/desktop/src-tauri/src/output_guard.c','scripts/ci/prepare-bundled-plugins.mjs',
    'apps/desktop/src/reviewed-mermaid-package.ts')
require=runtime_intake.require
digest=runtime_intake.digest


def derive_pc(original, recipe, build_prefix):
    require(build_prefix.is_absolute() and not any(c.isspace() for c in str(build_prefix)), 'Canonical build prefix without whitespace')
    require(str(build_prefix)==str(build_prefix.resolve()), 'No build SDK aliases')
    text=original.decode('utf-8')
    require(text.count('prefix='+recipe['prefix']+'\n')==1, 'Exact CMake SDK prefix')
    require(text.count('libdir='+recipe['lib']+'\n')==1, 'Exact CMake SDK library path')
    require(re.findall(r'^Version: (.*)$',text,re.M)==['2.54.2'], 'Exact SDK version')
    require('rpath' not in text and '\x00' not in text, 'No pre-existing link override')
    result=text.replace('prefix='+recipe['prefix']+'\n','prefix='+str(build_prefix)+'\n')
    result=result.replace('libdir='+recipe['lib']+'\n','libdir='+str(build_prefix/'lib/x86_64-linux-gnu')+'\n')
    require(len(re.findall(r'^Libs: .*$',result,re.M))==1, 'One SDK library declaration')
    result=re.sub(r'^(Libs: .*)$',lambda m:m[1]+' -Wl,-rpath,'+recipe['lib'],result,flags=re.M)
    # Reversal proves this did not substitute feature declarations or dependencies.
    reverse=result.replace('prefix='+str(build_prefix)+'\n','prefix='+recipe['prefix']+'\n')
    reverse=reverse.replace('libdir='+str(build_prefix/'lib/x86_64-linux-gnu')+'\n','libdir='+recipe['lib']+'\n')
    reverse=reverse.replace(' -Wl,-rpath,'+recipe['lib'],'')
    require(reverse==text,'SDK metadata transformation must be reversible')
    return result.encode()


def source_identity(source, expected):
    def git(*args):return subprocess.check_output(['git','-C',str(source),*args],text=True,timeout=15).strip()
    require(git('rev-parse','HEAD')==expected,'Exact product source SHA')
    require(git('status','--porcelain')=='','Clean product source required')
    rows=[]
    for relative in SOURCE_INPUTS:
        p=source/relative
        require(p.is_file() and not p.is_symlink(),'Regular locked product input: '+relative)
        rows.append({'path':relative,'sha256':digest(p),'bytes':p.stat().st_size})
    channel=json.loads((source/'release/update-channel.json').read_text())
    config=json.loads((source/'apps/desktop/src-tauri/tauri.conf.json').read_text())
    require(channel['endpoints']==[] and channel['publicKey'] is None,'No production updater configuration')
    require(config['plugins']['updater']=={'pubkey':'','endpoints':[]},'Unchanged empty Tauri updater')
    build=(source/'apps/desktop/src-tauri/build.rs').read_text()
    for guard in ['plugin_dom_guard.c','output_guard.c']:
        require('"src/'+guard+'"' in build,'Both embedded guard compiles required')
    require(build.count('.args(["--cflags", "--libs", "webkit2gtk-web-extension-4.1"])')==2,'Both guards consume exact extension SDK')
    return rows


def prepare(source, intake, output):
    require(not output.exists(),'Fresh build-binding output')
    for key in ['LD_LIBRARY_PATH','LD_PRELOAD','PKG_CONFIG_SYSROOT_DIR','PKG_CONFIG_PATH','PKG_CONFIG_LIBDIR','RUSTFLAGS','CARGO_ENCODED_RUSTFLAGS','TAURI_CONFIG','WEBKIT_EXEC_PATH','WEBKIT_INJECTED_BUNDLE_PATH','WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS']:
        require(not os.environ.get(key),'Unreviewed build/loader override: '+key)
    inputs=source_identity(source,install_gate.APPLICATION_SHA)
    receipt=json.loads((intake/'receipt.json').read_text())
    report=json.loads((intake/'intake.json').read_text())
    require(report['runtimeZipSha256']==runtime_intake.RUNTIME_SHA and report['patchSha256']=='855e58cc8ad531cc32e893b8274983a6264e6fdfc248c13e80c5ef0e01d7a4e5','Exact retained runtime')
    recipe=json.loads((Path(__file__).parent/'qa-final-path-profile.json').read_text())
    require(report['prefix']==recipe['prefix'] and receipt['prefix']==recipe['prefix'],'Final prefix identity')
    require(digest(intake/'normal-cmake-install.tar.gz')==runtime_intake.TAR_SHA,'Original runtime still intact')
    records={r['path']:r for r in receipt['files']}
    dest=(intake/'destdir').resolve();build_prefix=dest/recipe['prefix'].lstrip('/')
    # Every SDK header, library and local alias is checked, not only .pc files.
    for row in records.values():
        p=dest/row['path'];require(p.resolve().is_relative_to(dest),'SDK path escape')
        require(not any(q.is_symlink() for q in p.parents if q.is_relative_to(dest)),'SDK parent alias')
        if row['kind']=='file':
            require(not p.is_symlink() and p.stat().st_size==row['bytes'] and digest(p)==row['sha256'],'SDK input identity: '+row['path'])
            require(p.stat().st_mode&0o777==row['mode'],'SDK mode identity')
        else:require(p.is_symlink() and str(p.readlink())==row['target'],'SDK alias identity')
    output.mkdir();pc=output/'pkgconfig';pc.mkdir();derived=[]
    for module in MODULES:
        original=build_prefix/'lib/x86_64-linux-gnu/pkgconfig'/f'{module}.pc'
        content=derive_pc(original.read_bytes(),recipe,build_prefix)
        target=pc/f'{module}.pc';target.write_bytes(content)
        derived.append({'module':module,'originalSha256':digest(original),'derivedSha256':digest(target),'file':str(target)})
    result={'status':'build-sdk-prepared-not-compiled-or-installed','applicationSourceSha':install_gate.APPLICATION_SHA,'runtimeZipSha256':runtime_intake.RUNTIME_SHA,'runtimePatchSha256':report['patchSha256'],'sourceInputs':inputs,'pkgConfig':derived,'buildPrefix':str(build_prefix),'finalPrefix':recipe['prefix'],'environment':{'PKG_CONFIG_PATH':str(pc.resolve()),'RUSTFLAGS':'-C link-arg=-Wl,-rpath,'+recipe['lib']},'mandatoryNext':['Validate real pkg-config --variable/--cflags/--libs on supported host','Build trusted bundled plugins and original Tauri frontend from exact source','Capture both actual embedded guard compile/output identities','Inspect application and guard ELF final RPATH and NEEDED','Strict stage/package gates and ordinary-user real mappings before native acceptance'],'buildExecuted':False,'installed':False}
    (output/'binding.json').write_text(json.dumps(result,indent=2)+'\n')
    return result


def verify_pkgconfig(binding, environment=None):
    # The optional environment supports isolated synthetic dependency fixtures.
    # Production caller passes no custom environment and uses the prepared path.
    env=dict(os.environ if environment is None else environment)
    require(not env.get('PKG_CONFIG_SYSROOT_DIR'),'No global sysroot rebasing host dependencies')
    env['PKG_CONFIG_PATH']=binding['environment']['PKG_CONFIG_PATH']
    prefix=Path(binding['buildPrefix']);final=binding['finalPrefix'];rows=[]
    require({r['module'] for r in binding['pkgConfig']}==set(MODULES) and len(binding['pkgConfig'])==3,'Exact derived SDK records')
    for row in binding['pkgConfig']:
        path=Path(binding['environment']['PKG_CONFIG_PATH'])/(row['module']+'.pc')
        require(path.is_file() and not path.is_symlink() and digest(path)==row['derivedSha256'],'Derived SDK identity before pkg-config')
    for module in MODULES:
        def run(*args):return subprocess.check_output(['pkg-config',*args,module],env=env,text=True,stderr=subprocess.STDOUT,timeout=15).strip()
        require(run('--modversion')=='2.54.2','Resolved SDK version')
        require(run('--variable=pcfiledir')==binding['environment']['PKG_CONFIG_PATH'],'System private SDK fallback')
        require(run('--variable=libdir')==str(prefix/'lib/x86_64-linux-gnu'),'Resolved SDK build libdir')
        flags=shlex.split(run('--cflags','--libs'))
        require('-I'+str(prefix/'include/webkitgtk-4.1') in flags,'Actual private include path')
        require('-L'+str(prefix/'lib/x86_64-linux-gnu') in flags,'Actual private link path')
        require('-Wl,-rpath,'+final+'/lib/x86_64-linux-gnu' in flags,'Both C guards receive final RPATH')
        require([x for x in flags if 'rpath' in x]==['-Wl,-rpath,'+final+'/lib/x86_64-linux-gnu'],'No additional RPATH in resolved SDK')
        require(not any('/usr/include/webkitgtk' in x or '/usr/lib' in x and ('webkit' in x or 'javascriptcore' in x) for x in flags),'System WebKit SDK leakage')
        rows.append({'module':module,'flags':flags})
    return {'status':'pkg-config-resolution-verified-not-compiled','modules':rows}


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('source',type=Path);p.add_argument('intake',type=Path);p.add_argument('output',type=Path);a=p.parse_args()
    result=prepare(a.source.resolve(),a.intake.resolve(),a.output.resolve());print(result['status'])
