"""Timed-child official full source retrieval; authenticated hash before extraction."""
import hashlib,json,pathlib,tarfile,urllib.request
SHA='a76345b391bef6211fb5ab6cfab2e86b285d18cda17cbb9ade595f1252b86065'
URL='https://webkitgtk.org/releases/webkitgtk-2.54.2.tar.xz'
def validate_members(members):
 assert 0<len(members)<=150000
 total=0;seen=set()
 for m in members:
  p=pathlib.PurePosixPath(m.name)
  assert not p.is_absolute()and '..'not in p.parts and p.parts[0]=='webkitgtk-2.54.2'
  assert m.name not in seen;seen.add(m.name)
  assert m.isfile()or m.isdir()or m.issym()or m.islnk(),'Special source entry forbidden'
  if m.isfile():total+=m.size;assert 0<=m.size<=128*1024**2
  assert total<=2*1024**3
 return {'entries':len(members),'expandedRegularBytes':total}
def fetch(archive,dest):
 assert not archive.exists()and not dest.exists()
 size=0;h=hashlib.sha256()
 with urllib.request.urlopen(URL,timeout=40)as r,archive.open('xb')as out:
  while True:
   b=r.read(1024*1024)
   if not b:break
   size+=len(b);assert size<=70*1024**2;h.update(b);out.write(b)
 assert h.hexdigest()==SHA,'Official archive SHA mismatch'
 with tarfile.open(archive,'r:xz')as tar:
  members=tar.getmembers();report=validate_members(members)
  extract=dest.parent/'official-extract';assert not extract.exists();extract.mkdir()
  tar.extractall(extract,members=members,filter='data')
  (extract/'webkitgtk-2.54.2').rename(dest);extract.rmdir()
 report.update(url=URL,sha256=SHA,compressedBytes=size)
 print(json.dumps(report,indent=2));return report
if __name__=='__main__':
 import sys
 assert len(sys.argv)==3;fetch(pathlib.Path(sys.argv[1]),pathlib.Path(sys.argv[2]))
