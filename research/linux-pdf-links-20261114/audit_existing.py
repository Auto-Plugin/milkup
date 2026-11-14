#!/usr/bin/env python3
"""Offline diagnostic of existing evidence. Never rewrites PDFs or returns acceptance."""
import argparse, hashlib, json, pathlib, re, subprocess
from pypdf import PdfReader
from pypdf.generic import ContentStream
from pdf_links import CASES, CHINESE, PAIRS, inspect, union, verify

def multiply(a,b):
    return [a[0]*b[0]+a[1]*b[2],a[0]*b[1]+a[1]*b[3],a[2]*b[0]+a[3]*b[2],a[2]*b[1]+a[3]*b[3],a[4]*b[0]+a[5]*b[2]+b[4],a[4]*b[1]+a[5]*b[3]+b[5]]

def paint_rectangles(reader,page):
    """Independent painted blue rectangle evidence, NOT DOM/layout bounds."""
    matrix=[1,0,0,1,0,0];color=[0,0,0];stack=[];rects=[];out=[]
    height=float(page.mediabox.height)
    for args,op in ContentStream(page.get_contents(),reader).operations:
        if op==b'q':stack.append((matrix[:],color[:]))
        elif op==b'Q':matrix,color=stack.pop()
        elif op==b'cm':matrix=multiply(list(map(float,args)),matrix)
        elif op==b'rg':color=list(map(float,args))
        elif op==b're':
            x,y,w,h=map(float,args);points=[]
            for px,py in [(x,y),(x+w,y),(x,y+h),(x+w,y+h)]:
                points.append([px*matrix[0]+py*matrix[2]+matrix[4],height-(px*matrix[1]+py*matrix[3]+matrix[5])])
            rects.append([min(p[0] for p in points),min(p[1] for p in points),max(p[0] for p in points),max(p[1] for p in points)])
        elif op in [b'f',b'f*',b'n']:
            if op!=b'n' and color==[0,0,1]:out.extend(rects)
            rects=[]
    return out

def null_maps(reader):
    result=[]
    for number,page in enumerate(reader.pages,1):
        for name,ref in page['/Resources']['/Font'].items():
            font=ref.get_object()
            if '/ToUnicode' not in font:continue
            cmap=font['/ToUnicode'].get_data().decode()
            codes=re.findall(r'<([0-9A-Fa-f]+)>\s+<0000>',cmap)
            if codes:result.append({'page':number,'font':str(name),'codes':codes,'rawToUnicode':cmap})
    return result

def checks(sample,linked):
    compact=''.join(sample['text'].split())
    page_markers=all(len([w for w in sample['words'] if w['page']==p and w['text']==marker])==1 for p,marker in enumerate(['PAGEONE','PAGETWO','PAGETHREE'],1))
    tokens=[word for case in CASES for word in case['words']]
    missing=[word for word in tokens if compact.count(word)!=1]
    actual={(a['page'],a['uri']) for a in sample['links']}
    expected={(c['page'],c['uri']) for c in CASES} if linked else set()
    return {'pages':sample['pages']==3,'pageMarkers':page_markers,'chineseTwice':compact.count(CHINESE)==2,'intentionalRadicalsTwice':compact.count(PAIRS)==2,'uriPageSet':actual==expected,'annotationCount':len(sample['links']),'allLinkTokensExactlyOnce':not missing,'missingOrRepeatedLinkTokens':missing}

def audit(root,baseline=None):
    samples={name:inspect(root/(name+'.pdf')) for name in ['links','no-links']}
    readers={name:PdfReader(root/(name+'.pdf')) for name in samples}
    result={'status':'diagnostic-not-accepted','scope':'Offline original PDFs; no DOM layout evidence was recorded; no thresholds changed',
        'checks':{name:checks(s,name=='links') for name,s in samples.items()},
        'textIdenticalBetweenControls':samples['links']['text']==samples['no-links']['text'],
        'wordBoxesIdenticalBetweenControls':samples['links']['words']==samples['no-links']['words'],
        'sha256':{name:s['sha256'] for name,s in samples.items()},'links':[],
        'nullToUnicode':{name:null_maps(r) for name,r in readers.items()},
        'uncovered':['Independent print-time element/fragment layout boxes','Explicit overflow clipping fixture','Internal PDF destinations','Interactive viewer clicks/clipboard']}
    for c in CASES:
        annotations=[a for a in samples['links']['links'] if a['uri']==c['uri']]
        words=[w for w in samples['links']['words'] if w['text'] in c['words']]
        available_words=words or [w for w in samples['links']['words'] if w['page']==c['page'] and w['text']=='WRAP']
        box=union([w['rect'] for w in available_words]) if available_words else None
        paints=paint_rectangles(readers['links'],readers['links'].pages[c['page']-1])
        # Associate paint by vertical overlap only as diagnostics, not as an acceptance oracle.
        selected=[r for r in paints if any(r[1]<a['rect'][3] and r[3]>a['rect'][1] for a in annotations)]
        row={'expectedPage':c['page'],'uri':c['uri'],'annotations':annotations,'extractedWords':available_words,
            'wordBoxUnion':box,'wordTokensComplete':len(words)==len(c['words']),
            'independentPrintElementRects':None,'layoutEvidenceStatus':'not-captured-in-original-run',
            'independentPaintedUnderlineRects':selected,'paintIsNotElementLayout':True}
        if box and len(annotations)==1:
            row['annotationMinusWordBox']=[a-b for a,b in zip(annotations[0]['rect'],box)]
        page=readers['links'].pages[c['page']-1]
        row['pageGeometry']={'mediaBox':list(map(float,page.mediabox)),'cropBox':list(map(float,page.cropbox)),'rotate':int(page.get('/Rotate',0))}
        result['links'].append(row)
    if baseline:
        b={name:inspect(baseline/(name+'.pdf')) for name in samples}
        result['systemBaseline']={'checks':{name:checks(s,name=='links') for name,s in b.items()},'nullToUnicode':{name:null_maps(PdfReader(baseline/(name+'.pdf'))) for name in b}}
    try:
        verify(samples['links']);result['originalPositiveAssertion']='passed'
    except AssertionError as e:result['originalPositiveAssertion']=str(e)
    try:
        verify(samples['no-links'],False);result['previouslySkippedNoLinkUnicodeContract']='passed'
    except AssertionError as e:result['previouslySkippedNoLinkUnicodeContract']=str(e)
    return result

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('root',type=pathlib.Path);p.add_argument('--baseline',type=pathlib.Path);p.add_argument('--out',type=pathlib.Path,required=True);a=p.parse_args()
    result=audit(a.root,a.baseline);a.out.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'status':result['status'],'checks':result['checks'],'originalPositiveAssertion':result['originalPositiveAssertion']},ensure_ascii=False))
