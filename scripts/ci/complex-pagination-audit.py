#!/usr/bin/env python3
"""Synthetic Markdown and independent Poppler text/geometry/raster pagination gate."""
import collections
import hashlib
import json
import math
import pathlib
import statistics
import subprocess
import sys
import xml.etree.ElementTree as ET


def ident(i):
    return chr(65 + i // 26) + chr(65 + i % 26)


def fixture(root):
    root.mkdir(parents=True, exist_ok=True)
    parts = ['# BEGINPAGINATION\n']
    singles = ['BEGINPAGINATION']
    groups = {}
    for prefix, count, heading in [('P', 18, 'PRELUDE'), ('T', 72, 'TABLESECTION'), ('C', 100, 'CODESECTION')]:
        singles.append(heading)
        parts.append('\n## ' + heading + '\n')
        if prefix == 'T':
            parts.append('\n| TABLELEFT | TABLERIGHT |\n| --- | --- |\n')
        if prefix == 'C':
            parts.append('\n```text\n')
        rows = []
        for i in range(count):
            left, right = prefix + ident(i), 'END' + prefix + ident(i)
            rows.append([left, right])
            singles.extend([left, right])
            if prefix == 'T':
                parts.append(f'| {left} HAMBURGEFONS | {right} |\n')
            elif prefix == 'C':
                parts.append(f'{left} HAMBURGEFONS {right}\n')
            else:
                parts.append(f'\n{left} A short paragraph before the long blocks. {right}\n')
        if prefix == 'C':
            parts.append('```\n')
        groups[prefix] = {'heading': heading, 'rows': rows}
    parts.append('\n## FINALSECTION\n\nENDPAGINATION\n\n')
    singles.extend(['FINALSECTION', 'ENDPAGINATION'])
    parts.append('Known mapping diagnostics: WRAP0123456789 中文春风又绿明月 ⽂⾵⼜⽉\n\n[LINKDIAGNOSTIC](https://example.invalid/pagination)\n')
    text = ''.join(parts)
    (root / 'complex-pagination.md').write_text(text, encoding='utf8')
    expected = {'sourceSha256': hashlib.sha256(text.encode()).hexdigest(), 'singles': singles,
                'groups': groups, 'guard': 'HAMBURGEFONS', 'guardCount': 172,
                'papers': [{'name': 'a4-portrait', 'pageSize': 'a4', 'orientation': 'portrait', 'width': 595.276, 'height': 841.89},
                           {'name': 'letter-landscape', 'pageSize': 'letter', 'orientation': 'landscape', 'width': 792, 'height': 612}],
                'diagnostics': ['WRAP0123456789', '中文春风又绿明月', '⽂⾵⼜⽉'],
                'limitations': ['Mapping and link diagnostics are separate known fidelity gaps, not excused from overall export acceptance.',
                                'ASCII row geometry plus rendered guards is bounded pagination coverage, not arbitrary text or complex-script fidelity.']}
    (root / 'expectations.json').write_text(json.dumps(expected, indent=2, ensure_ascii=False) + '\n')


def inspect(pages, expected, paper):
    """Pure checks also exercised by corruption counterexamples before native execution."""
    errors = []
    def check(condition, message):
        if not condition:
            errors.append(message)
    occurrences = collections.defaultdict(list)
    for n, page in enumerate(pages, 1):
        check(abs(page['width'] - paper['width']) < 1 and abs(page['height'] - paper['height']) < 1, f'page {n}: paper/orientation')
        check(bool(page['words']), f'page {n}: blank page')
        for word in page['words']:
            occurrences[word['text']].append(dict(word, page=n))
            x0, y0, x1, y1 = word['box']
            check(all(math.isfinite(v) for v in word['box']) and 0 <= x0 < x1 <= page['width'] and 0 <= y0 < y1 <= page['height'], f'page {n}: out-of-page {word["text"]}')
    check(len(pages) >= 3, 'complex fixture must span multiple pages')
    for word in expected['singles']:
        check(len(occurrences[word]) == 1, f'{word}: expected once, got {len(occurrences[word])}')
    check(len(occurrences[expected['guard']]) == expected['guardCount'], 'render guard count')
    group_report = {}
    for key, group in expected['groups'].items():
        ordered = []
        for left, right in group['rows']:
            if len(occurrences[left]) != 1 or len(occurrences[right]) != 1:
                continue
            a, b = occurrences[left][0], occurrences[right][0]
            check(a['page'] == b['page'] and abs(a['box'][1] - b['box'][1]) < 1, f'{left}: row split or clipped')
            check(a['box'][2] < b['box'][0], f'{left}: row order/overlap')
            ordered.append((a['page'], a['box'][1], left))
        check([(p, y) for p, y, _ in ordered] == sorted((p, y) for p, y, _ in ordered), f'{key}: row order')
        if ordered and len(occurrences[group['heading']]) == 1:
            check(occurrences[group['heading']][0]['page'] == ordered[0][0], f'{key}: orphan heading')
        if key in ('T', 'C'):
            check(len({p for p, _, _ in ordered}) >= 2, f'{key}: did not exercise a page boundary')
        group_report[key] = {'rows': len(ordered), 'pages': sorted({p for p, _, _ in ordered}),
                             'boundaryRows': [{'page': p, 'first': rows[0][2], 'last': rows[-1][2]} for p in sorted({p for p, _, _ in ordered}) if (rows := [r for r in ordered if r[0] == p])]}
    return errors, occurrences, group_report


def audit(root):
    from PIL import Image
    expected = json.loads((root / 'expectations.json').read_text())
    assert hashlib.sha256((root / 'complex-pagination.md').read_bytes()).hexdigest() == expected['sourceSha256']
    report = {'scope': 'installed-default-runtime-complex-pagination', 'status': 'running', 'papers': [], 'errors': [],
              'knownFidelityLimitations': expected['limitations'], 'overallExportFidelityPassed': False}
    for paper in expected['papers']:
        name = paper['name']
        row = {'name': name, 'errors': []}
        report['papers'].append(row)
        try:
            pdf = root / (name + '.pdf')
            row['sha256'] = hashlib.sha256(pdf.read_bytes()).hexdigest()
            bbox = subprocess.check_output(['pdftotext', '-bbox-layout', str(pdf), '-'], timeout=30)
            (root / (name + '-bbox.xhtml')).write_bytes(bbox)
            raw = subprocess.check_output(['pdftotext', '-raw', str(pdf), '-'], timeout=30).decode('utf8')
            (root / (name + '-raw.txt')).write_text(raw)
            tree = ET.fromstring(bbox)
            pages = []
            for page in tree.findall('.//{*}page'):
                pages.append({'width': float(page.attrib['width']), 'height': float(page.attrib['height']),
                              'words': [{'text': ''.join(w.itertext()), 'box': [float(w.attrib[k]) for k in ['xMin', 'yMin', 'xMax', 'yMax']]} for w in page.findall('.//{*}word')]})
            assert 1 <= len(pages) <= 30, 'bounded PDF pages'
            errors, occurrences, groups = inspect(pages, expected, paper)
            row.update(errors=errors, pages=pages, groups=groups)
            row['mappingDiagnostics'] = [{'source': s, 'exact': s in raw} for s in expected['diagnostics']]
            # Link annotation presence is deliberately not a pagination pass criterion.
            # Preserve full PDF for independent annotation audit; do not infer links from text.
            row['linkAnnotations'] = 'pending-independent-PDF-object-review'
            subprocess.run(['pdftoppm', '-r', '144', '-png', str(pdf), str(root / (name + '-render'))], timeout=60, check=True, stdout=subprocess.DEVNULL)
            rendered = sorted(root.glob(name + '-render-*.png'))
            assert len(rendered) == len(pages)
            guards = []
            for n, (page, imagepath) in enumerate(zip(pages, rendered), 1):
                image = Image.open(imagepath).convert('L')
                sx, sy = image.width / page['width'], image.height / page['height']
                for word in page['words']:
                    if word['text'] != expected['guard']:
                        continue
                    x0, y0, x1, y1 = word['box']
                    crop = image.crop((math.floor(x0*sx), math.floor(y0*sy), math.ceil(x1*sx), math.ceil(y1*sy)))
                    ink = crop.point(lambda p: 255 if p < 110 else 0).getbbox()
                    style = 'code' if any(a['page'] == n and abs(a['box'][1]-y0) < 1 for pair in expected['groups']['C']['rows'] for a in occurrences[pair[0]]) else 'table'
                    guards.append({'page': n, 'box': word['box'], 'style': style, 'inkBox': ink, 'inkWidth': ink[2]-ink[0] if ink else 0, 'inkHeight': ink[3]-ink[1] if ink else 0})
            # Same literal in each style is its own cross-page raster control. A two-pixel
            # tolerance covers subpixel sampling at 144 dpi, not arbitrary edge clipping.
            for style in ['table', 'code']:
                subset = [g for g in guards if g['style'] == style]
                assert subset, style + ': raster controls missing'
                mw, mh = statistics.median(g['inkWidth'] for g in subset), statistics.median(g['inkHeight'] for g in subset)
                for g in subset:
                    if g['inkWidth'] < mw-2 or g['inkHeight'] < mh-2:
                        row['errors'].append(f'{style} page {g["page"]}: clipped/empty rendered guard {g}')
            row['renderedGuards'] = guards
            row['rasterControl'] = 'same-literal per-style ink bounds at 144 dpi; does not prove every arbitrary glyph'
            # Keep first/last bands of each page for independent human boundary review.
            for n, imagepath in enumerate(rendered, 1):
                image = Image.open(imagepath).convert('RGB')
                height = min(300, image.height//2)
                band = Image.new('RGB', (image.width, height*2), 'white')
                band.paste(image.crop((0,0,image.width,height)),(0,0))
                band.paste(image.crop((0,image.height-height,image.width,image.height)),(0,height))
                band.save(root / f'{name}-boundary-{n:02}.png')
        except Exception as exc:
            row['errors'].append(repr(exc))
        report['errors'].extend(name + ': ' + e for e in row['errors'])
    report['status'] = 'failed' if report['errors'] else 'passed-pagination-only'
    (root / 'pagination-audit.json').write_text(json.dumps(report, indent=2, ensure_ascii=False) + '\n')
    print(json.dumps({'status': report['status'], 'errors': report['errors']}, ensure_ascii=False))
    return bool(report['errors'])


if __name__ == '__main__':
    mode, root = sys.argv[1], pathlib.Path(sys.argv[2])
    if mode == 'fixture':
        fixture(root)
    elif mode == 'audit':
        sys.exit(audit(root))
    else:
        raise SystemExit('unknown mode')
