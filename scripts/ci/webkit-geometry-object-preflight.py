#!/usr/bin/env python3
"""Compile actual changed translation units, never a stand-in or disabled warning.

Only header generation plus selected object commands are allowed. Any unrelated
compiler invocation in the header plan stops this gate before execution.
"""
import argparse,collections,hashlib,json,os,pathlib,re,shlex,signal,subprocess,time

SOURCES=['Source/WebCore/page/PrintContext.cpp','Source/WebCore/rendering/OutlinePainter.cpp','Source/WebCore/platform/graphics/skia/GraphicsContextSkia.cpp']
INCLUDE='#include "RenderObjectInlines.h"\n'

def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
HEADER_TARGETS=['WebCoreBindings','WebCore_CopyPrivateHeaders','JavaScriptCore_CopyHeaders','JavaScriptCore_CopyPrivateHeaders','WTF_CopyHeaders','bmalloc_CopyHeaders','PAL_CopyHeaders']
def validate_header_plan(plan):
    assert len(plan.encode())<8*1024*1024,'Header plan exceeds budget'
    lines=plan.splitlines();assert 0<len(lines)<=10000,'Header generation exceeds bounded scope'
    assert '--regenerate-during-build'not in plan and 'VerifyGlobs.cmake'not in plan,'Manifest regeneration is not a complete header command graph'
    for line in lines:
        for token in shlex.split(line):
            assert not re.fullmatch(r'(?:clang(?:\+\+)?|gcc|g\+\+)(?:-\d+)?|cc|c\+\+|ccache|ld(?:\.lld)?|(?:llvm-)?ar',pathlib.PurePosixPath(token).name),'Header prerequisites include compiler/linker work outside selected translation units'
    return len(lines)

def validate_header_execution(log,plan,build):
    validate_header_plan(plan)
    approved=collections.Counter(tuple(shlex.split(line))for line in plan.splitlines())
    observed=collections.Counter();glob_checks=0
    for line in log.splitlines():
        if not re.match(r'^\[\d+/\d+\] ',line):continue
        command=line.split('] ',1)[1];args=shlex.split(command)
        # Ninja runs this check even with an already-current manifest. It is
        # not regeneration, and never substitutes for the complete plan.
        if len(args)==3 and pathlib.Path(args[0]).name=='cmake' and args[1]=='-P' and args[2]==str(build/'CMakeFiles/VerifyGlobs.cmake'):
            glob_checks+=1;assert glob_checks<=1;continue
        validate_header_plan(command)
        observed[tuple(args)]+=1
        assert observed[tuple(args)]<=approved[tuple(args)],'Executed command absent from reviewed header graph'
    assert observed,'No header work observed'
    return {'commands':sum(observed.values()),'globChecks':glob_checks}

def unit_contains(entry,actual):
    unit=pathlib.Path(entry['file']).resolve()
    if unit==actual:return True
    if not unit.is_file()or not unit.name.startswith('UnifiedSource-'):return False
    args=entry.get('arguments')or shlex.split(entry['command'])
    roots=[unit.parent];i=0
    while i<len(args):
        arg=args[i]
        if arg in ['-I','-iquote','-isystem']:
            i+=1;roots.append(pathlib.Path(args[i]))
        elif arg.startswith('-I')and len(arg)>2:roots.append(pathlib.Path(arg[2:]))
        i+=1
    cwd=pathlib.Path(entry['directory'])
    roots=[(cwd/r).resolve()if not r.is_absolute()else r.resolve()for r in roots]
    for name in re.findall(r'^#include "([^\"]+)"',unit.read_text(),re.M):
        include=pathlib.Path(name)
        candidates=[include]if include.is_absolute()else[root/include for root in roots]
        # Match actual quoted-include search order, not the harness cwd.
        found=next((p.resolve()for p in candidates if p.is_file()),None)
        if found==actual:return True
    return False

