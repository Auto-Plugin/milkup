#!/usr/bin/env python3
import argparse, hashlib, json, pathlib, subprocess, tempfile
p=argparse.ArgumentParser();p.add_argument('--source',type=pathlib.Path,required=True);p.add_argument('--output',type=pathlib.Path,required=True);a=p.parse_args()
a.output.mkdir(parents=True,exist_ok=True)
repo=pathlib.Path(__file__).resolve().parents[2];research=repo/'research/linux-pdf-links-20261114'
patch=research/'0001-research-skia-uri-annotations.patch'
subprocess.run(['git','-C',str(a.source),'apply','--check',str(patch)],check=True)
skia=a.source/'Source/ThirdParty/skia'
device=(skia/'src/pdf/SkPDFDevice.cpp').read_text()
assert 'SkAnnotationKeys::URL_Key()' in device and 'Op(clip, path, kIntersect_SkPathOp)' in device and 'pageXform.mapRect' in device
with tempfile.TemporaryDirectory() as tmp:
    src=pathlib.Path(tmp)/'api.cpp'
    src.write_text('#include "include/core/SkCanvas.h"\n#include "include/core/SkAnnotation.h"\n#include "include/core/SkData.h"\nvoid probe(SkCanvas* c, const SkRect& r) { auto d=SkData::MakeWithCString("https://example.invalid/"); SkAnnotateRectWithURL(c,r,d.get()); }\n')
    subprocess.run(['c++','-std=c++20','-fsyntax-only','-I'+str(skia),str(src)],check=True,timeout=60)
subprocess.run(['python3',str(research/'test_pdf_links.py')],check=True,timeout=30)
subprocess.run(['python3',str(research/'pdf_links.py'),'fixtures',str(a.output/'fixtures')],check=True)
(a.output/'result.json').write_text(json.dumps({'status':'passed','patchSha256':hashlib.sha256(patch.read_bytes()).hexdigest(),'scope':'Patch applicability, actual Skia API syntax, backend transform/clip presence and positive/negative verifier contracts; not engine link/runtime acceptance'},indent=2))
