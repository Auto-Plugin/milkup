#!/usr/bin/env python3
"""Separate fail-closed print-layout oracle. Never reads annotations as layout.

Scope: axis-aligned affine transforms, rectangular overflow clips, URI links.
No screen-DOM measurements, font bounding boxes or empirical edge tolerance.
"""
import argparse, hashlib, html, json, math, pathlib

PREFIX='MILKUP_LAYOUT '
URIS={name:'https://example.invalid/'+name for name in ['adjacent-left','adjacent-right','wrapped','neighbor','clipped','cross-page']}
IDS={ 'probe-'+k:v for k,v in URIS.items() }

def fixtures(directory):
    directory.mkdir(parents=True,exist_ok=True)
    for linked in [True,False]:
        def anchor(name,text,style=''):
            tag='a'if linked else'span';href=f' href="{URIS[name]}"'if linked else''
            return f'<{tag} id="probe-{name}"{href} style="{style}">{text}</{tag}>'
        # English-only geometry labels avoid letting the independent digit defect
        # change the geometry result. Full text/Chinese remain a separate gate.
        pages=[
          '<h1>GEOMETRYONE</h1><p>'+anchor('adjacent-left','LEFTLINK')+anchor('adjacent-right','RIGHTLINK')+'</p>'
          '<div style="position:relative;width:190px">'+anchor('wrapped','ALPHA BETA GAMMA<br>DELTA EPSILON<br>END')+anchor('neighbor','NEIGHBOR','position:absolute;right:0;bottom:0')+'</div>'
          '<div style="width:65px;height:18px;overflow:hidden;margin-top:35px">'+anchor('clipped','CLIPPEDLINKWITHTAIL','white-space:nowrap')+'</div>',
          '<h1>GEOMETRYTWO</h1><div style="width:270px;font-size:20px;line-height:64px">'+anchor('cross-page',' '.join(['CROSSPAGE']*60))+'</div>']
        css='@page{size:A4;margin:15mm}body{font:16px "Noto Sans CJK SC",sans-serif}section:first-of-type{break-after:page}a,span{color:blue;text-decoration:underline}'
        content='<!doctype html><meta charset="utf-8"><title>MILKUP_PRINT_LAYOUT_V1</title><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'"><style>'+css+'</style>'+''.join('<section>'+x+'</section>'for x in pages)
        name='geometry-links'if linked else'geometry-no-links'
        (directory/(name+'.html')).write_text(content)
    manifest={p.name:hashlib.sha256(p.read_bytes()).hexdigest()for p in directory.glob('geometry-*.html')}
    (directory/'geometry-fixtures.json').write_text(json.dumps({'sha256':manifest,'ids':IDS,'restrictions':'No script, rounded/path clips, rotations, nested subframes, writing-mode or perspective. Exact fixture bytes required.'},indent=2)+'\n')

def rect(r):
    assert len(r)==4 and all(math.isfinite(v)for v in r),'Invalid rectangle'
    assert r[2]>=r[0]and r[3]>=r[1],'Inverted rectangle'
    return list(r)

def intersect(a,b):
    r=[max(a[0],b[0]),max(a[1],b[1]),min(a[2],b[2]),min(a[3],b[3])]
    return r if r[2]>r[0]and r[3]>r[1]else None

def transform(r,m):
    a,b,c,d,e,f=m
    assert b==c==0 and a>0 and d>0,'Unsupported matrix'
    return [r[0]*a+e,r[1]*d+f,r[2]*a+e,r[3]*d+f]

def rounding_bound(m):
    # Two independent LayoutUnit edge quantizations (1/64 CSS px each),
    # plus 16 float32 arithmetic roundings at the bounded 20000-point scale.
    # This derives from representation/operations, not observed discrepancies.
    return max(m[0],m[3])*2/64 + 16*(2**-23)*20000

def parse(log,expected_pages,linked=True):
    assert len(log.encode())<=1024*1024,'Diagnostic byte budget'
    records=[json.loads(line[len(PREFIX):])for line in log.splitlines()if line.startswith(PREFIX)]
    assert records and len(records)<=512,'Missing or excessive layout records'
    pages={};current=None
    for r in records:
        k=r['kind'];p=r.get('page')
        assert k in ['page','element','end'],'Native diagnostic error'
        if k=='page':
            assert current is None and p not in pages and r['printing'] is True and r['layoutReady'] is True,'Wrong phase or duplicate page'
            assert len(r['ctm'])==6 and all(math.isfinite(v)and abs(v)<20000 for v in r['ctm']),'Invalid CTM'
            transform([0,0,1,1],r['ctm']);rect(r['pageRect'])
            current=p;pages[p]={'header':r,'elements':{}}
        elif k=='element':
            assert current==p,'Out-of-order element'
            ident=bytes.fromhex(r['idHex']).decode();uri=bytes.fromhex(r['uriHex']).decode()
            assert ident in IDS and ident not in pages[p]['elements'],'Unknown or duplicate element'
            assert uri==(IDS[ident]if linked else''),'Layout target mismatch'
            assert 0<len(r['fragments'])<=64 and len(r['clips'])<=32,'Incomplete fragments or clips'
            for box in r['fragments']+r['clips']:rect(box)
            pages[p]['elements'][ident]=r
        else:
            assert current==p and r['complete'] is True,'Incomplete native layout'
            assert r['elements']==len(IDS)and set(pages[p]['elements'])==set(IDS),'Missing layout elements'
            current=None
    assert current is None and set(pages)==set(range(1,expected_pages+1)),'Missing page/end'
    return pages

