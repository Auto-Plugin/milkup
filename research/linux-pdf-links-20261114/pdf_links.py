#!/usr/bin/env python3
"""Research-only URI/rectangle contract. Does not rewrite PDFs."""
import argparse, hashlib, html, json, pathlib, subprocess, xml.etree.ElementTree as ET

CHINESE = '中文复制验收：春风又绿江南岸，明月何时照我还。'
PAIRS = '文⽂风⻛又⼜月⽉'
CASES = [
    {'page': 1, 'words': ['LINKONE'], 'uri': 'https://example.invalid/one?x=1&y=2'},
    {'page': 1, 'words': ['LINKTWO'], 'uri': 'https://example.invalid/%E4%B8%AD%E6%96%87#target'},
    {'page': 2, 'words': ['WRAP%02d' % i for i in range(20)], 'uri': 'https://example.invalid/wrapped'},
    {'page': 3, 'words': ['LINKLAST'], 'uri': 'https://example.invalid/last'},
]

def fixtures(directory):
    directory.mkdir(parents=True, exist_ok=True)
    def link(c, enabled):
        attrs = ' href="' + html.escape(c['uri'], quote=True) + '"' if enabled else ''
        tag = 'a' if enabled else 'span'
        return f'<{tag}{attrs}>' + ' '.join(c['words']) + f'</{tag}>'
    for enabled, name in [(True, 'links'), (False, 'no-links')]:
        pages = [f'<h1>PAGEONE</h1><p>{CHINESE}</p><p>{PAIRS}</p><p>{link(CASES[0],enabled)}</p><p>{link(CASES[1],enabled)}</p>',
                 f'<h1>PAGETWO</h1><div style="width:200px">{link(CASES[2],enabled)}</div>',
                 f'<h1>PAGETHREE</h1><p>{CHINESE}</p><p>{PAIRS}</p><div style="transform:translate(30px,15px)">{link(CASES[3],enabled)}</div>']
        body = '<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'"><style>@page{size:A4;margin:15mm}body{font:16px \'Noto Sans CJK SC\',sans-serif}section{break-after:page}section:last-child{break-after:auto}a,span{color:blue;text-decoration:underline}</style>'
        body += ''.join('<section>'+p+'</section>' for p in pages)
        (directory/(name+'.html')).write_text(body)

def inspect(pdf):
    from pypdf import PdfReader
    reader = PdfReader(pdf)
    bbox = subprocess.check_output(['pdftotext','-bbox',str(pdf),'-'], text=True)
    raw = subprocess.check_output(['pdftotext','-raw',str(pdf),'-'], text=True)
    words = []
    for i, page in enumerate(ET.fromstring(bbox).iter('{http://www.w3.org/1999/xhtml}page'), 1):
        for w in page.iter('{http://www.w3.org/1999/xhtml}word'):
            words.append({'page':i,'text':w.text,'rect':[float(w.attrib[k]) for k in ['xMin','yMin','xMax','yMax']]})
    links = []
    for i, page in enumerate(reader.pages,1):
        assert int(page.get('/Rotate',0)) == 0, 'Fixture orientation unexpected'
        height = float(page.mediabox.height)
        for ref in page.get('/Annots',[]):
            a = ref.get_object()
            assert str(a.get('/Subtype')) == '/Link', 'Unexpected annotation kind'
            action = a.get('/A',{}).get_object()
            assert str(action.get('/S')) == '/URI', 'Unexpected action kind'
            x0,y0,x1,y1 = map(float,a['/Rect'])
            links.append({'page':i,'uri':str(action['/URI']),'rect':[x0,height-y1,x1,height-y0]})
    return {'pages':len(reader.pages),'links':links,'words':words,'text':raw,'sha256':hashlib.sha256(pdf.read_bytes()).hexdigest()}

def union(rects):
    return [min(r[0] for r in rects),min(r[1] for r in rects),max(r[2] for r in rects),max(r[3] for r in rects)]

def verify(sample, linked=True, unicode=True):
    assert sample['pages']==3, 'Exactly three fixture pages required'
    if unicode:
        compact=''.join(sample['text'].split())
        assert compact.count(CHINESE)==2 and compact.count(PAIRS)==2, 'Chinese/radical extraction regression'
    for p, marker in enumerate(['PAGEONE','PAGETWO','PAGETHREE'],1):
        assert len([w for w in sample['words'] if w['page']==p and w['text']==marker])==1, 'Page marker misplaced'
    if not linked:
        assert not sample['links'], 'No-link control must not create annotations'
        return
    expected={(c['page'],c['uri']) for c in CASES}
    assert {(a['page'],a['uri']) for a in sample['links']}==expected, 'URI/page set mismatch'
    for c in CASES:
        hits=[]
        for text in c['words']:
            found=[w for w in sample['words'] if w['text']==text]
            assert len(found)==1 and found[0]['page']==c['page'], 'Exact link text and page required'
            hits.append(found[0]['rect'])
        targets=[a['rect'] for a in sample['links'] if (a['page'],a['uri'])==(c['page'],c['uri'])]
        text_box=union(hits); area=union(targets)
        assert all(abs(a-b)<=7 for a,b in zip(area,text_box)), 'Annotation must bound its own text, not the page or another link'
        for r in targets:
            assert r[0]>=0 and r[1]>=0 and r[2]>r[0] and r[3]>r[1] and r[2]<=596 and r[3]<=843, 'Invalid or off-page rectangle'
            assert any(r[0]<b[2] and r[2]>b[0] and r[1]<b[3] and r[3]>b[1] for b in hits), 'Extraneous clickable region'
        for b in hits:
            assert any(r[0]<=b[0]+2 and r[1]<=b[1]+2 and r[2]>=b[2]-2 and r[3]>=b[3]-2 for r in targets), 'Uncovered linked word'

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('operation',choices=['fixtures','verify','baseline']);p.add_argument('directory',type=pathlib.Path);a=p.parse_args()
    if a.operation=='fixtures':fixtures(a.directory)
    else:
        results={}
        for name in ['links','no-links']:
            sample=inspect(a.directory/(name+'.pdf'));results[name]=sample
        (a.directory/'inspection.json').write_text(json.dumps(results,ensure_ascii=False,indent=2))
        if a.operation=='baseline':
            # Precisely demonstrate the missing interface, not an unrelated error.
            for s in results.values():verify(s,linked=False,unicode=False)
            rejected=False
            try:verify(results['links'],unicode=False)
            except AssertionError as e:
                assert str(e)=='URI/page set mismatch';rejected=True
            assert rejected, 'Old backend must fail the positive URI contract'
        else:
            verify(results['links']);verify(results['no-links'],linked=False)
            assert results['links']['text']==results['no-links']['text'], 'Annotations must not alter extracted text'
        (a.directory/'result.json').write_text(json.dumps({'status':'passed','scope':a.operation,'pdfSha256':{k:v['sha256'] for k,v in results.items()}},indent=2))
