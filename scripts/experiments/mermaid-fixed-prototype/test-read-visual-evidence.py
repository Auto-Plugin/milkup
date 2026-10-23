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
# Uncompressed DEFLATE deliberately crosses multiple 4096-character chunks.
PNG += png_chunk(b"IDAT", zlib.compress((b"\0" + b"\xff\xff\xff" * 640 + b"\0\0\0" * 640) * 2, level=0)) + png_chunk(b"IEND", b"")
DIGEST = hashlib.sha256(PNG).hexdigest()


def sample(partial_count=None):
    partial = partial_count is not None
    reached = FIXTURES[:partial_count] if partial else FIXTURES
    exported = reached[:-1] if partial else reached
    status = "partial-failed" if partial else "complete"
    run = {"id": 1, "run_attempt": 1, "head_sha": "a" * 40, "html_url": "synthetic", "status": "completed", "conclusion": "success"}
    if partial:
        run["conclusion"] = "failure"
    run.update(repository={"full_name": "Auto-Plugin/milkup"}, head_branch="dot/milkup-v2-mermaid-prototype")
    lines = []
    emit = lambda marker, value: lines.append(marker + " " + json.dumps(value))
    emit("MILKUP_EXECUTION_JSON", {"runId": "1", "attempt": "1", "exactSource": run["head_sha"], "captureVisualEvidence": True, "renderingInputsBaseline": READER.BASELINE, "nativeSourceBaseline": READER.NATIVE_BASELINE, "nativeSourceByteIdenticalToRenderingBaseline": False})
    user, supervisor_sid = "synthetic-user", "synthetic-supervisor"

    def token(container):
        return {"userSid": user, "elevated": False, "elevationType": 1, "administratorsGroupPresentIncludingDenyOnly": False,
                "seDebugPrivilege": {"present": False}, "isAppContainer": container, "capabilityCount": 0,
                "integrityRid": 4096 if container else 8192, "appContainerSid": "synthetic-container" if container else None}

    supervisors = []
    for phase, fixtures in [("canary", [next(f for f in FIXTURES if f["id"] == "flowchart-v2")]), ("positive", reached)]:
        supervisor = {"name": phase, "result": {"success": True, "resumed": True, "jobAssigned": True, "jobEmpty": True,
                      "exitCode": 0, "cleanupErrors": [], "suspendedToken": {"sid": user, "standardUser": True}}}
        if partial and phase == "positive":
            supervisor["result"].update(success=False, exitCode=1)
        supervisors.append(supervisor)
        emit("MILKUP_SUPERVISOR_JSON", supervisor)
        # The PowerShell case logger sorts filenames, independently of dispatch.
        for fixture in sorted(fixtures, key=lambda fixture: fixture["id"]):
            case = {"fixture": fixture["id"], "hostToken": token(False), "suspendedToken": token(True),
                 "browserToken": token(True), "browserProcessInOwnedJob": True, "cleanupSupervisorSid": supervisor_sid,
                 "cleanupErrors": [], "jobActiveAfterStop": 0, "profileDeletedAndFolderAbsent": True,
                 "privateTreeRemoved": True, "stopMatrixAfterThisCase": False, "ok": True,
                 "rawRenderSucceeded": True, "registrationMatches": True,
                 "pngValidation": {"decoded": True, "nonUniform": True, "sha256": DIGEST, "width": 1280, "height": 2},
                 "rendererMetadata": {"pngBytes": len(PNG), "rendered": {"diagramType": fixture["expectedRegistrationId"]}}}
            if partial and phase == "positive" and fixture["id"] == reached[-1]["id"]:
                case.update(ok=False, rawRenderSucceeded=False, privateTreeRemoved=False,
                            stopMatrixAfterThisCase=True, cleanupErrors=["Private tree deletion: access denied (os error 5)"],
                            pngValidation={"error": "Native ownership cleanup incomplete"})
            emit("MILKUP_CASE_JSON", case)
    context = {"schema": 1, "runId": "1", "attempt": "1", "source": run["head_sha"], "execution": "positive"}
    files = []
    encoded = base64.b64encode(PNG).decode("ascii")
    chunks = [encoded[i:i + READER.CHUNK] for i in range(0, len(encoded), READER.CHUNK)]
    for fixture in exported:
        header = dict(context, fixture=fixture["id"], sha256=DIGEST, bytes=len(PNG), width=1280, height=2, chunks=len(chunks))
        files.append(header)
        emit("MILKUP_PNG_BEGIN", header)
        for index, data in enumerate(chunks):
            emit("MILKUP_PNG_CHUNK", dict(context, fixture=fixture["id"], sha256=DIGEST, index=index, chunks=len(chunks), data=data))
        emit("MILKUP_PNG_END", header)
    emit("MILKUP_PNG_MANIFEST", dict(context, status=status, complete=not partial,
         count=len(exported), totalBytes=len(exported) * len(PNG), files=files,
         failedFixtures=[reached[-1]["id"]] if partial else [], unreachedFixtures=[f["id"] for f in FIXTURES[len(reached):]],
         capturesEnvironmentScreens=False, artifactUpload=False))
    account = {"source": run["head_sha"], "userSid": user, "cleanupSupervisorSid": supervisor_sid,
         "runId": "1", "attempt": "1",
         "captureVisualEvidence": True, "visualEvidenceEmitted": True, "visualEvidenceStatus": status,
         "accountDeleted": True, "profileDeleted": True,
         "stageRemoved": True, "cleanupErrors": [], "executions": supervisors, "localGroupSids": ["S-1-5-32-545"]}
    if partial:
        account["failure"] = READER.POSITIVE_FAILURE
    emit("MILKUP_ACCOUNT_JSON", account)
    return lines, run, {"total_count": 0, "artifacts": []}


