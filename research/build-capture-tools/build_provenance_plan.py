"""Exact-source, local-only next-build collection plan and bounded collector.
Build requires explicit --execute; no install/CI/network invocation. Does not turn new evidence into old-package proof.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import signal
import shutil
import subprocess
import tarfile
import time
import uuid
import zipfile

import capture_support as g
import capture_support as r
import capture_support as u

META = ['build.ninja','CMakeFiles/rules.ninja','CMakeCache.txt','compile_commands.json',
        'cmakeconfig.h','.ninja_deps','.ninja_log','install_manifest.txt']
SUFFIXES = {'.h','.hpp','.hxx','.c','.cc','.cpp','.cxx','.inc','.in','.gir','.xml','.sh','.json'}


def rel(name):
    if name.startswith(u.BUILD_ROOT):name=name[len(u.BUILD_ROOT):]
    return u.relative(name)


def make_plan(evidence):
    r.require(r.digest(evidence)==r.EVIDENCE_SHA,'Exact successful original build evidence')
    with zipfile.ZipFile(evidence) as z:
        old=json.loads(z.read('result.json')); ninja=u.restore_parts(z,'build.ninja')
        commands=u.restore_parts(z,'compile_commands.json')
    required={x:'build-metadata' for x in META}; hashes={}; links=[]
    for row in json.loads(commands):
        if row['file'].startswith(u.BUILD_ROOT):
            name=rel(row['file']); required[name]='actual-generated-compile-input'
            if name.endswith('cmake_pch.hxx.cxx'):required[name.removesuffix('.cxx')]='actual-pch-header'
    for edge in g.graph_records(ninja.decode()):
        for name in edge['outputs']:
            if name.startswith('/') or '$' in name:continue
            name=rel(name)
            if edge['rule']=='CUSTOM_COMMAND' and PurePosixPath(name).suffix in SUFFIXES:
                required.setdefault(name,'declared-generated-output')
            if name.endswith(('.o','.a','.pch')):hashes[name]='object/archive/PCH-byte-identity'
        variables=edge['variables']
        for dep in [variables.get('DEP_FILE'),variables.get('RSP_FILE')]:
            if dep and '$' not in dep:required[rel(dep)]='actual-dependency-or-response-file'
        for text in variables.values():
            for path in re.findall(r'@([^\s]+\.rsp)|--dependency-file=([^\s]+)',text):
                name=next(x for x in path if x); required[rel(name)]='link-response-or-dependency-file'
            for name in re.findall(r'(?:^|\s)(Source/[^\s;]+\.sh)(?:\s|$)',text):required[rel(name)]='cmake-generated-command-script'
        if 'LINKER__' in edge['rule'] and 'STATIC_LIBRARY' not in edge['rule']:
            links.append({'outputs':edge['outputs'],'edgeSha256':edge['edgeSha256'],
                          'linkFlags':variables.get('LINK_FLAGS',''),'linkLibraries':variables.get('LINK_LIBRARIES',''),
                          'archiveInputs':[x for x in edge['inputs'] if x.endswith('.a')]})
    return {'schema':1,'status':'dry-plan-not-executed','nextBuildId':str(uuid.uuid4()),
            'referenceEvidenceSha256':r.EVIDENCE_SHA,'sourceArchiveSha256':old['sourceArchiveSha256'],
            'patchSha256':old['patchSha256'],'buildRoot':u.BUILD_ROOT.rstrip('/'),
            'sourceRoot':u.SOURCE_ROOT.rstrip('/'),'originalConfiguration':old['configuration'],
            'configureOptions':old['configureOptions'],'knownToolIdentities':old['tools'],
            'graphSha256':u.sha(ninja),'compileDatabaseSha256':u.sha(commands),
            'normalBuildArgv':[old['tools']['ninja']['path'],'-v','-d','keepdepfile','-d','keeprsp','-k','0','-j','2','all'],
            'argvDeltaFromOriginal':['-d','keeprsp'],
            'budgets':{'buildSeconds':12000,'collectionSeconds':1200,'totalSeconds':21300,
                       'minimumStartFreeBytes':20*1024**3,'minimumReserveBytes':2*1024**3,
                       'maximumLogBytes':256*1024**2,'maximumCopiedBytes':4*1024**3,'maximumFileBytes':256*1024**2},
            'requiredFiles':[{'path':k,'reason':v} for k,v in sorted(required.items())],
            'identityOnlyFiles':[{'path':k,'reason':v} for k,v in sorted(hashes.items())],
            'linkTargets':links,'linkerMapGate':'pending exact linker admission and same-output comparison; no map flags added to original graph',
            'hostInputs':['/usr/share/wayland-protocols/unstable/pointer-constraints/pointer-constraints-unstable-v1.xml',
                          '/usr/share/wayland-protocols/unstable/relative-pointer/relative-pointer-unstable-v1.xml',
                          '/usr/lib/x86_64-linux-gnu/libsysprof-capture-4.a','/usr/bin/ld'],
            'completeSbom':False,'distribution':'local only; never auto-upload full provenance'}


def source_check(plan,archive,source,patch_directory=None):
    r.require(str(source.resolve())==plan['sourceRoot'] and r.digest(archive)==plan['sourceArchiveSha256'],
              'Exact actual source root and official archive')
    patch_directory=patch_directory or Path(__file__).parent
    lock=json.loads((patch_directory/'normal-path-2.54.2.json').read_text())
    r.require(lock['patchSha256']==plan['patchSha256'] and r.digest(patch_directory/'normal-path-2.54.2.patch')==plan['patchSha256'],'Exact patch lock')
    files={};aliases={};start=time.monotonic()
    with tarfile.open(archive,'r:xz') as t:
        for member in t:
            r.require(time.monotonic()-start<600,'Source verification time budget')
            if member.isdir():continue
            r.require(member.name.startswith('webkitgtk-2.54.2/'),'Official source root')
            name=u.relative(member.name.removeprefix('webkitgtk-2.54.2/'))
            if member.issym():
                r.require(name=='Source/ThirdParty/skia/src/ports/fontations/Cargo.toml'
                          and member.linkname=='../../../bazel/external/fontations/Cargo.toml','Only exact archive-declared source alias')
                aliases[name]=member.linkname;continue
            r.require(member.isfile(),'Official regular source only')
            original=hashlib.file_digest(t.extractfile(member),'sha256').hexdigest()
            if name in lock['inputs']:r.require(original==lock['inputs'][name],'Exact patched source preimage')
            expected=lock['outputs'].get(name,original)
            if name in files:r.require(files[name]==expected,'Exact duplicate source identity')
            files[name]=expected
    for name in lock['newFiles']:files[name]=lock['outputs'][name]
    receipt={'nextBuildId':plan['nextBuildId'],'sourceRoot':plan['sourceRoot'],
             'sourceArchiveSha256':plan['sourceArchiveSha256'],'patchSha256':plan['patchSha256'],
             'files':files,'aliases':aliases,'status':'official-source-and-patch-bytes-checked'}
    verify_source(plan,receipt)
    return receipt


def verify_source(plan,receipt):
    r.require(receipt['nextBuildId']==plan['nextBuildId'] and receipt['status']=='official-source-and-patch-bytes-checked'
              and all(receipt[k]==plan[k] for k in ['sourceRoot','sourceArchiveSha256','patchSha256']),'Same exact new source receipt')
    root=Path(plan['sourceRoot']);seen=set();seen_aliases=set();start=time.monotonic()
    for file in root.rglob('*'):
        r.require(time.monotonic()-start<600,'Actual source recheck time budget')
        if file.is_symlink():
            name=str(file.relative_to(root));r.require(name in receipt['aliases'] and os.readlink(file)==receipt['aliases'][name],
                                                     'Only exact declared source aliases')
            target=file.resolve();r.require(target.is_relative_to(root) and str(target.relative_to(root)) in receipt['files'],
                                           'Source alias resolves to a declared in-tree regular file')
            seen_aliases.add(name);continue
        if file.is_dir():continue
        name=str(file.relative_to(root));r.require(name in receipt['files'] and r.digest(file)==receipt['files'][name],'Unmodified official+patched input: '+name)
        seen.add(name)
    r.require(seen==set(receipt['files']),'No absent official source inputs')
    r.require(seen_aliases==set(receipt['aliases']),'No absent official source aliases')


def verify_build(plan, build, source_receipt=None):
    r.require(source_receipt is not None,'Full same-build source-tree verification required')
    verify_source(plan,source_receipt)
    r.require(str(build.resolve())==plan['buildRoot'],'Exact original absolute build root')
    checks={'build.ninja':plan['graphSha256'],'compile_commands.json':plan['compileDatabaseSha256'],
            'CMakeCache.txt':plan['originalConfiguration']['cacheSha256'],
            'cmakeconfig.h':plan['originalConfiguration']['configSha256']}
    for name,digest in checks.items():r.require(r.digest(build/name)==digest,'Unchanged configuration/graph: '+name)
    for name,row in plan['knownToolIdentities'].items():
        r.require(r.digest(Path(row['resolved']))==row['sha256'],'Known original tool identity: '+name)


def collect(plan,build,out,source_receipt=None):
    r.require(not out.exists(),'Fresh local collection; preserve prior failure')
    verify_build(plan,build,source_receipt)
    out.mkdir(); blobs=out/'blobs';blobs.mkdir(); started=time.monotonic(); total=0
    report={'nextBuildId':plan['nextBuildId'],'planSha256':canonical(plan),'status':'collecting',
            'files':[],'missing':[],'completeSbom':False,'packageBound':False,'buildExecutedByCollector':False}
    try:
        for mode,key in [('bytes','requiredFiles'),('hash','identityOnlyFiles')]:
            for row in plan[key]:
                r.require(time.monotonic()-started<plan['budgets']['collectionSeconds'],'Collection time limit')
                r.require(shutil.disk_usage(out).free>=plan['budgets']['minimumReserveBytes'],'Evidence disk reserve')
                name=rel(row['path']); path=build/name
                if not path.is_file():report['missing'].append(row);continue
                r.require(not path.is_symlink() and path.resolve().is_relative_to(build.resolve()),'No evidence path alias')
                before=path.stat();r.require(before.st_nlink==1,'Unique evidence source file')
                digest=r.digest(path)
                rec={**row,'bytes':before.st_size,'sha256':digest,'retention':mode}
                if mode=='bytes':
                    total+=before.st_size
                    r.require(before.st_size<=plan['budgets']['maximumFileBytes'] and total<=plan['budgets']['maximumCopiedBytes'],'Bounded lossless evidence bytes')
                    target=blobs/digest
                    if not target.exists():shutil.copyfile(path,target)
                    r.require(r.digest(target)==digest,'Copied evidence identity');rec['blob']='blobs/'+digest
                after=path.stat();r.require((before.st_ino,before.st_size,before.st_mtime_ns,before.st_ctime_ns)==
                                           (after.st_ino,after.st_size,after.st_mtime_ns,after.st_ctime_ns),'Stable evidence file')
                report['files'].append(rec)
        report['status']='collected-declared-files-not-complete-sbom' if not report['missing'] else 'incomplete-required-files'
        report['pending']=['normal build exit and exact tool/linker/host receipts','archive member extraction/live-section evidence',
                           'app build, CMake staging and actual next-package payload binding','applicable notice/obligation review']
    except Exception as e:
        report.update(status='failed-bounded-collection',error=str(e));raise
    finally:
        (out/'receipt.json').write_text(json.dumps(report,indent=2)+'\n')
    return report


def canonical(value):return u.sha(json.dumps(value,sort_keys=True,separators=(',',':')).encode())


def bounded_build(plan, build, out, source_receipt=None):
    """Explicit future operation, never called by plan/collect or any workflow."""
    r.require(os.geteuid()!=0 and not out.exists(),'Ordinary build user and fresh evidence')
    verify_build(plan,build,source_receipt)
    r.require(shutil.disk_usage(build).free>=plan['budgets']['minimumStartFreeBytes'],'Build free-space prerequisite')
    expected=[plan['knownToolIdentities']['ninja']['path'],'-v','-d','keepdepfile','-d','keeprsp','-k','0','-j','2','all']
    r.require(plan['normalBuildArgv']==expected,'Only original all-target build plus response retention')
    r.require(0<plan['budgets']['buildSeconds']<=15000 and plan['budgets']['maximumLogBytes']<=256*1024**2,'Fixed build bounds')
    out.mkdir(); started=time.monotonic(); log=out/'normal-build.log'
    report={'status':'running','nextBuildId':plan['nextBuildId'],'planSha256':canonical(plan),
            'argv':expected,'normalBuildExitCode':None,'mapComparison':'not-run','completeSbom':False}
    proc=None;stop=None
    try:
        with log.open('xb') as f:
            proc=subprocess.Popen(expected,cwd=build,stdout=f,stderr=subprocess.STDOUT,start_new_session=True)
            while proc.poll() is None:
                if time.monotonic()-started>=plan['budgets']['buildSeconds']:stop='deadline'
                elif log.stat().st_size>plan['budgets']['maximumLogBytes']:stop='log-budget'
                elif shutil.disk_usage(build).free<plan['budgets']['minimumReserveBytes']:stop='disk-reserve'
                if stop:break
                time.sleep(.25)
            if stop:
                os.killpg(proc.pid,signal.SIGTERM)
                try:proc.wait(timeout=10)
                except subprocess.TimeoutExpired:pass
                try:os.killpg(proc.pid,signal.SIGKILL)
                except ProcessLookupError:pass
            report['normalBuildExitCode']=proc.wait(timeout=10)
        report['status']='normal-build-completed-not-package' if report['normalBuildExitCode']==0 and not stop else 'failed-normal-build'
        report['stopReason']=stop
        verify_build(plan,build,source_receipt) # Source/graph/config identity must still match.
    except Exception as error:
        report.update(status='failed-normal-build',error=str(error));raise
    finally:
        if proc is not None and proc.poll() is None:
            os.killpg(proc.pid,signal.SIGKILL);proc.wait(timeout=10)
        report['elapsedSeconds']=time.monotonic()-started
        (out/'receipt.json').write_text(json.dumps(report,indent=2)+'\n')
    return report


def bind_next_package(build_receipt, staging_receipt, application_receipt, package_receipt):
    """Receipt conjunction only; requires independently byte-verified payload origins."""
    run=build_receipt['nextBuildId']
    r.require(all(x['nextBuildId']==run for x in [staging_receipt,application_receipt,package_receipt]),'Same new build lineage')
    r.require(build_receipt['normalBuildExitCode']==0 and build_receipt['mapComparison']=='exact-final-bytes-equal',
              'Actual next normal build and same-output map replay required')
    r.require(package_receipt['payloadBytesVerified'] is True and package_receipt['originsVerified'] is True,'Actual package byte/origin verification')
    r.require(package_receipt['runtimeReceiptSha256']==canonical(staging_receipt)
              and package_receipt['applicationReceiptSha256']==canonical(application_receipt),'Exact new package inputs')
    r.require(re.fullmatch('[0-9a-f]{64}',package_receipt['packageSha256']) is not None,'Exact new package SHA')
    return {'status':'new-package-lineage-bound-not-license-cleared','packageSha256':package_receipt['packageSha256'],
            'nextBuildId':run,'completeSbom':False,'oldPackageProvenanceSubstitutionAllowed':False}


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('mode',choices=['plan','source-check','collect','build']);p.add_argument('input',type=Path)
    p.add_argument('output',type=Path);p.add_argument('--build',type=Path);p.add_argument('--execute',action='store_true')
    p.add_argument('--patch-directory',type=Path);p.add_argument('--archive',type=Path);p.add_argument('--source-receipt',type=Path);a=p.parse_args()
    source=json.loads(a.source_receipt.read_text()) if a.source_receipt else None
    if a.mode=='plan':
        r.require(not a.output.exists(),'Fresh dry plan');d=make_plan(a.input);a.output.write_text(json.dumps(d,indent=2)+'\n')
    elif a.mode=='source-check':
        r.require(not a.output.exists(),'Fresh source receipt');plan=json.loads(a.input.read_text())
        d=source_check(plan,a.archive,Path(plan['sourceRoot']),a.patch_directory);a.output.write_text(json.dumps(d,indent=2)+'\n')
    elif a.mode=='collect':d=collect(json.loads(a.input.read_text()),a.build,a.output,source)
    else:
        r.require(a.execute,'No implicit build: explicit future --execute required')
        d=bounded_build(json.loads(a.input.read_text()),a.build,a.output,source)
    print(json.dumps({k:d[k] for k in ['status','nextBuildId']}))
    if d['status'].startswith(('failed','incomplete')):raise SystemExit(1)
