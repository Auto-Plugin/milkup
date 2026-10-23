#!/usr/bin/env python3
"""Verify and extract beta.7 embedded frontend bytes without executing Windows code.

Adapted from the archived beta.6 extraction-tool/extract-embedded.py; all extraction bounds and image gates retained.
Requires Python 3.9+ with lzma and the system libbrotlidec.so.1 shared library.
No downloads, subprocesses, installer execution, or GUI/runtime acceptance.
"""

import argparse
import ctypes
import hashlib
import json
import lzma
import os
from pathlib import Path, PurePosixPath
import re
import stat
import struct
import sys
from html.parser import HTMLParser


VERSION = "2.0.0-beta.7"
BASELINE = "cc2cfc1d44b937e56cfcbd6e8f3cdcf3ded10189"
FORMATTING_ARCHIVE_HASHES = {
    "4bce37c68e9cce6a93f8f3b416e7fb77bf0459bd45dca95111a6b554003d6b8f",
    "1a69786b8443c4eb534ccc22fa221219d914792e74fdc4e95fe1b2adcc9967d9",
}
FORMATTING_ENTRY_SHA256 = "842275d01961e8cb5053e402b34760dda6453b7eeca983db3fdb23685ec875db"
MIB = 1024 * 1024
MAX_JSON = 8 * MIB
MAX_INSTALLER = 49 * MIB
MAX_APPLICATION = 64 * MIB
MAX_NSIS_STREAM = 96 * MIB
MAX_LZMA_MEMORY = 128 * MIB
MAX_ASSET_COMPRESSED = 8 * MIB
MAX_ASSET_DECODED = 16 * MIB
MAX_ASSET_TOTAL = 64 * MIB
MAX_ASSETS = 256
MAX_KEY_CANDIDATES = 4096
MAX_POINTER_HITS = 4096
MAX_DECODE_ATTEMPTS = 512
MAX_HASH_INPUT = 512 * MIB
NSIS_SIGNATURE = b"\xef\xbe\xad\xdeNullsoftInst"
NSIS_MARKER = b"__TAURI_BUNDLE_TYPE_VAR_NSS"
COMPILED_MARKER = b"__TAURI_BUNDLE_TYPE_VAR_UNK"
ASSET_PATTERN = rb"/(?:assets/[A-Za-z0-9][A-Za-z0-9_.-]*|index\.html)"


class EvidenceError(ValueError):
    pass


def require(condition, message):
    if not condition:
        raise EvidenceError(message)


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def bounded_integer(value, maximum, label, minimum=1):
    require(type(value) is int and minimum <= value <= maximum, f"Invalid {label}")
    return value


def run_id(value):
    require(
        type(value) in (str, int)
        and re.fullmatch(r"[1-9][0-9]{0,18}", str(value)) is not None,
        "Run ID must be a positive decimal integer",
    )
    return bounded_integer(int(value), (1 << 63) - 1, "run ID")


def expected_commit(value):
    require(re.fullmatch(r"[0-9a-fA-F]{40}", value) is not None, "Expected commit must be 40 hex digits")
    return value.lower()


def digest(value, label):
    require(type(value) is str and re.fullmatch(r"[0-9a-f]{64}", value) is not None, f"Invalid {label}")
    return value


def read_regular(path, maximum):
    path = Path(path)
    require(stat.S_ISREG(path.lstat().st_mode), f"Not a regular file: {path}")
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0)
    fd = os.open(path, flags)
    with os.fdopen(fd, "rb") as handle:
        before = os.fstat(handle.fileno())
        require(stat.S_ISREG(before.st_mode), f"Not a regular file: {path}")
        require(0 < before.st_size <= maximum, f"File size outside bound: {path}")
        data = handle.read(maximum + 1)
        after = os.fstat(handle.fileno())
    require(len(data) == before.st_size, f"File size changed while reading: {path}")
    require(
        (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns)
        == (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns),
        f"File changed while reading: {path}",
    )
    return data


def no_duplicate_keys(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, f"Duplicate JSON key: {key}")
        result[key] = value
    return result


def read_json(path):
    data = read_regular(path, MAX_JSON)
    value = json.loads(data.decode("utf-8-sig"), object_pairs_hook=no_duplicate_keys)
    require(type(value) is dict, f"Expected JSON object: {path}")
    return data, value


