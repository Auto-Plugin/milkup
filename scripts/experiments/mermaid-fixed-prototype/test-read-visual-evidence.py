"""Transport regressions with synthetic JSON and a two-color test PNG, not render evidence."""
import base64
import copy
import hashlib
import importlib.util
import json
import pathlib
import struct
import unittest
import zlib

ROOT = pathlib.Path(__file__).parent
SPEC = importlib.util.spec_from_file_location("visual_reader", ROOT / "read-visual-evidence.py")
READER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(READER)
FIXTURES = json.loads((ROOT / "fixtures-manifest.json").read_text())["fixtures"]


def png_chunk(kind, payload):
    return struct.pack(">I", len(payload)) + kind + payload + struct.pack(">I", zlib.crc32(kind + payload))


PNG = b"\x89PNG\r\n\x1a\n" + png_chunk(b"IHDR", struct.pack(">IIBBBBB", 1280, 2, 8, 2, 0, 0, 0))
PNG += png_chunk(b"IDAT", zlib.compress((b"\0" + b"\xff\xff\xff" * 640 + b"\0\0\0" * 640) * 2)) + png_chunk(b"IEND", b"")
DIGEST = hashlib.sha256(PNG).hexdigest()


def sample():
    run = {"id": 1, "run_attempt": 1, "head_sha": "a" * 40, "html_url": "synthetic", "status": "completed", "conclusion": "success"}
    run.update(repository={"full_name": "Auto-Plugin/milkup"}, head_branch="dot/milkup-v2-mermaid-prototype")
    lines = []
    emit = lambda marker, value: lines.append(marker + " " + json.dumps(value))
    emit("MILKUP_EXECUTION_JSON", {"runId": "1", "attempt": "1", "exactSource": run["head_sha"], "captureVisualEvidence": True, "renderingInputsBaseline": READER.BASELINE})
    user, supervisor_sid = "synthetic-user", "synthetic-supervisor"

    def token(container):
        return {"userSid": user, "elevated": False, "elevationType": 1, "administratorsGroupPresentIncludingDenyOnly": False,
                "seDebugPrivilege": {"present": False}, "isAppContainer": container, "capabilityCount": 0,
                "integrityRid": 4096 if container else 8192, "appContainerSid": "synthetic-container" if container else None}

    supervisors = []
    for phase, fixtures in [("canary", [next(f for f in FIXTURES if f["id"] == "flowchart-v2")]), ("positive", FIXTURES)]:
        supervisor = {"name": phase, "result": {"success": True, "resumed": True, "jobAssigned": True, "jobEmpty": True,
                      "exitCode": 0, "cleanupErrors": [], "suspendedToken": {"sid": user, "standardUser": True}}}
        supervisors.append(supervisor)
        emit("MILKUP_SUPERVISOR_JSON", supervisor)
        for fixture in fixtures:
            emit("MILKUP_CASE_JSON", {"fixture": fixture["id"], "hostToken": token(False), "suspendedToken": token(True),
                 "browserToken": token(True), "browserProcessInOwnedJob": True, "cleanupSupervisorSid": supervisor_sid,
                 "cleanupErrors": [], "jobActiveAfterStop": 0, "profileDeletedAndFolderAbsent": True,
                 "privateTreeRemoved": True, "stopMatrixAfterThisCase": False, "ok": True,
                 "rawRenderSucceeded": True, "registrationMatches": True,
                 "pngValidation": {"decoded": True, "nonUniform": True, "sha256": DIGEST, "width": 1280, "height": 2},
                 "rendererMetadata": {"pngBytes": len(PNG), "rendered": {"diagramType": fixture["expectedRegistrationId"]}}})
    context = {"schema": 1, "runId": "1", "attempt": "1", "source": run["head_sha"], "execution": "positive"}
    files = []
    for fixture in FIXTURES:
        header = dict(context, fixture=fixture["id"], sha256=DIGEST, bytes=len(PNG), width=1280, height=2, chunks=1)
        files.append(header)
        emit("MILKUP_PNG_BEGIN", header)
        emit("MILKUP_PNG_CHUNK", dict(context, fixture=fixture["id"], sha256=DIGEST, index=0, chunks=1, data=base64.b64encode(PNG).decode("ascii")))
        emit("MILKUP_PNG_END", header)
    emit("MILKUP_PNG_MANIFEST", dict(context, count=50, totalBytes=50 * len(PNG), files=files, capturesEnvironmentScreens=False, artifactUpload=False))
    emit("MILKUP_ACCOUNT_JSON", {"source": run["head_sha"], "userSid": user, "cleanupSupervisorSid": supervisor_sid,
         "runId": "1", "attempt": "1",
         "captureVisualEvidence": True, "visualEvidenceEmitted": True, "accountDeleted": True, "profileDeleted": True,
         "stageRemoved": True, "cleanupErrors": [], "executions": supervisors, "localGroupSids": ["S-1-5-32-545"]})
    return lines, run, {"total_count": 0, "artifacts": []}


