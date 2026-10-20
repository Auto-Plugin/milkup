#!/usr/bin/env python3
"""Verify frozen W0 UDP evidence, including raw failure logs, without extraction."""
from pathlib import Path
from collections import Counter
from io import BytesIO
import hashlib
import json
import re
import zipfile

root = Path(__file__).resolve().parent
index = json.loads((root / "index.json").read_text())
archive = root / index["archive"]
assert archive.stat().st_size == index["archiveBytes"]
assert hashlib.sha256(archive.read_bytes()).hexdigest() == index["archiveSha256"]
cases = {
    "D01-socket-paths": "4ed8d76439243d0fef4677d12b40460caaab4886",
    "D02-valid-observer": "323c27d83c5ac17e87a3bf9709f77863eb8b786b",
    "D03-async-policy": "6af70966994927e116d58de40c46398d1ccf0e43",
}
with zipfile.ZipFile(archive) as bundle:
    assert bundle.testzip() is None
    assert len(bundle.namelist()) == len(set(bundle.namelist()))
    assert set(bundle.namelist()) == {r["path"] for r in index["members"]}
    for row in index["members"]:
        path = Path(row["path"])
        assert not path.is_absolute() and ".." not in path.parts
        assert path.suffix.lower() not in {".exe", ".dll", ".msi", ".msix", ".deb"}
        data = bundle.read(row["path"])
        assert len(data) == row["bytes"]
        assert hashlib.sha256(data).hexdigest() == row["sha256"]

    def load(path):
        return json.loads(bundle.read(path))

    reports = {}
    for name, sha in cases.items():
        run = load(name + "/run.json")
        assert run["head_sha"] == sha and run["status"] == "completed"
        assert run["conclusion"] == ("success" if name.startswith("D01") else "failure")
        assert load(name + "/artifacts.json")["total_count"] == 0
        commit = load(name + "/commit.json")
        assert commit["sha"] == sha
        for role in ["author", "committer"]:
            assert commit[role]["login"] == "LarryZhu-dev"
            assert commit[role]["id"] == 40397402
            assert commit["commit"][role]["name"] == "LarryZhu-dev"
            assert commit["commit"][role]["email"] == "larryzhu@foxmail.com"
        manifest = load(name + "/source-manifest.json")
        assert manifest["source"] == sha
        for row in manifest["files"]:
            data = bundle.read(name + "/source/" + row["path"])
            assert len(data) == row["bytes"]
            assert hashlib.sha1(f"blob {len(data)}\0".encode() + data).hexdigest() == row["gitBlob"]
        with zipfile.ZipFile(BytesIO(bundle.read(name + "/run-logs.zip"))) as raw_zip:
            assert raw_zip.testzip() is None
            for member in raw_zip.namelist():
                if not member.endswith("/"):
                    assert raw_zip.read(member) == bundle.read(name + "/run-logs/" + member)
        raw_path = name + "/run-logs/windows-w0/6_Run authorized temporary AppContainer experiment.txt"
        raw = bundle.read(raw_path).decode("utf-8-sig")
        stripped = "\n".join(re.sub(r"^\ufeff?\d{4}-\d\d-\d\dT[^ ]+ ", "", line)
                             for line in raw.splitlines())
        groups = dict(re.findall(r"^##\[group\]([^\r\n]+)\n(.*?)^##\[endgroup\]",
                                 stripped, re.M | re.S))
        body = groups["windows-w0-matrix.json"]
        if not name.startswith("D01"):
            provenance = load(name + "/windows-w0-matrix-parse-provenance.json")
            lines = body.splitlines()
            removed = provenance["separatedStderrLines"]
            assert len(removed) == (1 if name.startswith("D02") else 6)
            for item in removed:
                assert lines[item["groupLine"] - 1] == item["text"]
            skip = {r["groupLine"] for r in removed}
            body = "\n".join(line for i, line in enumerate(lines, 1) if i not in skip)
        report = load(name + "/windows-w0-matrix.json")
        assert json.loads(body) == report
        assert report["source"] == sha
        assert report["productIntegrated"] is False and report["fullIsolationGatePassed"] is False
        assert report["cleanupErrors"] == [] and report["outsideFileUnchanged"]
        assert report["privateTreeAndAclRemoved"] and report["profileDeletedAndFolderAbsent"]
        for key, value in report.items():
            if key.startswith("loopbackExemptions"):
                assert value["entryCount"] == 0 and value["ownSidPresent"] is False
        for case in report["cases"]:
            assert case["completed"] and not case.get("error")
            assert case["accountingAfterStop"]["activeProcesses"] == 0
            assert all(p["signaledAfterStop"] for p in case["retainedProcessHandles"])
        reports[name] = report
        if name.startswith("D01"):
            assert report["networkCanaryGatePassed"] is True  # preserve the invalid raw verdict
            assert load(name + "/interpretation.json")["validExperiment"] is False
            errors = [e for e in report["endpointObservationsFinal"] if "listenerError" in e]
            assert len(errors) == 3 and all("10054" in e["listenerError"] for e in errors)
            continue
        assert "test result: ok. 3 passed; 0 failed;" in raw
        assessment = report["networkAssessment"]
        assert assessment["observationControlsPassed"]
        assert assessment["observerErrors"] == [] and assessment["missingPositiveControls"] == []
        assert report["networkCanaryGatePassed"] is False
        events = report["endpointObservationsFinal"]
        assert Counter((e.get("turnUsername"), e["family"]) for e in events if e.get("turnUsername")) == {
            (case, family): 4 for case in ["ordinary", "restricted"]
            for family in ["ipv4", "ipv6", "nic-ipv4"]
        }
        variant_count = 5 if name.startswith("D02") else 7
        for case in report["cases"]:
            retained = {p["pid"]: p for p in case["retainedProcessHandles"]}
            roles = {p["pid"]: p["kind"]
                     for p in case["child"]["webviewProcessInfosAfterNetwork"]["processes"]}
            for key in ["udpBeforeRuntime", "udpAfterRuntime"]:
                probe = case["child"][key]
                assert len(probe["cases"]) == 3 * variant_count
                assert probe["threadImpersonation"] == {"present": False, "rawOsError": 1008}
                for row in probe["cases"]:
                    receipts = [e for e in events if e.get("nativeMarker") == row["marker"]]
                    assert row["sendResult"]["ok"]
                    repeated = row["variant"] == "wildcard-repeated"
                    if case["name"] == "ordinary":
                        assert len(receipts) == (3 if repeated else 1)
                        if row["holdMs"]:
                            assert row["reply"]["exactEcho"]
                    elif repeated:
                        assert len(receipts) == 2 and row["reply"]["exactEcho"]
                        assert len(row["sendResult"]["attempts"]) == 3
                        for receipt in receipts:
                            assert len(receipt["socketOwners"]["owners"]) == 1
                            owner = receipt["socketOwners"]["owners"][0]
                            assert owner["pid"] == probe["pid"]
                            assert owner["token"] == probe["token"]
                            assert retained[owner["pid"]]["inOwnerJob"]
                    else:
                        assert len(receipts) == 0
            if case["name"] != "restricted":
                continue
            helper_token = case["child"]["udpBeforeRuntime"]["token"]
            assert helper_token["isAppContainer"] and helper_token["capabilities"] == []
            assert helper_token["capabilityCount"] == 0
            assert helper_token["appContainerSid"] == report["appContainerSid"]
            for event in [e for e in events if e.get("turnUsername") == "restricted"]:
                owners = event["socketOwners"]["owners"]
                assert len(owners) == 1
                owner = owners[0]
                assert retained[owner["pid"]]["inOwnerJob"] and roles[owner["pid"]] == 2
                assert owner["token"] == helper_token
                if name.startswith("D03"):
                    threads = owner["threadTokens"]["threads"]
                    assert threads and all(t.get("threadTokenPresent") is False
                                           and t.get("rawOsError") == 1008 for t in threads)
        assert len(assessment["receivedRestrictedCanaries"]) == (12 if name.startswith("D02") else 24)
        if name.startswith("D03"):
            before = load(name + "/windows-w0-policy-before.json")
            after = load(name + "/windows-w0-policy-after.json")
            assert before == after
            for phase in ["before", "after"]:
                policy = load(name + f"/windows-w0-policy-{phase}.json")
                assert json.loads(groups[f"windows-w0-policy-{phase}.json"]) == policy
                assert policy["queryErrors"] == [] and policy["readOnly"]
                assert policy["changedConfiguration"] is False
                assert len(policy["activeProfiles"]) == 3
                assert all(profile["Enabled"] == 1 for profile in policy["activeProfiles"])
            assert before["activeRuleCounts"] == [
                {"Name": "Allow, Inbound", "Count": 100},
                {"Name": "Allow, Outbound", "Count": 82},
                {"Name": "Block, Outbound", "Count": 1},
            ]
            assert len(before["runtimeProgramRules"]) == 1
            assert before["runtimeProgramRules"][0]["Direction"] == 1
            assert before["runtimeProgramRules"][0]["Action"] == 2
            assert before["qwaveState"] == [{"Name": "QWAVE", "Status": 1, "StartType": 3}]
    tests = bundle.read("local-ci-tests.log").decode()
    assert "tests 58" in tests and "pass 58" in tests and "fail 0" in tests
    assert "Finished" in bundle.read("local-crosscheck.log").decode()
    assert bundle.read("local-rustfmt.log") == b""
    validation = load("validation.json")
    assert validation["previousFrozenArchiveSha256"] == \
        "97125a8e35b8e3aa20b93285e071680f795497bb6ea61415dd0c8cf28b62fad8"
print(f"Verified {len(index['members'])} members: D01 invalid, D02/D03 failed, "
      "native repeated UDP delivered before Runtime, product closed, artifacts 0.")
