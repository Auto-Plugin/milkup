from pathlib import Path
import json,hashlib
r=Path('/workspace/milkup/tests/fixtures/p5-output/milestone06')
m=json.loads((r/'manifest.json').read_text());results=[]
for f in m['fixtures']:
 data=(r/f['file']).read_bytes();s=data.decode()
 assert hashlib.sha256(data).hexdigest()==f['sourceSHA256']
 assert len(s.encode('utf-16-le'))//2==f['sourceUtf16']
 assert len(data)==f['sourceBytes'] and s.count('\n')+1==f['sourceLines']
 for d in f['diagrams']:
  fence=s.encode('utf-16-le')[d['fromUtf16']*2:d['toUtf16']*2].decode('utf-16-le')
  assert hashlib.sha256(fence.encode()).hexdigest()==d['fenceSHA256']
 results.append({'id':f['id'],'sourceSHA256':f['sourceSHA256'],'sourceBytes':len(data),'sourceUtf16':f['sourceUtf16'],'sourceLines':f['sourceLines'],'diagramCount':len(f['diagrams'])})
print(json.dumps({'status':'PASS_FROZEN_FIXTURES_ONLY','fixtures':results},ensure_ascii=False,indent=2))
