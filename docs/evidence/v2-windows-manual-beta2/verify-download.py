from pathlib import Path, PurePosixPath
import sys, json, hashlib, zipfile, stat
metadata_path, archive_path, dest_path, source_path = map(Path,sys.argv[1:])
metadata=json.loads(metadata_path.read_text());blob=archive_path.read_bytes();digest=hashlib.sha256(blob).hexdigest()
assert metadata['digest']=='sha256:'+digest
assert metadata['size_in_bytes']==len(blob)
assert not metadata['expired']
assert len(blob)<=50*1024*1024
assert not dest_path.exists();dest_path.mkdir()
with zipfile.ZipFile(archive_path) as archive:
    entries=archive.infolist();names=[e.filename for e in entries if not e.is_dir()]
    assert len(names)==19 and len(set(names))==19
    assert sum(e.file_size for e in entries)<50*1024*1024
    for entry in entries:
        p=PurePosixPath(entry.filename)
        assert not p.is_absolute() and '..' not in p.parts and '\\' not in entry.filename
        assert not stat.S_ISLNK(entry.external_attr>>16)
    archive.extractall(dest_path)
manifest=json.loads((dest_path/'manifest.json').read_text())
assert manifest['version']=='2.0.0-beta.2'
assert manifest['commit']==metadata['workflow_run']['head_sha']
assert manifest['baseline']=='40e53428e64a4effef2378ea6cbcab8f3be3b11a'
assert manifest['payloadImageMatchesCheckedBinary'] is True
assert manifest['application']['sha256']==manifest['extractedApplication']['sha256']
assert manifest['application']['productVersion']==manifest['extractedApplication']['productVersion']==manifest['installer']['productVersion']=='2.0.0-beta.2'
assert manifest['installerExecuted'] is False and manifest['guiImeAccepted'] is False
for r in [manifest['installer'],manifest['application'],manifest['extractedApplication']]:assert r['signature']=='NotSigned'
listed={}
for line in (dest_path/'SHA256SUMS.txt').read_text().splitlines():
    claimed,name=line.split('  ',1);assert name not in listed
    actual=hashlib.sha256((dest_path/name).read_bytes()).hexdigest();assert actual==claimed;listed[name]=actual
assert set(listed)==set(names)-{'SHA256SUMS.txt'}
assert listed[manifest['installer']['deliveredName']]==manifest['installer']['sha256']
plugins=json.loads((dest_path/'plugins.json').read_text());assert len(plugins)==11;assert plugins==manifest['plugins']
source_entries=json.loads((source_path/'release/bundled-plugins.json').read_text());by_id={}
for e in source_entries:
    m=json.loads((source_path/e['directory']/'plugin.json').read_text());by_id[m['id']]=m
assert {p['id'] for p in plugins}==set(by_id)
for p in plugins:
    name='plugins/'+p['archive'];assert listed[name]==p['sha256']
    archive=json.loads((dest_path/name).read_text());assert archive['manifest']==by_id[p['id']]
phases=manifest['sourceChecks']['phases'];assert len(phases)==15 and all(p['status']=='passed' for p in phases)
assert manifest['sourceChecks']['rust']['status']=='passed'
result={'status':'passed','artifactId':metadata['id'],'artifactZipSha256':digest,'artifactBytes':len(blob),'expiresAt':metadata['expires_at'],'source':manifest['commit'],'version':manifest['version'],'fileCount':len(names),'installer':manifest['installer'],'application':manifest['application'],'plugins':plugins,'phaseCount':len(phases),'rust':manifest['sourceChecks']['rust'],'installerExecuted':False,'guiAccepted':False}
(dest_path.parent/'download-verification.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(result,ensure_ascii=False,indent=2))
