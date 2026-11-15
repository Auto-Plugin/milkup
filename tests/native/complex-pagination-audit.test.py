import copy
import importlib.util
import pathlib
import tempfile
import unittest
import sys

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('audit', pathlib.Path(__file__).parents[2] / 'scripts/ci/complex-pagination-audit.py')
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


class GeometryContract(unittest.TestCase):
    def setUp(self):
        self.paper = {'width': 595.276, 'height': 841.89}
        self.pages = [dict(self.paper, words=[]) for _ in range(4)]
        self.expected = {'singles': ['TABLE', 'TAA', 'ENDTAA', 'TAB', 'ENDTAB', 'CODE', 'CAA', 'ENDCAA', 'CAB', 'ENDCAB'],
                         'guard': 'HAMBURGEFONS', 'guardCount': 4,
                         'groups': {'T': {'heading': 'TABLE', 'rows': [['TAA','ENDTAA'],['TAB','ENDTAB']]},
                                    'C': {'heading': 'CODE', 'rows': [['CAA','ENDCAA'],['CAB','ENDCAB']]}}}
        for i, pair in enumerate([['TAA','ENDTAA'],['TAB','ENDTAB'],['CAA','ENDCAA'],['CAB','ENDCAB']]):
            self.pages[i]['words'] = [{'text': w, 'box': [40+j*130,100,100+j*130,115]} for j,w in enumerate([pair[0],'HAMBURGEFONS',pair[1]])]
        self.pages[0]['words'].insert(0, {'text': 'TABLE', 'box':[40,60,100,80]})
        self.pages[2]['words'].insert(0, {'text': 'CODE', 'box':[40,60,100,80]})

    def errors(self):
        return audit.inspect(self.pages, self.expected, self.paper)[0]

    def test_positive(self):
        self.assertEqual(self.errors(), [])

    def test_missing_duplicate_and_clipped_words(self):
        for variant in ['missing', 'duplicate', 'clipped']:
            with self.subTest(variant=variant):
                saved = copy.deepcopy(self.pages)
                if variant == 'missing': self.pages[0]['words'].pop()
                if variant == 'duplicate': self.pages[0]['words'].append(copy.deepcopy(self.pages[0]['words'][-1]))
                if variant == 'clipped': self.pages[0]['words'][-1]['box'][2] = 700
                self.assertTrue(self.errors())
                self.pages = saved

    def test_wrong_orientation_blank_and_split(self):
        for variant in ['orientation','blank','split','orphan','order']:
            with self.subTest(variant=variant):
                saved = copy.deepcopy(self.pages)
                if variant == 'orientation': self.pages[0]['width'],self.pages[0]['height']=841.89,595.276
                if variant == 'blank': self.pages[0]['words']=[]
                if variant == 'split': self.pages[1]['words'].append(self.pages[0]['words'].pop())
                if variant == 'orphan': self.pages[1]['words'].append(self.pages[0]['words'].pop(0))
                if variant == 'order': self.pages[0],self.pages[1]=self.pages[1],self.pages[0]
                self.assertTrue(self.errors())
                self.pages = saved

    def test_generated_fixture_unique_and_bounded(self):
        import json
        with tempfile.TemporaryDirectory() as d:
            root=pathlib.Path(d);audit.fixture(root)
            e=json.loads((root/'expectations.json').read_text());text=(root/'complex-pagination.md').read_text()
            self.assertEqual(len(e['groups']['T']['rows']),72)
            self.assertEqual(len(e['groups']['C']['rows']),100)
            import re
            tokens=re.findall(r'[A-Z]+',text)
            self.assertTrue(all(tokens.count(s)==1 for s in e['singles']))
            self.assertEqual(tokens.count(e['guard']),e['guardCount'])
            self.assertLess(len(text),20000)


if __name__ == '__main__': unittest.main()
