import copy,importlib.util,pathlib,types,unittest
from unittest.mock import patch
HERE=pathlib.Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('noto_audit_test',HERE/'noto_map_audit.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class Ref(dict):
 def get_object(self):return self
def reader(value,wrong=None):
 rows=[f'<{i:02x}> <{value+i if value else 0:04x}>'for i in range(10)]
 if wrong=='missing':rows.pop()
 if wrong=='duplicate':rows.append(rows[0])
 raw='10 beginbfchar\n'+'\n'.join(rows)+'\nendbfchar'
 if wrong=='array':raw+='\n1 beginbfrange\n<10> <11> [<0030> <0031>]\nendbfrange'
 f=Ref({'/Encoding':{'/Differences':[0]+[f'/g{g:x}'for g in range(63153,63163)]},'/ToUnicode':types.SimpleNamespace(get_data=lambda:raw.encode())})
 return types.SimpleNamespace(pages=[{'/Resources':{'/Font':{'/F1':f}}}])
class NotoMap(unittest.TestCase):
 def test_same_run_zero_to_exact_digits(self):
  with patch.object(m,'PdfReader',side_effect=lambda p:reader(0 if p.stem=='digit-baseline' else 48)):
   self.assertEqual(m.audit(pathlib.Path('/synthetic'))['status'],'passed-ten-Noto-mappings-only')
 def test_missing_duplicate_unsupported_and_wrong_candidate_rejected(self):
  for error in ['missing','duplicate','array']:
   with self.subTest(error=error),patch.object(m,'PdfReader',return_value=reader(48,error)),self.assertRaises(AssertionError):m.mappings(None)
  with patch.object(m,'PdfReader',side_effect=lambda p:reader(0 if p.stem=='digit-baseline' else 49)),self.assertRaises(AssertionError):m.audit(pathlib.Path('/synthetic'))
if __name__=='__main__':unittest.main()
