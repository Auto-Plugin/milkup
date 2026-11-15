#!/usr/bin/env python3
"""Mechanism experiment only: system WebKit, bounded synthetic table printing."""
import collections
import hashlib
import json
import os
from pathlib import Path
import shlex
import subprocess
import sys
import tempfile
import time

HERE = Path(__file__).resolve().parent
VARIANTS = ('baseline', 'chain', 'external-group', 'internal-group')
CASES = {'short-room': (8, 3), 'short-edge': (45, 3),
         'long-room': (8, 72), 'long-edge': (45, 72)}


def ident(i):
    return chr(65 + i // 26) + chr(65 + i % 26)


def fixture(variant, case):
    prelude, count = CASES[case]
    # All preceding height is visible text in normal flow, not an empty spacer.
    paragraphs = ''.join(f'<p class="prelude">PRE{ident(i)}</p>' for i in range(prelude))
    title = '<h2 id="title">TABLETITLE</h2>'
    headers = '<tr><th id="left" scope="col">LEFTHEADER</th><th id="right" scope="col">RIGHTHEADER</th></tr>'
    rows = [f'<tr><td headers="left">ROW{ident(i)} HAMBURGEFONS</td><td headers="right">END{ident(i)}</td></tr>' for i in range(count)]
    css = '''@page{size:A4;margin:16mm}*{box-sizing:border-box}body{margin:0;padding:0;color:#202124;background:white;font-family:"Noto Sans CJK SC",sans-serif;font-size:16px;line-height:1.65}.prelude{margin:0;height:20px;line-height:20px}h2{font-size:24px;line-height:1.3;margin:20px 0;break-after:avoid;page-break-after:avoid}table{border-collapse:collapse;width:100%;margin:0;break-inside:auto}th,td{border:1px solid #999;padding:.4em .6em}thead{display:table-header-group}tr{break-inside:avoid;page-break-inside:avoid}'''
    if variant == 'baseline':
        body = f'<div class="lead">{title}<table aria-labelledby="title"><thead>{headers}</thead><tbody>{"".join(rows)}</tbody></table></div>'
        css += '.lead{break-inside:avoid;page-break-inside:avoid}'
    elif variant == 'chain':
        body = f'{title}<table aria-labelledby="title"><thead>{headers}</thead><tbody>{"".join(rows)}</tbody></table>'
        css += 'table{break-before:avoid;page-break-before:avoid}thead{break-inside:avoid;break-after:avoid;page-break-inside:avoid;page-break-after:avoid}tbody>tr:first-child{break-before:avoid;page-break-before:avoid}'
    else:
        # One table and explicit column associations; no duplicated or fake header.
        # The internal experiment adds one title cell. It is not a product design:
        # native AT/row navigation consequences must be reviewed separately.
        inner = f'<tr class="title-row"><td colspan="2">{title}</td></tr>' if variant == 'internal-group' else ''
        body = (title if variant == 'external-group' else '') + f'<table aria-labelledby="title"><tbody class="lead">{inner}{headers}{rows[0]}</tbody><tbody>{"".join(rows[1:])}</tbody></table>'
        css += 'table{break-before:avoid;page-break-before:avoid}tbody.lead{break-inside:avoid;page-break-inside:avoid}.title-row>td{border:0;padding:0}.title-row h2{margin:20px 0}'
    return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; base-uri \'none\'; form-action \'none\'"><style>' + css + '</style></head><body>' + paragraphs + body + '<p>DOCUMENTEND</p></body></html>'


def validate_html(html, variant, case):
    from lxml import html as parser
    root = parser.fromstring(html)
    table, = root.xpath('//table')
    assert table.get('aria-labelledby') == 'title'
    assert len(root.xpath('//h2[@id="title"]')) == 1
    assert len(table.xpath('.//th[@scope="col"]')) == 2
    assert len(table.xpath('.//td[@headers="left"]')) == CASES[case][1]
    assert len(table.xpath('.//td[@headers="right"]')) == CASES[case][1]
    assert not root.xpath('//*[@aria-hidden or @role]')
    assert not root.xpath('//script|//img|//iframe|//caption')
    assert len(root.xpath('//p[@class="prelude"]')) == CASES[case][0]
    for i, row in enumerate(table.xpath('.//tr[td[@headers="left"]]')):
        assert ''.join(row.itertext()).replace(' ', '') == f'ROW{ident(i)}HAMBURGEFONSEND{ident(i)}'
    css = root.xpath('//style')[0].text
    assert 'position:' not in css and 'break-before:page' not in css
    assert 'table{break-inside:avoid' not in css
    assert len(table.xpath('./tbody')) == (2 if variant.endswith('group') else 1)


def inspect_words(pages, case):
    prelude, count = CASES[case]
    errors, occ = [], collections.defaultdict(list)
    for n, page in enumerate(pages, 1):
        if not page['words']: errors.append(f'blank page {n}')
        if abs(page['width']-595.276)>1 or abs(page['height']-841.89)>1: errors.append(f'paper {n}')
        for word in page['words']:
            occ[word[4]].append((n, word))
            if not (0 <= word[0] < word[2] <= page['width'] and 0 <= word[1] < word[3] <= page['height']):
                errors.append(f'off-page {n} {word[4]}')
    expected = ['TABLETITLE', 'DOCUMENTEND'] + [f'PRE{ident(i)}' for i in range(prelude)]
    expected += [prefix+ident(i) for i in range(count) for prefix in ['ROW','END']]
    for text in expected:
        if len(occ[text]) != 1: errors.append(f'count {text} {len(occ[text])}')
    if len(occ['HAMBURGEFONS']) != count: errors.append('guard count')
    placements = []
    for i in range(count):
        left,right = occ['ROW'+ident(i)],occ['END'+ident(i)]
        if len(left)==len(right)==1:
            a,b=left[0],right[0];placements.append([a[0],a[1][1]])
            if a[0]!=b[0] or abs(a[1][1]-b[1][1])>1 or a[1][2]>=b[1][0]:errors.append('row split/order '+str(i))
    if placements != sorted(placements):errors.append('row order')
    if not occ['LEFTHEADER'] or not occ['RIGHTHEADER']:errors.append('missing headers')
    title_page = occ['TABLETITLE'][0][0] if len(occ['TABLETITLE'])==1 else None
    first_page = occ['ROWAA'][0][0] if len(occ['ROWAA'])==1 else None
    header_pages = [v[0] for v in occ['LEFTHEADER']]
    if title_page != first_page or first_page not in header_pages: errors.append('title/header/first-row separated')
    if title_page is not None and first_page is not None:
        lefts=[w for n,w in occ['LEFTHEADER'] if n==first_page]
        rights=[w for n,w in occ['RIGHTHEADER'] if n==first_page]
        if len(lefts)!=1 or len(rights)!=1:errors.append('ambiguous first-page headers')
        elif abs(lefts[0][1]-rights[0][1])>1 or lefts[0][2]>=rights[0][0]:errors.append('header alignment')
        elif title_page==first_page and not (occ['TABLETITLE'][0][1][3] <= lefts[0][1] and lefts[0][3] <= occ['ROWAA'][0][1][1]):errors.append('title/header/row overlap or order')
    if case.endswith('room') and title_page!=1:errors.append('unnecessary page before title')
    if case=='short-room' and len(pages)!=1:errors.append('short table grew pages')
    if count>3 and len({r[0] for r in placements})<2:errors.append('long table not fragmented')
    if len(pages)>6:errors.append('unbounded fragmentation')
    return {'errors':errors,'titlePage':title_page,'firstRowPage':first_page,'headerPages':header_pages,
            'pages':len(pages),'rows':len(placements),'rowPages':sorted({r[0] for r in placements}),
            'titleOccurrences':len(occ['TABLETITLE']),'markers':len(expected)}


def pdf_check(path, case):
    import fitz
    from PIL import Image
    import math,statistics
    doc=fitz.open(path)
    pages=[{'width':p.rect.width,'height':p.rect.height,'words':[list(w[:5]) for w in p.get_text('words')]} for p in doc]
    result=inspect_words(pages,case);result['coordinates']=pages
    # Independent Poppler renderer, MuPDF glyph coordinates; keep both outputs.
    subprocess.run(['pdftoppm','-r','144','-png',str(path),str(path.with_suffix(''))],check=True,timeout=40,stdout=subprocess.DEVNULL)
    images=sorted(path.parent.glob(path.stem+'-*.png'))
    assert len(images)==len(pages)
    guards=[]
    for page,im in zip(pages,images):
        image=Image.open(im).convert('L');sx=image.width/page['width'];sy=image.height/page['height']
        for w in page['words']:
            if w[4]!='HAMBURGEFONS':continue
            crop=image.crop((math.floor(w[0]*sx),math.floor(w[1]*sy),math.ceil(w[2]*sx),math.ceil(w[3]*sy)))
            box=crop.point(lambda p:255 if p<110 else 0).getbbox()
            guards.append([box[2]-box[0],box[3]-box[1]] if box else [0,0])
    if guards:
        width,height=[statistics.median(g[i] for g in guards) for i in (0,1)]
        if any(g[0]<width-2 or g[1]<height-2 for g in guards):result['errors'].append('clipped row guard')
    else:result['errors'].append('missing raster guards')
    result['guards']=guards;result['pdfSha256']=hashlib.sha256(path.read_bytes()).hexdigest()
    return result


def preflight(out):
    out.mkdir(parents=True,exist_ok=True)
    for variant in VARIANTS:
        for case in CASES:
            html=fixture(variant,case);validate_html(html,variant,case)
            (out/f'{variant}-{case}.html').write_text(html)
    return {'fixtures':16,'variants':VARIANTS,'cases':CASES,'status':'html-contracts-passed'}


def native(out):
    assert os.getuid()!=0 and not os.environ.get('WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS')
    assert not os.environ.get('LD_PRELOAD') and not os.environ.get('LD_LIBRARY_PATH')
    result={'scope':'system WebKit mechanism only; no Milkup build/install','sha':os.environ.get('GITHUB_SHA'),
            'preflight':preflight(out),'results':[],'status':'running'}
    report=out/'result.json'
    def persist():report.write_text(json.dumps(result,indent=2)+'\n')
    flags=shlex.split(subprocess.check_output(['pkg-config','--cflags','--libs','webkit2gtk-4.1','gtk+-3.0'],text=True))
    binary=out/'print-probe'
    subprocess.run(['cc','-Wall','-Wextra','-Werror','-Wno-deprecated-declarations',str(HERE/'print-probe.c'),'-o',str(binary),*flags],check=True,timeout=45)
    started=time.monotonic()
    with tempfile.TemporaryDirectory(prefix='mkbreak-',dir='/tmp') as runtime:
        env=os.environ.copy();env['XDG_RUNTIME_DIR']=runtime
        for name in ['CONFIG','CACHE','DATA','STATE']:
            folder=out/('xdg-'+name.lower());folder.mkdir(mode=0o700);env['XDG_'+name+'_HOME']=str(folder)
        for variant in VARIANTS:
            for case in CASES:
                assert time.monotonic()-started<600,'batch budget'
                name=variant+'-'+case;row={'variant':variant,'case':case};result['results'].append(row);persist()
                try:
                    with (out/(name+'.log')).open('w') as log:
                        p=subprocess.run(['timeout','--signal=TERM','--kill-after=5s','55s','xvfb-run','-a','dbus-run-session','--',str(binary),str(out/(name+'.html')),str(out/(name+'.pdf')),str(out/(name+'.maps'))],env=env,stdout=log,stderr=subprocess.STDOUT,timeout=65)
                    assert p.returncode==0,f'native print exit {p.returncode}'
                    assert 'SANDBOX_ENABLED' in (out/(name+'.log')).read_text()
                    maps=(out/(name+'.maps')).read_text()
                    libs=sorted({l.split()[-1] for l in maps.splitlines() if 'libwebkit2gtk-4.1.so.' in l or 'libjavascriptcoregtk-4.1.so.' in l})
                    assert len(libs)==2 and all(p.startswith('/usr/lib/') for p in libs),'system runtime required'
                    row.update(libraries=libs,**pdf_check(out/(name+'.pdf'),case));row['status']='passed' if not row['errors'] else 'failed-contract'
                except Exception as e:row.update(status='failed-execution',error=str(e))
                persist()
    baseline=[r for r in result['results'] if r['variant']=='baseline']
    result['baselineReproduced']=all(r['status']=='passed' for r in baseline if r['case']!='long-edge') and any(r['case']=='long-edge' and r.get('titlePage')==1 and r.get('firstRowPage')==2 and r.get('errors')==['title/header/first-row separated'] for r in baseline)
    result['passingMechanisms']=[v for v in VARIANTS[1:] if all(r['status']=='passed' for r in result['results'] if r['variant']==v)]
    result['status']='mechanism-evidence-only' if result['baselineReproduced'] and result['passingMechanisms'] else 'failed-mechanism-gate'
    persist();print(json.dumps({k:v for k,v in result.items() if k not in ['results','preflight']},indent=2))
    return result['status']!='mechanism-evidence-only'


if __name__=='__main__':
    mode,out=sys.argv[1],Path(sys.argv[2]).resolve()
    if mode=='preflight':print(json.dumps(preflight(out)))
    elif mode=='native':sys.exit(native(out))
    else:raise SystemExit('unknown mode')
