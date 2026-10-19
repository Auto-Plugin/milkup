import json,subprocess
from pathlib import Path
r=Path(__file__).parent;cases=json.loads((r/'cases.json').read_text());result={}
for name in ['baseline','chain','caption-chain','split-first']:
 subprocess.run(['pdftotext','-layout',str(r/(name+'.pdf')),str(r/(name+'.txt'))],check=True)
 pages=(r/(name+'.txt')).read_text().split('\f');pages=pages[:-1] if not pages[-1].strip() else pages
 norm=[''.join(p.split()) for p in pages]
 found=lambda marker:[i+1 for i,p in enumerate(norm) if marker in p]
 rows=[]
 for c in cases:
  kind={'table':'ROW','code':'LINE','list':'ITEM'}[c['type']]
  rows.append({'id':c['id'],'heading':found(c['id']+'-HEADING'),'first':found(c['firstMarker']),'last':found(c['lastMarker']),'end':found(c['id']+'-END'),'missing':[f'{c["id"]}-{kind}-{i:03}' for i in range(1,c['count']+1) if not found(f'{c["id"]}-{kind}-{i:03}')],'duplicateMarkers':[f'{c["id"]}-{kind}-{i:03}' for i in range(1,c['count']+1) if sum(p.count(f'{c["id"]}-{kind}-{i:03}') for p in norm)!=1]})
 result[name]={'pages':len(pages),'blankPages':[i+1 for i,p in enumerate(pages) if not p.strip()],'cases':rows}
(r/'comparison.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({n:[{'id':c['id'],'heading':c['heading'],'first':c['first'],'missing':len(c['missing']),'duplicates':len(c['duplicateMarkers'])} for c in d['cases']] for n,d in result.items()},indent=2))
