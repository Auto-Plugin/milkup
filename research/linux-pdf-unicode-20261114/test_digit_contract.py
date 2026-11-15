import copy, pathlib, tempfile, unittest
from digit_pdf_contract import fixtures, verify_trace, traces
from prepare_digit_probe import prepare

class DigitContract(unittest.TestCase):
    def samples(self):
        return [dict(source=list(map(ord, '0123456789')), accepted=True, glyphs=[[i, 63153+i, 17+i] for i in range(10)]),
                dict(source=list(map(ord, '1212')), accepted=True, glyphs=[[i, 3, 1+i%2] for i in range(4)])]
    def test_real_trace_contract_and_adversarial_changes(self):
        verify_trace(self.samples(), True)
        mutations = [lambda r:r.pop(), lambda r:r[0].update(accepted=False),
                     lambda r:r[0]['glyphs'][1].__setitem__(0,0),
                     lambda r:r[0]['glyphs'][0].__setitem__(1,0),
                     lambda r:r[0]['glyphs'][0].__setitem__(1,17),
                     lambda r:r[1]['glyphs'][1].__setitem__(1,4)]
        for mutation in mutations:
            rows = self.samples(); mutation(rows)
            with self.assertRaises(AssertionError): verify_trace(rows, True)
    def test_empty_overflow_trace_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            p=pathlib.Path(d)/'log'
            for text in ['', 'MILKUP_DIGIT_OVERFLOW\n']:
                p.write_text(text)
                with self.assertRaises(AssertionError):traces(p)
    def test_identical_fixture_and_embedded_font(self):
        with tempfile.TemporaryDirectory() as a, tempfile.TemporaryDirectory() as b:
            pa,pb=pathlib.Path(a),pathlib.Path(b)
            self.assertEqual(fixtures(pa),fixtures(pb))
            self.assertEqual((pa/'digit-baseline.html').read_bytes(),(pa/'digit-candidate.html').read_bytes())
            text=(pa/'digit-candidate.html').read_text()
            self.assertIn('data:font/ttf;base64,',text)
            self.assertIn('dir="rtl"',text)
            self.assertIn('break-before:page',text)
    def test_exact_source_delta_if_available(self):
        source=pathlib.Path('/tmp/milkup-webkit-header-preflight/source')
        if not source.exists():self.skipTest('matched source absent')
        with tempfile.TemporaryDirectory() as d:
            patch=pathlib.Path(d)/'digit.patch';r=prepare(source,patch)
            self.assertEqual(r['files'],['Source/WebCore/platform/graphics/FontCascade.cpp'])
            text=patch.read_text()
            self.assertNotIn('+++ b/Source/WebCore/platform/graphics/ScalarGlyphText.h',text)
            self.assertIn('sourceText = std::getenv("MILKUP_DIGIT_NOMINAL_ONLY")',text)
            self.assertIn('|| sourceFrom || sourceTo != sourceRun->length()',text)
            self.assertIn('milkupDigitTrace(source, offsets, glyphs, nominal, sourceText.has_value());',text)

if __name__ == '__main__': unittest.main()
