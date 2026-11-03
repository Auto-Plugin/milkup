"""Replay all three original artifacts; delivery ZIP and official 7zz stay external."""
import argparse
import hashlib
from pathlib import Path
import subprocess
import sys

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--repo', required=True)
parser.add_argument('--delivery-zip', required=True)
parser.add_argument('--sevenzip', required=True)
parser.add_argument('--output', required=True)
args = parser.parse_args()
root = Path(__file__).resolve().parent
archiver = Path(args.sevenzip)
if not archiver.is_file() or archiver.is_symlink() or hashlib.sha256(archiver.read_bytes()).hexdigest() != 'd32657a7a0e4cdc0a8aa57cafe474746944d76e861e753e9c902b9c9356fa886':
    raise SystemExit('The exact verified official 7-Zip 26.05 Linux x64 executable is required')
command = [sys.executable, str(root / 'verifier/verify_installed_dual.py'),
    '--candidate', 'a5556beea5cdd1570361c528b2326bc0ad8ba0c4',
    '--version', '2.0.0-beta.9', '--run', '41713129442', '--attempt', '1',
    '--repo', args.repo, '--harness', str(root / 'candidate-mermaid-product-e2e.mjs'),
    '--harness-provenance', str(root / 'harness-exact-windows-checkout-provenance.json'),
    '--sevenzip', str(archiver.resolve()), '--output', args.output,
    '--delivery-api', str(root / 'delivery-artifact-api.json'), '--delivery-zip', args.delivery_zip]
for role, name in [('installed', 'mermaid-installed-evidence-41713129442-1.zip'),
                   ('inspection', 'mermaid-installer-inspection-41713129442-1.zip')]:
    command.extend(['--' + role + '-api', str(root / (role + '-artifact-api.json')),
                    '--' + role + '-zip', str(root / name)])
raise SystemExit(subprocess.run(command, check=False).returncode)
