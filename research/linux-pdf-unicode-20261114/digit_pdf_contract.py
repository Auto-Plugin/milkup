#!/usr/bin/env python3
"""Digit regression gate with native source/cluster trace and unchanged negatives."""
import argparse, base64, hashlib, json, pathlib, subprocess, sys, tempfile
from pypdf import PdfReader
from pypdf.generic import ContentStream
from test_digit_probe import collision_font

LINKS = pathlib.Path(__file__).resolve().parents[1] / 'linux-pdf-links-20261114'
sys.path.insert(0, str(LINKS))
import layout_contract as layout
import paint_contract as paint
from pdf_links import inspect
from audit_existing import audit, null_maps

def fixtures(root):
    font = root / 'digit-collision.ttf'; collision_font(font)
    data = base64.b64encode(font.read_bytes()).decode()
    html = '''<!doctype html><html lang="en"><meta charset="utf-8"><title>MILKUP_DIGIT_RESEARCH</title>
<style>@page {size:A4;margin:0} body {font-family:'Noto Sans CJK SC';font-size:24px;padding:20px}
@font-face {font-family:DigitCollision;src:url(data:font/ttf;base64,''' + data + ''')}
.collision {font-family:DigitCollision} .negative {break-before:page}
</style><body><p>DIGITS</p><p>WRAP0123456789</p><p>COLLISION</p><p class="collision">1212</p>
<p>文⽂风⻛又⼜月⽉</p>
<section class="negative"><p>NEGATIVE</p><p class="collision">fi</p><p class="collision">a&#x301;</p>
<p style="font-family:'DejaVu Sans'">x&#x301;</p>
<p dir="rtl" lang="ar" style="font-family:'Noto Naskh Arabic'">سلام</p>
<p lang="hi" style="font-family:'Noto Sans Devanagari'">कि</p></section></body></html>'''
    for name in ['digit-baseline', 'digit-candidate']: (root / (name + '.html')).write_text(html)
    return {'fontSha256': hashlib.sha256(font.read_bytes()).hexdigest(), 'htmlSha256': hashlib.sha256(html.encode()).hexdigest()}

def traces(path):
    text = path.read_text(); assert 'MILKUP_DIGIT_OVERFLOW' not in text
    rows = [json.loads(x[len('MILKUP_DIGIT_V1 '):]) for x in text.splitlines() if x.startswith('MILKUP_DIGIT_V1 ')]
    assert 0 < len(rows) <= 512
    return rows

def verify_trace(rows, accepted):
    found = {}
    for token in ['WRAP0123456789', '1212']:
        selected = [r for r in rows if r['source'] == list(map(ord, token))]
        assert selected, 'Actual WebKit source/glyph trace missing: ' + token
        for row in selected:
            assert row['accepted'] is accepted
            assert [g[0] for g in row['glyphs']] == list(range(len(token)))
            assert len(row['glyphs']) == len(token)
            for char, g in zip(token, row['glyphs']):
                assert 0 < g[1] < 65535 and 0 < g[2] < 65535
                assert (g[1] != g[2]) if char.isascii() and char.isdigit() else (g[1] == g[2])
        found[token] = selected
    assert all(len({g[1] for g in row['glyphs']}) == 1 and len({g[2] for g in row['glyphs']}) == 2 for row in found['1212'])
    return found

