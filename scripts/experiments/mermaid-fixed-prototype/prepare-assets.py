#!/usr/bin/env python3
"""Stage an exact existing official package; no install, build, network or plugin execution."""
import hashlib
import json
from pathlib import Path
import sys

package = Path(sys.argv[1]).resolve(strict=True)
assert json.loads((package / 'package.json').read_text())['version'] == '12.2.0'
source = package / 'dist/mermaid.min.js'
blob = source.read_bytes()
expected = 'a8a6a6f805b074a8261a2825c86f99c8054acb3b35f50bb7e24a4f9f2c3c3b9f'
assert len(blob) == 5494801 and hashlib.sha256(blob).hexdigest() == expected
root = Path(__file__).resolve().parent
(root / 'assets').mkdir(exist_ok=True)
(root / 'assets/mermaid-12.2.0.min.js').write_bytes(blob)
(root / 'assets/MERMAID-LICENSE').write_bytes((package / 'LICENSE').read_bytes())
print(json.dumps({'version': '12.2.0', 'bytes': len(blob), 'sha256': expected,
                  'stageOnly': True, 'dependenciesInstalled': False,
                  'upstreamEmbeddedNotices': True}))
