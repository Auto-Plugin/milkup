#!/usr/bin/env python3
"""Offline, non-extracting verifier for one exact Windows account evidence ZIP.

Default inputs: artifacts.json and account.zip next to this script.
Prints JSON to stdout; exit 0 means retained-evidence verification only, never
Windows/product acceptance. --self-test uses explicitly synthetic local ZIPs.
No network, subprocesses, extraction, source changes, or input-file writes.
"""
import argparse
import hashlib
import io
import json
import re
import stat
import struct
import tempfile
import warnings
import zipfile
import zlib
from pathlib import Path

from PIL import Image, ImageFile

RUN_ID = "41675610602"
ATTEMPT = "1"
CANDIDATE = "1f64a10fa6c7c86488ccca31fa90be221c86ca38"
ARTIFACT = f"mermaid-account-evidence-{RUN_ID}-{ATTEMPT}"
ACCOUNTS = ("pure-standard", "filtered-admin")
ROOT_LOG = "mermaid-elevated-rejection.log"
MIB = 1024 * 1024
TOTAL_LIMIT = 128 * MIB
PNG_LIMIT = 32 * MIB
TEXT_LIMIT = 2 * MIB
PIXEL_LIMIT = 16_777_216
Image.MAX_IMAGE_PIXELS = PIXEL_LIMIT
ImageFile.LOAD_TRUNCATED_IMAGES = False

STEPS = [
    "01-initial-disabled-source", "02-enable-and-exact-bytes",
    "03-real-edit-save-replacement", "04-undo-exact-original",
    "05-redo-exact-edit", "06-disable-and-reenable-in-place",
    "07-wide", "07-c4", "07-invalid", "08-final-disable",
]
SCREENSHOTS = {name + "-window.png" for name in
               [item for step in STEPS for item in (step, step + "-failure")]
               + ["unhandled-failure"]}
DIAGRAMS = {name + "-diagram.png" for name in (
    "02-enabled", "03-edited", "04-undone", "05-redone", "06-reenabled", "07-wide", "07-c4")}
FIXTURES = ("ordinary", "wide", "c4", "invalid")
PHASES = ("checkout", "desktop-check", "final")
OUTER = {"windows-standard-product-audit.json", "evidence-files.json"} | {
    f"mermaid-source-{phase}.json" for phase in PHASES}
METADATA = {
    "standard-context.json", "standard-child-result.json", "mermaid-product-e2e.json",
    "installation-result.json", "installed-binary-comparison.json",
    "installed-binary-comparison-stderr.log", "installer-stdout.log", "installer-stderr.log",
    "node-stdout.log", "node-stderr.log", "edgedriver-native.log", "edgedriver-stdio.log",
} | {name + "-product.log" for name in FIXTURES} | {
    prefix + name + ".md.log" for name in FIXTURES for prefix in ("fixture-", "saved-")}
ALLOWED = OUTER | METADATA | SCREENSHOTS | DIAGRAMS
EXCLUDED = ["binaries", "installers", "profiles", "cookies", "credentials", "temporary password"]


def require(condition, message):
    if not condition:
        raise ValueError(message)


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def unique_object(pairs):
    value = {}
    for key, item in pairs:
        require(key not in value, "Duplicate JSON key: " + str(key)[:160])
        value[key] = item
    return value


def parse_json(data):
    def invalid_constant(value):
        raise ValueError("Non-finite JSON constant: " + value)
    return json.loads(data.decode("utf-8-sig"), object_pairs_hook=unique_object,
                      parse_constant=invalid_constant)


def read_input(file, limit):
    info = file.lstat()
    require(stat.S_ISREG(info.st_mode) and not file.is_symlink(), "Input must be a plain file")
    require(info.st_size <= limit, "Input exceeds byte budget")
    with file.open("rb") as stream:
        data = stream.read(limit + 1)
    require(len(data) == info.st_size and len(data) <= limit, "Input changed or exceeded budget")
    return data


def error_message(error):
    return f"{type(error).__name__}: {error}"[:600]


