import copy
import json
from pathlib import Path
import tempfile
import unittest

import gate


def layout(expected, numbered=True):
    pages = []; y = 70; page = None
    def new_page():
        nonlocal page, y
        page = {'width': 595, 'height': 842, 'characters': []}; pages.append(page); y = 70
    def text(value, x, baseline):
        for c in value:
            page['characters'].append({'text': c, 'origin': [x, baseline], 'bbox': [x, baseline - 9, x + 6, baseline + 3]}); x += 6
    new_page()
    for row in expected['lines']:
        if y > 780: new_page()
        if numbered: text(str(row['sourceLine']), 35, y)
        tokens = row['tokens']
        for start in range(0, len(tokens), 7):
            if y > 780: new_page()
            text(' '.join(tokens[start:start + 7]), 80, y); y += 14
    return pages


class CodeWrap(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.root = Path(self.tmp.name)
        self.expected = gate.fixture(self.root / 'fixture'); self.pages = layout(self.expected)

    def tearDown(self): self.tmp.cleanup()

    def test_fixture_short_long_page_and_real_gutter_contract(self):
        self.assertLess((self.root / 'fixture/code-wrap.md').stat().st_size, 8000)
        report = gate.inspect(self.pages, self.expected, 'required')
        self.assertEqual(report['errors'], []); self.assertEqual(report['lineNumberStatus'], 'passed')
        self.assertTrue(report['pageTransitions']); self.assertEqual(len(report['lines']), 50)

    def test_no_line_number_emitter_is_not_a_line_number_pass(self):
        pages = layout(self.expected, False)
        self.assertTrue(gate.inspect(pages, self.expected, 'required')['errors'])
        result = gate.inspect(pages, self.expected, 'absent')
        self.assertFalse(result['errors'])
        self.assertEqual(result['lineNumberStatus'], 'not-exercised-no-product-line-number-emitter')

    def test_historical_number_not_moving_with_wrapped_code_rejects(self):
        for page in self.pages:
            for char in page['characters']:
                if char['text'] == '4':
                    char['origin'][1] -= 28; char['bbox'][1] -= 28; char['bbox'][3] -= 28
                    self.assertTrue(gate.inspect(self.pages, self.expected, 'required')['errors']); return
        self.fail('fixture needs following source line 4')

    def test_content_order_clipping_duplication_and_missing_negatives(self):
        for mode in ['missing', 'duplicate', 'reorder', 'clip', 'baseline', 'x-order']:
            with self.subTest(mode=mode):
                pages = copy.deepcopy(self.pages); chars = pages[0]['characters']
                at = next(i for i, c in enumerate(chars) if c['text'] == 'W')
                if mode == 'missing': chars.pop(at)
                elif mode == 'duplicate': chars.insert(at, copy.deepcopy(chars[at]))
                elif mode == 'reorder': chars[at], chars[at+1] = chars[at+1], chars[at]
                elif mode == 'clip': chars[at]['bbox'][0] = -2
                elif mode == 'baseline': chars[at]['origin'][1] += 4
                else: chars[at+1]['origin'][0] = chars[at]['origin'][0]
                self.assertTrue(gate.inspect(pages, self.expected, 'required')['errors'])

    def test_no_wrapping_and_no_actual_page_boundary_reject(self):
        self.assertTrue(gate.inspect(self.pages[:1], self.expected, 'required')['errors'])
        flat = copy.deepcopy(self.pages)
        # Same complete ordered content, but put every character on one baseline.
        for page in flat:
            for char in page['characters']: char['origin'][1] = 70
        self.assertTrue(gate.inspect(flat, self.expected, 'required')['errors'])

    def test_real_pdf_parser_and_rasters_are_synthetic_not_native_acceptance(self):
        import fitz
        pdf = self.root / 'synthetic.pdf'
        with fitz.open() as document:
            for fixture in self.pages:
                page = document.new_page(width=595, height=842)
                for char in fixture['characters']:
                    page.insert_text(char['origin'], char['text'], fontname='cour', fontsize=10)
            document.save(pdf)
        report = gate.audit(pdf, self.root / 'fixture/expectations.json', self.root / 'audit', 'required', {'kind': 'synthetic-contract-not-installed'})
        self.assertEqual(report['errors'], [])
        self.assertFalse(report['installedNativeAcceptance'])
        self.assertEqual(report['status'], 'pending-native-provenance-and-raster-review')
        self.assertEqual(len(report['pageImages']), len(self.pages))
        self.assertTrue((self.root / 'audit/coordinates.json').is_file())


if __name__ == '__main__': unittest.main()
