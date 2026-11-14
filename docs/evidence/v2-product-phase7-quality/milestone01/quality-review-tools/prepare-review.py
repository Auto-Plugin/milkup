"""Read-only run audit + derived contact sheets; never launches or modifies the app/run."""
from pathlib import Path
import argparse, hashlib, itertools, json, re
from PIL import Image, ImageDraw, ImageFont, ImageOps
p = argparse.ArgumentParser()
p.add_argument('run', type=Path)
p.add_argument('output', type=Path)
a = p.parse_args()
run = a.run.resolve(strict=True)
out = a.output.resolve()
assert out != run and run not in out.parents, 'Keep review artifacts separate from raw run'
out.mkdir(parents=True, exist_ok=False)
def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def read(name): return json.loads((run / name).read_text())
def dump(name, value): (out / name).write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')
completion = read('completion.json')
stage = completion.get('stage', 'alloff')
checks = []
def check(name, passed, details=None): checks.append(dict(name=name, passed=bool(passed), details=details))
check('reported completion passed', completion.get('passed') is True, completion)
images = []
for file in sorted(run.rglob('*.png')):
    with Image.open(file) as im:
        images.append(dict(path=str(file), relative=str(file.relative_to(run)), sha256=sha(file), width=im.width, height=im.height))
index = {image['relative']: image for image in images}
review_tasks = []
font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 13)
def sheet(name, slots, columns=3, width=480, height=330):
    rows = (len(slots) + columns - 1) // columns
    canvas = Image.new('RGB', (columns * (width + 12) + 12, rows * (height + 46) + 12), '#dddddd')
    draw = ImageDraw.Draw(canvas)
    used = []
    for n, (label, relative) in enumerate(slots):
        x = 12 + (n % columns) * (width + 12)
        y = 12 + (n // columns) * (height + 46)
        draw.text((x, y), label[:65], fill='black', font=font)
        file = run / relative
        if relative in index:
            with Image.open(file) as source:
                preview = ImageOps.contain(source.convert('RGB'), (width, height))
                canvas.paste(preview, (x, y + 25))
            used.append(index[relative])
        else:
            draw.text((x, y + 60), 'MISSING ORIGINAL: ' + relative[:45], fill='red', font=font)
    file = out / (name + '.png')
    canvas.save(file)
    review_tasks.append(dict(kind='contact-sheet', path=str(file), sha256=sha(file), originals=used, inspected=False, findings=None))
if stage in ('keyboard', 'matrix'):
    preflight = read('preflight.json')
    samples = read('samples.json')
    check('both routes requested', preflight.get('routes') == ['ordinary', 'windowed'])
    check('full sample count', len(samples) == (24 if stage == 'keyboard' else 332), len(samples))
    check('no fixture failure', not completion.get('fixtureFailures'))
    check('no fatal error', not completion.get('fatal'))
    check('all samples passed', all(row.get('passed') is True for row in samples), [row['name'] for row in samples if not row.get('passed')])
    check('every sample screenshot present', all(row.get('screenshot') in index for row in samples))
    for fixture in preflight['fixtures']:
        file = Path(fixture['file']).resolve(strict=True)
        assert file.parent == run
        check('independent final file SHA ' + file.name, sha(file) == fixture['sha256'], dict(expected=fixture['sha256'], actual=sha(file)))
    if stage == 'keyboard':
        for route, mode in itertools.product(['ordinary', 'windowed'], ['source', 'live']):
            rows = [row for row in samples if row['fixture']['kind'] == route and row['fixture']['mode'] == mode]
            sheet(route + '-' + mode, [(row['name'] + (' PASS' if row['passed'] else ' FAIL'), row.get('screenshot', 'missing.png')) for row in rows])
    else:
        cell_pattern = re.compile(r'^(ordinary|windowed)-(source|live)-(light|dark)-(1280x800|760x520)-(100|125|150|200)-(selection|table|emphasis|task|code-End)$')
        cells = {}
        for row in samples:
            match = cell_pattern.fullmatch(row['name'])
            if match:
                *identity, feature = match.groups()
                cells.setdefault(tuple(identity), {})[feature] = row
        check('64 matrix cells', len(cells) == 64, len(cells))
        check('five samples in every cell', len(cells) == 64 and all(len(rows) == 5 for rows in cells.values()))
        checked = [image for image in images if image['relative'].endswith('-task-checked.png')]
        check('32 checked-task screenshots', len(checked) == 32, len(checked))
        for identity, rows in sorted(cells.items()):
            name = '-'.join(identity)
            slots = []
            for feature in ['selection', 'table', 'emphasis', 'task', 'code-End']:
                row = rows.get(feature)
                slots.append((feature + (' PASS' if row and row['passed'] else ' FAIL/MISSING'), name + '-' + feature + '.png'))
            if identity[1] == 'live': slots.append(('task checked + saved', name + '-task-checked.png'))
            sheet(name, slots)
            if identity[3:] == ('760x520', '200'):
                for _, relative in slots:
                    if relative in index:
                        review_tasks.append(dict(kind='original-required-narrow-200', **index[relative], inspected=False, findings=None))
    for row in samples:
        if not row.get('passed') and row.get('screenshot') in index:
            review_tasks.append(dict(kind='original-required-failure', **index[row['screenshot']], inspected=False, findings=None, sampleError=row.get('error'), failedChecks=[c for c in row.get('checks', []) if not c.get('passed')]))
else:
    provenance = read('provenance.json')
    results = read('results.json')
    check('three real launches', completion.get('launches') == 3)
    check('three origin proofs', all((run / f'launch-{n}/production-origin.json').is_file() for n in range(1, 4)))
    check('no Worker instrumentation requested', 'diagnostics:false' in ' '.join(provenance['boundaries']))
    expected_ids = provenance['installedIds']
    settled = next((row['catalog'] for row in results if row['name'] == '00-installed-baseline'), None)
    def approvals(catalog):
        entries=[]
        for entry in catalog['entries']:
            for generation in [entry['active'], entry['previous'], entry['pending']['generation'] if entry['pending'] else None]:
                if generation: entries.append((entry['id'], generation['id'], generation['approvedFingerprint']))
        return sorted(entries)
    for row in results:
        if row['name'] == '00-installed-baseline': continue
        native = row['catalog']
        check(row['name'] + ' native inactive', sorted(e['id'] for e in native['entries']) == expected_ids and all(e['enabled'] is False and e['startAttempt'] is None and e['tombstone'] is False and (e['pending'] is None or e['pending']['phase'] == 'prepared') for e in native['entries']))
        check(row['name'] + ' approvals unchanged', settled is not None and approvals(native) == approvals(settled))
    saved = (run / 'host-only.md').read_bytes()
    check('saved prefix and exact original CRLF/Unicode', saved.startswith(b'HOST-') and hashlib.sha256(saved[5:]).hexdigest() == provenance['originalSha256'])
    final = next((row for row in results if row['name'] == 'PASS'), None)
    if final:
        recovered = Path(final['recovered'])
        check('recovered copy exact bytes', recovered.read_bytes() == b'RECOVER-' + saved)
        check('original final hash', sha(run / 'host-only.md') == completion['originalSha256'])
        check('recovered final hash', sha(recovered) == completion['recoveredSha256'])
    else: check('PASS result exists', False)
    for launch in range(1, 4):
        items = [image for image in images if image['relative'].startswith(f'launch-{launch}/')]
        for start in range(0, len(items), 6):
            sheet(f'alloff-launch-{launch}-{start // 6 + 1}', [(Path(item['relative']).stem, item['relative']) for item in items[start:start+6]])
dump('image-index.json', images)
dump('independent-checks.json', dict(run=str(run), stage=stage, passed=all(c['passed'] for c in checks), checks=checks))
dump('pixel-review-pending.json', dict(status='NOT REVIEWED: generation is not inspection', tasks=review_tasks))
print(json.dumps(dict(stage=stage, checks=len(checks), failed=[c['name'] for c in checks if not c['passed']], originals=len(images), reviewTasks=len(review_tasks), output=str(out))))
