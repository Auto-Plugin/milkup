"""Archive security tests; not runtime installation or native acceptance."""
import copy
import hashlib
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest

import runtime_intake as r


class Intake(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='intake-contract-')
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.prefix = '/opt/milkup/runtime-qa/fixture'
        self.name = self.prefix[1:]+'/lib/example.so.0.1'
        self.body = b'explicit archive fixture, not ELF'
        self.rows = [{'path':self.name,'kind':'file','mode':0o644,'bytes':len(self.body),'sha256':hashlib.sha256(self.body).hexdigest()},
                     {'path':str(Path(self.name).with_name('example.so.0')),'kind':'symlink','target':'example.so.0.1'}]

    def fixture(self, mutate=None):
        rows = copy.deepcopy(self.rows)
        buf = io.BytesIO()
        with tarfile.open(fileobj=buf,mode='w:gz') as archive:
            for row in rows:
                member = tarfile.TarInfo(row['path'])
                if row['kind']=='file':member.size=len(self.body);member.mode=row['mode']
                else:member.type=tarfile.SYMTYPE;member.linkname=row['target'];member.mode=0o777
                if mutate:mutate(member,row)
                archive.addfile(member,io.BytesIO(self.body) if member.isfile() else None)
        p = self.root/'fixture.tar.gz';p.write_bytes(buf.getvalue())
        manifest = ''.join('/'+x['path']+'\n' for x in rows).encode()
        receipt = {'scope':r.SCOPE,'prefix':self.prefix,'runtimeBytesIncluded':True,'objectCheckpoint':False,'files':rows,'archive':{'bytes':p.stat().st_size,'sha256':r.digest(p)},'installManifestSha256':hashlib.sha256(manifest).hexdigest()}
        return p,receipt,manifest

    def test_real_read_only_library_and_local_alias_extract(self):
        p,receipt,m=self.fixture();out=self.root/'out'
        self.assertEqual(r.extract(p,receipt,m,self.prefix,out),len(self.body))
        self.assertEqual((out/self.name).stat().st_mode&0o777,0o644)
        self.assertEqual((out/self.rows[1]['path']).read_bytes(),self.body)
        with self.assertRaisesRegex(ValueError,'Fresh'):r.extract(p,receipt,m,self.prefix,out)

    def test_real_cmake_pax_path_and_fractional_timestamp_are_bound(self):
        def exact(m,row):m.pax_headers.update({'path':row['path'],'mtime':'1794858531.0'})
        p,receipt,manifest=self.fixture(exact)
        self.assertEqual(r.extract(p,receipt,manifest,self.prefix,self.root/'pax'),len(self.body))

    def test_archive_hash_and_per_file_hash_fail_closed(self):
        p,receipt,m=self.fixture();receipt['archive']['sha256']='0'*64
        with self.assertRaisesRegex(ValueError,'Archive hash'):r.extract(p,receipt,m,self.prefix,self.root/'bad')
        self.assertFalse((self.root/'bad').exists())
        receipt['archive']['sha256']=r.digest(p);receipt['files'][0]['sha256']='0'*64
        with self.assertRaisesRegex(ValueError,'Extracted file identity'):r.extract(p,receipt,m,self.prefix,self.root/'bad')

    def test_path_link_type_mode_and_pax_fail_before_writing(self):
        for label,change in [
            ('parent',lambda m,row:setattr(m,'name','../escape')),
            ('absolute',lambda m,row:setattr(m,'name','/escape')),
            ('mode',lambda m,row:setattr(m,'mode',0o777) if m.isfile() else None),
            ('hardlink',lambda m,row:setattr(m,'type',tarfile.LNKTYPE) if m.issym() else None),
            ('linkescape',lambda m,row:setattr(m,'linkname','../../escape') if m.issym() else None),
            ('pax',lambda m,row:m.pax_headers.update({'comment':'unexpected'}))]:
            with self.subTest(label=label):
                p,receipt,manifest=self.fixture(change)
                out=self.root/label
                with self.assertRaises(ValueError):r.extract(p,receipt,manifest,self.prefix,out)
                self.assertFalse(out.exists())

    def test_manifest_missing_duplicate_and_wrong_prefix(self):
        for label in ['missing','duplicate','prefix','kind']:
            p,receipt,m=self.fixture()
            if label=='missing':receipt['files'].pop()
            if label=='duplicate':receipt['files'].append(receipt['files'][0])
            if label=='prefix':receipt['prefix']='/opt/other'
            if label=='kind':receipt['objectCheckpoint']=True
            with self.subTest(label=label),self.assertRaises(ValueError):r.extract(p,receipt,m,self.prefix,self.root/label)

    def test_entrypoint_rejects_wrong_artifacts_before_output(self):
        p,_,_=self.fixture()
        with self.assertRaisesRegex(ValueError,'Pinned runtime'):r.consume(p,p,self.root/'forbidden')
        self.assertFalse((self.root/'forbidden').exists())


if __name__=='__main__':unittest.main()
