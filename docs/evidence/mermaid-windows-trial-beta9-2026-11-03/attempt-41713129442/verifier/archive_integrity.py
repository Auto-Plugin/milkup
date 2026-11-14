"""Offline, read-only GitHub artifact/ZIP integrity validation.

This establishes archive integrity only. Callers must separately require their
manifest, expected files, and product acceptance gates. No extraction occurs.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import struct
import zlib

MAX_ZIP_BYTES = 128 * 1024 * 1024
MAX_METADATA_BYTES = 2 * 1024 * 1024


class ArchiveIntegrityError(ValueError):
    """A required observation is absent, malformed, or inconsistent."""


def require(condition, message):
    if not condition:
        raise ArchiveIntegrityError(message)


def _integer(value, lower=0, upper=None):
    return type(value) is int and value >= lower and (upper is None or value <= upper)


def parse_json(data):
    """Parse UTF-8 JSON without duplicate keys or non-finite numbers."""
    def pairs(items):
        result = {}
        for key, value in items:
            require(key not in result, f"JSON duplicate key: {key!r}")
            result[key] = value
        return result

    def bad_constant(value):
        raise ArchiveIntegrityError(f"JSON non-finite number: {value}")

    def finite_float(value):
        number = float(value)
        require(number not in (float("inf"), float("-inf")), "JSON non-finite float")
        return number

    try:
        if isinstance(data, bytes):
            data = data.decode("utf-8", errors="strict")
        require(isinstance(data, str), "JSON input must be UTF-8 bytes or text")
        return json.loads(data, object_pairs_hook=pairs,
                          parse_constant=bad_constant, parse_float=finite_float)
    except ArchiveIntegrityError:
        raise
    except (UnicodeError, ValueError, TypeError, RecursionError) as error:
        raise ArchiveIntegrityError(f"Invalid JSON: {error}") from error


def _read_regular(path, limit, label):
    """Walk with no-follow directory handles, then read one held regular file."""
    require(_integer(limit, 1), f"Invalid {label} byte limit")
    raw = os.fspath(path)
    require(isinstance(raw, str) and raw and "\0" not in raw, f"Invalid {label} input path")
    require(".." not in Path(raw).parts, f"Parent traversal in {label} input path")
    absolute = Path(os.path.abspath(raw))
    require(os.open in os.supports_dir_fd and hasattr(os, "O_NOFOLLOW")
            and hasattr(os, "O_DIRECTORY"), "Safe no-follow input reads unavailable")
    directory = fd = None
    try:
        directory = os.open(absolute.anchor, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        for component in absolute.parts[1:-1]:
            next_fd = os.open(component, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                              dir_fd=directory)
            os.close(directory)
            directory = next_fd
        fd = os.open(absolute.name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK,
                     dir_fd=directory)
        before = os.fstat(fd)
        require(stat.S_ISREG(before.st_mode), f"{label} input is not a regular file")
        require(0 < before.st_size <= limit, f"{label} input exceeds byte limit or is empty")
        parts, count = [], 0
        while True:
            piece = os.read(fd, min(65536, before.st_size - count + 1))
            if not piece:
                break
            count += len(piece)
            require(count <= before.st_size and count <= limit, f"{label} input changed size during read")
            parts.append(piece)
        after = os.fstat(fd)
        require(count == before.st_size and
                (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) ==
                (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns),
                f"{label} input changed during read")
        return b"".join(parts)
    except ArchiveIntegrityError:
        raise
    except (OSError, ValueError, TypeError) as error:
        raise ArchiveIntegrityError(f"Cannot safely read {label} input: {error}") from error
    finally:
        if fd is not None:
            os.close(fd)
        if directory is not None:
            os.close(directory)


def _safe_name(name, *, directory=False):
    require(isinstance(name, str) and name, "ZIP name must be nonempty text")
    require(not any(ord(c) < 32 or 127 <= ord(c) <= 159 for c in name), "ZIP name contains control/NUL")
    require("\\" not in name and ":" not in name and not name.startswith("/"), "Unsafe ZIP path")
    normalized = name[:-1] if directory and name.endswith("/") else name
    require(normalized and not normalized.endswith("/"), "Empty ZIP path segment")
    require(all(part not in ("", ".", "..") for part in normalized.split("/")), "Unsafe ZIP path segment")
    return normalized


def _allowed_namespace(names):
    require(not isinstance(names, (str, bytes)), "allowed_names must be a collection of file names")
    try:
        names = list(names)
    except TypeError as error:
        raise ArchiveIntegrityError("allowed_names is not iterable") from error
    require(names, "allowed_names must not be empty")
    files, directories, spelling = set(), set(), {}
    for name in names:
        require(isinstance(name, str) and not name.endswith("/"), "allowed_names contains a directory")
        _safe_name(name)
        require(name not in files, "allowed_names contains a duplicate")
        files.add(name)
        parts = name.split("/")
        for end in range(1, len(parts) + 1):
            path = "/".join(parts[:end])
            folded = path.casefold()
            require(folded not in spelling or spelling[folded] == path, "allowed_names case collision")
            spelling[folded] = path
            if end != len(parts):
                directories.add(path)
    require(not files.intersection(directories), "allowed_names file/directory prefix collision")
    return files, directories


def _artifact(metadata, expected_name, run_id, candidate):
    require(isinstance(expected_name, str) and expected_name, "Explicit artifact name required")
    require(isinstance(run_id, str) and re.fullmatch(r"[1-9][0-9]*", run_id), "Explicit decimal run_id required")
    require(isinstance(candidate, str) and re.fullmatch(r"[a-f0-9]{40}", candidate), "Explicit full lowercase candidate SHA required")
    if isinstance(metadata, dict) and "artifacts" in metadata:
        rows = metadata["artifacts"]
        require(isinstance(rows, list), "API artifacts is not an array")
        if "total_count" in metadata:
            require(_integer(metadata["total_count"]) and metadata["total_count"] == len(rows),
                    "API artifact list is incomplete or has invalid total_count")
    elif isinstance(metadata, list):
        rows = metadata
    else:
        require(isinstance(metadata, dict), "API metadata must be an artifact object or artifacts array")
        rows = [metadata]
    require(all(isinstance(row, dict) and isinstance(row.get("name"), str) for row in rows),
            "API artifacts contains malformed entries")
    selected = [row for row in rows if row["name"] == expected_name]
    require(len(selected) == 1, "Expected artifact name missing or ambiguous")
    artifact = selected[0]
    require(_integer(artifact.get("id"), 1), "API artifact id missing or invalid")
    require(artifact.get("expired") is False, "API artifact is expired or expiry status unknown")
    expires = artifact.get("expires_at")
    require(isinstance(expires, str) and re.fullmatch(
        r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|\+00:00)", expires),
        "API expires_at must be an explicit UTC timestamp")
    try:
        expiry = dt.datetime.fromisoformat(expires.replace("Z", "+00:00"))
    except ValueError as error:
        raise ArchiveIntegrityError("API expires_at is invalid") from error
    require(expiry > dt.datetime.now(dt.timezone.utc), "API artifact expiry has elapsed")
    workflow = artifact.get("workflow_run")
    require(isinstance(workflow, dict) and _integer(workflow.get("id"), 1)
            and workflow["id"] == int(run_id), "API workflow run id mismatch")
    require(workflow.get("head_sha") == candidate, "API candidate/head SHA mismatch")
    require(_integer(artifact.get("size_in_bytes"), 1, MAX_ZIP_BYTES), "API ZIP size missing or out of bounds")
    require(isinstance(artifact.get("digest"), str) and re.fullmatch(r"sha256:[a-f0-9]{64}", artifact["digest"]),
            "API SHA-256 digest missing or malformed")
    return artifact


def _unpack(fmt, data, offset, label):
    size = struct.calcsize(fmt)
    require(0 <= offset <= len(data) - size, f"Truncated ZIP {label}")
    return struct.unpack_from(fmt, data, offset)


def _extras(data):
    """Opaque normal extras are allowed; their TLV envelopes must be complete."""
    position, result = 0, {}
    while position < len(data):
        tag, length = _unpack("<HH", data, position, "extra header")
        position += 4
        require(position + length <= len(data), "Truncated ZIP extra payload")
        if tag == 1:
            require(tag not in result, "Duplicate ZIP64 extra")
        result[tag] = data[position:position + length]
        position += length
    return result


def _zip64_values(extra, values):
    raw, offset, result = extra.get(1, b""), 0, []
    for value, marker, fmt in values:
        if value == marker:
            value, = _unpack(fmt, raw, offset, "ZIP64 value")
            offset += struct.calcsize(fmt)
        result.append(value)
    return result


def _directory_location(data):
    candidates = []
    for position in range(max(0, len(data) - 65557), len(data) - 21):
        if data[position:position + 4] == b"PK\x05\x06":
            row = _unpack("<4s4H2IH", data, position, "EOCD")
            if position + 22 + row[-1] == len(data):
                candidates.append((position, row))
    require(len(candidates) == 1, "ZIP end record missing, ambiguous, or followed by undeclared bytes")
    position, (_, disk, cd_disk, disk_count, count, cd_size, cd_offset, _) = candidates[0]
    require(disk == cd_disk == 0, "Multi-disk ZIP is not supported")
    directory_end = position
    zip64 = count == 0xffff or disk_count == 0xffff or cd_size == 0xffffffff or cd_offset == 0xffffffff
    if position >= 20 and data[position - 20:position - 16] == b"PK\x06\x07":
        _, locator_disk, record_offset, disks = _unpack("<4sIQI", data, position - 20, "ZIP64 locator")
        require(locator_disk == 0 and disks == 1, "Invalid ZIP64 disk locator")
        row = _unpack("<4sQ2H2I4Q", data, record_offset, "ZIP64 EOCD")
        signature, size, _, _, zdisk, zcd_disk, zcount_disk, zcount, zsize, zoffset = row
        require(signature == b"PK\x06\x06" and size >= 44 and record_offset + size + 12 == position - 20,
                "Invalid ZIP64 end record extent")
        require(zdisk == zcd_disk == 0 and zcount_disk == zcount, "Invalid ZIP64 disk counts")
        require(disk_count in (0xffff, zcount) and count in (0xffff, zcount)
                and cd_size in (0xffffffff, zsize) and cd_offset in (0xffffffff, zoffset),
                "ZIP64 and ordinary directory records disagree")
        count, cd_size, cd_offset, directory_end = zcount, zsize, zoffset, record_offset
    else:
        require(not zip64 and disk_count == count, "Missing ZIP64 locator or inconsistent ZIP counts")
    require(cd_offset + cd_size == directory_end, "ZIP central directory extent mismatch")
    return count, cd_offset, directory_end


def _decode_member(data, entry):
    payload = memoryview(data)[entry["dataStart"]:entry["dataEnd"]]
    size = entry["size"]
    if entry["method"] == 0:
        require(len(payload) == size, "Stored ZIP member size mismatch")
        result = bytes(payload)
    else:
        decoder = zlib.decompressobj(-15)
        try:
            result = decoder.decompress(payload, size + 1)
        except zlib.error as error:
            raise ArchiveIntegrityError(f"ZIP deflate decode failed: {error}") from error
        require(len(result) <= size, "ZIP member decoded beyond declared size")
        require(decoder.eof and not decoder.unused_data and not decoder.unconsumed_tail,
                "ZIP deflate stream incomplete or contains undeclared compressed data")
    require(len(result) == size, "ZIP decoded member size mismatch")
    require(zlib.crc32(result) & 0xffffffff == entry["crc"], "ZIP member CRC mismatch")
    return result


def _zip_files(data, allowed, ancestors, max_files, max_total_bytes, max_file_bytes):
    count, directory_start, directory_end = _directory_location(data)
    require(0 < count <= max_files + len(ancestors), "ZIP entry count exceeds allowed bound")
    entries, seen, position, total, file_count = [], set(), directory_start, 0, 0
    for _ in range(count):
        row = _unpack("<4s6H3I5H2I", data, position, "central header")
        (signature, creator, _, flags, method, stamp, date, crc, compressed, size,
         name_length, extra_length, comment_length, disk, _, attributes, local_offset) = row
        require(signature == b"PK\x01\x02", "Invalid ZIP central signature")
        end = position + 46 + name_length + extra_length + comment_length
        require(end <= directory_end, "ZIP central entry exceeds directory")
        raw_name = data[position + 46:position + 46 + name_length]
        extra = _extras(data[position + 46 + name_length:position + 46 + name_length + extra_length])
        size, compressed, local_offset, disk = _zip64_values(extra, [
            (size, 0xffffffff, "<Q"), (compressed, 0xffffffff, "<Q"),
            (local_offset, 0xffffffff, "<Q"), (disk, 0xffff, "<I")])
        require(disk == 0, "Multi-disk ZIP member")
        require(not flags & (1 | 0x40 | 0x2000), "Encrypted ZIP member")
        require(not flags & ~0x080e and method in (0, 8), "Unsupported ZIP flags or compression method")
        try:
            name = raw_name.decode("utf-8" if flags & 0x800 else "cp437", errors="strict")
        except UnicodeError as error:
            raise ArchiveIntegrityError("Invalid ZIP filename encoding") from error
        is_directory = name.endswith("/")
        canonical = _safe_name(name, directory=is_directory)
        folded = canonical.casefold()
        require(folded not in seen, "Duplicate or case-colliding ZIP member")
        seen.add(folded)
        mode = attributes >> 16
        kind = stat.S_IFMT(mode)
        require(kind in (0, stat.S_IFREG, stat.S_IFDIR), "ZIP symlink or special member")
        require(not attributes & (0x400 | 0x08), "ZIP reparse-point or volume-label member")
        if is_directory:
            require(canonical in ancestors and size == 0 and kind in (0, stat.S_IFDIR),
                    "Unknown, nonempty, or type-inconsistent ZIP directory")
        else:
            require(name in allowed and kind in (0, stat.S_IFREG) and not attributes & 0x10,
                    "Unknown or type-inconsistent ZIP file")
            limit = max_file_bytes(name) if callable(max_file_bytes) else max_file_bytes
            require(_integer(limit, 0), "Invalid configured ZIP member byte limit")
            require(size <= limit, f"ZIP member exceeds declared byte limit: {name}")
            total += size
            file_count += 1
            require(file_count <= max_files and total <= max_total_bytes, "ZIP declared count/aggregate byte limit exceeded")
        entries.append(dict(name=name, directory=is_directory, rawName=raw_name, flags=flags,
                            method=method, stamp=stamp, date=date, crc=crc, compressed=compressed,
                            size=size, localOffset=local_offset))
        position = end
    require(position == directory_end, "Undeclared data in ZIP central directory")
    require(file_count > 0, "ZIP contains no allowed files")
    cursor = 0
    for entry in sorted(entries, key=lambda item: item["localOffset"]):
        offset = entry["localOffset"]
        require(offset == cursor, "ZIP local entries overlap or contain undeclared gaps/prefix")
        row = _unpack("<4s5H3I2H", data, offset, "local header")
        signature, version, flags, method, stamp, date, crc, compressed, size, nl, el = row
        require(signature == b"PK\x03\x04" and (flags, method, stamp, date) ==
                (entry["flags"], entry["method"], entry["stamp"], entry["date"]), "ZIP local/central header mismatch")
        data_start = offset + 30 + nl + el
        require(data_start <= directory_start, "ZIP local name/extra exceeds data extent")
        require(data[offset + 30:offset + 30 + nl] == entry["rawName"], "ZIP local/central raw name mismatch")
        extra = _extras(data[offset + 30 + nl:data_start])
        used_zip64 = size == 0xffffffff or compressed == 0xffffffff
        size, compressed = _zip64_values(extra, [(size, 0xffffffff, "<Q"), (compressed, 0xffffffff, "<Q")])
        if flags & 8:
            require(crc in (0, entry["crc"]) and size in (0, entry["size"])
                    and compressed in (0, entry["compressed"]), "ZIP local descriptor placeholders mismatch")
        else:
            require((crc, compressed, size) == (entry["crc"], entry["compressed"], entry["size"]),
                    "ZIP local/central size or CRC mismatch")
        data_end = data_start + entry["compressed"]
        require(data_end <= directory_start, "ZIP compressed member exceeds data extent")
        cursor = data_end
        if flags & 8:
            fmt = "<IQQ" if used_zip64 else "<III"
            # The descriptor signature is optional. Its byte pattern can also
            # be the actual CRC, so prove the complete tuple before choosing.
            starts = [cursor]
            if data[cursor:cursor + 4] == b"PK\x07\x08":
                starts.append(cursor + 4)
            ends = [start + struct.calcsize(fmt) for start in starts
                    if start + struct.calcsize(fmt) <= directory_start
                    and struct.unpack_from(fmt, data, start) ==
                    (entry["crc"], entry["compressed"], entry["size"])]
            require(len(ends) == 1, "ZIP descriptor missing, mismatched, or ambiguous")
            cursor = ends[0]
        require(cursor <= directory_start, "ZIP descriptor exceeds data extent")
        entry["dataStart"], entry["dataEnd"] = data_start, data_end
    require(cursor == directory_start, "Undeclared data before ZIP central directory")
    # All declared sizes, names, types, and local extents have passed before any
    # decompressor runs. A full bounded decode also catches understated sizes.
    files = {}
    for entry in entries:
        decoded = _decode_member(data, entry)
        if not entry["directory"]:
            files[entry["name"]] = decoded
    return files, count, total


def verify_archive(api_path, zip_path, *, expected_name, run_id, candidate,
                   allowed_names, max_files, max_total_bytes, max_file_bytes):
    """Return (integrity_summary, {member_name: bytes}) or raise.

    max_files counts files, not explicitly allowed ancestor directory entries.
    max_file_bytes is an integer or callable(member_name) -> integer. Missing
    allowed files are not fabricated: the caller's manifest gate checks them.
    """
    require(_integer(max_files, 1), "Invalid max_files")
    require(_integer(max_total_bytes, 1), "Invalid max_total_bytes")
    require(callable(max_file_bytes) or _integer(max_file_bytes, 0), "Invalid max_file_bytes")
    allowed, ancestors = _allowed_namespace(allowed_names)
    metadata = parse_json(_read_regular(api_path, MAX_METADATA_BYTES, "API metadata"))
    artifact = _artifact(metadata, expected_name, run_id, candidate)
    data = _read_regular(zip_path, MAX_ZIP_BYTES, "ZIP")
    require(len(data) == artifact["size_in_bytes"], "ZIP bytes differ from API size_in_bytes")
    digest = hashlib.sha256(data).hexdigest()
    require("sha256:" + digest == artifact["digest"], "ZIP SHA-256 differs from API digest")
    files, entries, total = _zip_files(data, allowed, ancestors, max_files, max_total_bytes, max_file_bytes)
    summary = {"integrityVerified": True, "acceptance": "not-evaluated",
               "artifactId": artifact["id"], "artifactName": expected_name,
               "runId": run_id, "candidateSha": candidate, "expiresAt": artifact["expires_at"],
               "zipBytes": len(data), "zipSha256": digest, "entryCount": entries,
               "fileCount": len(files), "uncompressedBytes": total,
               "files": [{"name": name, "bytes": len(content), "sha256": hashlib.sha256(content).hexdigest()}
                         for name, content in sorted(files.items())]}
    return summary, files
