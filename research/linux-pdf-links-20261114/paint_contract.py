"""Independent paint-clip oracle + per-call A/B diagnostics; old oracle unchanged."""
import copy,json,math,pathlib,struct
import layout_contract as layout
from pdf_links import inspect
from audit_existing import audit
PREFIX='MILKUP_PAINT '

def fixtures(root):
 layout.fixtures(root)
 for linked in [True,False]:
  suffix='links'if linked else'no-links'
  content=(root/('geometry-'+suffix+'.html')).read_text()
  needle='<div style="width:65px;height:18px;overflow:hidden;'
  assert content.count(needle)==1
  content=content.replace(needle,'<div id="clip-parent" style="width:65px;height:18px;overflow:hidden;')
  for variant in ['baseline','candidate']:(root/('paint-'+variant+'-'+suffix+'.html')).write_text(content)

def parse(log,pages,dedup,linked):
 records=[json.loads(line[len(PREFIX):])for line in log.splitlines()if line.startswith(PREFIX)]
 assert 0<len(records)<=512,'Missing/budget-exceeded paint evidence'
 active=None;seen=set();calls=set();focus=[];clips=[]
 for r in records:
  kind=r['kind'];p=r.get('page');assert kind in ['begin','end','focus','clip'],'Native paint error'
  if kind=='begin':
   assert active is None and p not in seen and p in pages and r['dedup']is dedup,'Paint begin identity'
   active=p;seen.add(p);continue
  assert p==active and active is not None,'Paint record outside page'
  if kind=='end':active=None;continue
  layout.transform([0,0,1,1],r['ctm'])
  if kind=='focus':
   assert linked and r['call']not in calls and type(r['phase'])is int and r['phase']in [16,32,64],'Focus identity/phase'
   calls.add(r['call']);r['id']=bytes.fromhex(r['idHex']).decode();assert r['id']in layout.IDS
   assert 0<len(r['raw'])<=64
   for box in r['raw']:layout.rect(box)
   unique=list(dict.fromkeys(tuple(x)for x in r['raw']))
   assert r['emitted']==(len(unique)if dedup else len(r['raw'])),'Wrong per-call emitted count'
   r['duplicateItems']=len(r['raw'])-len(unique);focus.append(r)
  else:
   assert r['path']in ['box','layer'] and 0<r['scale']<=4 and math.isfinite(r['scale'])
   layout.rect(r['raw']);layout.rect(r['actual']);clips.append(r)
 assert active is None and seen==set(pages),'Missing paint page/end'
 if linked:assert {r['id']for r in focus}==set(layout.IDS),'Missing link focus evidence'
 return {'focus':focus,'clips':clips}

def snapped(rect,scale):
 # Exact positive-coordinate LayoutRect/Point snapping formula for this fixture.
 assert min(rect)>=0,'Unsupported negative clipping fixture'
 rnd=lambda x:math.floor(x*scale+.5)/scale
 result=[rnd(rect[0]),rnd(rect[1])]
 for axis in [0,1]:
  fraction=rect[axis]-math.floor(rect[axis])
  result.append(result[axis]+rnd(fraction+rect[axis+2]-rect[axis])-rnd(fraction))
 return result

def actual_clip_pages(pages,paint):
 """Replace only the proven ancestor clip, retaining original layout evidence."""
 result=copy.deepcopy(pages);proof=[]
 visible=[r for r in layout.expected_regions(pages)if r['id']=='probe-clipped']
 assert len(visible)==1,'Clipped fixture identity'
 p=visible[0]['page'];h=pages[p]['header'];m=h['ctm'];tol=layout.rounding_bound(m)
 node=pages[p]['elements']['probe-clipped'];assert len(node['clips'])==1
 layout_clip=layout.transform(node['clips'][0],m)
 candidates=[r for r in paint['clips']if r['page']==p]
 assert candidates,'No actual paint clip captured'
 actual=[]
 for r in candidates:
  raw=layout.transform(r['raw'],r['ctm'])
  assert all(abs(x-y)<=tol for x,y in zip(raw,layout_clip)),'Paint clip belongs to different ancestor/coordinate space'
  prediction=snapped(r['raw'],r['scale'])
  # Float32 representation rounding only, not an empirical PDF edge allowance.
  bound=8*(2**-23)*max(1,*map(abs,prediction))
  assert all(abs(x-y)<=bound for x,y in zip(r['actual'],prediction)),'Paint argument does not implement source snapping formula'
  mapped=layout.transform(r['actual'],r['ctm']);actual.append(mapped)
  proof.append({'page':p,'path':r['path'],'phase':r['phase'],'scale':r['scale'],'rawPrintClip':raw,'actualPaintClip':mapped,'snappingPrediction':prediction})
 assert all(all(abs(x-y)<=tol for x,y in zip(a,actual[0]))for a in actual),'Ambiguous paint clips across phases'
 a,b,c,d,e,f=m;v=actual[0]
 result[p]['elements']['probe-clipped']['clips']=[[(v[0]-e)/a,(v[1]-f)/d,(v[2]-e)/a,(v[3]-f)/d]]
 return result,proof