def original_command(entry,graph,build):
    args=entry.get('arguments')or shlex.split(entry['command'])
    assert args.count('-o')==args.count('-c')==1
    assert pathlib.Path(args[0]).name=='clang++'
    target=args[args.index('-o')+1]
    assert (build/target).resolve().is_relative_to(build.resolve())
    assert pathlib.Path(entry['directory']).resolve()==build.resolve()
    assert pathlib.Path(args[args.index('-c')+1]).resolve()==pathlib.Path(entry['file']).resolve()
    assert '-Werror=undefined-inline'in args,'Original strict warning required'
    matches=[]
    for line in graph.splitlines():
        cmd=shlex.split(line)
        if '-o'in cmd and cmd[cmd.index('-o')+1]==target:matches.append(cmd)
    assert len(matches)==1
    cmd=matches[0];assert pathlib.Path(cmd[0]).name=='ccache'and cmd[1]==args[0]
    assert not any(x in cmd for x in ['&&',';','|'])
    reduced=cmd[1:].copy();assert reduced.count('-MD')==1;reduced.remove('-MD')
    for flag,value in [('-MT',target),('-MF',target+'.d')]:
        assert reduced.count(flag)==1;i=reduced.index(flag);assert reduced[i+1]==value;del reduced[i:i+2]
    assert reduced==args,'Invocation differs from actual configured command'
    return target,cmd

def expected_old_failure(code,log):
    clean=re.sub(r'\x1b\[[0-9;]*m','',log)
    errors=[line for line in clean.splitlines()if 'error:'in line]
    return code!=0 and len(errors)==1 and "inline function 'WebCore::RenderObject::localToAbsoluteQuad' is not defined"in errors[0] and 'undefined-inline'in errors[0]