def decode_png(data):
    require(data[:8] == b"\x89PNG\r\n\x1a\n", "PNG signature mismatch")
    offset, chunks = 8, 0
    ended = False
    while offset < len(data):
        require(offset + 12 <= len(data), "Truncated PNG chunk")
        size = struct.unpack_from(">I", data, offset)[0]
        kind = data[offset + 4:offset + 8]
        end = offset + 12 + size
        require(end <= len(data), "Truncated PNG payload")
        require(zlib.crc32(data[offset + 4:end - 4]) & 0xffffffff ==
                struct.unpack_from(">I", data, end - 4)[0], "PNG chunk CRC mismatch")
        require(kind not in (b"acTL", b"fcTL", b"fdAT"), "Animated PNG not allowed")
        chunks += 1
        require(chunks <= 65536, "PNG chunk budget exceeded")
        if kind == b"IEND":
            require(size == 0 and end == len(data), "PNG must end exactly at IEND")
            ended = True
            break
        offset = end
    require(ended, "PNG IEND missing")
    with warnings.catch_warnings():
        warnings.simplefilter("error", Image.DecompressionBombWarning)
        with Image.open(io.BytesIO(data)) as image:
            require(image.format == "PNG" and getattr(image, "n_frames", 1) == 1,
                    "Single-frame PNG required")
            width, height = image.size
            require(0 < width <= 8192 and 0 < height <= 8192 and
                    width * height <= PIXEL_LIMIT, "PNG pixel budget exceeded")
            image.verify()
        with Image.open(io.BytesIO(data)) as image:
            image.load()
            rgba = image.convert("RGBA")
            pixels = rgba.tobytes()
            require(len(pixels) == width * height * 4, "Decoded pixel count mismatch")
            nonuniform = any(low != high for low, high in rgba.getextrema())
    return {"width": width, "height": height, "pixelFormat": "RGBA8",
            "pixelSha256": sha256(pixels), "fullyDecoded": True, "nonuniform": nonuniform}


def validate_manifest(files):
    require("artifact-manifest.json" in files, "Account artifact manifest missing")
    require(len(files) <= 96, "Account file count exceeds 96")
    manifest_bytes = files["artifact-manifest.json"]
    require(len(manifest_bytes) < MIB, "Artifact manifest exceeds reserved 1 MiB")
    manifest = parse_json(manifest_bytes)
    require(manifest.get("schema") == 1, "Artifact manifest schema mismatch")
    require(manifest.get("candidateSha") == CANDIDATE, "Manifest candidate mismatch")
    require(manifest.get("workflowRunId") == RUN_ID, "Manifest workflow run mismatch")
    require(manifest.get("runAttempt") == ATTEMPT, "Manifest run attempt mismatch")
    require(manifest.get("outerStatus") in ("passed", "failed", "blocked"), "Invalid outer status")
    require(manifest.get("excluded") == EXCLUDED, "Manifest exclusions mismatch")
    entries = manifest.get("files")
    require(isinstance(entries, list) and 0 < len(entries) <= 95, "Bounded manifest entries required")
    listed = set()
    for entry in entries:
        name = entry.get("name")
        require(isinstance(name, str) and name in ALLOWED, "Unknown manifest file name")
        require(name not in listed, "Duplicate manifest file name")
        listed.add(name)
        require(name in files, "Manifest file missing: " + name)
        require(type(entry.get("bytes")) is int and entry["bytes"] == len(files[name]),
                "Manifest byte count mismatch: " + name)
        require(entry.get("sha256") == sha256(files[name]), "Manifest SHA256 mismatch: " + name)
    require(set(files) == listed | {"artifact-manifest.json"}, "Manifest file set mismatch")
    total = sum(len(files[name]) for name in listed)
    require(type(manifest.get("totalBytes")) is int and manifest["totalBytes"] == total,
            "Manifest total byte count mismatch")
    require(total <= 127 * MIB and total + len(manifest_bytes) <= TOTAL_LIMIT,
            "Account aggregate byte budget exceeded")
    require("windows-standard-product-audit.json" in files, "Outer audit missing")
    audit = parse_json(files["windows-standard-product-audit.json"])
    require(audit.get("source") == CANDIDATE, "Outer audit candidate mismatch")
    require(audit.get("status") == manifest["outerStatus"], "Outer audit status mismatch")
    require(audit.get("passwordInLogsFilesArgumentsOrEnvironment") is False,
            "Credential-free audit declaration missing")
    for phase in PHASES:
        name = f"mermaid-source-{phase}.json"
        if name in files:
            snapshot = parse_json(files[name])
            require(snapshot.get("candidateSha") == CANDIDATE and snapshot.get("phase") == phase
                    and snapshot.get("readOnly") is True and snapshot.get("refreshedIndex") is False
                    and snapshot.get("rawStatus") == "", "Source snapshot mismatch: " + phase)
    children = listed - OUTER
    copy_bytes = files.get("evidence-files.json")
    if copy_bytes is None:
        require(not children, "Child evidence has no copy manifest")
    else:
        copy = parse_json(copy_bytes)
        require(copy.get("schema") == 1 and isinstance(copy.get("files"), list)
                and len(copy["files"]) <= 94, "Invalid bounded copy manifest")
        reviewed = set()
        for entry in copy["files"]:
            name = entry.get("retainedName")
            require(isinstance(name, str) and name in children and name not in reviewed,
                    "Unknown or duplicate child copy entry")
            reviewed.add(name)
            require(entry.get("relativePath") == (name[:-4] if name.endswith(".md.log") else name),
                    "Copy manifest contains a noncanonical original path")
            require(type(entry.get("bytes")) is int and entry["bytes"] == len(files[name])
                    and entry.get("sha256") == sha256(files[name]), "Child copy bytes/SHA256 mismatch")
        require(reviewed == children, "Unlisted child evidence")
        if "complete" in copy:
            require(type(copy["complete"]) is bool and
                    audit.get("evidenceCopy", {}).get("complete") is copy["complete"],
                    "Evidence completeness disagrees with outer audit")
            rejected = copy.get("rejected")
            count, omitted = copy.get("rejectedCount"), copy.get("rejectionsOmitted")
            require(isinstance(rejected, list) and len(rejected) <= 64 and type(count) is int
                    and 0 <= count <= 4096 and type(omitted) is int and omitted >= 0
                    and count == len(rejected) + omitted, "Unaccounted rejected evidence")
            require(copy["complete"] == (count == 0), "Invalid evidence completeness")
            require(copy["complete"] or audit["status"] == "failed",
                    "Incomplete evidence cannot claim a passing outer result")
    return {"outerStatus": audit["status"], "manifestFiles": len(entries), "totalBytes": total}


