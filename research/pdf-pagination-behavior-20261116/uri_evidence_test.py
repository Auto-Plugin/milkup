import hashlib,importlib.util,json,pathlib,tempfile,unittest,zipfile
import fitz
HERE=pathlib.Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('pagination_uri_test',HERE.parent/'pdf-pagination-mechanism-20261116/support/pagination_audit.py');audit=importlib.util.module_from_spec(spec);spec.loader.exec_module(audit)

class UriEvidence(unittest.TestCase):
    def test_original_native_pdf_completes_unchanged_full_pagination_audit(self):
        archive=HERE.parent/'pdf-combined-20261116/evidence/43829429928/native-original.zip'
        with tempfile.TemporaryDirectory()as d,zipfile.ZipFile(archive)as z:
            root=pathlib.Path(d)
            for name in ['a4-portrait.pdf','complex-pagination.md','expectations.json']:
                (root/name).write_bytes(z.read('observed-baseline-baseline/'+name))
            pdf=root/'a4-portrait.pdf';before=hashlib.sha256(pdf.read_bytes()).hexdigest()
            self.assertEqual(before,'6b389ac7330a3b4a41c049e681752a751a344555de65ea1ffd93dcfefb554825')
            with fitz.open(pdf)as doc:
                links=[dict(link,page=i+1)for i,page in enumerate(doc)for link in page.get_links()if link.get('uri')]
                self.assertEqual(len(links),1)
                with self.assertRaises(TypeError):json.dumps(links)
            self.assertFalse(audit.audit(root))
            report=json.loads((root/'pagination-audit.json').read_text())
            self.assertEqual(report['errors'],[]);self.assertEqual(len(report['papers'][0]['pages']),8)
            self.assertTrue(all(r['exact']for r in report['papers'][0]['mappingDiagnostics']))
            self.assertEqual(report['papers'][0]['uriAnnotations'],[dict(links[0],**{'from':list(links[0]['from'])})])
            from behavior_contract import assess_pdf
            self.assertTrue(assess_pdf(report,pdf)['paginationPassed'])
            self.assertEqual(before,hashlib.sha256(pdf.read_bytes()).hexdigest())

    def test_actual_reader_rectangle_survives_json_without_losing_fields(self):
        with tempfile.TemporaryDirectory()as d:
            path=pathlib.Path(d)/'links.pdf'
            with fitz.open()as doc:
                page=doc.new_page();page.insert_text((50,50),'LINK')
                page.insert_link({'kind':fitz.LINK_URI,'from':fitz.Rect(50,35,80,55),'uri':'https://example.invalid/a'})
                doc.save(path)
            with fitz.open(path)as doc:
                link,=doc[0].get_links()
                with self.assertRaises(TypeError):json.dumps(dict(link,page=1))
                result=audit.uri_annotation(link,1)
                self.assertEqual(json.loads(json.dumps(result)),dict(link,page=1,**{'from':list(link['from'])}))
                self.assertIsInstance(link['from'],fitz.Rect)

    def test_unknown_or_invalid_evidence_is_not_silently_dropped(self):
        base={'kind':fitz.LINK_URI,'from':fitz.Rect(1,2,3,4),'uri':'https://example.invalid/a','xref':12,'id':'link-0'}
        for change in [{'from':fitz.Rect(0,0,0,0)},{'from':[1,2,3,4]},{'uri':''},{'kind':fitz.LINK_GOTO},{'unrecognized':object()},{'unexpectedNumber':float('nan')}]:
            with self.assertRaises((AssertionError,ValueError,TypeError)):audit.uri_annotation(dict(base,**change),1)
        for page in [0,-1,'1']:
            with self.assertRaises(AssertionError):audit.uri_annotation(base,page)

if __name__=='__main__':unittest.main()
