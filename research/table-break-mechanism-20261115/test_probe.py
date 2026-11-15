import copy
import unittest
import probe


def good():
    words=[]
    def w(text,x,y):words.append([x,y,x+40,y+10,text])
    for i in range(8):w('PRE'+probe.ident(i),30,20+i*20)
    w('TABLETITLE',30,200);w('LEFTHEADER',30,230);w('RIGHTHEADER',300,230)
    for i in range(3):
        w('ROW'+probe.ident(i),30,260+30*i);w('HAMBURGEFONS',100,260+30*i);w('END'+probe.ident(i),300,260+30*i)
    w('DOCUMENTEND',30,380)
    return [{'width':595.276,'height':841.89,'words':words}]


class Contract(unittest.TestCase):
    def test_all_html_semantics(self):
        for v in probe.VARIANTS:
            for c in probe.CASES:probe.validate_html(probe.fixture(v,c),v,c)

    def test_single_title_and_original_rows_required(self):
        html=probe.fixture('internal-group','short-room')
        with self.assertRaises(AssertionError):probe.validate_html(html.replace('id="title"','aria-hidden="true"'),'internal-group','short-room')
        with self.assertRaises(AssertionError):probe.validate_html(html.replace('ENDAB','ENDAA'),'internal-group','short-room')

    def test_good_geometry(self):
        self.assertEqual(probe.inspect_words(good(),'short-room')['errors'],[])

    def test_missing_or_duplicate_content_rejected(self):
        p=good();p[0]['words']=[w for w in p[0]['words'] if w[4]!='ROWAA']
        self.assertTrue(probe.inspect_words(p,'short-room')['errors'])
        p=good();p[0]['words'].append(copy.deepcopy(p[0]['words'][8]))
        self.assertIn('count TABLETITLE 2',probe.inspect_words(p,'short-room')['errors'])

    def test_heading_split_and_overlap_rejected(self):
        p=good();second=copy.deepcopy(p[0]);second['words']=p[0]['words'][9:];p[0]['words']=p[0]['words'][:9];p.append(second)
        self.assertIn('title/header/first-row separated',probe.inspect_words(p,'short-room')['errors'])
        p=good();p[0]['words'][8][1:4:2]=[260,280]
        self.assertIn('title/header/row overlap or order',probe.inspect_words(p,'short-room')['errors'])

    def test_blank_page_and_clip_rejected(self):
        p=good();p.append({'width':595.276,'height':841.89,'words':[]})
        self.assertIn('blank page 2',probe.inspect_words(p,'short-room')['errors'])
        p=good();p[0]['words'][0][1]=-1
        self.assertIn('off-page 1 PREAA',probe.inspect_words(p,'short-room')['errors'])


if __name__=='__main__':unittest.main()
