from pathlib import Path
import subprocess,json,datetime
base=Path('/workspace/milkup-export-print-evidence/milestone06'); result=base/'runtime/product-batch-results.json'
assert not result.exists()
archive='/workspace/milkup-mermaid-engine-evidence/research/renderer-exact-memo-product-integration-01/artifacts/milkup.diagrams-1.1.1.milkup-plugin'
sha='2351692438a2083a72bcb8cddce28c7a530a8557734926992a3a2e3120c68a19'
cases=[('p5-m06-product-letter','multi','pdf-letter'),('p5-m06-product-print-02','regression-repeat','print-to-file'),('p5-m06-product-large-diagrams','large-diagrams','html'),('p5-m06-product-cancel','cancel','html'),('p5-m06-product-disable-all','disable-all','html')]
rows=[]
for name,case,fmt in cases:
 cmd=['bash',str(base/'runtime/run-product.sh'),name,case,fmt,archive,sha,'1.1.1']
 row={'run':name,'case':case,'format':fmt,'startedUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'command':cmd};rows.append(row);result.write_text(json.dumps(rows,indent=2)+'\n');print('START '+name,flush=True)
 with (base/'runtime'/f'{name}-wrapper.log').open('x') as log: p=subprocess.run(cmd,cwd='/workspace/milkup',stdout=log,stderr=subprocess.STDOUT)
 row.update(exitCode=p.returncode,endedUtc=datetime.datetime.now(datetime.timezone.utc).isoformat());result.write_text(json.dumps(rows,indent=2)+'\n');print('END '+name+' exit='+str(p.returncode),flush=True)
print('BATCH COMPLETE',flush=True)
