"""Offline review of every retained PDF, including a case stopped by a gate.

This does not change native acceptance or infer unexecuted cases. It keeps
identity, content, repeated headers and known text/link gaps separate.
"""
import argparse
import hashlib
import json
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
BASE = HERE.parent / 'pdf-pagination-mechanism-20261116'
sys.path.insert(0, str(BASE))
sys.path.insert(0, str(BASE / 'support'))
import contract
import calibrate


def review(root):
    native_report = json.loads((root / 'native-diagnostic.json').read_text())
    output = {'nativeStatus': native_report['status'],
              'nativeError': native_report.get('error'),
              'harnessSha': native_report['harnessSha'],
              'productAcceptancePassed': False, 'cases': []}
    for folder in sorted(root.glob('observed-*')):
        if not folder.is_dir():
            continue
        row = {'case': folder.name.removeprefix('observed-'),
               'reviewErrors': []}
        output['cases'].append(row)
        try:
            capture = json.loads((folder / 'process-capture.json').read_text())
            assert capture['status'] == 'kernel-sender-bound'
            assert capture['threadsStopped']
            native = json.loads((folder / 'native-result.json').read_text())
            assert native['status'] == 'pdf-received'
            assert native['guardianExit'] == 0 and native['privateRemoved']
            web = [p for p in capture['processes'].values()
                   if p['image'].endswith('/WebKitWebProcess')]
            assert len(web) == 1
            web, = web
            assert (web['noNewPrivs'], web['seccomp'], web['capEff']) == (1, 2, 0)
            lines = [line for line in (folder / 'native.log').read_text().splitlines()
                     if line.startswith(contract.PREFIX)]
            assert len(lines) == len(capture['records'])
            for line, receipt in zip(lines, capture['records']):
                assert (receipt['pid'], receipt['pidfdId'], receipt['uid']) == (
                    web['pid'], web['pidfdId'], web['uid'])
                assert receipt['sha256'] == hashlib.sha256((line + '\n').encode()).hexdigest()
            row['identity'] = {key: web[key] for key in (
                'pid', 'birth', 'pidfdId', 'uid', 'noNewPrivs', 'seccomp',
                'capEff', 'image', 'lineage', 'libraries')}
            row['kernelBoundRecords'] = len(lines)
            row['normalExit'] = native['guardianExit'] == 0
            row['privateRemoved'] = native['privateRemoved']
            row['nativeElapsedMs'] = native['elapsedMs']
            row['collectorErrorsOutsideWindow'] = [e for e in capture['errors']
                                                   if e['phase'] != 'window']
        except Exception as error:
            row['reviewErrors'].append('identity: ' + repr(error))
        try:
            audit = json.loads((folder / 'pagination-audit.json').read_text())
            row['contentErrors'] = audit['errors']
            row['papers'] = []
            for paper in audit['papers']:
                pdf = folder / (paper['name'] + '.pdf')
                native = json.loads((folder / 'native-result.json').read_text())
                assert hashlib.sha256(pdf.read_bytes()).hexdigest() == native['pdfSha256']
                headers = calibrate.header_contract(paper, pdf)
                positions = {}
                for page_number, page in enumerate(paper['pages'], 1):
                    for word in page['words']:
                        if word['text'] in ['TABLESECTION', 'TABLELEFT', 'TABLERIGHT', 'TAA']:
                            positions.setdefault(word['text'], []).append(
                                {'page': page_number, 'box': word['box']})
                parsed = contract.parse((folder / 'native.log').read_text(), len(paper['pages']))
                row['papers'].append({
                    'name': paper['name'], 'pages': len(paper['pages']),
                    'words': sum(len(page['words']) for page in paper['pages']),
                    'pdfSha256': hashlib.sha256(pdf.read_bytes()).hexdigest(),
                    'positions': positions, 'groups': paper['groups'],
                    'headers': headers, 'observations': contract.observations(parsed),
                    'mappingDiagnostics': paper.get('mappingDiagnostics'),
                    'uriAnnotations': paper.get('uriAnnotations'),
                    'renderedGuards': len(paper.get('renderedGuards', []))})
        except Exception as error:
            row['reviewErrors'].append('pdf: ' + repr(error))
    return output


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('root', type=pathlib.Path)
    parser.add_argument('output', type=pathlib.Path)
    args = parser.parse_args()
    result = review(args.root)
    args.output.write_text(json.dumps(result, indent=2, ensure_ascii=False) + '\n')
    print(json.dumps({'nativeStatus': result['nativeStatus'],
                      'cases': [{'case': r['case'], 'reviewErrors': r['reviewErrors'],
                                 'contentErrors': r.get('contentErrors'),
                                 'headerErrors': [p['headers']['errors'] for p in r.get('papers', [])]}
                                for r in result['cases']]}, ensure_ascii=False))
