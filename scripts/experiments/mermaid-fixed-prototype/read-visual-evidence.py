"""Strict readback of this prototype's bounded synthetic PNG log transport.

Uses the existing local Pillow for independent complete decoding. This is an
evidence reader, never a product dependency or a runner installation step.
"""
import argparse
import base64
import hashlib
import io
import json
import pathlib
import re
import struct
import zlib

from PIL import Image

BASELINE = "82fb49e95caf99ea45654f552992eff81f72bee9"
MAX_TOTAL = 1048576
MAX_IMAGE = 262144
CHUNK = 4096


def require(condition, message):
    if not condition:
        raise ValueError(message)


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, "Duplicate JSON key")
        result[key] = value
    return result


def parse(value):
    return json.loads(value, object_pairs_hook=unique_object)


def validate_png(data, header):
    require(33 <= len(data) <= MAX_IMAGE and data[:8] == b"\x89PNG\r\n\x1a\n", "Invalid PNG header/length")
    offset, saw_header, saw_data, saw_end = 8, False, False, False
    while offset < len(data):
        require(offset + 12 <= len(data), "Truncated PNG chunk")
        length = struct.unpack(">I", data[offset:offset + 4])[0]
        kind = data[offset + 4:offset + 8]
        end = offset + 12 + length
        require(end <= len(data), "Truncated PNG payload/CRC")
        crc = struct.unpack(">I", data[end - 4:end])[0]
        require(zlib.crc32(data[offset + 4:end - 4]) == crc, "PNG CRC mismatch")
        require(kind not in (b"acTL", b"fcTL", b"fdAT"), "Animated PNG rejected")
        if kind == b"IHDR":
            require(not saw_header and offset == 8 and length == 13, "Misplaced PNG IHDR")
            saw_header = True
        elif kind == b"IDAT":
            require(saw_header and length > 0, "Misplaced/empty PNG data")
            saw_data = True
        elif kind == b"IEND":
            require(saw_data and length == 0 and end == len(data), "Invalid PNG IEND/trailing data")
            saw_end = True
        offset = end
    require(saw_header and saw_data and saw_end, "Incomplete PNG")
    width, height = struct.unpack(">II", data[16:24])
    require(type(header["width"]) is int and type(header["height"]) is int and
            width == header["width"] == 1280 and height == header["height"] and
            0 < height <= 8192 and width * height <= 16777216, "PNG dimension mismatch/budget")
    with Image.open(io.BytesIO(data)) as image:
        require(image.format == "PNG" and image.size == (width, height), "Decoder format/size mismatch")
        image.verify()
    with Image.open(io.BytesIO(data)) as image:
        image.load()
        rgba = image.convert("RGBA")
        require(any(low != high for low, high in rgba.getextrema()), "Uniform PNG")


def token_boundary(case, account):
    for field, container, integrity in [("hostToken", False, 8192), ("suspendedToken", True, 4096), ("browserToken", True, 4096)]:
        token = case[field]
        require(token["userSid"] == account["userSid"] and token["elevated"] is False and
                token["elevationType"] == 1 and token["administratorsGroupPresentIncludingDenyOnly"] is False and
                token["seDebugPrivilege"]["present"] is False and token["isAppContainer"] is container and
                token["capabilityCount"] == 0 and token["integrityRid"] == integrity, "Token boundary failed")
    require(case["suspendedToken"]["appContainerSid"] == case["browserToken"]["appContainerSid"] and
            case["browserProcessInOwnedJob"] is True, "Browser identity/Job mismatch")
    require(case["cleanupSupervisorSid"] == account["cleanupSupervisorSid"] != account["userSid"], "Supervisor identity mismatch")
    require(case["cleanupErrors"] == [] and case["jobActiveAfterStop"] == 0 and
            case["profileDeletedAndFolderAbsent"] is True and case["privateTreeRemoved"] is True and
            case["stopMatrixAfterThisCase"] is False, "Native cleanup incomplete")


