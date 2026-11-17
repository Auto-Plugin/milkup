import gzip
import io
import json
import unittest
import zipfile
import capture_support as s

class Support(unittest.TestCase):
    def test_graph_keeps_real_variables_and_drops_escaped_unknown_output(self):
        rows=s.graph_records('build a.o: CXX_COMPILER__ /source/a.cpp | x.h || order\n  DEP_FILE = a.o.d\nbuild bad$ name: CUSTOM_COMMAND x\n')
        self.assertEqual(len(rows),1)
        self.assertEqual(rows[0]['inputs'],['/source/a.cpp','x.h'])
        self.assertEqual(rows[0]['variables'],{'DEP_FILE':'a.o.d'})
    def test_parts_identity_rejects_corruption(self):
        for corrupt in [False,True]:
            raw=b'exact graph';stored=gzip.compress(raw)
            part={'file':'build.ninja.part-000.gz','storedBytes':len(stored),'storedSha256':s.sha(stored),
                  'rawBytes':len(raw),'rawSha256':s.sha(raw)}
            manifest={'encoding':'ordered-gzip-parts','rawBytes':len(raw),'rawSha256':s.sha(raw),'parts':[part]}
            buf=io.BytesIO()
            with zipfile.ZipFile(buf,'w') as z:
                z.writestr('graph/build.ninja.parts.json',json.dumps(manifest))
                z.writestr('graph/'+part['file'],stored+b'changed' if corrupt else stored)
            with zipfile.ZipFile(io.BytesIO(buf.getvalue())) as z:
                if corrupt:
                    with self.assertRaises(ValueError):s.restore_parts(z,'build.ninja')
                else:self.assertEqual(s.restore_parts(z,'build.ninja'),raw)

if __name__=='__main__':unittest.main()