def run(root):
 report={'status':'failed','geometryStatus':'failed','scope':'research A/B, not installed product; digit fidelity remains separate','variants':{},'errors':[]}
 import tempfile
 with tempfile.TemporaryDirectory()as d:
  temp=pathlib.Path(d);fixtures(temp)
  for p in temp.glob('paint-*.html'):assert (root/p.name).read_bytes()==p.read_bytes(),'Fixture identity'
 for variant,dedup in [('baseline',False),('candidate',True)]:
  for suffix,linked in [('links',True),('no-links',False)]:
   name='paint-'+variant+'-'+suffix;item={};report['variants'][name]=item
   try:
    pdf=inspect(root/(name+'.pdf'));log=(root/(name+'.log')).read_text();pages=layout.parse(log,pdf['pages'],linked)
    item['discrimination']=layout.discrimination(pages);paint=parse(log,pages,dedup,linked)
    item.update(pdf=pdf,layout=pages,paint=paint)
    try:layout.verify(pdf,pages,linked);item['originalUnsnappedOracle']='passed'
    except AssertionError as e:item['originalUnsnappedOracle']=str(e)
    corrected,proof=actual_clip_pages(pages,paint);item['independentPaintClipProof']=proof
    try:layout.verify(pdf,corrected,linked);item['paintGeometry']='passed'
    except AssertionError as e:item['paintGeometry']=str(e)
    if variant=='baseline'and linked:
     neighbor=[r for r in paint['focus']if r['id']=='probe-neighbor'and r['page']==1]
     item['neighborCalls']=len(neighbor);item['neighborDuplicateItems']=sum(r['duplicateItems']for r in neighbor)
     assert len(neighbor)==1 and neighbor[0]['duplicateItems']==1,'Duplicate hypothesis not proven: inspect call records'
     assert item['paintGeometry']=='Missing/extra/unioned annotation','Baseline must retain exact duplicate failure'
    else:assert item['paintGeometry']=='passed','Strict actual-paint geometry failed'
    item['status']='passed'
   except Exception as e:item['status']='failed';item['error']=str(e);report['errors'].append(name+': '+str(e))
 try:
  left=report['variants']['paint-baseline-links']['paint']['focus'];right=report['variants']['paint-candidate-links']['paint']['focus']
  signature=lambda rows:[{k:r[k]for k in ['page','call','phase','id','block','inline','ctm','raw']}for r in rows]
  assert signature(left)==signature(right),'A/B changed paint calls or raw rectangles'
  assert all(x['status']=='passed'for x in report['variants'].values())
  report['geometryStatus']='passed'
 except Exception as e:report['errors'].append('A/B: '+str(e))
 try:
  report['sourceText']=audit(root)
  for name,checks in report['sourceText']['checks'].items():
   for key in ['pages','pageMarkers','chineseTwice','intentionalRadicalsTwice','uriPageSet','allLinkTokensExactlyOnce']:
    if not checks[key]:report['errors'].append('source-text '+name+': '+key)
 except Exception as e:report['errors'].append('source-text: '+str(e))
 if not report['errors']:report['status']='passed'
 (root/'paint-result.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
 return report

if __name__=='__main__':
 import argparse
 p=argparse.ArgumentParser();p.add_argument('root',type=pathlib.Path);a=p.parse_args();r=run(a.root)
 print(json.dumps({k:r[k]for k in ['status','geometryStatus','errors']}));raise SystemExit(0 if r['status']=='passed'else 1)