def change_record(lines, marker, change, predicate=lambda record: True, *, last=False):
    indices = [i for i, line in enumerate(lines) if line.startswith(marker + " ") and
               predicate(json.loads(line.split(" ", 1)[1]))]
    index = indices[-1] if last else indices[0]
    record = json.loads(lines[index].split(" ", 1)[1])
    change(record)
    lines[index] = marker + " " + json.dumps(record)


class ReaderTest(unittest.TestCase):
    def check(self, lines, run, artifacts, *, allow_partial_failed=False):
        return READER.collect(("\n".join(lines) + "\n").encode(), run, artifacts, FIXTURES,
                              allow_partial_failed=allow_partial_failed)

    def test_complete_synthetic_transport(self):
        streams, result = self.check(*sample())
        self.assertEqual(len(streams), 50)
        self.assertEqual(result["totalBytes"], 50 * len(PNG))
        self.assertEqual(list(streams), [fixture["id"] for fixture in FIXTURES])
        self.assertTrue(result["complete"])
        self.assertEqual(result["failedFixtures"], [])
        self.assertTrue(result["nativeAndOuterCleanupVerified"])

    def test_missing_duplicate_reordered_or_corrupt_chunk(self):
        for mode in ["missing", "duplicate", "reordered", "index", "data"]:
            with self.subTest(mode=mode):
                lines, run, artifacts = sample()
                index = next(i for i, line in enumerate(lines) if line.startswith("MILKUP_PNG_CHUNK "))
                if mode == "missing":
                    del lines[index]
                elif mode == "duplicate":
                    lines.insert(index, lines[index])
                elif mode == "reordered":
                    lines[index], lines[index + 1] = lines[index + 1], lines[index]
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

    def test_native_diagnostic_baseline_is_explicit_and_exact(self):
        for field, value in [("nativeSourceBaseline", READER.BASELINE),
                             ("nativeSourceByteIdenticalToRenderingBaseline", True)]:
            with self.subTest(field=field):
                lines, run, artifacts = sample()
                change_record(lines, "MILKUP_EXECUTION_JSON", lambda r: r.update({field: value}))
                with self.assertRaises(ValueError):
                    self.check(lines, run, artifacts)

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

    def test_partial_requires_opt_in_and_preserves_failure_at_both_bounds(self):
        for count in [2, 3, 50]:
            with self.subTest(reached=count):
                evidence = sample(partial_count=count)
                with self.assertRaises(ValueError):
                    self.check(*evidence)
                streams, result = self.check(*evidence, allow_partial_failed=True)
                self.assertEqual(list(streams), [fixture["id"] for fixture in FIXTURES[:count - 1]])
                self.assertEqual(result["count"], count - 1)
                self.assertEqual(result["status"], "partial-failed")
                self.assertFalse(result["complete"])
                self.assertFalse(result["nativeAndOuterCleanupVerified"])
                self.assertTrue(result["outerCleanupVerified"])
                self.assertTrue(result["exportedCasesNativeCleanupVerified"])
                self.assertEqual(result["originalFailure"], READER.POSITIVE_FAILURE)
                self.assertEqual(result["failedFixtures"], [FIXTURES[count - 1]["id"]])
                self.assertEqual(result["unreachedFixtures"], [fixture["id"] for fixture in FIXTURES[count:]])
                self.assertFalse(result["failedCase"]["privateTreeRemoved"])
                self.assertEqual(result["humanVisualReview"], "pending")
        # With N=3 the failed agentflow case is alphabetically first, not last.
        lines, _, _ = sample(partial_count=3)
        records = [json.loads(line.split(" ", 1)[1]) for line in lines if line.startswith("MILKUP_CASE_JSON ")][1:]
        self.assertFalse(records[0]["ok"])
        self.assertTrue(records[-1]["ok"])

    def test_partial_rejects_false_completion_and_missing_original_failure(self):
        mutations = [
            ("MILKUP_PNG_MANIFEST", lambda r: r.update(status="complete")),
            ("MILKUP_PNG_MANIFEST", lambda r: r.update(complete=True)),
            ("MILKUP_PNG_MANIFEST", lambda r: r.update(failedFixtures=[])),
            ("MILKUP_PNG_MANIFEST", lambda r: r.update(failedFixtures=[FIXTURES[0]["id"]])),
            ("MILKUP_PNG_MANIFEST", lambda r: r.update(unreachedFixtures=[])),
            ("MILKUP_PNG_MANIFEST", lambda r: r.update(count=3)),
            ("MILKUP_ACCOUNT_JSON", lambda r: r.pop("failure")),
            ("MILKUP_ACCOUNT_JSON", lambda r: r.update(failure="Some other failure")),
            ("MILKUP_ACCOUNT_JSON", lambda r: r.update(visualEvidenceStatus="complete")),
        ]
        for index, (marker, mutation) in enumerate(mutations):
            with self.subTest(mutation=index):
                lines, run, artifacts = sample(partial_count=3)
                change_record(lines, marker, mutation)
                with self.assertRaises((ValueError, KeyError)):
                    self.check(lines, run, artifacts, allow_partial_failed=True)

    def test_partial_requires_exact_reached_prefix_and_one_final_failure(self):
        mutations = [
            lambda r: r.update(fixture=FIXTURES[10]["id"]),
            lambda r: r.update(fixture=FIXTURES[0]["id"]),
            lambda r: r.update(ok=True),
            lambda r: r.update(stopMatrixAfterThisCase=False),
            lambda r: r.update(privateTreeRemoved=True),
            lambda r: r.update(cleanupErrors=[]),
            lambda r: r.update(cleanupErrors=[""]),
            lambda r: r.update(jobActiveAfterStop=1),
            lambda r: r.update(profileDeletedAndFolderAbsent=False),
            lambda r: r["hostToken"].update(elevated=True),
        ]
        for index, mutation in enumerate(mutations):
            with self.subTest(mutation=index):
                lines, run, artifacts = sample(partial_count=3)
                change_record(lines, "MILKUP_CASE_JSON", mutation, lambda r: r["ok"] is False)
                with self.assertRaises(ValueError):
                    self.check(lines, run, artifacts, allow_partial_failed=True)
        lines, run, artifacts = sample(partial_count=3)
        change_record(lines, "MILKUP_CASE_JSON", lambda r: r.update(ok=False),
                      lambda r: r["fixture"] == FIXTURES[0]["id"])
        with self.assertRaises(ValueError):
            self.check(lines, run, artifacts, allow_partial_failed=True)
        with self.assertRaises(ValueError):
            self.check(*sample(partial_count=1), allow_partial_failed=True)

    def test_partial_requires_successful_canary_and_clean_outer_resources(self):
        for key, value in [("accountDeleted", False), ("profileDeleted", False), ("stageRemoved", False),
                           ("cleanupErrors", ["not removed"])]:
            with self.subTest(account_field=key):
                lines, run, artifacts = sample(partial_count=3)
                change_record(lines, "MILKUP_ACCOUNT_JSON", lambda r: r.update({key: value}))
                with self.assertRaises(ValueError):
                    self.check(lines, run, artifacts, allow_partial_failed=True)
        for phase, key, value in [("positive", "jobEmpty", False), ("positive", "success", True),
                                  ("positive", "exitCode", 0), ("positive", "cleanupErrors", ["outer failure"]),
                                  ("canary", "success", False), ("canary", "exitCode", 1)]:
            with self.subTest(phase=phase, field=key):
                lines, run, artifacts = sample(partial_count=3)
                change_record(lines, "MILKUP_SUPERVISOR_JSON", lambda r: r["result"].update({key: value}),
                              lambda r: r["name"] == phase)
                change_record(lines, "MILKUP_ACCOUNT_JSON",
                              lambda r: next(s for s in r["executions"] if s["name"] == phase)["result"].update({key: value}))
                with self.assertRaises(ValueError):
                    self.check(lines, run, artifacts, allow_partial_failed=True)
        lines, run, artifacts = sample(partial_count=3)
        change_record(lines, "MILKUP_CASE_JSON", lambda r: r.update(ok=False))
        with self.assertRaises(ValueError):
            self.check(lines, run, artifacts, allow_partial_failed=True)

    def test_partial_transport_rejects_mixed_identity_duplicates_and_truncation(self):
        for marker in ["MILKUP_EXECUTION_JSON", "MILKUP_PNG_BEGIN", "MILKUP_PNG_CHUNK",
                       "MILKUP_PNG_END", "MILKUP_PNG_MANIFEST", "MILKUP_ACCOUNT_JSON"]:
            for field, value in [("runId", "2"), ("attempt", "2"),
                                 ("exactSource" if marker == "MILKUP_EXECUTION_JSON" else "source", "b" * 40)]:
                with self.subTest(marker=marker, field=field):
                    lines, run, artifacts = sample(partial_count=3)
                    change_record(lines, marker, lambda r: r.update({field: value}))
                    with self.assertRaises(ValueError):
                        self.check(lines, run, artifacts, allow_partial_failed=True)
        for marker in ["MILKUP_CASE_JSON", "MILKUP_PNG_CHUNK", "MILKUP_PNG_MANIFEST", "MILKUP_ACCOUNT_JSON"]:
            with self.subTest(duplicate=marker):
                lines, run, artifacts = sample(partial_count=3)
                index = next(i for i, line in enumerate(lines) if line.startswith(marker + " "))
                lines.insert(index, lines[index])
                with self.assertRaises(ValueError):
                    self.check(lines, run, artifacts, allow_partial_failed=True)
        for marker in ["MILKUP_PNG_CHUNK", "MILKUP_PNG_END", "MILKUP_PNG_MANIFEST", "MILKUP_ACCOUNT_JSON"]:
            with self.subTest(truncate_at=marker):
                lines, run, artifacts = sample(partial_count=3)
                cut = next(i for i, line in enumerate(lines) if line.startswith(marker + " "))
                with self.assertRaises(ValueError):
                    self.check(lines[:cut], run, artifacts, allow_partial_failed=True)

    def test_png_order_is_manifest_order_in_both_modes_and_failed_fixture_cannot_export(self):
        for partial_count in [None, 3]:
            with self.subTest(partial_count=partial_count):
                lines, run, artifacts = sample(partial_count=partial_count)
                starts = [i for i, line in enumerate(lines) if line.startswith("MILKUP_PNG_BEGIN ")]
                end = next(i for i in range(starts[1], len(lines)) if lines[i].startswith("MILKUP_PNG_END ")) + 1
                lines[starts[0]:end] = lines[starts[1]:end] + lines[starts[0]:starts[1]]
                change_record(lines, "MILKUP_PNG_MANIFEST",
                              lambda r: r["files"].__setitem__(slice(0, 2), r["files"][1::-1]))
                with self.assertRaises(ValueError):
                    self.check(lines, run, artifacts, allow_partial_failed=True)
        lines, run, artifacts = sample(partial_count=3)
        # A fully framed, otherwise valid PNG for the failed fixture is still forbidden.
        original, failed = FIXTURES[1]["id"], FIXTURES[2]["id"]
        for marker in ["MILKUP_PNG_BEGIN", "MILKUP_PNG_END"]:
            change_record(lines, marker, lambda r: r.update(fixture=failed), lambda r: r["fixture"] == original)
        for i, line in enumerate(lines):
            if line.startswith("MILKUP_PNG_CHUNK "):
                record = json.loads(line.split(" ", 1)[1])
                if record["fixture"] == original:
                    record["fixture"] = failed
                    lines[i] = "MILKUP_PNG_CHUNK " + json.dumps(record)
        change_record(lines, "MILKUP_PNG_MANIFEST", lambda r: r["files"][1].update(fixture=failed))
        with self.assertRaises(ValueError):
            self.check(lines, run, artifacts, allow_partial_failed=True)

    def test_partial_opt_in_does_not_accept_other_run_outcomes_or_complete_failure(self):
        for conclusion in ["success", "cancelled", "timed_out"]:
            with self.subTest(conclusion=conclusion):
                lines, run, artifacts = sample(partial_count=3)
                run["conclusion"] = conclusion
                with self.assertRaises(ValueError):
                    self.check(lines, run, artifacts, allow_partial_failed=True)
        lines, run, artifacts = sample()
        run["conclusion"] = "failure"
        with self.assertRaises(ValueError):
            self.check(lines, run, artifacts, allow_partial_failed=True)


if __name__ == "__main__":
    unittest.main()
