import copy
import json
from pathlib import Path
import tempfile
import unittest

from contract import parse, observations, PREFIX
from fixtures import generate, annotate
from prepare import prepare


def sample(reset=False):
    rows=[]
    def box(kind, role, call=0, parent=0, **kw):
        r=dict(kind=kind,role=role,node=role,call=call,parent=parent,value=0,
               top=500,height=20,width=500,marginBefore=0,marginAfter=0,
               block=True,strut=0,before=0,after=1 if role==1 else 0,inside=0,
               dirty=False,horizontal=True)
        r.update(kw);rows.append(r)
    box('after-break',1,1,value=500);box('return',1,1,value=500);box('end',1,1)
    box('table-layout',3,2)
    if reset:
        box('adjust',2,3,2)
        box('strut-write',2,3,strut=40,value=0)
        box('strut-written',2,3,strut=0,value=0)
        box('return',2,3,2);box('end',2,3,2)
    box('end',3,2)
    rows.append(dict(kind='page',page=1,rect=[0,0,600,800],ctm=[1,0,0,1,0,0]))
    for r in range(1,7):
        box('final',r)
        rows.append(dict(kind='quad',page=1,role=r,node=r,rect=[0,500,500,520]))
    rows.append(dict(kind='page-end',page=1))
    return renumber(rows)


def renumber(rows):
    for i,r in enumerate(rows,1): r['seq']=i; r['tick']=i*1000
    return rows


def log(rows): return '\n'.join(PREFIX+json.dumps(r)for r in rows)


class ContractTests(unittest.TestCase):
    def test_unadjusted_boundary_is_not_promoted_to_proven_cause(self):
        o=observations(parse(log(sample()),1))
        self.assertTrue(o['headingAvoidObserved']);self.assertTrue(o['headingBreakReturnedUnchanged'])
        self.assertFalse(o['positiveStrutResetInsideTableLayout']);self.assertIn('not proof',o['scope'])

    def test_nested_positive_reset_has_table_origin(self):
        o=observations(parse(log(sample(True)),1));r=o['positiveStrutResetInsideTableLayout']
        self.assertEqual([(x['tableCall'],x['call'],x['oldStrut'])for x in r],[(2,3,40)])

    def test_final_boxes_distinguish_orphan_without_using_pdf_annotations(self):
        rows=sample();start=next(i for i,x in enumerate(rows)if x['kind']=='page')
        page=copy.deepcopy(rows[start:]);rows=rows[:start]
        for number in (1,2):
            part=copy.deepcopy(page)
            for r in part:
                if 'page'in r:r['page']=number
                if r['kind']=='page':r['rect']=[0,(number-1)*800,600,number*800]
                if r['kind']=='quad':r['rect']=[0,780,500,799]if r['role']==1 else[0,810,500,830]
            rows.extend(part)
        result=observations(parse(log(renumber(rows)),2))
        self.assertEqual(result['finalVisibleBoxPages'][1],[1]);self.assertEqual(result['finalVisibleBoxPages'][6],[2])
        self.assertEqual(result['diagnosticBranch'],'observed-avoid-without-heading-break-movement')

    def test_changed_boundary_is_inconclusive_not_missing_constraint(self):
        rows=sample();rows[1]['value']=800
        self.assertEqual(observations(parse(log(rows),1))['diagnosticBranch'],'inconclusive')

    def test_reject_corrupt_incomplete_and_wrong_phase(self):
        mutations=[
            lambda r:r.pop(),
            lambda r:r[1].update(seq=99),
            lambda r:r[2].update(tick=0),
            lambda r:r[0].update(kind='unknown'),
            lambda r:next(x for x in r if x['kind']=='final').update(dirty=True),
            lambda r:next(x for x in r if x['kind']=='final').update(node=30),
            lambda r:next(x for x in r if x['kind']=='quad').update(node=30),
            lambda r:next(x for x in r if x['kind']=='page').update(ctm=[1,1,0,1,0,0]),
            lambda r:r[1].update(value=float('nan')),
            lambda r:r[1].update(call=2),
            lambda r:r[0].update(extra='untrusted'),
            lambda r:r.append(dict(kind='error',reason='record-budget')),
        ]
        for m in mutations:
            rows=sample();m(rows)
            with self.subTest(m=m),self.assertRaises((AssertionError,KeyError)):parse(log(rows),1)

    def test_missing_role_return_page_and_reset_confirmation(self):
        for kind in ['quad','final','return']:
            rows=sample(); rows.pop(next(i for i,x in enumerate(rows)if x['kind']==kind));renumber(rows)
            with self.subTest(kind=kind),self.assertRaises(AssertionError):parse(log(rows),1)
        with self.assertRaises(AssertionError):parse(log(sample()),2)
        rows=sample(True);rows.pop(next(i for i,x in enumerate(rows)if x['kind']=='strut-written'));renumber(rows)
        with self.assertRaises(AssertionError):observations(parse(log(rows),1))

    def test_fixture_metadata_only_and_source_hash(self):
        with tempfile.TemporaryDirectory()as d:
            r=generate(Path(d)/'out');self.assertEqual(len(r),4)
        with self.assertRaises(AssertionError):annotate('<title>Document</title><table>different</table>')

    def test_wrong_source_refused_before_generating_patch(self):
        with tempfile.TemporaryDirectory()as d:
            p=Path(d);q=p/'Source/WebCore/rendering';q.mkdir(parents=True)
            (q/'RenderBlockFlow.cpp').write_text('wrong')
            with self.assertRaises(AssertionError):prepare(p,p/'patch')
            self.assertFalse((p/'patch').exists())


if __name__=='__main__':unittest.main()