def expected_regions(pages):
    output=[]
    for p,data in pages.items():
        h=data['header'];m=h['ctm'];tol=rounding_bound(m)
        for ident,r in data['elements'].items():
            for fragment in r['fragments']:
                box=fragment
                for clip in [h['pageRect']]+r['clips']:
                    box=intersect(box,clip)
                    if box is None:break
                if box:
                    mapped=transform(box,m)
                    assert max(map(abs,mapped))<20000,'Coordinate scope exceeded'
                    output.append({'page':p,'id':ident,'uri':IDS[ident],'rect':mapped,'tolerance':tol})
    return output

def discrimination(pages):
    regions=expected_regions(pages)
    wrapped=[r for r in regions if r['id']=='probe-wrapped']
    neighbors=[r for r in regions if r['id']=='probe-neighbor']
    assert len(wrapped)>=3 and len(neighbors)==1,'Wrapped/neighbor fixture not realized'
    neighbor=neighbors[0]
    assert all(intersect(w['rect'],neighbor['rect'])is None for w in wrapped),'Actual elements overlap; not a valid counterexample'
    union=[min(r['rect'][0]for r in wrapped),min(r['rect'][1]for r in wrapped),max(r['rect'][2]for r in wrapped),max(r['rect'][3]for r in wrapped)]
    assert intersect(union,neighbor['rect']),'Old union must cover neighbor to discriminate'
    cross={r['page']for r in regions if r['id']=='probe-cross-page'}
    assert len(cross)>=2,'Cross-page fixture did not cross a page'
    clipped=[r for r in regions if r['id']=='probe-clipped']
    assert len(clipped)==1,'Clipped fixture not visible exactly once'
    native=pages[clipped[0]['page']]['elements']['probe-clipped']
    assert native['clips'],'Overflow clip not captured'
    original=transform(native['fragments'][0],pages[clipped[0]['page']]['header']['ctm'])
    assert clipped[0]['rect'][2]<original[2] and clipped[0]['rect'][3]<original[3],'Clip must cut both horizontal and vertical extents'
    left=[r for r in regions if r['id']=='probe-adjacent-left'];right=[r for r in regions if r['id']=='probe-adjacent-right']
    assert len(left)==len(right)==1 and left[0]['page']==right[0]['page'],'Adjacent fixture missing'
    assert abs(left[0]['rect'][2]-right[0]['rect'][0])<=left[0]['tolerance'],'Links not immediately adjacent'
    return {'wrappedNeighborCounterexample':True,'crossPages':sorted(cross),'twoAxisOverflowClip':True,'adjacentLinks':True}

def verify(sample,pages,linked=True):
    assert sample['pages']==len(pages),'PDF/page mismatch'
    regions=expected_regions(pages)
    if not linked:
        assert not sample['links'],'Control acquired annotations'
        return regions
    # One annotation per visible fragment (duplicates of identical fragments can
    # be collapsed). Reject a bounding union which covers another link or a gap.
    unique=[]
    for r in regions:
        if not any((r['page'],r['uri'],r['rect'])==(x['page'],x['uri'],x['rect'])for x in unique):unique.append(r)
    assert len(sample['links'])==len(unique),'Missing/extra/unioned annotation'
    pending=list(sample['links'])
    for r in unique:
        matches=[a for a in pending if (a['page'],a['uri'])==(r['page'],r['uri'])and all(abs(x-y)<=r['tolerance']for x,y in zip(rect(a['rect']),r['rect']))]
        assert len(matches)==1,'Annotation not equal to its independent print fragment'
        a=matches[0];pending.remove(a)
        for other in unique:
            if other['page']==r['page']and other['uri']!=r['uri']:
                overlap=intersect(a['rect'],other['rect'])
                assert overlap is None or min(overlap[2]-overlap[0],overlap[3]-overlap[1])<=r['tolerance'],'Clickable region overlaps neighboring target'
    return unique

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('directory',type=pathlib.Path);a=p.parse_args();fixtures(a.directory)