def verify(metadata_path, zip_path):
    result = {"schema": 1, "scope": "offline retained-evidence integrity only",
              "artifactName": ARTIFACT, "workflowRunId": RUN_ID, "runAttempt": ATTEMPT,
              "candidateSha": CANDIDATE, "present": False, "verified": False,
              "acceptance": "not-evaluated", "errors": [], "accounts": {
                  name: {"present": False, "verified": False, "errors": [], "files": [], "images": []}
                  for name in ACCOUNTS},
              "elevatedRejectionLog": {"present": False, "verified": False},
              "networkAccessed": False, "archiveExtracted": False, "inputsModified": False}
    try:
        metadata = parse_json(read_input(metadata_path, TEXT_LIMIT))
        artifacts = metadata.get("artifacts")
        require(isinstance(artifacts, list), "GitHub artifact list required")
        matches = [item for item in artifacts if item.get("name") == ARTIFACT]
        require(len(matches) == 1, "Exactly one expected API artifact required")
        artifact = matches[0]
        result["present"] = True
        require(artifact.get("expired") is False, "API artifact expired/unknown")
        workflow = artifact.get("workflow_run", {})
        require(workflow.get("id") == int(RUN_ID) and workflow.get("head_sha") == CANDIDATE,
                "API workflow identity mismatch")
        raw = read_input(zip_path, TOTAL_LIMIT + MIB)
        digest = sha256(raw)
        result["zip"] = {"bytes": len(raw), "sha256": digest, "artifactId": artifact.get("id"),
                         "apiBytesMatched": artifact.get("size_in_bytes") == len(raw),
                         "apiDigestMatched": artifact.get("digest") == "sha256:" + digest}
        require(result["zip"]["apiBytesMatched"] and result["zip"]["apiDigestMatched"],
                "ZIP bytes/digest do not match saved API metadata")
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            infos = archive.infolist()
            require(len(infos) <= 195, "ZIP entry count exceeds two bounded accounts plus root log")
            require(sum(info.file_size for info in infos) <= TOTAL_LIMIT,
                    "ZIP uncompressed aggregate exceeds 128 MiB")
            seen, approved, account_files = set(), [], {name: {} for name in ACCOUNTS}
            for info in infos:
                name = info.orig_filename
                account = name.split("/", 1)[0] if isinstance(name, str) else None
                if account in ACCOUNTS:
                    result["accounts"][account]["present"] = True
                try:
                    require(name == info.filename and "\\" not in name and "\x00" not in name,
                            "Noncanonical ZIP path")
                    require(name not in seen, "Duplicate ZIP entry: " + name[:160])
                    seen.add(name)
                    mode = info.external_attr >> 16
                    kind = stat.S_IFMT(mode)
                    require(not stat.S_ISLNK(mode) and not (info.external_attr & 0x400),
                            "ZIP symlink/reparse entry forbidden")
                    require(not (info.flag_bits & 1), "Encrypted ZIP entry forbidden")
                    if info.is_dir():
                        require(name in {part + "/" for part in ACCOUNTS} and kind in (0, stat.S_IFDIR)
                                and info.file_size == 0, "Unexpected ZIP directory")
                        continue
                    require(kind in (0, stat.S_IFREG), "Nonregular ZIP entry forbidden")
                    parts = name.split("/")
                    require(name == ROOT_LOG or (len(parts) == 2 and parts[0] in ACCOUNTS
                            and parts[1] in ALLOWED | {"artifact-manifest.json"}),
                            "ZIP path is not in the exact evidence allowlist: " + name[:160])
                    limit = PNG_LIMIT if name.endswith(".png") else TEXT_LIMIT
                    require(0 <= info.file_size <= limit, "ZIP member byte budget exceeded")
                    approved.append(info)
                except Exception as error:
                    message = error_message(error)
                    result["errors"].append(message)
                    if account in ACCOUNTS:
                        result["accounts"][account]["errors"].append(message)
            for account in ACCOUNTS:
                count = sum(1 for info in infos if info.filename.startswith(account + "/") and not info.is_dir())
                require(count <= 96, "Account file count exceeds 96: " + account)
            for info in approved:
                name = info.filename
                account = name.split("/", 1)[0]
                try:
                    limit = PNG_LIMIT if name.endswith(".png") else TEXT_LIMIT
                    with archive.open(info) as stream:
                        data = stream.read(limit + 1)
                    require(len(data) == info.file_size and len(data) <= limit, "ZIP member length mismatch")
                    row = {"name": name.split("/")[-1], "bytes": len(data), "sha256": sha256(data)}
                    if name == ROOT_LOG:
                        result["elevatedRejectionLog"] = dict(row, present=True, verified=True,
                                                              contentAcceptance="not-evaluated")
                        continue
                    account_files[account][row["name"]] = data
                    result["accounts"][account]["files"].append(row)
                    if name.endswith(".json"):
                        parse_json(data)
                    if name.endswith(".png"):
                        result["accounts"][account]["images"].append(dict(row, **decode_png(data)))
                except Exception as error:
                    message = name + ": " + error_message(error)
                    result["errors"].append(message)
                    if account in ACCOUNTS:
                        result["accounts"][account]["errors"].append(message)
            for account in ACCOUNTS:
                row = result["accounts"][account]
                if not row["present"]:
                    row["errors"].append("Required account directory absent")
                else:
                    try:
                        row.update(validate_manifest(account_files[account]))
                    except Exception as error:
                        row["errors"].append(error_message(error))
                row["verified"] = row["present"] and not row["errors"]
                if row["errors"]:
                    result["errors"].append(account + ": " + "; ".join(row["errors"])[:1200])
            if not result["elevatedRejectionLog"]["present"]:
                result["errors"].append("Required root elevated-rejection log absent")
    except Exception as error:
        result["errors"].append(error_message(error))
    result["allExpectedEvidencePresent"] = all(row["present"] for row in result["accounts"].values()) \
        and result["elevatedRejectionLog"]["present"]
    result["verified"] = result["allExpectedEvidencePresent"] and not result["errors"] \
        and all(row["verified"] for row in result["accounts"].values())
    return result


