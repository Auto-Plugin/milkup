import copy,importlib.util,json,pathlib,unittest,zipfile
HERE=pathlib.Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('candidate_gate_test',HERE/'candidate_gate.py');gate=importlib.util.module_from_spec(spec);spec.loader.exec_module(gate)

class CandidateGate(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with zipfile.ZipFile(HERE.parent/'pdf-combined-20261116/evidence/43826817074/preflight-original.zip')as z:
            cls.original=json.loads(z.read('pagination-behavior-preflight.json'))

    def test_real_receipt_reproduces_old_rejection_and_preserves_all_evidence(self):
        c=copy.deepcopy(self.original)
        self.assertEqual(c['gate']['uniqueObjectCommands'],11)
        with self.assertRaises(AssertionError):assert c['gate']['uniqueObjectCommands']in(1,2,3)
        self.assertEqual(gate.validate(c,tail=True,combined=True),{'sources':13,'uniqueObjectCommands':11,'maxObjectCommands':13})
        self.assertEqual(c,self.original)

    def test_missing_extra_or_forged_compile_evidence_fails_closed(self):
        source=gate.sources(True,True)[0]
        def row(c):return next(r for r in c['gate']['samples']if r['name'].startswith('fixed-'))
        mutations=[
            lambda c:c['gate'].update(uniqueObjectCommands=3),
            lambda c:c['gate'].update(maxObjectCommands=14),
            lambda c:c['gate']['selectedUnits'].pop(source),
            lambda c:c['gate']['sourceHashes'].pop(source),
            lambda c:c['gate']['sourceHashes'].update({'Source/WebCore/unrelated.cpp':'a'*64}),
            lambda c:c['gate']['sourceHashes'].update({source:'a'*64}),
            lambda c:c['gate'].update(compileDatabaseSha256='a'*64),
            lambda c:c['gate'].update(sourceRestored=False),
            lambda c:c['gate']['samples'].remove(row(c)),
            lambda c:c['gate']['samples'].append(copy.deepcopy(row(c))),
            lambda c:row(c).update(exitCode=1),
            lambda c:row(c).update(sourceHashAfter='a'*64),
            lambda c:row(c).update(objectSha256=''),
            lambda c:c['gate']['selectedUnits'][source].update(file='/wrong/input.cpp'),
        ]
        for mutation in mutations:
            c=copy.deepcopy(self.original);mutation(c)
            with self.assertRaises((AssertionError,KeyError)):gate.validate(c,tail=True,combined=True)

    def test_mode_cannot_silently_accept_broader_sources(self):
        with self.assertRaises(AssertionError):gate.validate(self.original,tail=True,combined=False)
        with self.assertRaises(AssertionError):gate.sources(tail=False,combined=True)
        # Historical pagination shape is still accepted only with its complete
        # selected coverage; unified Table/Section are one actual command.
        for tail in [False,True]:
            c=copy.deepcopy(self.original);names=gate.sources(tail,False)
            c['gate']['selectedUnits']={k:v for k,v in c['gate']['selectedUnits'].items()if k in names}
            c['gate']['sourceHashes']={k:v for k,v in c['gate']['sourceHashes'].items()if k in names}
            expected={'fixed-RenderBlockFlow','fixed-RenderTable'}|({'fixed-PrintContext'}if tail else set())
            c['gate']['samples']=[r for r in c['gate']['samples']if not r['name'].startswith('fixed-')or r['name']in expected]
            c['gate'].update(uniqueObjectCommands=len(expected),maxObjectCommands=4)
            self.assertEqual(gate.validate(c,tail=tail)['uniqueObjectCommands'],len(expected))

if __name__=='__main__':unittest.main()
