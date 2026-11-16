"""Timed-child official full source retrieval; authenticated hash before extraction."""
import hashlib,json,pathlib,tarfile,urllib.request
SHA='a76345b391bef6211fb5ab6cfab2e86b285d18cda17cbb9ade595f1252b86065'
URL='https://webkitgtk.org/releases/webkitgtk-2.54.2.tar.xz'
DUPLICATE_PATH='webkitgtk-2.54.2/Source/WebKit/Resources/gtk/gtk-theme.css'
DUPLICATE_SHA='37813ec43856d3773483539a95c088d010cdaed14b1effbd28f423297be9d96a'
def validate_members(members,read_member=None):
 assert 0<len(members)<=150000
 total=0;seen=set();known=[]
 for m in members:
  p=pathlib.PurePosixPath(m.name)
  assert not p.is_absolute()and '..'not in p.parts and p.parts[0]=='webkitgtk-2.54.2'
  assert str(p)==m.name.rstrip('/'),'Noncanonical archive path'
  if m.name==DUPLICATE_PATH:
   assert read_member is not None and m.isfile()and m.size==990 and m.mode==0o664 and not m.linkname
   data=read_member(m);assert len(data)==990 and hashlib.sha256(data).hexdigest()==DUPLICATE_SHA,'Known duplicate content mismatch'
   known.append(m.name);assert len(known)<=2,'Extra duplicate occurrence'
  elif m.name in seen:raise AssertionError('Unreviewed duplicate path: '+m.name)
  seen.add(m.name)
  assert m.isfile()or m.isdir()or m.issym()or m.islnk(),'Special source entry forbidden'
  if m.isfile():total+=m.size;assert 0<=m.size<=128*1024**2
  assert total<=2*1024**3
 assert len(known)in [0,2],'Official duplicate pair incomplete'
 return {'entries':len(members),'expandedRegularBytes':total,'identicalDuplicateOccurrences':len(known),'duplicateSha256':DUPLICATE_SHA if known else None}
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
  members=tar.getmembers();report=validate_members(members,lambda m:tar.extractfile(m).read(991))
  unique=[];seen=set()
  for member in members:
   if member.name not in seen:unique.append(member);seen.add(member.name)
  extract=dest.parent/'official-extract';assert not extract.exists();extract.mkdir()
  tar.extractall(extract,members=unique,filter='data')
  (extract/'webkitgtk-2.54.2').rename(dest);extract.rmdir()
 report.update(url=URL,sha256=SHA,compressedBytes=size)
 print(json.dumps(report,indent=2));return report
if __name__=='__main__':
 import sys
 assert len(sys.argv)==3;fetch(pathlib.Path(sys.argv[1]),pathlib.Path(sys.argv[2]))
