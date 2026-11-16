"""Combined gates are conjunctions of new same-run evidence, never old reports."""
import json
PREFIX='MILKUP_COMBINED '
NAMES=['digit-baseline','digit-candidate','paint-candidate-links','paint-candidate-no-links','links','no-links']
def pages(log,count):
 assert len(log.encode())<=2*1024*1024
 rows=[json.loads(line[len(PREFIX):])for line in log.splitlines()if line.startswith(PREFIX)]
 assert 0<count<=64 and len(rows)==count*2,'Every actual printed page needs two bound records'
 for i,r in enumerate(rows):
  assert r=={'kind':'page','phase':'begin'if i%2==0 else'end','page':i//2+1,'printing':True,'layoutReady':True},'Wrong/missing/out-of-order actual-print boundary'
 return {'pages':count,'records':len(rows),'status':'passed'}
def original_fidelity(report):
 assert len(report['results'])==7 and len(report['rootMarginControls'])==2
 for row in report['results']:
  assert row['paginationPassed'] and row['uriDiagnosticPassed'],'Original pagination/URI failed: '+row['case']
  assert len(row['mappingDiagnostics'])==3 and all(v['exact']for v in row['mappingDiagnostics']),'Original source characters failed: '+row['case']
 assert all(r['passed']and r.get('combinedFidelity')is True for r in report['rootMarginControls'])
def complete(rows,result):
 return [r['case']for r in rows]==NAMES and all(r.get('identityPassed')and r.get('pageBoundary',{}).get('status')=='passed'for r in rows) and result.get('status')=='passed'
