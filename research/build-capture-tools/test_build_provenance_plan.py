import copy
import json
from pathlib import Path
import tempfile
import subprocess
import sys
import unittest
from unittest.mock import patch
import build_provenance_plan as p


class ProvenancePlan(unittest.TestCase):
    def test_path_scope(self):
        self.assertEqual(p.rel(p.u.BUILD_ROOT+'Derived/x.cpp'),'Derived/x.cpp')
        for name in ['../secret','/etc/shadow',p.u.BUILD_ROOT+'../secret']:
            with self.subTest(name=name),self.assertRaises(ValueError):p.rel(name)

    def test_missing_bytes_stay_incomplete_and_copied_bytes_are_hashed(self):
        with tempfile.TemporaryDirectory() as td:
            root=Path(td);build=root/'build';build.mkdir();(build/'generated.cpp').write_text('original')
            plan={'nextBuildId':'new','requiredFiles':[{'path':'generated.cpp'},{'path':'missing.h'}],
                  'identityOnlyFiles':[],'budgets':{'collectionSeconds':30,'minimumReserveBytes':0,
                  'maximumFileBytes':4096,'maximumCopiedBytes':4096}}
            with patch.object(p,'verify_build'):
                report=p.collect(plan,build,root/'evidence')
            self.assertEqual(report['status'],'incomplete-required-files')
            self.assertFalse(report['completeSbom']);self.assertFalse(report['packageBound'])
            row=report['files'][0];self.assertEqual(p.r.digest(root/'evidence'/row['blob']),row['sha256'])

    def test_budget_and_alias_fail_preserve_receipt(self):
        for kind in ['budget','alias']:
            with tempfile.TemporaryDirectory() as td:
                root=Path(td);build=root/'build';build.mkdir();(build/'original').write_text('large')
                if kind=='alias':(build/'input').symlink_to('original')
                else:(build/'input').write_text('large')
                plan={'nextBuildId':'new','requiredFiles':[{'path':'input'}],'identityOnlyFiles':[],
                      'budgets':{'collectionSeconds':30,'minimumReserveBytes':0,'maximumFileBytes':1,'maximumCopiedBytes':1}}
                with patch.object(p,'verify_build'),self.assertRaises(ValueError):p.collect(plan,build,root/'evidence')
                self.assertEqual(json.loads((root/'evidence/receipt.json').read_text())['status'],'failed-bounded-collection')

    def bound(self):
        b={'nextBuildId':'new','normalBuildExitCode':0,'mapComparison':'exact-final-bytes-equal'}
        s={'nextBuildId':'new','runtimeSha256':'a'*64};a={'nextBuildId':'new','applicationSha256':'b'*64}
        k={'nextBuildId':'new','runtimeReceiptSha256':p.canonical(s),'applicationReceiptSha256':p.canonical(a),
           'payloadBytesVerified':True,'originsVerified':True,'packageSha256':'c'*64}
        return b,s,a,k

    def test_lineage_not_a_license_pass(self):
        result=p.bind_next_package(*self.bound())
        self.assertFalse(result['completeSbom']);self.assertFalse(result['oldPackageProvenanceSubstitutionAllowed'])

    def test_old_package_missing_map_or_tampered_origin_rejected(self):
        for kind in ['old','map','payload','runtime','app']:
            b,s,a,k=self.bound()
            if kind=='old':k['nextBuildId']='old'
            elif kind=='map':b['mapComparison']='not-run'
            elif kind=='payload':k['payloadBytesVerified']=False
            elif kind=='runtime':k['runtimeReceiptSha256']='0'*64
            else:k['applicationReceiptSha256']='0'*64
            with self.subTest(kind=kind),self.assertRaises(ValueError):p.bind_next_package(b,s,a,k)

    def test_source_alias_and_input_mutation_rejected(self):
        with tempfile.TemporaryDirectory() as td:
            root=Path(td);(root/'real').write_text('exact');(root/'alias').symlink_to('real')
            plan={'nextBuildId':'new','sourceRoot':str(root),'sourceArchiveSha256':'a','patchSha256':'b'}
            receipt={**plan,'status':'official-source-and-patch-bytes-checked',
                     'files':{'real':p.r.digest(root/'real')},'aliases':{'alias':'real'}}
            p.verify_source(plan,receipt)
            (root/'real').write_text('changed')
            with self.assertRaises(ValueError):p.verify_source(plan,receipt)
            (root/'real').write_text('exact');(root/'alias').unlink();(root/'alias').symlink_to('/etc/passwd')
            with self.assertRaises(ValueError):p.verify_source(plan,receipt)

    def test_build_cli_never_executes_without_explicit_switch(self):
        with tempfile.TemporaryDirectory() as td:
            root=Path(td)
            z=subprocess.run([sys.executable,str(Path(p.__file__)),'build',str(root/'absent-plan'),str(root/'output')],
                             capture_output=True,text=True,timeout=5)
            self.assertNotEqual(z.returncode,0)
            self.assertIn('No implicit build',z.stderr)
            self.assertFalse((root/'output').exists())


if __name__=='__main__':unittest.main()
