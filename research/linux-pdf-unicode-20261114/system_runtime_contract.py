#!/usr/bin/env python3
"""Future distro-runtime text/URI smoke gate; never installs or selects a private lib."""
import argparse, hashlib, json, pathlib, subprocess, sys
from pypdf import PdfReader
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'linux-pdf-links-20261114'))
from pdf_links import inspect, CHINESE, PAIRS
from audit_existing import checks, null_maps

def libraries(path):
    found={}
    for line in path.read_text().splitlines():
        fields=line.split(maxsplit=5)
        if len(fields)!=6:continue
        name=fields[5]
        if '/libwebkit2gtk-4.1.so.' not in name and '/libjavascriptcoregtk-4.1.so.' not in name:continue
        p=pathlib.Path(name);assert p.is_absolute() and p.resolve().is_relative_to('/usr/lib'), 'Private or mixed runtime mapping'
        assert p.is_file();found[str(p.resolve())]=hashlib.sha256(p.read_bytes()).hexdigest()
    assert len(found)==2, 'Both normal system libraries must be mapped'
    return found

def verify(root):
    report={'status':'failed','scope':'Normal distro runtime PDF text/search and URI/page smoke only; not independent link geometry, installed Milkup, clipboard, complex-text fidelity or physical print','errors':[]}
    try:
        native=json.loads((root/'native-result.json').read_text())
        assert native['systemAcceptance'] is True and native['mode']=='baseline' and native['uid']!=0
        assert {r['name']for r in native['runs']}=={'links','no-links','digit-candidate'} and len(native['runs'])==3
        expected=None;proof=[]
        for row in native['runs']:
            assert row['exitCode']==0 and row['webProcesses']
            mapped=libraries(root/row['libraryMaps'])
            if expected is None:expected=mapped
            assert mapped==expected
            for child in row['webProcesses']:
                assert child['startTicks'] and pathlib.Path(child['image']).resolve().is_relative_to('/usr/lib')
                assert libraries(root/child['maps'])==expected
            assert 'SANDBOX_ENABLED' in (root/(row['name']+'.log')).read_text()
            proof.append(row)
        report['systemLibraries']=expected;report['nativeRuns']=proof
        report['packageVersions']=subprocess.check_output(['dpkg-query','-W','-f=${binary:Package} ${Version}\n','libwebkit2gtk-4.1-0','libjavascriptcoregtk-4.1-0'],text=True,timeout=10)
        report['pdfs']={}
        for name,linked in [('links',True),('no-links',False)]:
            pdf=inspect(root/(name+'.pdf'));result=checks(pdf,linked)
            for key in ['pages','pageMarkers','chineseTwice','intentionalRadicalsTwice','uriPageSet','allLinkTokensExactlyOnce']:assert result[key],name+': '+key
            assert not null_maps(PdfReader(root/(name+'.pdf')))
            report['pdfs'][name]={'sha256':pdf['sha256'],'checks':result}
        pdf=inspect(root/'digit-candidate.pdf');text=''.join(pdf['text'].split())
        assert pdf['pages']==2
        for token in ['WRAP0123456789','1212',PAIRS]:assert text.count(token)==1,token
        report['pdfs']['digit-candidate']={'sha256':pdf['sha256'],'sourceTokens':'passed','negativeComplexPage':'not accepted as full fidelity'}
        report['status']='passed'
    except Exception as error:report['errors'].append(str(error))
    (root/'system-runtime-result.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    return report

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('root',type=pathlib.Path);a=p.parse_args();r=verify(a.root)
    print(json.dumps({'status':r['status'],'errors':r['errors']}));raise SystemExit(0 if r['status']=='passed' else 1)
