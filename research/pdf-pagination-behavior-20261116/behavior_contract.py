"""Keep original independent content, clipping and repeated-header thresholds."""
import sys,pathlib
BASE=pathlib.Path(__file__).resolve().parent.parent/'pdf-pagination-mechanism-20261116'
sys.path.insert(0,str(BASE/'support'))
import calibrate
PAPERS=[{'name':'a4-portrait','pageSize':'a4','orientation':'portrait','width':595.276,'height':841.89},
{'name':'a4-landscape','pageSize':'a4','orientation':'landscape','width':841.89,'height':595.276},
{'name':'letter-portrait','pageSize':'letter','orientation':'portrait','width':612,'height':792},
{'name':'letter-landscape','pageSize':'letter','orientation':'landscape','width':792,'height':612}]
CASES=[(name,name,PAPERS[0]) for name in ['baseline-baseline','baseline-short-edge','baseline-long-room','baseline-short-room']]
CASES += [('baseline-'+p['name'],'baseline-baseline',p) for p in PAPERS[1:]]
def adapted_html(html,paper):
 if paper['name']=='a4-portrait':return html
 old='@page{size:A4;margin:16mm}'
 assert html.count(old)==1
 return html.replace(old,'@page{size:'+paper['pageSize'].upper()+' '+paper['orientation']+';margin:16mm}')
def verify_pdf(current,pdf):
 assert current['errors']==[],('Original content/orphan/clipping contract failed',current['errors'])
 assert len(current['papers'])==1
 result=calibrate.header_contract(current['papers'][0],pdf)
 assert not result['errors'],('Repeated header contract failed',result['errors'])
 return result


def assess_pdf(current,pdf):
 """Retain independent header evidence even when content/blank-page fails.
 A product contract failure is a result, never permission to mark the batch passed.
 Identity and cleanup checks remain outside and must succeed before this function.
 """
 assert len(current['papers'])==1
 headers=calibrate.header_contract(current['papers'][0],pdf)
 errors=list(current['errors'])+list(headers['errors'])
 return {'paginationPassed':not errors,'contentErrors':list(current['errors']),
         'headerErrors':list(headers['errors']),'headers':headers}

def batch_passed(results,expected_cases):
 return len(results)==len(expected_cases) and [r['case']for r in results]==[c[0]for c in expected_cases] and all(r['paginationPassed']for r in results)
