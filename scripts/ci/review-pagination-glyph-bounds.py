#!/usr/bin/env python3
"""Offline supplementary audit; never overwrites the original failed CI report."""
import copy
import hashlib
import json
import math
import pathlib
import statistics
import sys
import fitz
from PIL import Image

root=pathlib.Path(sys.argv[1])
original=json.loads((root/'pagination-audit.json').read_text())
result={'originalStatus':original['status'],'originalErrors':original['errors'],
        'fitzVersion':fitz.VersionBind,'papers':[], 'scope':'same PDFs, independent font bounds and original Poppler rasters'}

def defects(samples):
    errors=[]
    for style in ['table','code']:
        group=[s for s in samples if s['style']==style]
        assert group
        mw=statistics.median(s['inkWidth'] for s in group)
        mh=statistics.median(s['inkHeight'] for s in group)
        for s in group:
            if s['inkWidth']<mw-2 or s['inkHeight']<mh-2:
                errors.append(s)
    return errors

for old in original['papers']:
    name=old['name'];pdf=root/(name+'.pdf')
    assert hashlib.sha256(pdf.read_bytes()).hexdigest()==old['sha256']
    doc=fitz.open(pdf);samples=[];mapping=[];links=[]
    for n,page in enumerate(doc,1):
        image=Image.open(sorted(root.glob(name+'-render-*.png'))[n-1]).convert('L')
        sx,sy=image.width/page.rect.width,image.height/page.rect.height
        for word in page.get_text('words'):
            if word[4]!='HAMBURGEFONS':continue
            x0,y0,x1,y1=word[:4]
            # Match the independent glyph bounds to original bbox by horizontal
            # interval and contained vertical interval, not by changing thresholds.
            matching=[g for g in old['renderedGuards'] if g['page']==n and abs(g['box'][0]-x0)<.1 and g['box'][1]<=y0+.1 and g['box'][3]>=y1-.1]
            assert len(matching)==1,(name,n,word,matching)
            prior=matching[0]
            crop=image.crop((math.floor(x0*sx),math.floor(y0*sy),math.ceil(x1*sx),math.ceil(y1*sy)))
            box=crop.point(lambda p:255 if p<110 else 0).getbbox()
            samples.append({'page':n,'style':prior['style'],'popplerBox':prior['box'],'glyphBox':list(word[:4]),
                            'inkWidth':box[2]-box[0] if box else 0,'inkHeight':box[3]-box[1] if box else 0})
        links.extend(dict(link,page=n) for link in page.get_links())
        text=page.get_text()
        if 'Known mapping' in text:mapping.append({'page':n,'actual':text[text.index('Known mapping'):],'codepoints':['U+%04X'%ord(c) for c in text[text.index('Known mapping'):]]})
    assert len(samples)==172
    errors=defects(samples)
    # Negative controls keep the same median/tolerance: removing a guard or
    # clipping >2 pixels from a guard must remain detectable.
    for style in ['table','code']:
        i=next(i for i,s in enumerate(samples) if s['style']==style)
        for field in ['inkHeight','inkWidth']:
            modified=copy.deepcopy(samples);modified[i][field]=0
            assert defects(modified),'Missing guard counterexample accepted'
            modified=copy.deepcopy(samples);modified[i][field]-=8
            assert defects(modified),'Clipped guard counterexample accepted'
    result['papers'].append({'name':name,'sha256':old['sha256'],'pages':len(doc),'guardErrors':errors,'samples':samples,
                             'mappingDiagnostics':mapping,'uriAnnotations':[l for l in links if l.get('uri')],
                             'negativeControls':'missing and eight-pixel clipping rejected for both styles, same two-pixel threshold',
                             'remainingPaginationErrors':[e for e in old['errors'] if 'clipped/empty rendered guard' not in e]})
(root.parent/'independent-glyph-review.json').write_text(json.dumps(result,indent=2,ensure_ascii=False)+'\n')
print(json.dumps([{'name':p['name'],'guardErrors':len(p['guardErrors']),'remainingPaginationErrors':p['remainingPaginationErrors'],'uriAnnotations':len(p['uriAnnotations'])} for p in result['papers']],indent=2))
