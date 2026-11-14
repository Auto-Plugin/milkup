#!/usr/bin/env python3
import json,sys
from pathlib import Path
from common import digest

def generate(root):
    m=json.loads((root/'archive-manifest.json').read_text())
    lines=['# P7 milestone02 evidence archive','', 'The manifest records every preserved file SHA-256 and original path. Large synthetic Markdown fixtures and JSON/log files use deterministic lossless gzip; original byte counts and hashes remain verifiable. Raw failures are retained. This index records provenance, not a declaration that every acceptance target passed.', '', 'Excluded categories: application ELF/build artifacts, dependencies, runtime profiles, hidden recovery work files, diagnostic and public plugin archives, SDK tgz, generated plugin.js and sensitive filenames. Source and hash/build metadata remain. The complete final browser suite passed 197/197; prior full-suite failure and zero-case invocation records are preserved and not reclassified. The source evidence is not removed or modified.', '', '| Archived path | Bytes | Original bytes | SHA-256 |', '| --- | ---: | ---: | --- |']
    for e in m['entries']: lines.append(f"| [{e['path']}]({e['path']}) | {e['archiveBytes']} | {e['originalBytes']} | `{e['archiveSha256']}` |")
    (root/'ARCHIVE-INDEX.md').write_text('\n'.join(lines)+'\n')
    checks={name:{'bytes':digest(root/name)[0],'sha256':digest(root/name)[1]} for name in ['archive-manifest.json','ARCHIVE-INDEX.md']}
    (root/'archive-metadata-checksums.json').write_text(json.dumps(checks,indent=2)+'\n')
if __name__=='__main__': generate(Path(sys.argv[1]))
