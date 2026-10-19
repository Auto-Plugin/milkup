from pathlib import Path
import subprocess,json,re,hashlib
from PIL import Image,ImageChops
import fitz
root=Path('/workspace/milkup-export-print-evidence/milestone01/native-ui/runs')
out=Path(__file__).resolve().parent
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
inputs={'printed':root/'p5-print-file-04/printed.pdf','exported':root/'p5-pdf-05/a4-portrait.pdf'}
report={'scope':'Actual existing WebKit native print-to-file versus actual A4 PDF export; not physical printing or patched-engine validation.','rasterization':'Poppler pdftoppm -scale-to 1250 -png, decoded RGB comparison for every page','inputs':{},'pageComparisons':[]}
for label,pdf in inputs.items():
 folder=out/label;folder.mkdir(exist_ok=True)
 subprocess.run(['pdftoppm','-scale-to','1250','-png',str(pdf),str(folder/'page')],check=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 raw=subprocess.check_output(['pdftotext','-raw',str(pdf),'-']).decode()
 (folder/'raw.txt').write_text(raw)
 doc=fitz.open(pdf);mupdf='\f'.join(p.get_text() for p in doc)
 (folder/'mupdf.txt').write_text(mupdf)
 markers=re.findall(r'P5-PAGE-(\d+)\b',raw)
 counts={str(n):markers.count(str(n)) for n in range(1,101)}
 probes=['中文输入','冻结内容','打印',"'中文代码 P5-CODE-MARKER'",'👩🏽\u200d💻']
 report['inputs'][label]={'path':str(pdf),'sha256':sha(pdf),'bytes':pdf.stat().st_size,'sourceSHA256':sha(pdf.parent/'source.md'),'pages':len(doc),'pageSizes':[[p.rect.width,p.rect.height] for p in doc],'markerCount':len(markers),'markerCounts':counts,'missing':[n for n,c in counts.items() if c==0],'duplicates':[n for n,c in counts.items() if c>1],'unexpected':[m for m in markers if int(m) not in range(1,101)],'coreMarkerCounts':{m:raw.count(m) for m in ['P5-ORIGINAL-BODY','P5-CODE-MARKER','P5-FOOTNOTE-MARKER','P5-END-MARKER']},'copySearch':{'normalization':'NONE; original extracted codepoints only','status':'FAIL' if any(x not in raw or x not in mupdf for x in probes) else 'PASS','exactProbes':{x:{'poppler':x in raw,'mupdf':x in mupdf} for x in probes},'kangxiCodepointCount':sum('\u2f00'<=c<='\u2fdf' for c in raw),'codeLines':[s for s in raw.splitlines() if 'const message' in s]},'footnoteMarkerPages':[i+1 for i,p in enumerate(raw.split('\f')) if 'P5-FOOTNOTE-MARKER' in p]}
a=sorted((out/'printed').glob('page-*.png'));b=sorted((out/'exported').glob('page-*.png'))
assert len(a)==len(b)
for i,(ap,bp) in enumerate(zip(a,b),1):
 ai=Image.open(ap).convert('RGB');bi=Image.open(bp).convert('RGB')
 bounds=ImageChops.difference(ai,bi).getbbox() if ai.size==bi.size else 'different sizes'
 report['pageComparisons'].append({'page':i,'size':ai.size,'pixelsExactlyEqual':ai.size==bi.size and bounds is None,'differenceBounds':bounds,'printedPngSHA256':sha(ap),'exportedPngSHA256':sha(bp),'printedRgbSHA256':hashlib.sha256(ai.tobytes()).hexdigest(),'exportedRgbSHA256':hashlib.sha256(bi.tobytes()).hexdigest()})
report['sameSourceBytes']=report['inputs']['printed']['sourceSHA256']==report['inputs']['exported']['sourceSHA256']
report['allPagePixelsExactlyEqual']=all(p['pixelsExactlyEqual'] for p in report['pageComparisons'])
report['markerChecksPassed']=all(d['markerCount']==100 and not d['missing'] and not d['duplicates'] and not d['unexpected'] and all(v==1 for v in d['coreMarkerCounts'].values()) for d in report['inputs'].values())
report['driverWarning']={'retained':True,'path':str(root/'control/p5-print-file-04-harness.log'),'message':'X Error of failed request: BadWindow (invalid Window parameter)','qualification':'Actual print output and UI completion succeeded; the observation warning remains recorded, not suppressed.'}
(out/'comparison.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({k:v for k,v in report.items() if k!='inputs'},ensure_ascii=False,indent=2))
assert report['allPagePixelsExactlyEqual'] and report['markerChecksPassed'] and report['sameSourceBytes']
