import hashlib, json
from pathlib import Path
from PIL import Image, ImageChops
HERE=Path(__file__).resolve().parent
CURRENT=HERE/'extracted'
BASE=Path('/workspace/mermaid-rebuild-evidence/windows-installed-41668620695/installed')
NAMES=['02-enabled-diagram.png','03-edited-diagram.png','04-undone-diagram.png','05-redone-diagram.png','06-reenabled-diagram.png','07-wide-diagram.png','07-c4-diagram.png']
def observe(p):
    raw=p.read_bytes()
    with Image.open(p) as im:
        assert im.format=='PNG'
        rgba=im.convert('RGBA'); rgba.load()
    return {'bytes':len(raw),'pngSha256':hashlib.sha256(raw).hexdigest(),'width':rgba.width,'height':rgba.height,'rgbaSha256':hashlib.sha256(rgba.tobytes()).hexdigest()},rgba
def comparison(a,b):
    af,ai=observe(a);bf,bi=observe(b)
    r={'left':str(a),'right':str(b),'leftFacts':af,'rightFacts':bf,'dimensionsEqual':ai.size==bi.size,'pixelsEqual':af['rgbaSha256']==bf['rgbaSha256'] and ai.size==bi.size}
    if ai.size==bi.size:
        diff=ImageChops.difference(ai,bi)
        # All four channels count; using RGBA getbbox alone may ignore RGB-only differences.
        mask=ImageChops.lighter(ImageChops.lighter(diff.getchannel('R'),diff.getchannel('G')),ImageChops.lighter(diff.getchannel('B'),diff.getchannel('A')))
        r['changedPixelCount']=sum(count for value,count in enumerate(mask.histogram()) if value)
        r['changedPixelBoundingBox']=mask.getbbox()
    return r
result={'run':41703213523,'candidateSha':'b139a9891a086685d7e0e9e85472a29a629f7a45','scope':'Read-only decoded pixels. Equality does not replace visual review or security acceptance. Baseline is delivered installed beta.8; new candidate is development binary embedding production assets.','betweenAccounts':[],'againstInstalledBeta8':[],'missing':[]}
for name in NAMES:
    paths=[CURRENT/kind/name for kind in ['pure-standard','filtered-admin']]
    if all(p.is_file() for p in paths):result['betweenAccounts'].append(comparison(*paths))
    else:result['missing'].extend(str(p) for p in paths if not p.is_file())
    for p in paths:
        if p.is_file() and (BASE/name).is_file():result['againstInstalledBeta8'].append(comparison(BASE/name,p))
(HERE/'pixel-comparison.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({'pairs':len(result['betweenAccounts']),'identicalBetweenAccounts':sum(p['pixelsEqual'] for p in result['betweenAccounts']),'baselinePairs':len(result['againstInstalledBeta8']),'identicalToInstalledBeta8':sum(p['pixelsEqual'] for p in result['againstInstalledBeta8']),'missing':result['missing']}))