def collect(log, run, artifacts, fixtures):
    require(run["status"] == "completed" and run["conclusion"] == "success", "CI run is not successful")
    require(run["repository"]["full_name"] == "Auto-Plugin/milkup" and
            run["head_branch"] == "dot/milkup-v2-mermaid-prototype" and run["run_attempt"] == 1,
            "Unexpected repository/branch/attempt")
    require(artifacts["total_count"] == 0 and artifacts["artifacts"] == [], "Unexpected artifact upload")
    require(len(log) <= 4 * MAX_TOTAL, "Log exceeds evidence reader budget")
    context = {"schema": 1, "runId": str(run["id"]), "attempt": str(run["run_attempt"]),
               "source": run["head_sha"], "execution": "positive"}
    expected = {fixture["id"]: fixture for fixture in fixtures}
    require(len(expected) == len(fixtures) == 50, "Invalid fixed fixture set")
    require(all(isinstance(name, str) and re.fullmatch(r"[A-Za-z0-9_-]{1,80}", name) for name in expected), "Unsafe fixture name")
    streams, headers, manifest, current = {}, {}, None, None
    groups, supervisors, phase, account, execution = {}, [], None, None, None
    total = 0
    stage = "execution"
    for line in log.decode("utf-8-sig").splitlines():
        if "MILKUP_EXECUTION_JSON " in line:
            require(stage == "execution" and execution is None, "Duplicate/out-of-order execution record")
            execution = parse(line.split("MILKUP_EXECUTION_JSON ", 1)[1])
            stage = "canary-supervisor"
        elif "MILKUP_SUPERVISOR_JSON " in line:
            supervisor = parse(line.split("MILKUP_SUPERVISOR_JSON ", 1)[1])
            phase = supervisor["name"]
            require(phase not in groups and stage == phase + "-supervisor" and phase in ("canary", "positive"),
                    "Duplicate/out-of-order supervisor phase")
            groups[phase] = []
            supervisors.append(supervisor)
            stage = phase + "-cases"
        elif "MILKUP_CASE_JSON " in line:
            require(phase is not None and stage == phase + "-cases", "Case outside execution/order")
            groups[phase].append(parse(line.split("MILKUP_CASE_JSON ", 1)[1]))
            if phase == "canary" and len(groups[phase]) == 1:
                stage = "positive-supervisor"
            elif phase == "positive" and len(groups[phase]) == 50:
                stage = "png"
        elif "MILKUP_ACCOUNT_JSON " in line:
            require(stage == "account" and account is None, "Duplicate/premature account result")
            account = parse(line.split("MILKUP_ACCOUNT_JSON ", 1)[1])
            stage = "done"
        elif "MILKUP_PNG_" in line:
            require(stage == "png", "PNG data outside transport stage")
            marker, payload = line.split("MILKUP_PNG_", 1)[1].split(" ", 1)
            record = parse(payload)
            require(all(record.get(key) == value for key, value in context.items()), "PNG stream context mismatch")
            if marker == "MANIFEST":
                require(current is None and manifest is None and len(streams) == 50, "Premature/duplicate manifest")
                manifest = record
                stage = "account"
                continue
            require(manifest is None, "PNG data after final manifest")
            fixture = record["fixture"]
            require(fixture in expected and re.fullmatch(r"[a-f0-9]{64}", record["sha256"]), "Unknown fixture/digest")
            if marker == "BEGIN":
                require(current is None and fixture not in streams and fixture not in headers, "Duplicate/interleaved PNG")
                require(type(record["bytes"]) is int and 33 <= record["bytes"] <= MAX_IMAGE, "PNG byte budget")
                require(type(record["chunks"]) is int and record["chunks"] == (4 * ((record["bytes"] + 2) // 3) + CHUNK - 1) // CHUNK,
                        "PNG chunk count mismatch")
                total += record["bytes"]
                require(total <= MAX_TOTAL, "Aggregate PNG budget")
                headers[fixture] = record
                current = {"fixture": fixture, "chunks": []}
            elif marker == "CHUNK":
                require(current is not None and current["fixture"] == fixture, "Chunk outside current PNG")
                header = headers[fixture]
                require(record["sha256"] == header["sha256"] and record["chunks"] == header["chunks"] and
                        type(record["index"]) is int and record["index"] == len(current["chunks"]) < header["chunks"],
                        "Duplicate/missing/out-of-order chunk")
                data = record["data"]
                require(isinstance(data, str) and 0 < len(data) <= CHUNK and len(data) % 4 == 0, "Invalid chunk length")
                if record["index"] < header["chunks"] - 1:
                    require(len(data) == CHUNK, "Short nonfinal chunk")
                current["chunks"].append(data)
            elif marker == "END":
                require(current is not None and current["fixture"] == fixture and record == headers[fixture] and
                        len(current["chunks"]) == record["chunks"], "Missing/mismatched PNG completion")
                encoded = "".join(current["chunks"])
                require(len(encoded) == 4 * ((record["bytes"] + 2) // 3), "Base64 length mismatch")
                data = base64.b64decode(encoded, validate=True)
                require(base64.b64encode(data).decode("ascii") == encoded, "Noncanonical base64")
                require(len(data) == record["bytes"] and hashlib.sha256(data).hexdigest() == record["sha256"], "PNG byte/hash mismatch")
                validate_png(data, record)
                streams[fixture] = data
                current = None
            else:
                raise ValueError("Unknown PNG transport marker")
    require(stage == "done" and manifest is not None and current is None and set(streams) == set(expected), "Missing complete PNG/terminal set")
    require(manifest["files"] == list(headers.values()) and manifest["count"] == 50 and manifest["totalBytes"] == total and
            manifest["capturesEnvironmentScreens"] is False and manifest["artifactUpload"] is False, "Final manifest differs")
    require(execution is not None and execution["runId"] == context["runId"] and execution["attempt"] == context["attempt"] and
            execution["exactSource"] == run["head_sha"] and execution["captureVisualEvidence"] is True and
            execution["renderingInputsBaseline"] == BASELINE, "Rendering baseline/mode proof missing")
    require(account is not None and account["runId"] == context["runId"] and account["attempt"] == context["attempt"] and
            account["source"] == run["head_sha"] and account["captureVisualEvidence"] is True and
            account["visualEvidenceEmitted"] is True and account["accountDeleted"] is True and account["profileDeleted"] is True and
            account["stageRemoved"] is True and account["cleanupErrors"] == [] and "failure" not in account,
            "Final account/profile/stage cleanup incomplete")
    require(list(groups) == ["canary", "positive"] and len(groups["canary"]) == 1 and
            groups["canary"][0]["fixture"] == "flowchart-v2" and len(groups["positive"]) == 50 and
            {case["fixture"] for case in groups["positive"]} == set(expected), "Execution matrix differs")
    require(account["executions"] == supervisors and account["localGroupSids"] == ["S-1-5-32-545"], "Supervisor/account facts differ")
    for supervisor in supervisors:
        result = supervisor["result"]
        require(result["success"] is True and result["resumed"] is True and result["jobAssigned"] is True and
                result["jobEmpty"] is True and result["exitCode"] == 0 and result["cleanupErrors"] == [] and
                result["suspendedToken"]["sid"] == account["userSid"] and result["suspendedToken"]["standardUser"] is True,
                "Outer supervisor failed")
    for group, cases in groups.items():
        for case in cases:
            token_boundary(case, account)
            require(case["ok"] is True and case["rawRenderSucceeded"] is True and case["registrationMatches"] is True and
                    case["pngValidation"]["decoded"] is True and case["pngValidation"]["nonUniform"] is True,
                    "Positive render assertion failed")
            if group == "positive":
                header = headers[case["fixture"]]
                require(all(case["pngValidation"][key] == header[key] for key in ["sha256", "width", "height"]) and
                        case["rendererMetadata"]["pngBytes"] == header["bytes"] and
                        case["rendererMetadata"]["rendered"]["diagramType"] == expected[case["fixture"]]["expectedRegistrationId"],
                        "PNG transfer differs from native case report")
    return streams, {"schema": 1, "runId": run["id"], "runUrl": run["html_url"], "source": run["head_sha"],
                     "renderingInputsBaseline": BASELINE, "count": 50, "totalBytes": total,
                     "normalizedJobLogSha256": hashlib.sha256(log).hexdigest(), "artifactCount": 0,
                     "nativeAndOuterCleanupVerified": True, "independentPngDecodeVerified": True,
                     "humanVisualReview": "pending", "files": list(headers.values()),
                     "execution": execution}


def main():
    parser = argparse.ArgumentParser()
    for name in ["log", "run", "artifacts", "output"]:
        parser.add_argument("--" + name, type=pathlib.Path, required=True)
    args = parser.parse_args()
    require(args.log.stat().st_size <= 4 * MAX_TOTAL, "Log exceeds evidence reader budget")
    fixtures = parse((pathlib.Path(__file__).parent / "fixtures-manifest.json").read_text())["fixtures"]
    streams, result = collect(args.log.read_bytes(), parse(args.run.read_text()), parse(args.artifacts.read_text()), fixtures)
    # No files become accepted evidence until transport, PNGs and final cleanup
    # have all passed. Never overwrite an existing result directory.
    args.output.mkdir(parents=False, exist_ok=False)
    for fixture, data in streams.items():
        (args.output / (fixture + ".png")).write_bytes(data)
    (args.output / "manifest.json").write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps({"count": result["count"], "totalBytes": result["totalBytes"], "source": result["source"], "cleanup": True}))


if __name__ == "__main__":
    main()
