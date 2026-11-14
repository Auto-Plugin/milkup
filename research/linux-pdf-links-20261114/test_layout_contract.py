import copy,json,pathlib,tempfile,unittest
import layout_contract as c
from prepare_layout_probe import prepare

# These synthetic coordinates test the contract, NOT WebKit behavior.
def records(linked=True):
    rows=[{'kind':'page','page':1,'printing':True,'layoutReady':True,'ctm':[.75,0,0,.75,12,18],'pageRect':[0,0,600,800]}]
    shapes={name:[[10,10+40*i,100,30+40*i]]for i,name in enumerate(c.IDS)}
    shapes['probe-wrapped']=[[10,90,100,110],[10,120,40,140]]
    shapes['probe-neighbor']=[[50,120,90,140]]
    shapes['probe-clipped']=[[10,180,180,204]]
    for name,boxes in shapes.items():
        rows.append({'kind':'element','page':1,'idHex':name.encode().hex(),'uriHex':(c.IDS[name]if linked else'').encode().hex(),'fragments':boxes,'clips':[[10,180,75,198]]if name=='probe-clipped'else[]})
    rows.append({'kind':'end','page':1,'elements':len(c.IDS),'complete':True})
    return rows

def parse(rows,linked=True):return c.parse('\n'.join(c.PREFIX+json.dumps(r)for r in rows),1,linked)
def sample(pages):return {'pages':len(pages),'links':[{k:r[k]for k in ['page','uri','rect']}for r in c.expected_regions(pages)]}

class LayoutContract(unittest.TestCase):
    def test_independent_fragments_and_clip(self):
        p=parse(records());s=sample(p);self.assertEqual(len(c.verify(s,p)),7)
        clipped=next(x for x in s['links']if x['uri'].endswith('/clipped'))
        self.assertEqual(clipped['rect'],[19.5,153.0,68.25,166.5])
        self.assertLess(c.rounding_bound([.75,0,0,.75,12,18]),.062)
    def test_reject_annotation_mutations(self):
        p=parse(records());original=sample(p)
        def union_wrapped(s):
            s['links']=[x for x in s['links']if not x['uri'].endswith('/wrapped')]
            s['links'].append({'page':1,'uri':c.URIS['wrapped'],'rect':[19.5,85.5,87,123]})
        mutations=[lambda s:s['links'].pop(),lambda s:s['links'].append(copy.deepcopy(s['links'][0])),lambda s:s['links'][0].update(page=2),lambda s:s['links'][0].update(uri=c.URIS['adjacent-right']),lambda s:s['links'][0].update(rect=[0,0,595,842]),lambda s:s['links'][0]['rect'].__setitem__(1,800),union_wrapped,lambda s:next(x for x in s['links']if x['uri'].endswith('/clipped')).update(rect=[19.5,153,147,171])]
        for change in mutations:
            with self.subTest(mutation=change):
                s=copy.deepcopy(original);change(s)
                with self.assertRaises(AssertionError):c.verify(s,p)
    def test_missing_or_false_native_evidence_rejected(self):
        mutations=[lambda r:r[0].update(layoutReady=False),lambda r:r.pop(),lambda r:r[0].update(printing=False),lambda r:r[-1].update(complete=False),lambda r:r[1].update(uriHex=''),lambda r:r[0].update(ctm=[0,1,-1,0,0,0]),lambda r:r.pop(2),lambda r:r.append(copy.deepcopy(r[0]))]
        for change in mutations:
            with self.subTest(mutation=change):
                r=records();change(r)
                with self.assertRaises(AssertionError):parse(r)
    def test_fixture_discrimination_and_cross_page(self):
        rows=records()
        for row in rows:
            if row['kind']!='element':continue
            name=bytes.fromhex(row['idHex']).decode()
            if name=='probe-adjacent-right':row['fragments']=[[100,10,190,30]]
            if name=='probe-wrapped':row['fragments']=[[10,90,100,110],[10,120,40,140],[10,150,25,170]]
            if name=='probe-neighbor':row['fragments']=[[50,150,90,170]]
            if name=='probe-cross-page':row['fragments']=[[10,780,100,820]]
        second=copy.deepcopy(rows)
        for row in second:row['page']=2
        second[0]['ctm']=[.75,0,0,.75,12,-582];second[0]['pageRect']=[0,800,600,1600]
        pages=c.parse('\n'.join(c.PREFIX+json.dumps(x)for x in rows+second),2)
        self.assertEqual(c.discrimination(pages)['crossPages'],[1,2])
        c.verify(sample(pages),pages)
        bad=copy.deepcopy(pages);bad[1]['elements']['probe-neighbor']['fragments']=[[200,150,250,170]]
        with self.assertRaisesRegex(AssertionError,'Old union'):c.discrimination(bad)
        bad=copy.deepcopy(pages);bad[1]['elements']['probe-clipped']['clips']=[]
        with self.assertRaisesRegex(AssertionError,'Overflow clip'):c.discrimination(bad)
    def test_negative_control(self):
        p=parse(records(False),False);c.verify({'pages':1,'links':[]},p,False)
        with self.assertRaises(AssertionError):c.verify(sample(p),p,False)
    def test_fixture_identity_and_probe_placement(self):
        with tempfile.TemporaryDirectory()as d:
            root=pathlib.Path(d);c.fixtures(root)
            linked=(root/'geometry-links.html').read_text();negative=(root/'geometry-no-links.html').read_text()
            self.assertIn('overflow:hidden',linked);self.assertIn('line-height:64px',linked)
            self.assertEqual(linked.count(' href='),6);self.assertNotIn(' href=',negative)
            self.assertIn('MILKUP_PRINT_LAYOUT_V1',linked)
        probe=pathlib.Path(__file__).with_name('print-layout-probe.inc').read_text()
        self.assertIn('renderer->absoluteQuads(quads)',probe)
        self.assertIn('overflowClipRect(LayoutPoint())',probe)
        for forbidden in ['getClientRects(', 'setURLForRect(', 'collectFocusRingRects(', 'beforeprint']:
            self.assertNotIn(forbidden,probe)
    def test_actual_source_order_if_available(self):
        source=pathlib.Path('/tmp/milkup-webkit-header-preflight/source')
        if not source.exists():self.skipTest('Exact source absent')
        with tempfile.TemporaryDirectory()as d:
            p=pathlib.Path(d)/'probe.patch';result=prepare(source,p)
            self.assertEqual(result['sha256'],'938541c51de207aa15b45133d341c40cba36f4a912e1be48c38bca9418eb0d3e')
            patch=p.read_text();self.assertIn('ctx.clip(pageRect);\n+    milkupPrintLayoutProbe',patch)
            self.assertIn('frame.view()->paintContents(ctx, pageRect);',patch)

if __name__=='__main__':unittest.main()
