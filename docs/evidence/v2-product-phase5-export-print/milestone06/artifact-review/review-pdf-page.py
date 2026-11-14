#!/usr/bin/env python3
"""Rasterize one actual saved PDF page and compare exact RGB pixels; no UI launch."""
from pathlib import Path
import argparse,hashlib,json,subprocess,re
from PIL import Image,ImageChops
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--run',type=Path,required=True)
p.add_argument('--pdf',default='printed.pdf')
p.add_argument('--page',type=int,default=2)
p.add_argument('--output',type=Path,required=True)
p.add_argument('--reference',action='append',default=[],help='label=/absolute/path/to/existing-page.png')
a=p.parse_args();a.output.mkdir(parents=True,exist_ok=True);pdf=a.run/a.pdf
sha=lambda path:hashlib.sha256(path.read_bytes()).hexdigest()
prefix=a.output/f'page-{a.page}'
subprocess.run(['pdftoppm','-f',str(a.page),'-l',str(a.page),'-scale-to','1250','-singlefile','-png',str(pdf),str(prefix)],capture_output=True,check=True)
raw=subprocess.check_output(['pdftotext','-f',str(a.page),'-l',str(a.page),'-raw',str(pdf),'-']).decode()
(a.output/f'page-{a.page}-raw.txt').write_text(raw)
png=prefix.with_suffix('.png');im=Image.open(png).convert('RGB');comparisons=[]
for arg in a.reference:
 label,path=arg.split('=',1);path=Path(path);old=Image.open(path).convert('RGB')
 bounds=ImageChops.difference(im,old).getbbox() if im.size==old.size else 'different dimensions'
 comparisons.append({'reference':label,'path':str(path),'referencePNG_SHA256':sha(path),'sameSize':im.size==old.size,'pixelsExactlyEqual':bounds is None,'differenceBounds':bounds})
report={'scope':'Single actual saved page only, independent Poppler raster; no native UI, no physical print, no reliability/fixed-timeout claim.','pdf':str(pdf),'pdfSHA256':sha(pdf),'pdfBytes':pdf.stat().st_size,'sourceSHA256':sha(a.run/'source.md'),'page':a.page,'rasterSize':im.size,'rasterSHA256':sha(png),'rasterRGB_SHA256':hashlib.sha256(im.tobytes()).hexdigest(),'comparisons':comparisons,'rawSourceFallbackGrammarDetected':bool(re.search(r'flowchart\s+LR|```\s*mermaid',raw)),'copySearchPageExact':{s:s in raw for s in ['中文输入','冻结内容','打印']},'visualReview':'PENDING_ACTUAL_PIXEL_INSPECTION','remaining':['Other pages unreviewed by this single-page script.','PDF codepoint mapping and long-block heading pagination remain open.','A visible diagram on this run is not proof of timeout remediation or deterministic repeatability.']}
for name in ['provenance.json','completion.json']:
 if (a.run/name).exists():report[name]=json.loads((a.run/name).read_text())
if (a.run/'results.json').exists():
 results=json.loads((a.run/'results.json').read_text())
 report['lastResult']=results[-1] if isinstance(results,list) and results else results
(a.output/'review.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({k:v for k,v in report.items() if k not in ['provenance.json','lastResult','completion.json']},ensure_ascii=False,indent=2))
