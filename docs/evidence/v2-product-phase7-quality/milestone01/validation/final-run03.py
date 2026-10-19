import datetime,hashlib,json,os,pathlib,subprocess,time
BASE=pathlib.Path('/workspace/milkup-p7-quality-evidence/milestone01/validation')
REPO=pathlib.Path('/workspace/milkup')
os.environ['NPM_CONFIG_VERIFY_DEPS_BEFORE_RUN']='false'
os.environ['NPM_CONFIG_MANAGE_PACKAGE_MANAGER_VERSIONS']='false'
def write_json(name,obj):
    with (BASE/name).open('x') as f:
        json.dump(obj,f,indent=2,ensure_ascii=False);f.write('\n')
def git(*args):
    return subprocess.check_output(['git',*args],cwd=REPO)
def sources():
    paths=set(git('diff','--name-only','HEAD','-z').decode().split('\0'))
    paths.update(git('ls-files','--others','--exclude-standard','-z').decode().split('\0'))
    return sorted(p for p in paths if p and (REPO/p).is_file())
def snapshot(paths):
    rows=[]
    for path in paths:
        p=REPO/path
        if not p.is_file():
            rows.append({'path':path,'missing':True});continue
        data=p.read_bytes()
        rows.append({'path':path,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()})
    return rows
paths=sources()
write_json('final-inputs-before03.json',{'head':git('rev-parse','HEAD').decode().strip(),'files':snapshot(paths),'paths':paths})
entry=['bash','scripts/cloud/pnpm.sh','--config.verify-deps-before-run=false','--config.manage-package-manager-versions=false']
steps=[
    ('presentation-isolated',entry+['--filter','@milkup/view-dom','exec','vitest','run','src/__tests__/presentation.test.ts','--maxWorkers=1','--no-file-parallelism']),
    ('workspace-tests',entry+['test']),
]
results=[]
for name,cmd in steps:
    prefix='final-'+name+'-03'
    print(json.dumps({'event':'START','name':name,'at':datetime.datetime.now(datetime.timezone.utc).isoformat()}),flush=True)
    began=time.monotonic()
    started=datetime.datetime.now(datetime.timezone.utc).isoformat()
    with (BASE/(prefix+'.log')).open('xb') as log:
        log.write(('$ '+' '.join(cmd)+'\n').encode());log.flush()
        p=subprocess.Popen(cmd,cwd=REPO,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
        with (BASE/'final-process-events03.jsonl').open('a') as f:f.write(json.dumps({'name':name,'pid':p.pid,'startedAt':started})+'\n')
        code=p.wait()
    result={'name':name,'command':cmd,'exitCode':code,'elapsedSeconds':time.monotonic()-began,'startedAt':started,'finishedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'log':str(BASE/(prefix+'.log'))}
    write_json(prefix+'.json',result);results.append(result)
    print(json.dumps({'event':'FINISH',**result}),flush=True)
    if code:
        print((BASE/(prefix+'.log')).read_text(errors='replace')[-6500:],flush=True)
write_json('final-inputs-after03.json',{'head':git('rev-parse','HEAD').decode().strip(),'files':snapshot(paths),'pathsNow':sources()})
write_json('final-results03.json',{'steps':results,'allPassed':all(x['exitCode']==0 for x in results),'environmentOverrides':{'NPM_CONFIG_VERIFY_DEPS_BEFORE_RUN':'false','NPM_CONFIG_MANAGE_PACKAGE_MANAGER_VERSIONS':'false'},'scope':'Non-GUI validation only. No corrective edits. Repository source drift must be evaluated using before/after records; generated build outputs are expected.'})
raise SystemExit(0 if all(x['exitCode']==0 for x in results) else 1)
