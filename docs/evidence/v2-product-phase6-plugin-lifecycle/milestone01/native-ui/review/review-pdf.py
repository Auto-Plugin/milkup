"""Inspect only saved PDF bytes/text and existing producer PNGs; never rasterize."""
from pathlib import Path
import argparse,json,hashlib,re,subprocess
from PIL import Image
import fitz
p=argparse.ArgumentParser();p.add_argument('run');a=p.parse_args();run=Path(a.run);control=run.parent/'control'/(run.name+'-p6-command.json');command=json.loads(control.read_text());completion=json.loads((run/'completion.json').read_text());assert command.get('exitCode')==0 and completion.get('automatedChecksPassed') is True
sha=lambda f:hashlib.sha256(f.read_bytes()).hexdigest();plan=json.loads((run/'plan.json').read_text());out=Path(__file__).parent;artifacts=[]
for file in sorted(run.glob('*.pdf')):
 doc=fitz.open(file);text=subprocess.check_output(['pdftotext','-raw',str(file),'-']).decode();mu=''.join(p.get_text(sort=False) for p in doc);(out/(run.name+'-'+file.stem+'.raw.txt')).write_text(text);(out/(run.name+'-'+file.stem+'.mupdf.txt')).write_text(mu)
 counts={m:len(re.findall(re.escape(m)+r'(?![A-Za-z0-9_-])',text)) for m in plan['fixture']['bodyMarkersExactlyOnce']};images=[]
 for png in sorted(run.glob(file.name+'.page-*.png')):
  images.append({'path':str(png),'sha256':sha(png),'dimensions':list(Image.open(png).size)})
 probes=['中文输入','冻结内容',"const message = '中文代码 P5-CODE-MARKER'",'👩🏽‍💻']
 artifacts.append({'file':str(file),'sha256':sha(file),'bytes':file.stat().st_size,'pages':len(doc),'pageSizesPt':[list(p.rect)[2:] for p in doc],'bodyMarkerCounts':counts,'allMarkersExactlyOnce':all(v==1 for v in counts.values()),'rawFootnoteSource':'[^p5]' in text,'mermaidSource':'flowchart LR' in text,'warningsRawText':text.split('导出警告')[-1].strip() if '导出警告' in text else None,'unicodeProbes':{'normalization':'NONE','Poppler':{s:s in text for s in probes},'MuPDF':{s:s in mu for s in probes}},'pageLinks':[p.get_links() for p in doc],'existingPagePNGs':images,'visualReview':'PENDING actual view_image review; text/geometry is not diagram pixel proof'})
report={'run':str(run),'control':str(control),'controlExit':command['exitCode'],'completion':completion,'producerBinarySHA256':plan['binarySha256'],'sourceSHA256':sha(run/'source.md'),'expectedSourceSHA256':plan['fixture']['sourceSHA256'],'scope':'Read-only actual PDFs with existing producer page rasters; no new raster/browser/nativeUI. Physical printing not exercised.','artifacts':artifacts};target=out/(run.name+'.pdf-review.json');target.write_text(json.dumps(report,ensure_ascii=False,indent=2,default=list)+'\n');print(target)