class ReaderTest(unittest.TestCase):
    def check(self, lines, run, artifacts):
        return READER.collect(("\n".join(lines) + "\n").encode(), run, artifacts, FIXTURES)

    def test_complete_synthetic_transport(self):
        streams, result = self.check(*sample())
        self.assertEqual(len(streams), 50)
        self.assertEqual(result["totalBytes"], 50 * len(PNG))

    def test_missing_duplicate_reordered_or_corrupt_chunk(self):
        for mode in ["missing", "duplicate", "index", "data"]:
            with self.subTest(mode=mode):
                lines, run, artifacts = sample()
                index = next(i for i, line in enumerate(lines) if line.startswith("MILKUP_PNG_CHUNK "))
                if mode == "missing":
                    del lines[index]
                elif mode == "duplicate":
                    lines.insert(index, lines[index])
                else:
                    record = json.loads(lines[index].split(" ", 1)[1])
                    record["index" if mode == "index" else "data"] = 1 if mode == "index" else "AAAA" + record["data"][4:]
                    lines[index] = "MILKUP_PNG_CHUNK " + json.dumps(record)
                with self.assertRaises((ValueError, KeyError)):
                    self.check(lines, run, artifacts)

    def test_manifest_mismatch_or_cleanup_failure_rejects_images(self):
        for marker, key, value in [("MILKUP_PNG_MANIFEST", "totalBytes", 1), ("MILKUP_ACCOUNT_JSON", "stageRemoved", False)]:
            with self.subTest(marker=marker):
                lines, run, artifacts = sample()
                index = next(i for i, line in enumerate(lines) if line.startswith(marker + " "))
                record = json.loads(lines[index].split(" ", 1)[1])
                record[key] = value
                lines[index] = marker + " " + json.dumps(record)
                with self.assertRaises(ValueError):
                    self.check(lines, run, artifacts)

    def test_failed_run_or_upload_is_not_accepted(self):
        lines, run, artifacts = sample()
        failed = copy.deepcopy(run)
        failed["conclusion"] = "failure"
        with self.assertRaises(ValueError):
            self.check(lines, failed, artifacts)
        with self.assertRaises(ValueError):
            self.check(lines, run, {"total_count": 1, "artifacts": [{}]})

    def test_png_crc_truncation_and_json_duplicates(self):
        for data in [PNG[:-1], PNG[:-1] + bytes([PNG[-1] ^ 1])]:
            with self.assertRaises(ValueError):
                READER.validate_png(data, {"width": 1280, "height": 2})
        with self.assertRaises(ValueError):
            READER.parse('{"id":1,"id":2}')

    def test_early_cleanup_late_records_or_mixed_run_are_rejected(self):
        for mode in ["early", "late", "run"]:
            with self.subTest(mode=mode):
                lines, run, artifacts = sample()
                if mode == "early":
                    terminal = lines.pop()
                    lines.insert(1, terminal)
                elif mode == "late":
                    lines.append(next(line for line in lines if line.startswith("MILKUP_CASE_JSON ")))
                else:
                    terminal = json.loads(lines[-1].split(" ", 1)[1])
                    terminal["runId"] = "2"
                    lines[-1] = "MILKUP_ACCOUNT_JSON " + json.dumps(terminal)
                with self.assertRaises(ValueError):
                    self.check(lines, run, artifacts)


if __name__ == "__main__":
    unittest.main()
