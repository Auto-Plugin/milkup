"""Independent code-wrap PDF preparation. Never renders replacement HTML/PDF.

The fixture is Markdown. Audit an actual exported PDF; page images are retained
for glyph/clip review, not substituted for searchable PDF content and geometry.
"""
import argparse
import hashlib
import json
from pathlib import Path

EPSILON = 0.5  # PDF points; applies to baselines, not rounded word-box tops.


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def tag(value):
    return ''.join(chr(65 + value // (26 ** power) % 26) for power in [2, 1, 0])


def fixture(folder):
    folder.mkdir(parents=True, exist_ok=False)
    lines = []
    for number in range(50):
        long = number >= 2 and number % 2 == 0
        tokens = ['W' + tag(number) + tag(column) + 'M' for column in range(24 if long else 3)]
        lines.append({'sourceLine': number + 1, 'tokens': tokens, 'mustWrap': long})
    source = '```text\n' + '\n'.join(' '.join(row['tokens']) for row in lines) + '\n```\n'
    document = folder / 'code-wrap.md'; document.write_text(source)
    expected = {'schema': 'milkup-code-wrap-v1', 'lines': lines, 'documentSha256': digest(document),
                'baselineTolerancePt': EPSILON, 'minimumPages': 2,
                'numbering': 'Tokens are source content, not product line numbers; never treat them as a gutter.'}
    (folder / 'expectations.json').write_text(json.dumps(expected, indent=2) + '\n')
    return expected


def inspect(pages, expected, number_mode):
    errors = []; body = []; digits = []
    for page_index, page in enumerate(pages):
        for char in page['characters']:
            if char['text'].isspace():
                continue
            row = {**char, 'page': page_index}
            x0, y0, x1, y1 = char['bbox']
            if not (-EPSILON <= x0 < x1 <= page['width'] + EPSILON and
                    -EPSILON <= y0 < y1 <= page['height'] + EPSILON):
                errors.append('character outside page: ' + repr(row))
            (digits if char['text'].isdigit() else body).append(row)
    wanted = ''.join(''.join(row['tokens']) for row in expected['lines'])
    actual = ''.join(row['text'] for row in body)
    if actual != wanted:
        errors.append('Searchable code characters/order differ: missing, duplicate, substituted or reordered text')
        return {'errors': errors, 'lineNumberStatus': 'not-evaluated', 'lines': []}
    offset = 0; rows = []
    for source in expected['lines']:
        count = sum(map(len, source['tokens'])); characters = body[offset:offset + count]; offset += count
        first = characters[0]; last = characters[-1]
        visual = []
        for char in characters:
            position = (char['page'], char['origin'][1])
            if not visual or position[0] != visual[-1][0] or abs(position[1] - visual[-1][1]) > EPSILON:
                visual.append(position)
        if source['mustWrap'] and len(visual) < 2:
            errors.append('Required automatic wrapping not exercised: line ' + str(source['sourceLine']))
        if source['sourceLine'] <= 2 and len(visual) != 1:
            errors.append('Short control unexpectedly wraps')
        for a, b in zip(characters, characters[1:]):
            if a['page'] == b['page'] and abs(a['origin'][1] - b['origin'][1]) <= EPSILON and b['origin'][0] <= a['origin'][0]:
                errors.append('Code characters overlap/reverse on a visual line')
        if any(b[0] < a[0] or (b[0] == a[0] and b[1] <= a[1] + EPSILON) for a, b in zip(visual, visual[1:])):
            errors.append('Visual reading order overlaps or reverses: line ' + str(source['sourceLine']))
        rows.append({'sourceLine': source['sourceLine'], 'first': first, 'last': last, 'visualBaselines': visual})
    first, second = rows[:2]
    advance = second['first']['origin'][1] - first['first']['origin'][1]
    if first['first']['page'] != second['first']['page'] or advance <= 1:
        errors.append('Initial two short source lines do not establish line advance')
    for before, after in zip(rows, rows[1:]):
        a, b = before['last'], after['first']
        if b['page'] < a['page']:
            errors.append('Source line order reversed')
        elif b['page'] == a['page'] and abs(b['origin'][1] - a['origin'][1] - advance) > EPSILON:
            errors.append('Following source line is not below the last wrapped visual row: ' + str(after['sourceLine']))
    transitions = [(i, a['page'], b['page']) for i, (a, b) in enumerate(zip(body, body[1:])) if b['page'] != a['page']]
    if len({c['page'] for c in body}) < expected['minimumPages'] or not transitions:
        errors.append('Real code pagination boundary not exercised')
    groups = {}
    for char in digits:
        key = (char['page'], round(char['origin'][1], 3))
        groups.setdefault(key, []).append(char)
    if number_mode == 'absent':
        if digits: errors.append('Unexpected numeric text in declared unnumbered export')
        status = 'not-exercised-no-product-line-number-emitter'
    else:
        status = 'passed' if digits else 'failed-missing-real-line-numbers'
        if len(groups) != len(rows): errors.append('Real searchable gutter row count differs from source lines')
        for row in rows:
            start = row['first']; candidates = [chars for (p, y), chars in groups.items()
                if p == start['page'] and abs(y - start['origin'][1]) <= EPSILON]
            if len(candidates) != 1:
                errors.append('Gutter baseline missing/misaligned: line ' + str(row['sourceLine'])); continue
            chars = sorted(candidates[0], key=lambda c: c['origin'][0])
            if ''.join(c['text'] for c in chars) != str(row['sourceLine']): errors.append('Wrong/duplicate gutter number')
            if max(c['bbox'][2] for c in chars) >= start['bbox'][0] - EPSILON: errors.append('Gutter overlaps code')
        if errors: status = 'failed'
    return {'errors': errors, 'lineNumberStatus': status, 'lines': rows,
            'lineAdvancePt': advance, 'pageTransitions': transitions,
            'baselineTolerancePt': EPSILON, 'sourceCharacters': len(body)}


def audit(pdf, expected_path, folder, number_mode, provenance):
    import fitz
    folder.mkdir(parents=True, exist_ok=False)
    expected = json.loads(expected_path.read_text())
    assert expected['schema'] == 'milkup-code-wrap-v1' and expected['baselineTolerancePt'] == EPSILON
    pages = []; rasters = []
    with fitz.open(pdf) as document:
        assert 1 <= len(document) <= 20, 'Bounded fixture PDF only'
        for index, page in enumerate(document):
            chars = []
            for block in page.get_text('rawdict', sort=False)['blocks']:
                if block['type'] != 0: continue
                for line in block['lines']:
                    for span in line['spans']:
                        for char in span['chars']:
                            chars.append({'text': char['c'], 'origin': list(char['origin']), 'bbox': list(char['bbox'])})
            pages.append({'width': page.rect.width, 'height': page.rect.height, 'characters': chars})
            path = folder / f'page-{index + 1:02d}.png'
            page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False).save(path)
            rasters.append({'file': path.name, 'sha256': digest(path), 'dpi': 144})
    (folder / 'coordinates.json').write_text(json.dumps(pages, indent=2) + '\n')
    result = inspect(pages, expected, number_mode)
    result.update(pdfSha256=digest(pdf), documentSha256=expected['documentSha256'],
                  provenance=provenance, pageImages=rasters,
                  clippingScope='Character page bounds automated; rendered glyph/clip completeness requires page-image review.',
                  status='failed' if result['errors'] else 'pending-native-provenance-and-raster-review',
                  installedNativeAcceptance=False)
    (folder / 'report.json').write_text(json.dumps(result, indent=2) + '\n')
    return result


if __name__ == '__main__':
    p = argparse.ArgumentParser(); sub = p.add_subparsers(dest='command', required=True)
    make = sub.add_parser('fixture'); make.add_argument('folder', type=Path)
    check = sub.add_parser('audit'); check.add_argument('pdf', type=Path); check.add_argument('expected', type=Path)
    check.add_argument('folder', type=Path); check.add_argument('--line-number-mode', choices=['required', 'absent'], default='required')
    check.add_argument('--provenance', type=Path, required=True)
    a = p.parse_args()
    if a.command == 'fixture': fixture(a.folder)
    else:
        result = audit(a.pdf, a.expected, a.folder, a.line_number_mode, json.loads(a.provenance.read_text()))
        raise SystemExit(1 if result['errors'] else 0)