def run(root):
    report = {'status': 'failed', 'errors': [], 'scope': 'Private research WebKit engine, Poppler extraction/search; not viewer clipboard, installed product or physical print'}
    try:
        with tempfile.TemporaryDirectory() as d:
            fixture = pathlib.Path(d); report['fixture'] = fixtures(fixture)
            for name in ['digit-baseline', 'digit-candidate']:
                assert (fixture / (name + '.html')).read_bytes() == (root / (name + '.html')).read_bytes()
        readers = {n: PdfReader(root / (n + '.pdf')) for n in ['digit-baseline', 'digit-candidate']}
        assert all(len(p.pages) == 2 for p in readers.values())
        texts = {}
        for name in readers:
            raw = subprocess.check_output(['pdftotext', '-layout', str(root / (name + '.pdf')), '-'], timeout=15).decode()
            texts[name] = raw.split('\f'); (root / (name + '-extracted.txt')).write_text(raw)
        compact = lambda s: ''.join(s.split())
        assert 'WRAP0123456789' not in compact(texts['digit-baseline'][0]), 'Baseline digit defect was not reproduced'
        for token in ['WRAP0123456789', '1212', '文⽂风⻛又⼜月⽉']:
            assert compact(texts['digit-candidate'][0]).count(token) == 1, 'Candidate source text lost/duplicated: ' + token
        assert texts['digit-baseline'][1] == texts['digit-candidate'][1], 'Protected negative text behavior changed'
        report['negativeExtractedTextUnchanged'] = True
        report['negativeText'] = texts['digit-candidate'][1]
        actual = []
        for args, op in ContentStream(readers['digit-candidate'].pages[0].get_contents(), readers['digit-candidate']).operations:
            if op == b'BDC' and len(args) == 2 and hasattr(args[1], 'get') and args[1].get('/ActualText') is not None:
                actual.append(str(args[1]['/ActualText']))
        assert actual.count('2') >= 2, 'Same uncoded glyph conflict must use per-occurrence ActualText'
        report['actualText'] = actual
        report['traces'] = {n: verify_trace(traces(root / (n + '.log')), n == 'digit-candidate') for n in readers}
        pixels = {}
        with tempfile.TemporaryDirectory() as d:
            for name in readers:
                prefix = pathlib.Path(d) / name
                subprocess.run(['pdftoppm', '-r', '72', str(root / (name + '.pdf')), str(prefix)], check=True, timeout=20, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                pixels[name] = [hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(pathlib.Path(d).glob(name + '-*.ppm'))]
        assert len(pixels['digit-baseline']) == 2 and pixels['digit-baseline'] == pixels['digit-candidate'], 'Metadata patch changed rendered pixels'
        report['pixels'] = pixels
    except Exception as error: report['errors'].append('digits: ' + str(error))
    # Preserve geometry and Chinese/radical/multipage gates independently,
    # without repeating the already-proven old duplicate A/B experiment.
    try:
        report['geometry'] = {}
        for suffix, linked in [('links', True), ('no-links', False)]:
            name = 'paint-candidate-' + suffix; pdf = inspect(root / (name + '.pdf')); log = (root / (name + '.log')).read_text()
            pages = layout.parse(log, pdf['pages'], linked); layout.discrimination(pages)
            native = paint.parse(log, pages, True, linked); corrected, proof = paint.actual_clip_pages(pages, native)
            layout.verify(pdf, corrected, linked)
            report['geometry'][name] = {'status': 'passed', 'clipProof': proof, 'annotations': len(pdf['links'])}
    except Exception as error: report['errors'].append('retained geometry: ' + str(error))
    try:
        source = audit(root); report['sourceText'] = source
        for name, checks in source['checks'].items():
            for key in ['pages', 'pageMarkers', 'chineseTwice', 'intentionalRadicalsTwice', 'uriPageSet', 'allLinkTokensExactlyOnce']:
                assert checks[key], name + ': ' + key
            assert not null_maps(PdfReader(root / (name + '.pdf'))), name + ': U+0000 persists'
    except Exception as error: report['errors'].append('retained source: ' + str(error))
    if not report['errors']: report['status'] = 'passed'
    (root / 'digit-result.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    return report

if __name__ == '__main__':
    p = argparse.ArgumentParser(); p.add_argument('mode', choices=['fixtures', 'verify']); p.add_argument('root', type=pathlib.Path); a = p.parse_args()
    if a.mode == 'fixtures': print(json.dumps(fixtures(a.root)))
    else:
        r = run(a.root); print(json.dumps({'status': r['status'], 'errors': r['errors']})); raise SystemExit(0 if r['status'] == 'passed' else 1)
