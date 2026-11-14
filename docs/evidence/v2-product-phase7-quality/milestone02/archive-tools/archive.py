#!/usr/bin/env python3
"""Plan is read-only except explicit plan output. Copy requires --approved-copy."""
import argparse, gzip, hashlib, json, os, shutil, tempfile
from pathlib import Path
from common import SOURCE, DEST, LIMIT, candidates, digest, gzip_size, compress_fixture, safe_relative, allowed

def plan(output):
    entries=[]; excluded=[]
    for rel,reason,size in candidates():
        if reason: excluded.append({'path':str(rel),'bytes':size,'reason':reason}); continue
        p=SOURCE/rel
        with p.open('rb') as source:
            if source.read(4)==b'\x7fELF':raise RuntimeError('ELF cannot be archived: '+str(rel))
        n,h=digest(p); compressed=compress_fixture(rel,n)
        estimate=gzip_size(p) if compressed else n
        if digest(p)!=(n,h): raise RuntimeError('Source changed during plan: '+str(rel))
        entries.append({'source':str(rel),'path':str(rel)+('.gz' if compressed else ''),'encoding':'gzip' if compressed else 'identity','originalBytes':n,'originalSha256':h,'estimatedArchiveBytes':estimate})
    entries.sort(key=lambda x:x['path']); estimated=sum(x['estimatedArchiveBytes'] for x in entries)
    result={'schema':1,'sourceRoot':str(SOURCE),'destination':str(DEST),'status':'blocked-over-cap' if estimated>LIMIT else 'planned-not-copied','payloadCapBytes':LIMIT,'unreviewedRoots':[x['path'] for x in excluded if 'unreviewed' in x['reason']],'estimatedBytes':estimated,'entries':entries,'excluded':excluded}
    output.write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps({'files':len(entries),'sourceBytes':sum(x['originalBytes'] for x in entries),'estimatedArchiveBytes':estimated,'overCap':estimated>LIMIT,'excludedEntries':len(excluded),'unreviewedRoots':result['unreviewedRoots'],'plan':str(output)}))
    if estimated>LIMIT: raise RuntimeError('Archive exceeds 16 MiB cap; blocked plan retained for review')

def copy(planpath):
    p=json.loads(planpath.read_text())
    if p['sourceRoot']!=str(SOURCE) or p['destination']!=str(DEST): raise RuntimeError('Unexpected roots')
    if p.get('unreviewedRoots'): raise RuntimeError('Unreviewed roots require explicit policy review: '+', '.join(p['unreviewedRoots']))
    if DEST.exists(): raise RuntimeError('Destination must not exist; no overwrite or merge')
    if p['estimatedBytes']>LIMIT: raise RuntimeError('Plan exceeds cap')
    selection=list(candidates())
    unknown=[str(rel) for rel,reason,size in selection if reason and 'unreviewed' in reason]
    if unknown:raise RuntimeError('New unreviewed paths after plan: '+', '.join(unknown))
    current={str(rel) for rel,reason,size in selection if not reason}
    if current!={e['source'] for e in p['entries']}:raise RuntimeError('Selected source set changed after plan')
    DEST.parent.mkdir(parents=True,exist_ok=True)
    if shutil.disk_usage(DEST.parent).free < p['estimatedBytes']+32*1024*1024: raise RuntimeError('Insufficient free space/headroom')
    stage=Path(tempfile.mkdtemp(prefix='.milestone01-archive-',dir=DEST.parent)); records=[]; paths=set()
    # On failure retain partial staging for inspection; never delete source or historical evidence.
    for e in p['entries']:
        rel=safe_relative(e['source']); outrel=safe_relative(e['path']); source=SOURCE/rel
        if allowed(rel) is not None: raise RuntimeError('Plan contains excluded source')
        wantgzip=compress_fixture(rel,e['originalBytes'])
        if str(outrel)!=str(rel)+('.gz' if wantgzip else '') or e['encoding']!=('gzip' if wantgzip else 'identity'): raise RuntimeError('Plan output mapping changed')
        if str(outrel) in paths: raise RuntimeError('Duplicate destination')
        paths.add(str(outrel))
        if any(x.is_symlink() for x in [source,*source.parents]) or not source.is_file(): raise RuntimeError('Source is not a regular non-symlink file')
        if digest(source)!=(e['originalBytes'],e['originalSha256']): raise RuntimeError('Source changed after plan: '+str(rel))
        dest=stage/outrel; dest.parent.mkdir(parents=True,exist_ok=True)
        with source.open('rb') as f, dest.open('xb') as out:
            if e['encoding']=='gzip':
                with gzip.GzipFile(filename='',mode='wb',fileobj=out,mtime=0,compresslevel=6) as z: shutil.copyfileobj(f,z,1024*1024)
            elif e['encoding']=='identity': shutil.copyfileobj(f,out,1024*1024)
            else: raise RuntimeError('Unknown encoding')
        if digest(source)!=(e['originalBytes'],e['originalSha256']): raise RuntimeError('Source changed while copying')
        n,h=digest(dest); records.append({**e,'archiveBytes':n,'archiveSha256':h})
        if sum(x['archiveBytes'] for x in records)>LIMIT: raise RuntimeError('Actual archive exceeds cap')
    manifest={'schema':1,'approvedPlanSha256':hashlib.sha256(planpath.read_bytes()).hexdigest(),'sourceRoot':str(SOURCE),'entries':records,'excluded':p['excluded'],'scope':'Original bytes preserved; gzip JSON/log/Markdown decodes losslessly. Original evidence untouched. No ELF, plugin archives, SDK tgz, generated plugin.js, profile or dependency trees copied. Only explicitly reviewed runtime source scripts included.'}
    (stage/'archive-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    from index import generate
    from verify import verify
    generate(stage); verify(stage)
    if sum(q.stat().st_size for q in stage.rglob('*') if q.is_file())>LIMIT:raise RuntimeError('Archive plus metadata exceeds 16 MiB cap')
    for e in p['entries']:
        if digest(SOURCE/safe_relative(e['source']))!=(e['originalBytes'],e['originalSha256']):raise RuntimeError('Source changed before final publication')
    os.rename(stage,DEST)
    print(json.dumps({'copied':str(DEST),'files':len(records),'bytes':sum(x['archiveBytes'] for x in records)}))

if __name__=='__main__':
    a=argparse.ArgumentParser(); a.add_argument('--plan',type=Path); a.add_argument('--approved-copy',type=Path); x=a.parse_args()
    if bool(x.plan)==bool(x.approved_copy): a.error('Choose exactly one action')
    plan(x.plan) if x.plan else copy(x.approved_copy)
