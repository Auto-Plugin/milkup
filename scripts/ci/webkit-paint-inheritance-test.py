import copy,importlib.util,pathlib,unittest
p=pathlib.Path(__file__).with_name('webkit-paint-inheritance.py');s=importlib.util.spec_from_file_location('gate',p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
class Inheritance(unittest.TestCase):
 def case(self):
  return [{'base_commit':{'sha':m.BASE},'status':'ahead','commits':[{'sha':'candidate'}],'total_commits':1,'files':[{'filename':'research/linux-pdf-links-20261114/prepare_paint_probe.py','status':'added'}]}, {'id':43660565818,'head_sha':m.BASE,'status':'completed','conclusion':'success','event':'workflow_dispatch','path':'.github/workflows/linux-webkit-build-research.yml'}, {'harnessSha':m.BASE,'status':'preflight-passed-not-engine-built','fullEngineBuildAttempted':False,'preflight':{'geometryActualObjects':'passed'}}, {'status':'passed','sourceRestored':True}, 'candidate']
 def test_valid_delta(self):self.assertEqual(m.verify(*self.case())['status'],'passed')
 def test_reject_wrong_or_incomplete_proof(self):
  mutations=[lambda a:a[0]['files'][0].update(filename='apps/desktop/src/main.ts'),lambda a:a[0].update(total_commits=2),lambda a:a[0]['base_commit'].update(sha='other'),lambda a:a[1].update(conclusion='failure'),lambda a:a[1].update(id=43657723234),lambda a:a[3].update(sourceRestored=False),lambda a:a[0]['files'][0].update(status='renamed',previous_filename='secret')]
  for change in mutations:
   a=self.case();change(a)
   with self.assertRaises(AssertionError):m.verify(*a)
if __name__=='__main__':unittest.main()
