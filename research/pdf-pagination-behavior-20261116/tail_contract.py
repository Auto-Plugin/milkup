"""Tail diagnostics: strict schema/clock/page/identity, not a behavior oracle."""
import json,sys,pathlib
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parent.parent/'pdf-pagination-mechanism-20261116'))
from contract import integer,finite,rectangle
PREFIX='MILKUP_TAIL '
COMMON={'kind','seq','tick'}
def parse(text,baseline):
 rows=[json.loads(s[len(PREFIX):])for s in text.splitlines()if s.startswith(PREFIX)]
 assert 0<len(rows)<=1024
 pages={};identities={};margins=[];last_tick=-1;last_document=None;pending={}
 for seq,r in enumerate(rows,1):
  assert r['seq']==seq
  integer(r['tick'],0,2**63-1);assert r['tick']>=last_tick;last_tick=r['tick']
  if r['kind']=='document':
   assert set(r)==COMMON|{'page','document','pageRect'}
   assert r['page']==len(pages)+1 and r['page']in baseline['pages']
   rectangle(r['document']);rectangle(r['pageRect'])
   assert r['pageRect']==baseline['pages'][r['page']]['header']['rect']
   if last_document is not None:assert last_document==r['document'],'Document changed during print'
   last_document=r['document'];pages[r['page']]={'document':r,'boxes':{}}
  elif r['kind']=='box':
   assert set(r)==COMMON|{'page','role','node','top','height','marginBefore','marginAfter','collapsedAfter','before','after','quad','layout','visual'}
   integer(r['role'],1,4);integer(r['node'],1,32)
   assert identities.setdefault(r['role'],r['node'])==r['node'] and len(set(identities.values()))==len(identities)
   assert r['page']==len(pages) and r['role']not in pages[r['page']]['boxes']
   for k in ['top','height','marginBefore','marginAfter','collapsedAfter']:finite(r[k])
   for k in ['before','after']:integer(r[k],0,9)
   for k in ['quad','layout','visual']:rectangle(r[k])
   pages[r['page']]['boxes'][r['role']]=r
  elif r['kind']=='margin':
   assert set(r)==COMMON|{'role','node','phase','content','result','pending','collapseBefore','collapseAfter','borderPaddingAfter','scrollbar','collapsedAfter'}
   assert not pages,'Layout changed after print began'
   integer(r['role'],1,4);integer(r['node'],1,32)
   assert identities.setdefault(r['role'],r['node'])==r['node'] and len(set(identities.values()))==len(identities)
   for k in ['content','result','pending','borderPaddingAfter','scrollbar','collapsedAfter']:finite(r[k])
   for k in ['collapseBefore','collapseAfter']:assert type(r[k])is bool
   if r['phase']=='before':assert r['role']not in pending;pending[r['role']]=r
   elif r['phase']=='after':
    before=pending.pop(r['role']);assert before['node']==r['node'] and before['content']==r['content']
    margins.append({'before':before,'after':r,'addedHeight':r['result']-before['result']})
   else:raise AssertionError('Unknown margin phase')
  else:raise AssertionError('Unknown tail record')
 assert not pending and len(pages)==len(baseline['pages'])
 assert all(set(p['boxes'])=={1,2,3,4}for p in pages.values()),'Missing root/body/last block'
 assert any(x['before']['role']==1 for x in margins),'RenderView bottom margin path not observed'
 final=pages[1]['boxes']
 for p in pages.values():
  for role,r in p['boxes'].items():assert {k:v for k,v in r.items()if k not in COMMON|{'page'}}=={k:v for k,v in final[role].items()if k not in COMMON|{'page'}},'Final geometry changed'
 return {'rows':rows,'pages':pages,'marginTransitions':margins,'scope':'Measured layout/overflow and margins only; PDF content/blank-page acceptance is independent'}
