import ast,hashlib,pathlib,tempfile,unittest
from audit_existing import checks,multiply
from test_pdf_links import sample
from pdf_links import CASES

class Audit(unittest.TestCase):
    def fixture(self):
        s=sample();s['text']+=' '.join(w for c in CASES for w in c['words']);return s
    def test_full_text_separate_from_unicode(self):
        s=self.fixture();self.assertTrue(checks(s,True)['allLinkTokensExactlyOnce'])
        s['text']=s['text'].replace('WRAP00','WRAP')
        r=checks(s,True);self.assertTrue(r['chineseTwice']);self.assertFalse(r['allLinkTokensExactlyOnce']);self.assertEqual(r['missingOrRepeatedLinkTokens'],['WRAP00'])
        s['links']=[];r=checks(s,False);self.assertTrue(r['uriPageSet']);self.assertFalse(r['allLinkTokensExactlyOnce'])
    def test_wrong_page_and_uri(self):
        s=self.fixture();s['links'][0]['page']=3;self.assertFalse(checks(s,True)['uriPageSet'])
        s=self.fixture();s['links'][0]['uri']='https://wrong.invalid';self.assertFalse(checks(s,True)['uriPageSet'])
    def test_pdf_flip_then_local_transform(self):
        self.assertEqual(multiply([2,0,0,2,10,20],[1,0,0,-1,0,842]),[2,0,0,-2,10,822])
    def test_runtime_check_survives_pdf_assertion(self):
        source=pathlib.Path(__file__).resolve().parents[2]/'scripts/ci/run-webkit-link-probe.py'
        tree=ast.parse(source.read_text());function=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='final_runtime_check')
        scope={'pathlib':pathlib,'hashlib':hashlib}
        exec(compile(ast.Module(body=[function],type_ignores=[]),str(source),'exec'),scope)
        check=scope['final_runtime_check']
        with tempfile.TemporaryDirectory() as tmp:
            f=pathlib.Path(tmp)/'owned-test-library';f.write_bytes(b'original');expected={str(f):hashlib.sha256(f.read_bytes()).hexdigest()}
            self.assertEqual(check(expected)['status'],'passed')
            f.write_bytes(b'changed');self.assertEqual(check(expected)['status'],'failed')
            f.unlink();self.assertEqual(check(expected)['status'],'failed')
        final=next(n for n in tree.body if isinstance(n,ast.Try) and n.finalbody)
        self.assertIn('final_runtime_check(expected)',ast.unparse(ast.Module(body=final.finalbody,type_ignores=[])))

if __name__=='__main__':unittest.main()
