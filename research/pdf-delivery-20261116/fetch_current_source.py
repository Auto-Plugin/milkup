"""Bounded official source inspection, selected files only, no build/install."""
import argparse,hashlib,json,pathlib,tarfile,tempfile,urllib.request,shutil
HERE=pathlib.Path(__file__).resolve().parent
VERSION='2.54.2';DIGEST='a76345b391bef6211fb5ab6cfab2e86b285d18cda17cbb9ade595f1252b86065'
URL=f'https://webkitgtk.org/releases/webkitgtk-{VERSION}.tar.xz'
EXTRA=['Source/WebKit/PlatformGTK.cmake','Source/cmake/OptionsGTK.cmake','Source/WebKit/Shared/glib/ProcessExecutablePathGLib.cpp','Source/WebKit/UIProcess/Launcher/glib/BubblewrapLauncher.cpp','Source/WebKit/UIProcess/API/glib/WebKitWebContext.cpp','Source/WebCore/platform/graphics/skia/SkiaRecordingResult.cpp','Source/WebCore/platform/graphics/skia/SkiaRecordingResult.h','Source/WebCore/platform/graphics/LayoutRect.h','Source/WebCore/platform/LayoutUnit.h','Source/WebCore/PlatformGTK.cmake','Source/JavaScriptCore/PlatformGTK.cmake','Source/WTF/wtf/PlatformGTK.cmake','Source/cmake/WebKitCompilerFlags.cmake','Source/cmake/WebKitCommon.cmake','Source/cmake/WebKitFS.cmake','CMakeLists.txt','COPYING','COPYING.LIB','LICENSE','LICENSE-LGPL-2.1','Source/WebCore/LICENSE-LGPL-2.1','Source/WebCore/LICENSE-LGPL-2','Source/WebCore/LICENSE-APPLE','Source/JavaScriptCore/COPYING.LIB','Source/WTF/COPYING.LIB','NEWS']
class Reader:
 def __init__(self,r):self.r=r;self.digest=hashlib.sha256();self.size=0
 def read(self,n=-1):
  assert n>=0
  b=self.r.read(n);self.size+=len(b);assert self.size<=70*1024*1024;self.digest.update(b);return b

def fetch(dest):
 assert not dest.exists(),'Never overwrite source/evidence'
 selected=set(json.loads((HERE/'source-lock-2.52.6.json').read_text()))|set(EXTRA)
 with tempfile.TemporaryDirectory(prefix='milkup-current-source-',dir=dest.parent)as t:
  tmp=pathlib.Path(t);found={};total=0
  with urllib.request.urlopen(URL,timeout=60)as response:
   reader=Reader(response)
   with tarfile.open(fileobj=reader,mode='r|xz')as archive:
    for member in archive:
     prefix=f'webkitgtk-{VERSION}/';assert member.name.startswith(prefix)
     rel=member.name[len(prefix):]
     if rel not in selected:continue
     assert member.isfile() and 0<member.size<=4*1024*1024 and rel not in found
     data=archive.extractfile(member).read(member.size+1);assert len(data)==member.size
     total+=len(data);assert total<=12*1024*1024
     p=tmp/rel;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(data);found[rel]={'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()}
   while reader.read(1024*1024):pass
   assert reader.digest.hexdigest()==DIGEST,'Official full compressed source SHA mismatch'
  receipt={'sourceVersion':VERSION,'url':URL,'sha256':DIGEST,'compressedBytes':reader.size,'selectedBytes':total,'files':found,'notPresent':sorted(selected-found.keys()),'scope':'Exact official source inspection; not a compiled, installed or accepted runtime'}
  (tmp/'source-receipt.json').write_text(json.dumps(receipt,indent=2)+'\n');shutil.move(str(tmp),str(dest))
 return receipt
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('destination',type=pathlib.Path);a=p.parse_args();r=fetch(a.destination);print(json.dumps({'version':VERSION,'files':len(r['files']),'compressedBytes':r['compressedBytes'],'selectedBytes':r['selectedBytes']}))