def synthetic_self_test():
    """Synthetic framing/integrity fixtures; no Windows or product is exercised."""
    image = Image.new("RGBA", (2, 1), "white")
    image.putpixel((1, 0), (0, 0, 0, 255))
    output = io.BytesIO()
    image.save(output, format="PNG")
    png = output.getvalue()
    encode = lambda value: (json.dumps(value) + "\n").encode()

    def account_data(bad_hash=False, bad_run=False, bad_png=False):
        content = png[:-4] if bad_png else png
        files = {"windows-standard-product-audit.json": encode({
            "source": CANDIDATE, "status": "failed", "syntheticFixture": True,
            "passwordInLogsFilesArgumentsOrEnvironment": False}),
            "07-wide-diagram.png": content}
        files["evidence-files.json"] = encode({"schema": 1, "files": [{
            "retainedName": "07-wide-diagram.png", "relativePath": "07-wide-diagram.png",
            "bytes": len(content), "sha256": sha256(content)}]})
        entries = [{"name": name, "bytes": len(data), "sha256": sha256(data)} for name, data in files.items()]
        if bad_hash:
            entries[0]["sha256"] = "0" * 64
        files["artifact-manifest.json"] = encode({"schema": 1, "candidateSha": CANDIDATE,
            "workflowRunId": "0" if bad_run else RUN_ID, "runAttempt": ATTEMPT,
            "outerStatus": "failed", "excluded": EXCLUDED,
            "files": entries, "totalBytes": sum(map(len, files.values()))})
        return files

    cases = ("valid-failed-run-evidence", "missing-account", "api-digest", "traversal",
             "symlink", "duplicate-entry", "manifest-hash", "manifest-run", "truncated-png",
             "unknown-binary", "nested-profile", "oversized-log", "missing-root-log")
    rows = []
    with tempfile.TemporaryDirectory(prefix="synthetic-account-artifact-") as directory:
        base = Path(directory)
        for case in cases:
            metadata_path, zip_path = base / "artifacts.json", base / "account.zip"
            with warnings.catch_warnings():
                warnings.simplefilter("ignore", UserWarning)
                with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
                    if case != "missing-root-log":
                        archive.writestr(ROOT_LOG, "SYNTHETIC FIXTURE ONLY; not elevated rejection proof\n")
                    for account in ACCOUNTS:
                        if case == "missing-account" and account == "filtered-admin":
                            continue
                        files = account_data(bad_hash=case == "manifest-hash" and account == "filtered-admin",
                                             bad_run=case == "manifest-run" and account == "filtered-admin",
                                             bad_png=case == "truncated-png" and account == "filtered-admin")
                        for name, data in files.items():
                            archive.writestr(account + "/" + name, data)
                    extra = {"traversal": "../outside.log", "unknown-binary": "pure-standard/installer.exe",
                             "nested-profile": "pure-standard/userprofile/node-stdout.log",
                             "oversized-log": "pure-standard/node-stdout.log"}.get(case)
                    if extra:
                        archive.writestr(extra, b"x" * (TEXT_LIMIT + 1) if case == "oversized-log" else b"x")
                    if case == "duplicate-entry":
                        archive.writestr("pure-standard/07-wide-diagram.png", png)
                    if case == "symlink":
                        info = zipfile.ZipInfo("pure-standard/node-stdout.log")
                        info.create_system = 3
                        info.external_attr = (stat.S_IFLNK | 0o777) << 16
                        archive.writestr(info, "../../outside")
            raw = zip_path.read_bytes()
            metadata_path.write_bytes(encode({"artifacts": [{"id": 1, "name": ARTIFACT,
                "expired": False, "size_in_bytes": len(raw),
                "digest": "sha256:" + ("0" * 64 if case == "api-digest" else sha256(raw)),
                "workflow_run": {"id": int(RUN_ID), "head_sha": CANDIDATE}}]}))
            result = verify(metadata_path, zip_path)
            require(result["verified"] == (case == "valid-failed-run-evidence"), "Synthetic case failed: " + case)
            require(result["acceptance"] == "not-evaluated", "Verifier must never confer acceptance")
            if case == "missing-account":
                require(result["accounts"]["pure-standard"]["verified"] and
                        not result["accounts"]["filtered-admin"]["present"], "Partial evidence was lost")
            if case == "valid-failed-run-evidence":
                require(all(row["images"][0]["fullyDecoded"] and
                            row["images"][0]["pixelSha256"] == sha256(image.tobytes())
                            for row in result["accounts"].values()), "Synthetic full decode/pixel hash failed")
            rows.append({"name": case, "passed": True})
    return {"scope": "SYNTHETIC LOCAL FIXTURES ONLY", "windowsOrProductExecuted": False,
            "networkAccessed": False, "tests": len(rows), "passed": len(rows), "cases": rows}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    root = Path(__file__).resolve().parent
    parser.add_argument("--metadata", type=Path, default=root / "artifacts.json")
    parser.add_argument("--zip", dest="zip_path", type=Path, default=root / "account.zip")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    result = synthetic_self_test() if args.self_test else verify(args.metadata, args.zip_path)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if args.self_test or result["verified"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
