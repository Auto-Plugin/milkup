import importlib.util, pathlib, unittest
p=pathlib.Path(__file__).with_name('webkit-digit-followup.py');spec=importlib.util.spec_from_file_location('gate',p);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class Followup(unittest.TestCase):
    def case(self):
        checks={k:True for k in ['pages','pageMarkers','chineseTwice','intentionalRadicalsTwice','uriPageSet','allLinkTokensExactlyOnce']}
        return [
            {'base_commit':{'sha':m.BASE},'status':'ahead','commits':[{'sha':'candidate'}],'total_commits':1,'files':[{'filename':'research/linux-pdf-unicode-20261114/digit_pdf_contract.py','status':'modified'}]},
            {'id':m.RUN,'head_sha':m.BASE,'event':'workflow_dispatch','status':'completed','conclusion':'failure','path':'.github/workflows/linux-webkit-build-research.yml'},
            {'harnessSha':m.BASE,'status':'private-runtime-built-not-accepted','preflight':{'digitActualObject':'passed'},'compileExitCode':0,'resourceStopReason':None,'digitPatchSha256':'fe7952f48491b1b3a75759789795831c9f3638aff1768cbf1fd48a4f784a20a3'},
            {'status':'passed','sourceUnchanged':True,'sourceSha256':'49e8541ecc4890f22c9a6e5ff49dac106b999c01ac6565361f8fd384937adf70','objectSha256':'93ecc87125c7373c334bc28238decd206cb1102a4d7e3953f69cb1a3673aead6'},
            {'status':'failed','harnessSha':m.BASE,'privateRuntimeFinalCheck':{'status':'passed'},'runs':[{'exitCode':0,'webProcesses':[{}]} for _ in range(6)]},
            {'status':'failed','errors':['digits: Baseline digit defect was not reproduced'],'geometry':{'paint-candidate-links':{'status':'passed'},'paint-candidate-no-links':{'status':'passed'}},'sourceText':{'checks':{'links':checks,'no-links':checks}}},'candidate']
    def test_exact_subgates(self):
        r=m.verify(*self.case());self.assertEqual(r['originalOverallStatus'],'failure');self.assertFalse(r['requiresNewDigitTUGate'])
    def test_reject_mutations(self):
        mutations=[lambda a:a[0]['files'][0].update(filename='apps/desktop/src/main.ts'),lambda a:a[0]['files'][0].update(filename='research/linux-pdf-unicode-20261114/independent-digit-text.inc'),lambda a:a[0].update(total_commits=2),lambda a:a[1].update(head_sha='other'),lambda a:a[2].update(compileExitCode=1),lambda a:a[3].update(sourceUnchanged=False),lambda a:a[3].update(objectSha256='other'),lambda a:a[4]['privateRuntimeFinalCheck'].update(status='failed'),lambda a:a[5]['errors'].append('another failure'),lambda a:a[5]['geometry']['paint-candidate-links'].update(status='failed')]
        for change in mutations:
            args=self.case();change(args)
            with self.assertRaises(AssertionError):m.verify(*args)
if __name__=='__main__':unittest.main()
