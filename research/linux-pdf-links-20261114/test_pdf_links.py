import copy, unittest
from pdf_links import CASES, CHINESE, PAIRS, verify

def sample():
    s={'pages':3,'text':(CHINESE+PAIRS)*2,'words':[],'links':[]}
    for page,text in enumerate(['PAGEONE','PAGETWO','PAGETHREE'],1):s['words'].append({'page':page,'text':text,'rect':[20,20,70,40]})
    for i,c in enumerate(CASES):
        rects=[]
        for j,w in enumerate(c['words']):
            r=[30+(j%3)*60,100+i*80+(j//3)*20,80+(j%3)*60,115+i*80+(j//3)*20]
            s['words'].append({'page':c['page'],'text':w,'rect':r});rects.append(r)
        s['links'].append({'page':c['page'],'uri':c['uri'],'rect':[min(r[0] for r in rects),min(r[1] for r in rects),max(r[2] for r in rects),max(r[3] for r in rects)]})
    return s

class Contract(unittest.TestCase):
    def test_positive_and_no_link_control(self):
        s=sample();verify(s);s['links']=[];verify(s,False)
    def test_rejections(self):
        mutations=[lambda s:s.update(links=[]),lambda s:s['links'][0].update(uri='https://wrong.invalid'),lambda s:s['links'][0].update(page=3),lambda s:s['links'][0].update(rect=[0,0,595,842]),lambda s:s['links'][0].update(rect=[300,300,350,320]),lambda s:s.update(text=s['text'].replace('文','⽂')),lambda s:s.update(pages=2),lambda s:s['links'].append({'page':1,'uri':CASES[0]['uri'],'rect':[400,400,450,450]})]
        for mutate in mutations:
            s=sample();mutate(s)
            with self.subTest(mutation=mutate),self.assertRaises(AssertionError):verify(s)
        with self.assertRaises(AssertionError):verify(sample(),False)

if __name__=='__main__':unittest.main()
