"""Bounded-memory parser preflight; no source extraction or compiler invocation."""
import hashlib,io,json,pathlib,tarfile,urllib.request,zipfile
import current_source_archive as a
def inspect(destination):
 with urllib.request.urlopen(a.URL,timeout=40)as response:data=response.read(70*1024**2+1)
 assert len(data)<=70*1024**2 and hashlib.sha256(data).hexdigest()==a.SHA
 with tarfile.open(fileobj=io.BytesIO(data),mode='r:xz')as tar:
  members=tar.getmembers();result=a.validate_members(members,lambda m:tar.extractfile(m).read(991))
  copies=[m for m in members if m.name==a.DUPLICATE_PATH];assert len(copies)==2
  content=tar.extractfile(copies[0]).read();assert content==tar.extractfile(copies[1]).read()
 result.update(sourceSha256=a.SHA,compressedBytes=len(data),scope='Full official archive parser only; no extraction/configure/TU/runtime')
 destination.mkdir(parents=True,exist_ok=True)
 with zipfile.ZipFile(destination/'gtk-theme-original.zip','w',zipfile.ZIP_DEFLATED)as z:
  info=zipfile.ZipInfo('gtk-theme.css',(2026,11,16,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;info.external_attr=0o100644<<16;z.writestr(info,content)
 (destination/'corrected-archive-preflight.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2))
if __name__=='__main__':
 import sys
 assert len(sys.argv)==2;inspect(pathlib.Path(sys.argv[1]))
