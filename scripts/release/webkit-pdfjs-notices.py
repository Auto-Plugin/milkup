"""Prepare/verify a limited notice payload; never approve or install a runtime.

No network, package-manager, ELF execution, or guessed license expressions.
This gate deliberately covers only five byte-locked PDF.js resources.
"""
import argparse
import hashlib
import json
from pathlib import Path
import stat

ASSETS = {
    "web/standard_fonts/LiberationSans-Regular.ttf": "f8ace1f892b2bd9dc1792ba7f097fa7588f84fed48321480e04de5390828221f",
    "web/standard_fonts/LiberationSans-Italic.ttf": "832b4406dbef23628800d3aaad21048534ac84d7e3ad955be83b8172ed8ef512",
    "web/standard_fonts/LiberationSans-Bold.ttf": "361c61b82d575c5c35fd9157fda8b0194bcfcd0d88ea8521a4fb5dd53d33dddc",
    "web/standard_fonts/LiberationSans-BoldItalic.ttf": "a224075ac17495ad0a3af3bc0a419ac0704a8b3fd1095456201fb9b095fc281d",
    "web/wasm/quickjs-eval.js": "fe7930418e869791ce892567dbd0bc4698152b7e550b5cefa553992c56ddc325",
}
NOTICES = {
    "LICENSE_LIBERATION": "d2c4d5b3e115a519cb58eb691aa64538397e2611f9ebe801392cf9667997e7dc",
    "LICENSE_QUICKJS": "598fd7fc928e4350abce36e337ba5a1346923c5c692f5be92c3d8e29ddd7c18d",
    "LICENSE_PDFJS_QUICKJS": "7fdaed3d938f3dfce7189db07e74773c23789143a55db81a95d09dcbfda267b0",
}
HERE = Path(__file__).with_suffix("")
STATUS = "limited-pdfjs-notices-verified-not-runtime-or-release-approval"


def digest(data):
    return hashlib.sha256(data).hexdigest()


def read_regular(root, relative, limit):
    root = Path(root).absolute()
    path = root
    if root.is_symlink() or not root.is_dir():
        raise ValueError("Real directory required")
    for part in Path(relative).parts:
        if part in ("", ".", "..") or Path(relative).is_absolute():
            raise ValueError("Invalid relative path")
        path = path / part
        if path.is_symlink():
            raise ValueError("Symlink input rejected")
    info = path.stat()
    if not stat.S_ISREG(info.st_mode) or info.st_size > limit:
        raise ValueError("Bounded regular file required")
    with path.open("rb") as stream:
        data = stream.read(limit + 1)
    if len(data) > limit or len(data) != info.st_size:
        raise ValueError("Input changed or exceeded its budget")
    return data


def collect(pdfjs_root, notices_root=HERE):
    assets = []
    for relative, expected in ASSETS.items():
        data = read_regular(pdfjs_root, relative, 256 * 1024)
        if digest(data) != expected:
            raise ValueError("Unreviewed PDF.js resource: " + relative)
        assets.append({"path": relative, "sha256": expected, "bytes": len(data)})
    notices = {}
    for name, expected in NOTICES.items():
        data = read_regular(notices_root, name, 64 * 1024)
        if digest(data) != expected:
            raise ValueError("Notice identity mismatch: " + name)
        notices[name] = data
    manifest = {
        "schemaVersion": 1,
        "status": STATUS,
        "assets": assets,
        "notices": [{"path": name, "sha256": digest(data), "bytes": len(data)}
                    for name, data in notices.items()],
        "completeSbom": False,
        "runtimeIdentityVerified": False,
        "installedPayloadVerified": False,
        "legalApproval": False,
    }
    return manifest, notices


def prepare(pdfjs_root, output, notices_root=HERE):
    manifest, notices = collect(pdfjs_root, notices_root)
    output = Path(output)
    # A fresh directory is required; never overwrite an existing package/report.
    output.mkdir(mode=0o755, parents=False, exist_ok=False)
    for name, data in notices.items():
        with (output / name).open("xb") as stream:
            stream.write(data)
        (output / name).chmod(0o644)
    with (output / "manifest.json").open("x", encoding="utf-8") as stream:
        json.dump(manifest, stream, indent=2)
        stream.write("\n")
    (output / "manifest.json").chmod(0o644)
    return verify(pdfjs_root, output, notices_root)


def verify(pdfjs_root, output, notices_root=HERE):
    expected, notices = collect(pdfjs_root, notices_root)
    output = Path(output)
    if output.is_symlink() or not output.is_dir():
        raise ValueError("Real notice payload directory required")
    if {p.name for p in output.iterdir()} != set(NOTICES) | {"manifest.json"}:
        raise ValueError("Extra or missing notice payload")
    actual = json.loads(read_regular(output, "manifest.json", 64 * 1024))
    if actual != expected:
        raise ValueError("Notice manifest mismatch or unsupported approval claim")
    for name, data in notices.items():
        if read_regular(output, name, 64 * 1024) != data:
            raise ValueError("Prepared notice bytes mismatch: " + name)
    return expected


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("prepare", "verify"))
    parser.add_argument("pdfjs_root", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    result = (prepare if args.action == "prepare" else verify)(args.pdfjs_root, args.output)
    print(json.dumps(result, indent=2))
