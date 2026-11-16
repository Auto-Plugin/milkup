"""Restore bounded selected preimages to new directories, never a runtime."""
import argparse,hashlib,json,pathlib,stat,zipfile
HERE=pathlib.Path(__file__).resolve().parent
def restore(version,destination):
 assert not destination.exists(),'Never overwrite a source tree'
 row=json.loads((HERE/'selected-source-archives.json').read_text())[version];archive=HERE/row['path']
 assert archive.stat().st_size==row['bytes'] and hashlib.sha256(archive.read_bytes()).hexdigest()==row['sha256']
 with zipfile.ZipFile(archive)as z:
  names=z.namelist();assert len(names)==len(set(names))==row['files']
  assert sum(i.file_size for i in z.infolist())==row['uncompressedBytes']<=12*1024*1024
  for info in z.infolist():
   p=pathlib.PurePosixPath(info.filename);assert not p.is_absolute() and '..'not in p.parts
   assert stat.S_ISREG(info.external_attr>>16)
  destination.mkdir(parents=True)
  for info in z.infolist():
   p=destination/info.filename;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(z.read(info))
 return destination
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('version',choices=['2.52.6','2.54.2']);p.add_argument('destination',type=pathlib.Path);a=p.parse_args();print(restore(a.version,a.destination))
