#!/usr/bin/env python3
"""Independent offline findings, never rewrite PDFs or override the failed gate."""
import argparse, ctypes as C, ctypes.util, hashlib, json, pathlib, subprocess, sys, tempfile
from pypdf import PdfReader
from pypdf.generic import ContentStream
from test_digit_probe import shape
from digit_pdf_contract import traces
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'linux-pdf-links-20261114'))
from audit_existing import null_maps
from pdf_links import inspect, CASES

def pixels(pdf):
    with tempfile.TemporaryDirectory() as d:
        prefix=pathlib.Path(d)/'page'
        subprocess.run(['pdftoppm','-r','72',str(pdf),str(prefix)],check=True,timeout=30,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        return [hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(pathlib.Path(d).glob('page-*.ppm'))]

def script_for(text):
    hb=C.CDLL(ctypes.util.find_library('harfbuzz'));ptr=C.c_void_p
    for name,args,ret in [('hb_buffer_create',[],ptr),('hb_buffer_add_utf8',[ptr,C.c_char_p,C.c_int,C.c_uint,C.c_int],None),('hb_buffer_guess_segment_properties',[ptr],None),('hb_buffer_get_script',[ptr],C.c_uint32),('hb_buffer_destroy',[ptr],None)]:
        f=getattr(hb,name);f.argtypes=args;f.restype=ret
    b=hb.hb_buffer_create();raw=text.encode();hb.hb_buffer_add_utf8(b,raw,len(raw),0,len(raw));hb.hb_buffer_guess_segment_properties(b)
    value=hb.hb_buffer_get_script(b);hb.hb_buffer_destroy(b)
    return {'tagValue':value,'tag':value.to_bytes(4,'big').decode() if value else 'HB_SCRIPT_INVALID/no specific script'}

def audit(root, old):
    result={'status':'offline-diagnostic-only-original-run-remains-failed','run':43670757867,'candidate':'7b589d0d1d3127bd11bf8c20dae3d0a7bb3f9f2d'}
    samples={name:inspect(root/(name+'.pdf')) for name in ['digit-baseline','digit-candidate']}
    compact=lambda s:''.join(s.split())
    assert '0123456789' in compact(samples['digit-baseline']['text'])
    assert '1212' not in compact(samples['digit-baseline']['text']) and '1212' in compact(samples['digit-candidate']['text'])
    result['failedAssumption']='Digits alone did not select non-nominal Noto glyphs. Baseline contained 0123456789, so the original required A/B reproduction assertion correctly failed.'
    result['syntheticCollision']={}
    for name,accepted in [('digit-baseline',False),('digit-candidate',True)]:
        rows=traces(root/(name+'.log'));selected=[r for r in rows if r['source']==list(map(ord,'1212'))]
        assert selected and all(r['accepted'] is accepted and r['glyphs']==[[0,3,1],[1,3,2],[2,3,1],[3,3,2]] for r in selected)
        reader=PdfReader(root/(name+'.pdf'));actual=[]
        for args,op in ContentStream(reader.pages[0].get_contents(),reader).operations:
            if op==b'BDC' and len(args)==2 and hasattr(args[1],'get') and args[1].get('/ActualText') is not None:actual.append(str(args[1]['/ActualText']))
        result['syntheticCollision'][name]={'traces':selected,'actualText':actual,'sha256':samples[name]['sha256'],'nullToUnicode':null_maps(reader),'pixels':pixels(root/(name+'.pdf'))}
    assert result['syntheticCollision']['digit-candidate']['actualText'].count('2')==2
    assert result['syntheticCollision']['digit-baseline']['pixels']==result['syntheticCollision']['digit-candidate']['pixels']
    text={name:subprocess.check_output(['pdftotext','-layout',str(root/(name+'.pdf')),'-'],timeout=15).decode().split('\f') for name in samples}
    assert text['digit-baseline'][1]==text['digit-candidate'][1]
    result['negativePage']={'extractionUnchanged':True,'text':text['digit-candidate'][1], 'note':'Baseline itself lacks complete ligature/composition/RTL/Indic source fidelity. Unchanged behavior is not a fidelity pass.'}
    result['originalFixtures']={}
    for name in ['links','no-links']:
        sample=inspect(root/(name+'.pdf'));before=inspect(old/(name+'.pdf'));rows=traces(root/(name+'.log'))
        digit_rows=[r for r in rows if any(g!=n and 48<=r['source'][offset]<=57 for offset,g,n in r['glyphs'])]
        assert digit_rows and all(r['accepted'] for r in digit_rows)
        assert {g for r in digit_rows for offset,g,n in r['glyphs'] if g!=n}==set(range(63153,63163))
        assert all(compact(sample['text']).count('WRAP%02d'%i)==1 for i in range(20))
        assert all(len([w for w in sample['words'] if w['text']==t and w['page']==c['page']])==1 for c in CASES for t in c['words'])
        current_null=null_maps(PdfReader(root/(name+'.pdf')));old_null=null_maps(PdfReader(old/(name+'.pdf')))
        assert old_null and not current_null
        now_pixels=pixels(root/(name+'.pdf'));old_pixels=pixels(old/(name+'.pdf'));assert now_pixels==old_pixels
        result['originalFixtures'][name]={'beforeSha256':before['sha256'],'afterSha256':sample['sha256'],'beforeNullFonts':len(old_null),'afterNullFonts':len(current_null),'allTwentyWRAPTokensExactlyOnceOnCorrectPage':True,'actualChangedDigitGlyphIds':list(range(63153,63163)),'acceptedTraceCount':len(digit_rows),'pixelsIdentical':True,'pagePixelHashes':now_pixels,'limitation':'Historical nominal-only build versus current build, not same-run Noto A/B.'}
    font=pathlib.Path('/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc');result['localScriptControl']={'fontSha256':hashlib.sha256(font.read_bytes()).hexdigest(),'samples':[]}
    for t in ['0123456789','WRAP0123456789']:
        v,d,g=shape(font,2,t,'en');result['localScriptControl']['samples'].append({'text':t,'script':script_for(t),'harfbuzz':v,'direction':d,'glyphs':g})
    return result

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('root',type=pathlib.Path);p.add_argument('old',type=pathlib.Path);p.add_argument('output',type=pathlib.Path);a=p.parse_args()
    r=audit(a.root,a.old);a.output.write_text(json.dumps(r,ensure_ascii=False,indent=2)+'\n');print(r['status'])
