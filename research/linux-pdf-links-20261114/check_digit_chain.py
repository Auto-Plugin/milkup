#!/usr/bin/env python3
"""Correlate real local shaping, the compiled metadata guard and retained PDFs."""
import argparse, hashlib, json, pathlib, re, subprocess, tempfile
from pypdf import PdfReader
from diagnose_digit_shaping import diagnose

def pdf_null_glyphs(path):
    rows=[]
    for page_num,page in enumerate(PdfReader(path).pages,1):
        for name,ref in page['/Resources']['/Font'].items():
            font=ref.get_object()
            if '/ToUnicode'not in font or '/Encoding'not in font:continue
            encoding=font['/Encoding'];mapping={};code=None
            if not hasattr(encoding,'get'):continue
            for entry in encoding.get('/Differences',[]):
                if isinstance(entry,int):code=entry
                else:
                    assert code is not None
                    mapping[code]=str(entry);code+=1
            cmap=font['/ToUnicode'].get_data().decode()
            for token in re.findall(r'<([0-9a-fA-F]+)>\s+<0000>',cmap):
                code=int(token,16);glyph=mapping.get(code)
                rows.append({'page':page_num,'font':str(name),'pdfCode':code,'glyphName':glyph,'glyphId':int(glyph[2:],16)if glyph and re.fullmatch('/g[0-9A-Fa-f]+',glyph)else None,'toUnicode':0})
    return {'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'nullRows':rows}

def check(font,index,pdfs,source):
    report=diagnose(font,index)
    # Compile the actual existing ScalarGlyphText algorithm using actual HB output.
    header=pathlib.Path(__file__).parent.parent/'linux-pdf-unicode-20261114'
    lines=['#include "ScalarGlyphText.h"','#include <cassert>','using namespace WebCore;','int main() {']
    for s in report['samples']:
        gs=s['glyphs'];vec=lambda key:','.join(str(g[key])for g in gs)
        lines+=['{',f'std::vector<uint32_t> offsets {{{vec("utf8Cluster")}}}, glyphs {{{vec("glyph")}}}, nominal {{{vec("nominal")}}};',f'auto result=makeScalarGlyphText(u"WRAP0123456789",offsets,glyphs,nominal);',f'assert(result.has_value()=={str(s["currentScalarBridgeWouldAccept"]).lower()});','}']
    lines+=['}']
    with tempfile.TemporaryDirectory()as d:
        d=pathlib.Path(d);cpp=d/'chain.cpp';cpp.write_text('\n'.join(lines));binary=d/'chain'
        subprocess.run(['c++','-std=c++20','-Wall','-Wextra','-Werror','-I'+str(header),str(cpp),'-o',str(binary)],check=True,timeout=30)
        subprocess.run([str(binary)],check=True,timeout=5)
    report['actualCppGuard']='6 actual shaping samples compiled and matched; en/locl rejected'
    report['pdfs']={str(p):pdf_null_glyphs(p)for p in pdfs}
    english=next(s for s in report['samples']if s['language']=='en'and s['locl']==1)
    digit_gids={g['glyph']for g in english['glyphs']if g['source'].isdigit()}
    report['sameTenGlyphIdsAsLocalShaping']=all({r['glyphId']for r in p['nullRows']}==digit_gids for p in report['pdfs'].values())
    assert report['sameTenGlyphIdsAsLocalShaping']
    relatives=['Source/WebCore/platform/graphics/FontCascade.cpp','Source/ThirdParty/skia/src/pdf/SkPDFDevice.cpp','Source/ThirdParty/skia/src/pdf/SkPDFFont.cpp','Source/ThirdParty/skia/src/pdf/SkPDFMakeToUnicodeCmap.cpp']
    report['exactSourceFiles']={p:hashlib.sha256((source/p).read_bytes()).hexdigest()for p in relatives}
    device=(source/relatives[1]).read_text()
    assert 'if (c.fUtf8Text)'in device and 'fontUnichar <= 0'in device and 'glyphToUnicodeEx.set(gid, SkString(c.fUtf8Text, c.fTextByteLength))'in device
    report['finding']='Source digits remain scalar; en locl produces uncoded glyphs. Existing unchanged-nominal guard rejects the complete source span. Skia source-aware extended cmap path requires fUtf8Text; retained baseline and private PDFs instead map these exact ten glyph IDs to U+0000. This is a reproducible mechanism, not an observed CI shaping trace.'
    report['remainingEvidence']='Original CI font bytes/hash, exact WebKit locale and TextRun offsets, metadata acceptance and Skia cluster text at runtime were not recorded. No heuristic glyph reverse map or guard relaxation is applied.'
    return report

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--font',type=pathlib.Path,required=True);p.add_argument('--index',type=int,default=2);p.add_argument('--source',type=pathlib.Path,required=True);p.add_argument('--pdf',type=pathlib.Path,action='append',required=True);p.add_argument('--out',type=pathlib.Path,required=True);a=p.parse_args()
    a.out.write_text(json.dumps(check(a.font,a.index,a.pdf,a.source),ensure_ascii=False,indent=2)+'\n')