def safe_relative_file(root, name):
    require(type(name) is str and 0 < len(name) <= 240, "Invalid installer deliveredName")
    require("\\" not in name and ":" not in name and "\x00" not in name, "Unsafe installer path")
    relative = PurePosixPath(name)
    require(not relative.is_absolute() and str(relative) == name, "Installer path must be canonical and relative")
    require(
        all(re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*", part) for part in relative.parts),
        "Unsafe installer path component",
    )
    current = root
    for part in relative.parts[:-1]:
        current = current / part
        require(stat.S_ISDIR(current.lstat().st_mode), "Installer parent must be a real directory")
    candidate = root.joinpath(*relative.parts)
    require(candidate.resolve(strict=True).is_relative_to(root), "Installer path escapes manifest directory")
    require(stat.S_ISREG(candidate.lstat().st_mode), "Installer must be a regular file, not a symlink")
    return candidate


def validate_record(record, label, maximum):
    require(type(record) is dict, f"Missing {label} record")
    bounded_integer(record.get("bytes"), maximum, f"{label} bytes")
    digest(record.get("sha256"), f"{label} SHA-256")
    require(record.get("productVersion") == VERSION, f"Unexpected {label} product version")
    require(record.get("signature") == "NotSigned", f"Unexpected {label} signature state")


def validate_evidence(manifest_path, verification_path, commit, expected_run):
    manifest_bytes, manifest = read_json(manifest_path)
    require(manifest.get("version") == VERSION, "Manifest version must be 2.0.0-beta.7")
    require(manifest.get("baseline") == BASELINE, "Unexpected manifest baseline")
    require(manifest.get("commit") == commit, "Manifest commit differs from expected commit")
    require(run_id(manifest.get("runId")) == expected_run, "Manifest run differs from expected run")
    require(manifest.get("status") == "built-for-user-manual-trial", "Unexpected manifest status")
    require(manifest.get("platform") == "windows-x86_64", "Unexpected manifest platform")
    require(manifest.get("installerExecuted") is False, "Manifest must state installerExecuted=false")
    require(manifest.get("guiImeAccepted") is False, "Manifest must state guiImeAccepted=false")
    require(manifest.get("payloadImageMatchesCheckedBinary") is False, "Manifest must distinguish the patched NSIS image")
    require(manifest.get("payloadImageMatchesExpectedNsisImage") is True, "Manifest NSIS image match did not pass")
    verification_bytes, verification = read_json(verification_path)
    require(verification.get("status") == "passed", "Download verification did not pass")
    require(verification.get("source") == commit, "Download verification source differs")
    require(run_id(verification.get("runId")) == expected_run, "Download verification run differs")
    require(verification.get("version") == VERSION, "Download verification version differs")
    require(verification.get("baseline") == BASELINE, "Download verification baseline differs")
    require(verification.get("sourceChecksPassed") is True, "Download verification source checks did not pass")
    require(verification.get("installerExecuted") is False, "Download verification must state installerExecuted=false")
    require(verification.get("guiAccepted") is False, "Download verification must state guiAccepted=false")
    require(verification.get("manifestSha256") == sha256(manifest_bytes), "Manifest byte hash differs from download verification")
    require(verification.get("plugins") == manifest.get("plugins"), "Download verification plugin inventory differs")
    plugins = manifest.get("plugins")
    require(type(plugins) is list, "Missing plugin inventory")
    formatting = [item for item in plugins if type(item) is dict and item.get("id") == "milkup.formatting"]
    require(len(formatting) == 1, "Expected exactly one Formatting archive")
    formatting = formatting[0]
    require(formatting.get("version") == "1.0.1" and formatting.get("host") == "worker" and
            formatting.get("sha256") in FORMATTING_ARCHIVE_HASHES, "Formatting viewport-loop fix archive was not reviewed")
    formatting_review = verification.get("formattingReview")
    require(type(formatting_review) is dict and formatting_review.get("viewportLoopFixVerified") is True and
            formatting_review.get("archiveSha256") == formatting["sha256"] and
            formatting_review.get("entryWithoutFirstSdkCommentSha256") == FORMATTING_ENTRY_SHA256,
            "Missing download verification of the Formatting viewport-loop fix")
    for key, maximum in (("installer", MAX_INSTALLER), ("application", MAX_APPLICATION), ("compiledApplication", MAX_APPLICATION)):
        validate_record(manifest.get(key), key, maximum)
        require(verification.get(key) == manifest[key], f"Download verification {key} record differs")
    require(manifest["application"]["bytes"] == manifest["compiledApplication"]["bytes"], "Application lengths differ")
    if "extractedApplication" in manifest:
        require(manifest["extractedApplication"] == manifest["application"], "Extracted application record differs")
    proof = manifest.get("nsisImageVerification")
    require(type(proof) is dict and proof.get("status") == "passed", "Missing passed NSIS image proof")
    require(proof.get("transform") == "tauri-cli-2.11.4-unique-UNK-to-NSS", "Unexpected NSIS transform")
    require(proof.get("compiledSha256") == manifest["compiledApplication"]["sha256"], "NSIS proof compiled hash differs")
    require(proof.get("expectedNsisSha256") == manifest["application"]["sha256"], "NSIS proof application hash differs")
    require(type(proof.get("changedBytes")) is int and proof["changedBytes"] == 3, "NSIS proof must describe exactly three changed bytes")
    bounded_integer(proof.get("markerOffset"), manifest["application"]["bytes"] - len(NSIS_MARKER), "NSIS marker offset", minimum=0)
    require(verification.get("nsisImageVerification") == proof, "Download verification NSIS proof differs")
    return manifest, verification, sha256(manifest_bytes), sha256(verification_bytes)


def unpack_nsis(installer, record):
    require(installer[:2] == b"MZ", "Installer lacks DOS magic")
    require(installer.count(NSIS_SIGNATURE) == 1, "Expected exactly one NSIS header signature")
    header_offset = installer.index(NSIS_SIGNATURE) - 4
    require(0 <= header_offset <= len(installer) - 33, "Truncated NSIS header or LZMA properties")
    payload = installer[header_offset + 28:]
    decoder = lzma.LZMADecompressor(format=lzma.FORMAT_ALONE, memlimit=MAX_LZMA_MEMORY)
    # NSIS omits the eight-byte unknown-size field from its solid LZMA stream.
    stream = decoder.decompress(payload[:5] + b"\xff" * 8 + payload[5:], max_length=MAX_NSIS_STREAM + 1)
    require(decoder.eof and len(stream) <= MAX_NSIS_STREAM, "NSIS stream incomplete or exceeds decompression bound")
    size = record["bytes"]
    matches = []
    hashed_bytes = 0
    for match in re.finditer(b"MZ", stream):
        start = match.start()
        if start + size > len(stream):
            continue
        hashed_bytes += size
        require(hashed_bytes <= MAX_HASH_INPUT, "NSIS candidate hash work exceeds bound")
        candidate = memoryview(stream)[start:start + size]
        if sha256(candidate) == record["sha256"]:
            matches.append(start)
    require(len(matches) == 1, "Expected exactly one NSIS application matching size and SHA-256")
    offset = matches[0]
    app = stream[offset:offset + size]
    return app, {
        "headerOffset": header_offset,
        "decompressedBytes": len(stream),
        "unusedTrailingBytes": len(decoder.unused_data),
        "applicationOffset": offset,
        "matchingApplications": 1,
    }


def reverse_bundle_marker(app, manifest):
    require(app.count(NSIS_MARKER) == 1, "Application must contain exactly one NSIS bundle marker")
    require(app.count(COMPILED_MARKER) == 0, "NSIS application unexpectedly contains a compiled bundle marker")
    offset = app.index(NSIS_MARKER)
    require(offset == manifest["nsisImageVerification"]["markerOffset"], "Actual bundle marker offset differs from NSIS proof")
    compiled = bytearray(app)
    compiled[offset:offset + len(NSIS_MARKER)] = COMPILED_MARKER
    changed = [i for i in range(offset, offset + len(NSIS_MARKER)) if app[i] != compiled[i]]
    require(len(changed) == 3 and len(compiled) == len(app), "Inverse bundle marker transform is not exactly three bytes")
    require(compiled.count(COMPILED_MARKER) == 1 and compiled.count(NSIS_MARKER) == 0, "Inverse transform did not restore a unique compiled marker")
    require(sha256(compiled) == manifest["compiledApplication"]["sha256"], "Inverse NSIS transform does not match compiled application SHA-256")
    return {"markerOffset": offset, "changedBytes": 3, "changedOffsets": changed, "compiledSha256": sha256(compiled)}


class PEImage:
    def __init__(self, data):
        self.data = data
        require(len(data) >= 64 and data[:2] == b"MZ", "Application lacks DOS header")
        pe = struct.unpack_from("<I", data, 60)[0]
        require(64 <= pe <= len(data) - 24 and data[pe:pe + 4] == b"PE\0\0", "Invalid PE header offset or signature")
        machine, count = struct.unpack_from("<HH", data, pe + 4)
        require(machine == 0x8664 and 1 <= count <= 96, "Expected bounded AMD64 PE sections")
        optional = pe + 24
        optional_size = struct.unpack_from("<H", data, pe + 20)[0]
        require(optional_size >= 112 and optional + optional_size <= len(data), "Truncated PE32+ optional header")
        require(struct.unpack_from("<H", data, optional)[0] == 0x20B, "Expected PE32+")
        self.base = struct.unpack_from("<Q", data, optional + 24)[0]
        table = optional + optional_size
        table_end = table + count * 40
        require(table_end <= len(data), "Truncated PE section table")
        self.sections = []
        for index in range(count):
            _, va, size, offset = struct.unpack_from("<4I", data, table + 40 * index + 8)
            if size == 0:
                continue
            require(table_end <= offset <= len(data) and size <= len(data) - offset, "PE raw section exceeds file bounds")
            require(va + size <= 1 << 32 and self.base + va + size <= 1 << 64, "PE virtual section address overflow")
            for old_va, old_offset, old_size in self.sections:
                require(offset + size <= old_offset or old_offset + old_size <= offset, "Overlapping PE raw sections")
                require(va + size <= old_va or old_va + old_size <= va, "Overlapping PE virtual sections")
            self.sections.append((va, offset, size))
        require(self.sections, "No file-backed PE sections")

    def file_offset(self, address, length):
        require(length > 0 and address >= self.base, "Invalid PE pointer range")
        rva = address - self.base
        for va, offset, size in self.sections:
            if va <= rva and length <= size and rva - va <= size - length:
                return offset + rva - va
        raise EvidenceError("PE pointer range is not contained in a raw section")

    def virtual_address(self, offset, length):
        require(length > 0, "Invalid PE raw range")
        for va, start, size in self.sections:
            if start <= offset and length <= size and offset - start <= size - length:
                return self.base + va + offset - start
        raise EvidenceError("PE raw range is not contained in a section")


class BrotliDecoder:
    def __init__(self):
        self.library = ctypes.CDLL("libbrotlidec.so.1")
        self.decode = self.library.BrotliDecoderDecompress
        self.decode.argtypes = [ctypes.c_size_t, ctypes.c_void_p, ctypes.POINTER(ctypes.c_size_t), ctypes.c_void_p]
        self.decode.restype = ctypes.c_int
        self.buffer = ctypes.create_string_buffer(MAX_ASSET_DECODED)

    def decompress(self, compressed):
        output_length = ctypes.c_size_t(MAX_ASSET_DECODED)
        source = ctypes.create_string_buffer(compressed)
        status = self.decode(len(compressed), source, ctypes.byref(output_length), self.buffer)
        if status != 1:
            return None
        require(output_length.value <= MAX_ASSET_DECODED, "Brotli output exceeds bound")
        return ctypes.string_at(self.buffer, output_length.value)


def extract_assets(app):
    pe = PEImage(app)
    decoder = BrotliDecoder()
    assets = {}
    records = []
    visited = set()
    key_candidates = pointer_hits = attempts = total = 0
    for match in re.finditer(ASSET_PATTERN, app):
        key_candidates += 1
        require(key_candidates <= MAX_KEY_CANDIDATES, "Asset key search exceeds bound")
        try:
            address = pe.virtual_address(match.start(), 1)
        except EvidenceError:
            continue
        for hit in re.finditer(re.escape(struct.pack("<Q", address)), app):
            pointer_hits += 1
            require(pointer_hits <= MAX_POINTER_HITS, "Asset pointer search exceeds bound")
            table_offset = hit.start()
            if table_offset in visited:
                continue
            visited.add(table_offset)
            try:
                pe.virtual_address(table_offset, 32)
                key_pointer, key_length, data_pointer, data_length = struct.unpack_from("<4Q", app, table_offset)
                if not 0 < key_length <= 200 or not 0 < data_length <= MAX_ASSET_COMPRESSED:
                    continue
                key_offset = pe.file_offset(key_pointer, key_length)
                compressed_offset = pe.file_offset(data_pointer, data_length)
                key = app[key_offset:key_offset + key_length].decode("ascii")
                if re.fullmatch(ASSET_PATTERN.decode("ascii"), key) is None:
                    continue
                # Rust's string pool need not terminate keys with NUL. The table's
                # bounded key_length, not the initial regex span, owns the key.
                if key_offset != match.start():
                    continue
            except (EvidenceError, UnicodeError, struct.error):
                continue
            attempts += 1
            require(attempts <= MAX_DECODE_ATTEMPTS, "Brotli candidate count exceeds bound")
            raw = decoder.decompress(app[compressed_offset:compressed_offset + data_length])
            if raw is None:
                continue
            require(key not in assets, f"Ambiguous duplicate embedded asset: {key}")
            require(len(assets) < MAX_ASSETS, "Embedded asset count exceeds bound")
            total += len(raw)
            require(total <= MAX_ASSET_TOTAL, "Decoded frontend total exceeds bound")
            assets[key] = raw
            records.append({"key": key, "bytes": len(raw), "sha256": sha256(raw), "peTableOffset": table_offset,
                            "compressedOffset": compressed_offset, "compressedBytes": data_length})
    require("/index.html" in assets, "Embedded index.html was not found")
    return assets, sorted(records, key=lambda record: record["key"])


class EntryScriptParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.module_sources = []
        self.base_seen = False

    def handle_starttag(self, tag, attrs):
        if tag == "base":
            self.base_seen = True
        if tag != "script":
            return
        keys = [name for name, _ in attrs]
        require(len(keys) == len(set(keys)), "Duplicate script attributes in index.html")
        values = dict(attrs)
        if (values.get("type") or "").strip().lower() == "module":
            self.module_sources.append(values.get("src"))


def frontend_markers(assets):
    html = assets["/index.html"].decode("utf-8")
    parser = EntryScriptParser()
    parser.feed(html)
    parser.close()
    require(not parser.base_seen, "Unexpected base URL in embedded index.html")
    require(len(parser.module_sources) == 1, "Expected exactly one module script in embedded index.html")
    source = parser.module_sources[0]
    require(type(source) is str, "Entry module must have a src attribute")
    normalized = source[2:] if source.startswith("./") else source.lstrip("/")
    require(not source.startswith("//") and re.fullmatch(r"assets/[A-Za-z0-9_.-]+\.js", normalized) is not None,
            "Entry script must be a local assets JavaScript path")
    key = "/" + normalized
    require(key in assets, f"Entry script referenced by index.html was not extracted: {key}")
    js = assets[key].decode("utf-8")
    # Required literal UI strings bind the extracted entry to the reviewed source.
    # Their presence establishes embedded bytes, never successful UI behavior.
    stable = ["data-application-update-action", "enableFromUserIntent", 'data-plugin-action="toggle"',
              "关于", "milkup-code-closing", "milkup-code-language", "document-toolbar",
              "data-editor-context-menu", "hostContextCommand", "floating-document-toolbar",
              "data-theme-import", "data-theme-open", "data-theme-reset",
              "appearance_theme_commit_candidate", "prefers-reduced-motion"]
    counts = {marker: js.count(marker) for marker in [VERSION, "2.0.0-beta.6", "2.0.0-beta.5", "2.0.0-beta.4", "2.0.0-beta.3", *stable]}
    require(counts[VERSION] >= 1, "Entry script lacks beta.7 version marker")
    require(counts["2.0.0-beta.6"] == counts["2.0.0-beta.5"] == counts["2.0.0-beta.4"] == counts["2.0.0-beta.3"] == 0, "Entry script contains an old beta version marker")
    for marker in stable:
        require(counts[marker] >= 1, f"Entry script lacks stable UI marker: {marker}")
    return key, source, counts


def write_exclusive(path, data):
    with path.open("xb") as handle:
        handle.write(data)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest_json", type=Path)
    parser.add_argument("new_output_directory", type=Path)
    parser.add_argument("--verification", required=True, type=Path, help="Passed download-verification JSON for this exact manifest")
    parser.add_argument("--expected-commit", required=True, help="Expected 40-hex source commit")
    parser.add_argument("--expected-run", required=True, help="Expected positive GitHub Actions run ID")
    args = parser.parse_args(argv)
    commit = expected_commit(args.expected_commit)
    expected_run = run_id(args.expected_run)
    require(not os.path.lexists(args.new_output_directory), "Output directory must be new")
    manifest, verification, manifest_hash, verification_hash = validate_evidence(
        args.manifest_json, args.verification, commit, expected_run
    )
    root = args.manifest_json.parent.resolve(strict=True)
    installer_path = safe_relative_file(root, manifest["installer"].get("deliveredName"))
    installer = read_regular(installer_path, MAX_INSTALLER)
    require(len(installer) == manifest["installer"]["bytes"], "Installer byte size differs from manifest")
    require(sha256(installer) == manifest["installer"]["sha256"], "Installer SHA-256 differs from manifest")
    app, nsis = unpack_nsis(installer, manifest["application"])
    inverse = reverse_bundle_marker(app, manifest)
    assets, asset_records = extract_assets(app)
    entry_key, entry_src, markers = frontend_markers(assets)
    proof = {
        "status": "passed", "verificationKind": "static-embedded-frontend-extraction",
        "source": commit, "runId": expected_run, "version": VERSION, "baseline": BASELINE,
        "manifestSha256": manifest_hash, "downloadVerificationSha256": verification_hash,
        "installer": manifest["installer"], "application": manifest["application"],
        "compiledApplication": manifest["compiledApplication"],
        "installerSha256": sha256(installer), "appSha256": sha256(app), "appBytes": len(app),
        "nsis": nsis, "inverseNsisTransform": inverse, "assets": asset_records,
        "entryScriptSrc": entry_src, "entryScript": entry_key, "markers": markers,
        "markerInterpretation": "Static string presence only; not behavior or runtime acceptance",
        "sourceChecksPassed": True,
        "installerExecuted": False, "windowsCodeExecuted": False, "windowsRuntimeAccepted": False,
        "guiAccepted": False, "guiImeAccepted": False, "realUpgradeRollback": "unverified",
        "limits": {"installerBytes": MAX_INSTALLER, "applicationBytes": MAX_APPLICATION,
                   "nsisStreamBytes": MAX_NSIS_STREAM, "lzmaMemoryBytes": MAX_LZMA_MEMORY,
                   "compressedAssetBytes": MAX_ASSET_COMPRESSED, "decodedAssetBytes": MAX_ASSET_DECODED,
                   "decodedAssetTotalBytes": MAX_ASSET_TOTAL, "assetCount": MAX_ASSETS,
                   "keyCandidates": MAX_KEY_CANDIDATES, "pointerHits": MAX_POINTER_HITS,
                   "brotliDecodeAttempts": MAX_DECODE_ATTEMPTS, "nsisCandidateHashBytes": MAX_HASH_INPUT},
        "method": "Read-only bounded NSIS solid-LZMA extraction; exact application size/SHA-256; unique three-byte NSS-to-UNK inverse transform matching the compiled SHA-256; bounded PE32+ pointer/length asset table and system Brotli decode; entry script resolved from embedded index.html. No installer or Windows code executed; not Windows runtime, GUI/IME, upgrade, or rollback acceptance.",
    }
    # Nothing is written until every identity, image, asset and frontend check passes.
    output = args.new_output_directory
    output.mkdir(parents=False, exist_ok=False)
    write_exclusive(output / "milkup-desktop.exe", app)
    frontend = output / "frontend"
    frontend.mkdir()
    for key, raw in sorted(assets.items()):
        destination = frontend / key.lstrip("/")
        destination.parent.mkdir(parents=True, exist_ok=True)
        write_exclusive(destination, raw)
    write_exclusive(output / "embedded-frontend-proof.json", (json.dumps(proof, ensure_ascii=False, indent=2) + "\n").encode("utf-8"))
    print(json.dumps({"status": "passed", "source": commit, "runId": expected_run,
                      "assetCount": len(assets), "entryScript": entry_key, "markers": markers,
                      "verificationKind": proof["verificationKind"], "windowsCodeExecuted": False},
                     ensure_ascii=False, indent=2))


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, lzma.LZMAError, struct.error, UnicodeError) as error:
        print(f"error: {error}", file=sys.stderr)
        sys.exit(1)
