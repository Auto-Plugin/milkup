"""Resolve the authenticated runtime's ELF dependencies without executing it.

This is a host compatibility inventory, not sandbox/process mapping acceptance.
It does not alter the loader configuration or install any runtime component.
"""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess

import runtime_intake as intake


def run(*args):
    return subprocess.check_output(args,text=True,stderr=subprocess.STDOUT,timeout=20)


def versions(text):
    definitions=set();needs={};mode=None;library=None
    for line in text.splitlines():
        if line.startswith('Version definition section'):mode='definitions'
        elif line.startswith('Version needs section'):mode='needs'
        elif line.startswith('Version symbols section'):mode=None
        if mode=='needs':
            found=re.search(r'File: (\S+)',line)
            if found:library=found[1];needs.setdefault(library,set())
        found=re.search(r'Name: (\S+)',line)
        if found and mode=='definitions':definitions.add(found[1])
        elif found and mode=='needs':
            intake.require(library is not None,'Version without dependency')
            needs[library].add(found[1])
    return definitions,needs


def check_versions(needs, definitions):
    for name,wanted in needs.items():
        intake.require(name in definitions and wanted<=definitions[name], 'Unsatisfied symbol versions: '+name+' '+str(sorted(wanted-definitions.get(name,set()))))


def inventory(root):
    report=json.loads((root/'intake.json').read_text())
    intake.require(report['runtimeZipSha256']==intake.RUNTIME_SHA and report['status']=='authenticated-staging-not-package-or-native-accepted','Authenticated intake required')
    release=dict(re.findall(r'^(\w+)="?([^"\n]*)"?$',Path('/etc/os-release').read_text(),re.M))
    intake.require(release.get('ID')=='ubuntu' and release.get('VERSION_ID')=='26.04','Exact supported QA host required')
    for name in ['LD_LIBRARY_PATH','LD_PRELOAD','WEBKIT_EXEC_PATH','WEBKIT_INJECTED_BUNDLE_PATH','WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS']:
        intake.require(not os.environ.get(name),'No loader or sandbox override: '+name)
    cache=run('/sbin/ldconfig','-p');available={}
    for name,attributes,path in re.findall(r'^\s*(\S+)\s+\(([^)]+)\)\s+=>\s+(\S+)',cache,re.M):
        if 'x86-64' in attributes:available.setdefault(name,set()).add(str(Path(path).resolve()))
    private={e['soname']:root/'destdir'/name.lstrip('/') for name,e in report['elf'].items() if e['soname']}
    objects={};defs={};queue=[root/'destdir'/name.lstrip('/') for name in report['elf']];edges=[]
    while queue:
        p=queue.pop(0)
        if str(p) in objects:continue
        intake.require(len(objects)<500,'Transitive ELF count budget')
        header=run('readelf','-h',str(p));intake.require('ELF64' in header and 'Advanced Micro Devices X86-64' in header,'Exact host architecture')
        dynamic=run('readelf','-d',str(p));needed=re.findall(r'\(NEEDED\).*?\[(.*?)\]',dynamic)
        defined,wanted=versions(run('readelf','--version-info',str(p)))
        row={'path':str(p),'sha256':intake.digest(p),'bytes':p.stat().st_size,'needed':needed,'versionNeeds':{k:sorted(v) for k,v in wanted.items()}}
        is_private=p.is_relative_to(root/'destdir')
        if not is_private:
            intake.require(p.is_relative_to('/usr/lib') or p.is_relative_to('/lib'),'Host library root')
            st=p.stat();intake.require(st.st_uid==0 and not st.st_mode&0o7022,'Protected host dependency')
            found=None
            for alias in [str(p),str(p).removeprefix('/usr')]:
                proc=subprocess.run(['dpkg-query','-S',alias],text=True,capture_output=True,timeout=15)
                if proc.returncode==0:
                    candidates=[l.rsplit(': ',1)[0] for l in proc.stdout.splitlines() if l.endswith(': '+alias)]
                    if len(set(candidates))==1:found=candidates[0];break
            intake.require(found is not None,'Official package ownership missing: '+str(p))
            row['package']=found;row['packageVersion']=run('dpkg-query','-W','-f=${Version}',found).strip()
        objects[str(p)]=row
        localdefs={}
        for name in needed:
            intake.require('/' not in name,'Named NEEDED dependency')
            if name in private:target=private[name]
            else:
                intake.require('webkit' not in name.lower() and 'javascriptcore' not in name.lower(),'No system runtime family fallback')
                choices=available.get(name,set());intake.require(len(choices)==1,'Missing/ambiguous host dependency: '+name+' '+str(sorted(choices)))
                target=Path(next(iter(choices)))
            key=str(target)
            if key not in defs:defs[key]=versions(run('readelf','--version-info',key))[0]
            localdefs[name]=defs[key];queue.append(target)
            edges.append({'from':str(p),'needed':name,'resolved':str(target),'private':name in private})
        check_versions(wanted,localdefs)
    return {'status':'elf-host-closure-passed-not-loaded-or-installed','runtimeZipSha256':intake.RUNTIME_SHA,'host':release,'objects':list(objects.values()),'edges':edges,'notCovered':['dlopen modules/resources','WebProcess actual mappings','Default sandbox behavior','Application ABI and assets','SBOM/static licenses','PDF or GUI acceptance']}


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('root',type=Path);p.add_argument('output',type=Path);a=p.parse_args()
    report={'status':'failed-host-closure','runtimeZipSha256':intake.RUNTIME_SHA}
    try:
        report=inventory(a.root)
    except Exception as error:
        report['error']=str(error)
        raise
    finally:
        with a.output.open('x') as out:out.write(json.dumps(report,indent=2)+'\n')
