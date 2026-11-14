#!/usr/bin/python3
"""Read-only image comparison; write only a separate comparison evidence file."""
import hashlib, json, pathlib
from PIL import Image

root = pathlib.Path(__file__).resolve().parent
new_root = root/'corpus'
old_root = pathlib.Path('/workspace/mermaid-rebuild-evidence/native-corpus-688fc89a')
sha = lambda value: hashlib.sha256(value).hexdigest()
new = json.loads((new_root/'native-corpus-results.json').read_text())
old_provenance_bytes = (old_root/'provenance.json').read_bytes()
old = json.loads(old_provenance_bytes)
assert new['status'] == 'passed' and len(new['cases']) == 50
old_cases = {row['fixture']: row for row in old['result']['cases']}

def decoded(file):
    with Image.open(file) as image:
        assert image.format == 'PNG' and getattr(image, 'n_frames', 1) == 1
        image.load()
        rgba = image.convert('RGBA').tobytes()
        return {'width': image.width, 'height': image.height,
                'fileSha256': sha(file.read_bytes()), 'rgbaSha256': sha(rgba)}

rows = []
for case in new['cases']:
    before = decoded(old_root/(case['fixture']+'.png'))
    after = decoded(new_root/case['png']['file'])
    assert after['fileSha256'] == case['png']['sha256']
    assert after['rgbaSha256'] == case['decode']['rgbaSha256']
    rows.append({'fixture': case['fixture'], 'historical': before, 'new': after,
                 'dimensionsEqual': (before['width'], before['height']) == (after['width'], after['height']),
                 'pngBytesEqual': before['fileSha256'] == after['fileSha256'],
                 'rgbaPixelsEqual': before['rgbaSha256'] == after['rgbaSha256'],
                 'fixtureSourceBytesEqual': case['sourceSha256'] == old_cases[case['fixture']]['sourceSha256'],
                 'newSourceSha256': case['sourceSha256'],
                 'historicalSourceSha256': old_cases[case['fixture']]['sourceSha256']})
report = {'kind': 'decoded-PNG-regression-comparison',
          'newSourceCommit': new['sourceCommit'], 'newProductionBinarySha256': new['binarySha256'],
          'historicalCandidate': old['candidate'], 'historicalSourceBaseline': old['sourceBaseline'],
          'historicalTestBinarySha256': old['testBinarySha256'],
          'historicalProvenancePath': str(old_root/'provenance.json'),
          'historicalProvenanceSha256': sha(old_provenance_bytes),
          'sameBuildSourceClaimed': False, 'visualReviewClaimed': False,
          'cases': rows,
          'summary': {key: sum(row[key] for row in rows) for key in
                      ['dimensionsEqual', 'pngBytesEqual', 'rgbaPixelsEqual', 'fixtureSourceBytesEqual']},
          'differences': [row['fixture'] for row in rows if not row['rgbaPixelsEqual'] or not row['dimensionsEqual']]}
with (root/'historical-png-comparison.json').open('x') as out:
    json.dump(report, out, indent=2)
    out.write('\n')
print(json.dumps({'summary': report['summary'], 'differences': report['differences'],
                  'report': str(root/'historical-png-comparison.json')}))
