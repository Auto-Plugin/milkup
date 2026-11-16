"""Separate intentional-blank and real-overflow controls; original gate unchanged."""
import json,pathlib,sys
BASE=pathlib.Path(__file__).resolve().parent.parent/'pdf-pagination-mechanism-20261116'
sys.path[:0]=[str(BASE),str(BASE/'support')]
import calibrate,pagination_audit,contract,paper_render,tail_contract
from behavior_contract import PAPERS,adapted_html

CASES=[('forced-blank', '<div style="break-before:page;height:1px"></div><p style="break-before:page">FORCEDAFTERBLANK</p>',6,5,['FORCEDAFTERBLANK']),
       ('real-overflow','<div style="break-before:page;height:1900px;background:#ededed">OVERFLOWSTART</div><p>OVERFLOWEND</p>',7,6,['OVERFLOWSTART','OVERFLOWEND'])]

def html_control(original,addition):
 assert original.count('</body>')==1
 return original.replace('</body>',addition+'</body>')

def verify_control(case,audit,pdf_path):
 import fitz
 assert case in CASES, 'Only explicit controlled fixture contracts'
 name,addition,count,special,markers=case
 paper=audit['papers'][0]
 # These exact synthetic controls deliberately have a text-free middle page.
 # Original seven documents never receive this special expected result.
 assert audit['errors']==[f'a4-portrait: page {special}: blank page'],audit['errors']
 headers=calibrate.header_contract(paper,pdf_path);assert not headers['errors'],headers
 with fitz.open(pdf_path)as pdf:
  assert len(pdf)==count,(name,len(pdf),count)
  locations={m:[i+1 for i,p in enumerate(pdf)if m in p.get_text()]for m in markers}
  if name=='forced-blank':assert locations=={'FORCEDAFTERBLANK':[6]}
  else:assert locations=={'OVERFLOWSTART':[5],'OVERFLOWEND':[7]}
  assert not pdf[special-1].get_text().strip() and not pdf[special-1].get_images()
  pix=pdf[special-1].get_pixmap(matrix=fitz.Matrix(1,1),colorspace=fitz.csRGB,alpha=False);samples=pix.samples
  ink=sum(any(v<245 for v in samples[i:i+3])for i in range(0,len(samples),3))
  if name=='forced-blank':assert ink==0,'Intentional blank page must remain blank'
  else:assert ink>pix.width*pix.height/2,'Real gray overflow page lost/clipped'
  return {'passed':True,'pages':len(pdf),'specialPage':special,'nonWhitePixels':ink,'markers':locations,'headers':headers,'expectedWordOnlyAuditError':audit['errors'],
          'scope':'Explicit synthetic blank/visual-content contract, not a waiver for original documents'}

def run(out,labelled,binary,guard,env,validate,persist):
 results=[]
 for case in CASES:
  name,addition,count,special,markers=case;dest=out/('root-control-'+name);ref=out/'reference/baseline-short-room';paper=PAPERS[0]
  original=(labelled/'baseline-short-room.html').read_text();html=html_control(original,addition)
  native=paper_render.render(binary,guard,html,dest,env,paper);validate(native,dest)
  row={'case':name,'passed':False,'native':native};results.append(row)
  try:
   (dest/'complex-pagination.md').write_bytes((ref/'complex-pagination.md').read_bytes())
   expected=json.loads((ref/'expectations.json').read_text());expected['papers']=[paper];expected['singles']+=markers
   (dest/'expectations.json').write_text(json.dumps(expected,indent=2)+'\n')
   (dest/'control-source.json').write_text(json.dumps({'baseHtmlSha256':calibrate.sha(original.encode()),'htmlSha256':calibrate.sha(html.encode()),'addition':addition,'scope':'Original short-room serialized HTML plus explicit research control elements; Markdown covers original marker portion'},indent=2)+'\n')
   pagination_audit.audit(dest);audit=json.loads((dest/'pagination-audit.json').read_text())
   parsed=contract.parse((dest/'native.log').read_text(),len(audit['papers'][0]['pages']));tail=tail_contract.parse((dest/'native.log').read_text(),parsed)
   (dest/'tail-layout.json').write_text(json.dumps(tail,indent=2)+'\n')
   row.update(verify_control(case,audit,dest/'a4-portrait.pdf'))
  except Exception as error:row['error']=repr(error)
  finally:(dest/'control-result.json').write_text(json.dumps(row,indent=2)+'\n');persist(results)
 return results
