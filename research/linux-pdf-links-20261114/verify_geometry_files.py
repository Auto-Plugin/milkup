#!/usr/bin/env python3
"""Persist every independent outcome; a passed geometry check is not PDF fidelity."""
import argparse,hashlib,json,pathlib
from layout_contract import parse,verify,discrimination,fixtures
from pdf_links import inspect
from audit_existing import audit

def run(root):
    result={'status':'failed','scope':'research native engine only; not installed Milkup or supported runtime delivery','geometry':{},'errors':[]}
    # Bind the printed input to the generator, not just a title in a native log.
    import tempfile
    with tempfile.TemporaryDirectory()as d:
        temp=pathlib.Path(d);fixtures(temp)
        for p in temp.glob('geometry-*.html'):
            assert (root/p.name).read_bytes()==p.read_bytes(),'Fixture bytes changed'
    for linked,name in [(True,'geometry-links'),(False,'geometry-no-links')]:
        item={};result['geometry'][name]=item
        try:
            sample=inspect(root/(name+'.pdf'));item['pdf']=sample
            log=(root/(name+'.log')).read_text();item['logSha256']=hashlib.sha256(log.encode()).hexdigest()
            pages=parse(log,sample['pages'],linked);item['printLayout']=pages
            item['fixtureDiscrimination']=discrimination(pages)
            item['regions']=verify(sample,pages,linked);item['status']='passed'
        except Exception as e:item['status']='failed';item['error']=str(e);result['errors'].append(name+': '+str(e))
    try:
        # Keep the exact original Chinese/radical and digit source contract;
        # never substitute geometry-only English labels for text fidelity.
        result['originalTextDiagnostic']=audit(root)
        for name,checks in result['originalTextDiagnostic']['checks'].items():
            for key in ['pages','pageMarkers','chineseTwice','intentionalRadicalsTwice','uriPageSet','allLinkTokensExactlyOnce']:
                if not checks[key]:result['errors'].append('source-text '+name+': '+key+' failed')
    except Exception as e:result['errors'].append('source-text: '+str(e))
    if not result['errors']:result['status']='passed'
    (root/'geometry-result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    return result

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('root',type=pathlib.Path);a=p.parse_args()
    r=run(a.root);print(json.dumps({'status':r['status'],'errors':r['errors']}));raise SystemExit(0 if r['status']=='passed'else 1)
