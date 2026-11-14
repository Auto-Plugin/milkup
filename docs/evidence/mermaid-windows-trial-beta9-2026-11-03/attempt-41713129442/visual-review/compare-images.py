"""Read-only comparison of actual installed PNGs against accepted source PNGs.
Writes derived JSON only; never rewrites images or original reports.
"""
import argparse,hashlib,json
from pathlib import Path
from PIL import Image,ImageChops

def sha(data): return hashlib.sha256(data).hexdigest()
def image(path):
    with Image.open(path) as im:
        if im.format != 'PNG': raise ValueError('Expected actual PNG')
        im.load()
        return im.convert('RGBA')

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--raw',type=Path,required=True)
    parser.add_argument('--accepted',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    candidate='a5556beea5cdd1570361c528b2326bc0ad8ba0c4';run='41713129442'
    expected=sorted(str(p.relative_to(args.accepted)) for p in args.accepted.rglob('*.png'))
    actual=sorted(str(p.relative_to(args.raw)) for p in args.raw.rglob('*.png'))
    if len(expected)!=34 or actual!=expected: raise ValueError('Exact 34 original PNGs required')
    rows=[];accounts={};before={str(p.relative_to(args.raw)):sha(p.read_bytes()) for p in args.raw.rglob('*') if p.is_file()}
    for kind in ['pure-standard','filtered-admin']:
        manifest=json.loads((args.raw/kind/'artifact-manifest.json').read_text())
        if manifest['candidateSha']!=candidate or manifest['workflowRunId']!=run: raise ValueError('Wrong actual source/run')
        listed={x['name']:x for x in manifest['files']}
        report=json.loads((args.raw/kind/'mermaid-product-e2e.json').read_text())
        accounts[kind]={'status':report.get('status'),'steps':[{'name':x.get('name'),'passed':x.get('passed')} for x in report.get('steps',[])],'originalVisualReviewAccepted':report.get('visualReviewAccepted'),'outerStatus':manifest['outerStatus']}
        for relative in [x for x in actual if x.startswith(kind+'/')]:
            path=args.raw/relative;reference=args.accepted/relative;data=path.read_bytes()
            info=listed[path.name]
            if len(data)!=info['bytes'] or sha(data)!=info['sha256']: raise ValueError('PNG differs from actual artifact manifest')
            a=image(path);b=image(reference)
            if a.size!=b.size: raise ValueError('Unexpected dimensions require separate direct review')
            row={'path':relative,'dimensions':list(a.size),'bytes':len(data),'sha256':sha(data),'rgbaSha256':sha(a.tobytes()),'type':'diagram' if path.name.endswith('-diagram.png') else 'window','reference':str(reference),'referenceSha256':sha(reference.read_bytes()),'fullRgbaIdentical':a.tobytes()==b.tobytes(),'fullDifferenceBoundsExclusive':ImageChops.difference(a,b).getbbox(alpha_only=False)}
            if row['type']=='window':
                if a.size!=(1028,760): raise ValueError('Unexpected viewport')
                bounds=(0,36,1028,760);ab=a.crop(bounds);bb=b.crop(bounds)
                difference=ImageChops.difference(ab,bb).getbbox(alpha_only=False)
                row.update(bodyBoundsExclusive=list(bounds),bodyRgbaIdentical=ab.tobytes()==bb.tobytes(),bodyDifferencePixels=sum(x!=y for x,y in zip(ab.get_flattened_data(),bb.get_flattened_data())),bodyDifferenceBoundsExclusive=([difference[0],difference[1]+36,difference[2],difference[3]+36] if difference else None))
            rows.append(row)
    indexed={x['path']:x for x in rows};cross=[]
    for row in rows:
        if row['path'].startswith('pure-standard/') and row['type']=='diagram':
            name=row['path'].split('/',1)[1];other=indexed['filtered-admin/'+name]
            cross.append({'name':name,'sameDimensions':row['dimensions']==other['dimensions'],'rgbaIdentical':row['rgbaSha256']==other['rgbaSha256'],'encodedBytesIdentical':row['sha256']==other['sha256']})
    after={str(p.relative_to(args.raw)):sha(p.read_bytes()) for p in args.raw.rglob('*') if p.is_file()}
    if after!=before: raise ValueError('Original evidence changed while reviewing')
    result={'status':'comparison_complete_direct_inspection_is_separate','runId':run,'candidateSha':candidate,'acceptedRunId':'41703213523','accountReports':accounts,'images':rows,'crossAccountDiagrams':cross,'rawIntegrity':{'files':len(before),'allBytesUnchanged':True,'sha256':before}}
    args.output.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'pngCount':len(rows),'diagramsIdentical':sum(x['type']=='diagram' and x['fullRgbaIdentical'] for x in rows),'windowBodiesIdentical':sum(x['type']=='window' and x['bodyRgbaIdentical'] for x in rows),'rawFilesUnchanged':len(before)}))
if __name__=='__main__': main()