def run(source,build,out):
    out.mkdir(parents=True,exist_ok=False)
    report={'status':'running','scope':'Generated headers and actual selected translation units; not runtime or PDF acceptance','samples':[]}
    def persist():(out/'result.json').write_text(json.dumps(report,indent=2)+'\n')
    def execute(name,cmd,timeout,env=None):
        (out/(name+'-command.json')).write_text(json.dumps({'cwd':str(build),'arguments':cmd,'ccacheDisabled':bool(env and env.get('CCACHE_DISABLE'))},indent=2))
        at=time.monotonic()
        with (out/(name+'.log')).open('w')as log:
            proc=subprocess.Popen(cmd,cwd=build,env=env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
            try:code=proc.wait(timeout=timeout)
            except subprocess.TimeoutExpired:
                os.killpg(proc.pid,signal.SIGTERM)
                try:proc.wait(timeout=5)
                except subprocess.TimeoutExpired:os.killpg(proc.pid,signal.SIGKILL);proc.wait()
                raise RuntimeError(name+' exceeded bounded timeout')
        return {'name':name,'exitCode':code,'seconds':round(time.monotonic()-at,3)}
    original=None;print_source=source/SOURCES[0]
    try:
        assert os.getuid()!=0
        # Resolve CMake's pending glob/manifest regeneration separately. A -n
        # plan which only lists regeneration cannot prove the subsequent graph.
        row=execute('refresh-build-manifest',['ninja','build.ninja'],120)
        report['samples'].append(row);persist();assert row['exitCode']==0,'Manifest regeneration failed'
        commands=json.loads((build/'compile_commands.json').read_text())
        selected={}
        for relative in SOURCES:
            actual=(source/relative).resolve();matches=[]
            for entry in commands:
                if unit_contains(entry,actual):matches.append(entry)
            assert len(matches)==1,'Exactly one actual configured TU required for '+relative
            selected[relative]=matches[0]
        report['compileDatabaseSha256']=digest(build/'compile_commands.json')
        report['sourceHashes']={s:digest(source/s)for s in SOURCES}
        report['selectedUnits']=selected;persist()
        available=subprocess.check_output(['ninja','-C',str(build),'-t','targets','all'],text=True,timeout=30)
        targets=set(line.rsplit(': ',1)[0]for line in available.splitlines())
        assert set(HEADER_TARGETS)<=targets,'Required explicit header target missing'
        header_targets=HEADER_TARGETS+(['ANGLE-webgl-headers']if 'ANGLE-webgl-headers'in targets else[])
        # No library/object-order umbrella target: those drag in library builds.
        plan=subprocess.check_output(['ninja','-C',str(build),'-t','commands',*header_targets],text=True,timeout=45)
        (out/'header-plan.log').write_text(plan)
        report['headerTargets']=header_targets
        report['headerPlanLines']=validate_header_plan(plan);persist()
        row=execute('generate-headers',['ninja','-v','-j','4',*header_targets],240);report['samples'].append(row);persist();assert row['exitCode']==0,'Actual header generation failed'
        generated_log=(out/'generate-headers.log').read_text()
        assert not re.search(r'Building (?:CXX|C|ASM) object|Linking (?:CXX|C|ASM)',generated_log),'Unexpected build in header generation'
        report['headerExecution']=validate_header_execution(generated_log,plan,build);persist()
        generated={}
        for directory in build.glob('*/DerivedSources'):
            for header in directory.rglob('*.h'):
                if header.is_file()and not header.is_symlink():generated[str(header.relative_to(build))]=digest(header)
        assert generated and len(generated)<20000,'Generated header evidence required'
        (out/'generated-header-sha256.json').write_text(json.dumps(generated,indent=2)+'\n')
        report['generatedHeaders']=len(generated)
        original=print_source.read_bytes();text=original.decode();assert text.count(INCLUDE)==1
        invoked=set()
        for relative,entry in selected.items():
            args=entry.get('arguments')or shlex.split(entry['command']);target=args[args.index('-o')+1]
            graph=subprocess.check_output(['ninja','-C',str(build),'-t','commands',target],text=True,timeout=30)
            assert len(graph.encode())<32*1024*1024
            (out/(pathlib.Path(relative).stem+'-graph.log')).write_text(graph)
            target,cmd=original_command(entry,graph,build)
            unit=pathlib.Path(entry['file']);(out/(pathlib.Path(relative).stem+'-actual-unit.cpp')).write_bytes(unit.read_bytes())
            if target in invoked:continue
            invoked.add(target);output=(build/target).resolve();output.parent.mkdir(parents=True,exist_ok=True)
            environment={**os.environ,'CCACHE_DISABLE':'1'}
            if relative==SOURCES[0]:
                # Actual candidate TU, changing only the missing include. Restore
                # in finally even on timeout; no production source is touched.
                print_source.write_text(text.replace(INCLUDE,''))
                try:
                    row=execute('old-missing-inline',cmd,120,environment)
                    report['samples'].append(row);persist()
                    assert expected_old_failure(row['exitCode'],(out/'old-missing-inline.log').read_text()),'Old variant did not fail for the exact original inline error'
                finally:print_source.write_bytes(original)
            output.unlink(missing_ok=True)
            row=execute('fixed-'+pathlib.Path(relative).stem,cmd,120,environment)
            report['samples'].append(row);persist()
            assert row['exitCode']==0 and output.is_file()and output.stat().st_size>0,'Actual fixed translation unit failed'
            row['objectSha256']=digest(output);row['sourceHashAfter']=digest(source/relative);persist()
        assert digest(print_source)==report['sourceHashes'][SOURCES[0]],'Candidate source not restored'
        report['status']='passed'
    except Exception as e:report['status']='failed';report['error']=str(e)
    finally:
        if original is not None:print_source.write_bytes(original)
        report['sourceRestored']=original is None or print_source.read_bytes()==original
        persist()
    return report

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--source',type=pathlib.Path,required=True);p.add_argument('--build',type=pathlib.Path,required=True);p.add_argument('--output',type=pathlib.Path,required=True);a=p.parse_args()
    r=run(a.source.resolve(),a.build.resolve(),a.output.resolve());print(json.dumps(r));raise SystemExit(0 if r['status']=='passed'else 1)
