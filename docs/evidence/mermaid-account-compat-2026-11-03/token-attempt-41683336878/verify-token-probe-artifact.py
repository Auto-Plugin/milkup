#!/usr/bin/env python3
"""Offline token-probe evidence verifier. Never extracts or changes input files.

Use --artifacts saved-api.json --zip saved.zip. Exit 0 means the fixed diagnostic
observation and recorded cleanup are complete, never rendering/product approval.
--self-test creates only labelled synthetic local fixtures; no Windows is run.
"""
import argparse
import hashlib
import io
import json
import re
import stat
import tempfile
import warnings
import zipfile
from pathlib import Path

DEFAULT_RUN = "41681937161"
DEFAULT_CANDIDATE = "93755eb640b2dc8a1b614c3bd7cf175b253c6ab8"
ATTEMPT = "1"
MIB = 1024 * 1024
FILE_LIMIT, TOTAL_LIMIT = 2 * MIB, 40 * MIB
KINDS = ("pure-standard", "filtered-admin")
TEST = "launcher::token_diagnostic::parent_observes_suspended_and_self_tokens"
MARKER = "MILKUP_MERMAID_TOKEN_DIAGNOSTIC "
SCOPE = "Fixed trusted token observations only; no document or browser execution"
ROOT_FILES = {"source-checkout.json", "source-pre-probe.json", "source-final.json",
              "probe-build-record.json", "wrapper-regressions.json"}
CHILD_FILES = {"windows-mermaid-token-probe-audit.json", "token-probe-result.json",
               "token-probe-stdout.log", "token-probe-stderr.log", "token-probe-context.json",
               "token-probe-child-result.json", "token-probe-evidence-files.json"}
AUDIT = "windows-mermaid-token-probe-audit.json"
INNER = "token-probe-evidence-files.json"
SIX_FILES = CHILD_FILES - {INNER}
FIVE_FILES = SIX_FILES - {AUDIT}
ALL_FILES = ROOT_FILES | {f"{kind}/{name}" for kind in KINDS for name in CHILD_FILES} | {"manifest.json"}
NATIVE_KEYS = set("schema status accountKind parentPid childPid host suspendedParentView childSelfView failedStage mermaidSourceBytes comStarted webviewStarted javascriptStarted renderPolicyChanged diagnosticOnly childDeadlineMs cleanup hostPolicyAccepted freshAppContainerSid executionAncestryAccessDenials creationTimeJobVerified childExitCode stdoutBytes stderrBytes stdoutSha256 stderrSha256 parentAndSelfPrivilegesMatch parentAndSelfIdentityMatch".split())


def need(condition, message):
    if not condition:
        raise ValueError(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def unique_object(items):
    result = {}
    for key, value in items:
        need(key not in result, "Duplicate JSON key: " + str(key)[:100])
        result[key] = value
    return result


def parse(data):
    def bad_constant(value):
        raise ValueError("Non-finite JSON constant")
    return json.loads(data.decode("utf-8-sig"), object_pairs_hook=unique_object,
                      parse_constant=bad_constant)


def encoded(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()


def equal(left, right):
    # Unlike Python ==, this does not equate true with 1 or false with 0.
    return encoded(left) == encoded(right)


def integer(value, minimum=0, maximum=0xffffffff):
    return type(value) is int and minimum <= value <= maximum


def keys(value, required, optional=()):
    need(isinstance(value, dict), "JSON object required")
    need(set(required) <= set(value) <= set(required) | set(optional), "Closed object keys mismatch")


def flags(value, true=(), false=()):
    need(isinstance(value, dict), "Flag object required")
    for name in true:
        need(value.get(name) is True, "Required true flag: " + name)
    for name in false:
        need(value.get(name) is False, "Required false flag: " + name)


def plain_read(file, limit):
    info = file.lstat()
    need(stat.S_ISREG(info.st_mode) and not file.is_symlink(), "Plain input file required")
    need(info.st_size <= limit, "Input byte budget exceeded")
    with file.open("rb") as stream:
        data = stream.read(limit + 1)
    need(len(data) == info.st_size and len(data) <= limit, "Input changed or grew beyond budget")
    return data


def message(error):
    return (type(error).__name__ + ": " + str(error))[:600]


def proof(name, data):
    return {"name": name, "bytes": len(data), "sha256": digest(data)}


def file_entries(entries, files, permitted, expected):
    need(isinstance(entries, list) and len(entries) <= len(permitted), "Bounded file list required")
    seen = set()
    total = 0
    for item in entries:
        keys(item, ("name", "bytes", "sha256"))
        name = item["name"]
        need(isinstance(name, str) and name in permitted and name not in seen,
             "Unknown or duplicate manifest filename")
        seen.add(name)
        need(name in files, "Manifest file missing: " + name)
        need(integer(item["bytes"], 0, FILE_LIMIT) and item["bytes"] == len(files[name]),
             "Manifest file byte count mismatch: " + name)
        need(item["sha256"] == digest(files[name]), "Manifest file SHA256 mismatch: " + name)
        total += item["bytes"]
    need(seen == expected, "Manifest filename set is not exact")
    return total


def native_complete(value, parent_pid):
    need(value.get("status") == "observed", "Native diagnostic was not observed")
    need(integer(parent_pid, 1) and value.get("parentPid") == parent_pid
         and integer(value.get("parentPid"), 1) and integer(value.get("childPid"), 1),
         "Native process IDs are not bound to the held probe")
    flags(value, ("diagnosticOnly", "hostPolicyAccepted", "creationTimeJobVerified", "parentAndSelfIdentityMatch"),
          ("renderPolicyChanged", "comStarted", "webviewStarted", "javascriptStarted"))
    need(type(value.get("parentAndSelfPrivilegesMatch")) is bool, "Privilege comparison must be an observation boolean")
    need(type(value.get("mermaidSourceBytes")) is int and value["mermaidSourceBytes"] == 0
         and type(value.get("childExitCode")) is int and value["childExitCode"] == 0
         and "failedStage" in value and value["failedStage"] is None, "Native exit/stage/source mismatch")
    for field, caller, observer in (("suspendedParentView", "parent-suspended-child", parent_pid),
                                    ("childSelfView", "appcontainer-self", value["childPid"])):
        view = value.get(field)
        flags(view, ("complete",))
        need(view.get("caller") == caller and integer(view.get("observerPid"), 1)
             and view["observerPid"] == observer and integer(view.get("subjectPid"), 1)
             and view["subjectPid"] == value["childPid"]
             and type(view.get("requestedSourceTokenAccess")) is int
             and view["requestedSourceTokenAccess"] == 8, "Native observer identity mismatch")
        thread = view.get("callerThreadToken")
        flags(thread, ("complete", "handleClosed"), ("present",))
        need(type(thread.get("win32Error")) is int and thread["win32Error"] == 1008
             and "token" in thread and thread["token"] is None, "Caller thread ERROR_NO_TOKEN evidence missing")
    cleanup = value.get("cleanup")
    flags(cleanup, ("jobCreated", "jobEmpty", "profileCreated", "profileDeleted",
                    "privateTreeCreated", "privateTreeRemoved", "ipcCompleted"))
    need(cleanup.get("errors") == [], "Native cleanup errors present or unknown")
    joins = cleanup.get("joins")
    need(isinstance(joins, list) and len(joins) == 2
         and sorted(item.get("stream", "") for item in joins) == ["stderr", "stdout"],
         "Native stream identities missing or duplicated")
    for item in joins:
        flags(item, ("finished",), ("cancelRequested", "panicked"))


def account_observation(files, kind, run, candidate, build):
    row = {"present": bool(files), "missingFiles": sorted(CHILD_FILES - set(files)),
           "evidenceVerified": False, "diagnosticObserved": False, "observationComplete": False,
           "cleanupVerified": False, "integrityErrors": [], "observationIssues": []}
    if not files:
        row["observationIssues"].append("Account evidence absent")
        return row
    parsed = {name: parse(data) for name, data in files.items() if name.endswith(".json")}
    audit, child, native, context = (parsed.get(name) for name in
        (AUDIT, "token-probe-child-result.json", "token-probe-result.json", "token-probe-context.json"))
    try:
        inner = parsed.get(INNER)
        keys(inner, ("schema", "status", "complete", "expectedAccountKind", "source", "files", "totalBytes"))
        need(type(inner["schema"]) is int and inner["schema"] == 1 and inner["source"] == candidate
             and inner["expectedAccountKind"] == kind, "Inner evidence manifest identity mismatch")
        need(inner["status"] in ("passed", "failed", "blocked") and type(inner["complete"]) is bool
             and inner["complete"] == (inner["status"] == "passed"), "Inner manifest status mismatch")
        total = file_entries(inner["files"], files, SIX_FILES, set(files) - {INNER})
        need(integer(inner["totalBytes"], 0, 7 * MIB) and inner["totalBytes"] == total,
             "Inner manifest aggregate mismatch")
        need(isinstance(audit, dict) and audit.get("schema") == 1 and type(audit["schema"]) is int,
             "Outer account audit missing/schema invalid")
        need(audit.get("source") == candidate and audit.get("runId") == run
             and audit.get("attempt") == ATTEMPT and audit.get("expectedAccountKind") == kind
             and audit.get("testName") == TEST and audit.get("status") == inner["status"],
             "Outer account audit identity/status mismatch")
        need(isinstance(audit.get("localRunId"), str) and re.fullmatch(r"[a-f0-9]{32}", audit["localRunId"]),
             "Local account run GUID invalid")
        row["wrapperStatus"] = audit["status"]
        copy = audit.get("evidenceCopy")
        if copy is not None:
            keys(copy, ("complete", "files", "bytes", "rejected"))
            need(type(copy["complete"]) is bool and isinstance(copy["rejected"], list), "Invalid bounded child copy result")
            copied = set(files) & FIVE_FILES
            copied_bytes = file_entries(copy["files"], files, FIVE_FILES, copied)
            rejected = copy["rejected"]
            need(len(rejected) <= 5 and len({item.get("name") for item in rejected}) == len(rejected)
                 and {item.get("name") for item in rejected} == FIVE_FILES - copied,
                 "Child copy rejection set mismatch")
            need(copy["complete"] == (not rejected) and integer(copy["bytes"], 0, 6 * MIB)
                 and copy["bytes"] == copied_bytes, "Child copy completeness/bytes mismatch")
        if build is not None:
            need(audit.get("expectedProbeExeSha256") == build["sha256"], "Expected probe SHA differs from root build")
            for record in (audit.get("probe"), child.get("probe") if isinstance(child, dict) else None):
                if record is not None:
                    keys(record, ("path", "bytes", "sha256"))
                    need(record["sha256"] == build["sha256"] and type(record["bytes"]) is int
                         and record["bytes"] == build["bytes"], "Staged probe bytes/SHA differ from build record")
            row["probeBuildBindingChecked"] = True
        if child is not None:
            need(child.get("schema") == 1 and type(child["schema"]) is int
                 and child.get("status") in ("passed", "failed")
                 and type(child.get("complete")) is bool
                 and child["complete"] == (child["status"] == "passed")
                 and child.get("candidateSha") == candidate and child.get("expectedAccountKind") == kind
                 and child.get("testName") == TEST and child.get("expectedSid") == audit.get("accountSid"),
                 "Child result identity/status mismatch")
            need(equal(audit.get("childResult"), child), "Embedded child result differs from retained child JSON")
        if context is not None:
            need(context.get("schema") == 1 and type(context["schema"]) is int
                 and context.get("expectedAccountKind") == kind
                 and context.get("expectedSid") == audit.get("accountSid"), "Context identity mismatch")
        if native is not None:
            need(isinstance(native, dict) and set(native) <= NATIVE_KEYS
                 and type(native.get("schema")) is int and native["schema"] == 1
                 and native.get("accountKind") == kind and native.get("status") in ("observed", "failed"),
                 "Native closed envelope identity/status mismatch")
            row["nativeStatus"] = native["status"]
        stdout = files.get("token-probe-stdout.log")
        if stdout is not None:
            text = stdout.decode("utf-8-sig")
            pattern = re.compile(r"(?m)^(?:test " + re.escape(TEST) + r" \.\.\. )?" + re.escape(MARKER) + r"([^\r\n]+)\r?$")
            markers = pattern.findall(text)
            row["stdoutMarkerCount"] = len(markers)
            if native is not None:
                need(len(markers) == 1 and text.count(MARKER) == 1, "Exactly one native stdout marker required")
                need(len(markers[0].encode()) <= MIB and equal(parse(markers[0].encode()), native),
                     "Stdout marker differs from retained native result")
                row["stdoutMarkerMatchesResult"] = True
            elif markers:
                row["observationIssues"].append("Stdout contains diagnostic marker but retained result JSON is missing")
        row["evidenceVerified"] = True
    except Exception as error:
        row["integrityErrors"].append(message(error))
    if native is not None and native.get("status") == "observed" and child is not None:
        try:
            native_complete(native, child.get("process", {}).get("pid"))
            row["diagnosticObserved"] = row["evidenceVerified"] and row.get("stdoutMarkerMatchesResult") is True
        except Exception as error:
            row["observationIssues"].append(message(error))
    try:
        need(not row["missingFiles"], "Required account files are missing")
        need(row["evidenceVerified"] and row["diagnosticObserved"], "Diagnostic was not completely observed")
        need(build is not None and row.get("probeBuildBindingChecked") is True
             and audit.get("probe") is not None and child.get("probe") is not None, "Probe build binding incomplete")
        need(audit["status"] == "passed" and child["status"] == "passed" and child.get("diagnosticStatus") == "observed",
             "Account wrapper/child did not complete")
        need(audit.get("cleanupErrors") == [] and audit.get("error") is None, "Outer cleanup/error remains")
        flags(audit, ("accountCreated", "accountDeleted", "profileDeleted", "stageRemoved", "accountGroupCleanupConfirmed"),
              ("changedAcl", "changedUacOrSecurityPolicy", "runtimeInstalled", "browserStartedByWrapper",
               "desktopRequired", "inheritedRunnerEnvironment", "passwordInLogsFilesArgumentsOrEnvironment",
               "originalProductReportsModified", "renderingPolicyChanged"))
        group = audit.get("accountGroupCleanup")
        flags(group, ("readOnly", "complete"))
        need(group.get("sid") == audit["accountSid"] and group.get("errors") == [], "Account group cleanup identity/errors")
        groups = group.get("groups")
        need(isinstance(groups, list) and len(groups) == 2
             and {item.get("groupSid") for item in groups} == {"S-1-5-32-545", "S-1-5-32-544"}, "Group cleanup set incomplete")
        for item in groups:
            flags(item, ("queried",), ("exactSidPresent",))
        supervisor = audit.get("supervisor")
        flags(supervisor, ("success", "resumed", "jobAssigned", "jobEmpty", "accountKindVerified"),
              ("inheritedParentEnvironment", "existingDesktopAclChanged", "productInnerCleanupProvedByOuterJob"))
        need(supervisor.get("status") == "passed" and supervisor.get("expectedAccountKind") == kind
             and type(supervisor.get("exitCode")) is int and supervisor["exitCode"] == 0
             and type(supervisor.get("activeBeforeOuterCleanup")) is int and supervisor["activeBeforeOuterCleanup"] == 0
             and supervisor.get("cleanupErrors") == [], "Outer supervisor cleanup incomplete")
        process = child.get("process")
        flags(process, ("started", "exited", "streamsDrained"),
              ("timedOut", "captureExceeded", "forcedProcessTermination", "forcedNodeTermination",
               "useShellExecute", "credentialsSpecified", "breakawayRequested"))
        need(process.get("status") == "passed" and process.get("tool") == "TokenProbe"
             and type(process.get("exitCode")) is int and process["exitCode"] == 0
             and process.get("cleanupErrors") == [], "Probe process output/cleanup incomplete")
        for stream in ("stdout", "stderr"):
            need(type(process.get(stream + "Bytes")) is int and process[stream + "Bytes"] == len(files[f"token-probe-{stream}.log"]),
                 "Captured stream byte count differs from retained log")
        flags(context, ("accountKindVerified",), ("desktopRequired", "securityPolicyChanged", "existingAclChanged"))
        need(context.get("actualSid") == context.get("expectedSid") == audit.get("accountSid"), "Context SID binding mismatch")
        row["cleanupVerified"] = True
        row["observationComplete"] = True
    except Exception as error:
        row["observationIssues"].append(message(error))
    return row


def verify(artifacts_path, zip_path, run, candidate):
    result = {"schema": 1, "workflowRunId": run, "runAttempt": ATTEMPT, "candidateSha": candidate,
              "artifactName": f"mermaid-token-observation-{run}-{ATTEMPT}", "evidenceVerified": False,
              "diagnosticObservedAccounts": [], "overallObservationComplete": False,
              "notProductAcceptance": True, "tokenMeaningInterpreted": False,
              "integrityErrors": [], "observationIssues": [], "files": [], "accounts": {},
              "networkAccessed": False, "inputsModified": False, "archiveExtracted": False}
    files = {}
    try:
        need(re.fullmatch(r"[1-9][0-9]*", run) and re.fullmatch(r"[a-f0-9]{40}", candidate), "Exact expected run/candidate required")
        api = parse(plain_read(artifacts_path, FILE_LIMIT))
        need(isinstance(api.get("artifacts"), list), "Saved API artifact list required")
        matches = [item for item in api["artifacts"] if item.get("name") == result["artifactName"]]
        need(len(matches) == 1, "Exactly one exact-name API artifact required")
        artifact = matches[0]
        need(artifact.get("expired") is False and artifact.get("workflow_run", {}).get("id") == int(run)
             and artifact.get("workflow_run", {}).get("head_sha") == candidate, "API artifact run/head/expiry mismatch")
        raw = plain_read(zip_path, TOTAL_LIMIT + MIB)
        result["zip"] = {"bytes": len(raw), "sha256": digest(raw), "artifactId": artifact.get("id")}
        need(type(artifact.get("size_in_bytes")) is int and artifact["size_in_bytes"] == len(raw)
             and artifact.get("digest") == "sha256:" + digest(raw), "API ZIP bytes/digest mismatch")
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            infos = archive.infolist()
            need(len(infos) <= 22 and sum(item.file_size for item in infos) <= TOTAL_LIMIT,
                 "ZIP entry/aggregate budget exceeded")
            seen = set()
            for item in infos:
                name = item.orig_filename
                need(name == item.filename and "\\" not in name and "\x00" not in name, "Noncanonical ZIP name")
                need(name.casefold() not in seen, "ZIP duplicate/case collision")
                seen.add(name.casefold())
                mode = item.external_attr >> 16
                need(not stat.S_ISLNK(mode) and not (item.external_attr & 0x400), "ZIP symlink/reparse entry forbidden")
                need(not (item.flag_bits & 1), "Encrypted ZIP forbidden")
                if item.is_dir():
                    need(name in {kind + "/" for kind in KINDS} and stat.S_IFMT(mode) in (0, stat.S_IFDIR)
                         and item.file_size == 0, "Unexpected ZIP directory")
                    continue
                need(name in ALL_FILES and stat.S_IFMT(mode) in (0, stat.S_IFREG), "Unapproved ZIP path/type: " + name[:120])
                need(0 <= item.file_size <= FILE_LIMIT, "ZIP per-file budget exceeded")
            for item in infos:
                if item.is_dir():
                    continue
                with archive.open(item) as stream:
                    data = stream.read(FILE_LIMIT + 1)
                need(len(data) == item.file_size and len(data) <= FILE_LIMIT, "ZIP member size mismatch")
                files[item.filename] = data
                result["files"].append(proof(item.filename, data))
                if item.filename.endswith(".json"):
                    parse(data)
        need("manifest.json" in files, "Root manifest missing")
        manifest = parse(files["manifest.json"])
        keys(manifest, ("candidateSha", "files", "scope"))
        need(manifest["candidateSha"] == candidate and manifest["scope"] == SCOPE, "Root manifest identity/scope mismatch")
        file_entries(manifest["files"], files, ALL_FILES - {"manifest.json"}, set(files) - {"manifest.json"})
        result["evidenceVerified"] = True
    except Exception as error:
        result["integrityErrors"].append(message(error))
    result["missingFiles"] = sorted(ALL_FILES - set(files))
    build = None
    if result["evidenceVerified"]:
        try:
            if "probe-build-record.json" in files:
                build = parse(files["probe-build-record.json"])
                keys(build, ("candidateSha", "executable", "bytes", "sha256", "testOnly", "desktopBuilt", "documentRendering"))
                need(build["candidateSha"] == candidate and integer(build["bytes"], 1, 64 * MIB)
                     and isinstance(build["sha256"], str) and re.fullmatch(r"[a-f0-9]{64}", build["sha256"]), "Build record identity/hash invalid")
                flags(build, ("testOnly",), ("desktopBuilt", "documentRendering"))
            else:
                result["observationIssues"].append("Root probe build record missing")
        except Exception as error:
            build = None
            result["integrityErrors"].append(message(error))
        for kind in KINDS:
            account_files = {name.split("/", 1)[1]: data for name, data in files.items() if name.startswith(kind + "/")}
            try:
                row = account_observation(account_files, kind, run, candidate, build)
            except Exception as error:
                row = {"present": bool(account_files), "evidenceVerified": False, "diagnosticObserved": False,
                       "observationComplete": False, "integrityErrors": [message(error)], "observationIssues": []}
            result["accounts"][kind] = row
            if row["present"] and not row["evidenceVerified"]:
                result["integrityErrors"].append(kind + ": inner evidence verification failed")
            if row["diagnosticObserved"]:
                result["diagnosticObservedAccounts"].append(kind)
        for phase in ("checkout", "pre-probe", "final"):
            name = f"source-{phase}.json"
            try:
                need(name in files, "Source snapshot missing: " + phase)
                source = parse(files[name])
                need(source.get("candidateSha") == candidate and source.get("instrumentationSha") == candidate
                     and source.get("phase") == phase and source.get("readOnly") is True
                     and source.get("refreshedIndex") is False and source.get("rawStatus") == "", "Source snapshot was not exact and clean: " + phase)
            except Exception as error:
                result["observationIssues"].append(message(error))
        try:
            need("wrapper-regressions.json" in files, "Wrapper regression record missing")
            wrapper = parse(files["wrapper-regressions.json"])
            need(wrapper.get("status") == "passed" and integer(wrapper.get("tests"), 1, 1024)
                 and isinstance(wrapper.get("cases"), list) and wrapper["tests"] == len(wrapper["cases"])
                 and all(item.get("passed") is True for item in wrapper["cases"]), "Wrapper regression record incomplete")
            flags(wrapper, false=("nativeTokenProbeExecuted", "windowsAccountOperations", "remoteTasksTriggered"))
        except Exception as error:
            result["observationIssues"].append(message(error))
    for kind in KINDS:
        result["accounts"].setdefault(kind, {"present": any(name.startswith(kind + "/") for name in files),
            "evidenceVerified": False, "diagnosticObserved": False, "observationComplete": False,
            "integrityErrors": [], "observationIssues": ["Not evaluated after outer integrity failure"]})
    result["evidenceVerified"] = result["evidenceVerified"] and not result["integrityErrors"]
    result["overallObservationComplete"] = result["evidenceVerified"] and not result["missingFiles"] \
        and not result["observationIssues"] and all(row["observationComplete"] for row in result["accounts"].values())
    return result


def self_test():
    run, candidate = DEFAULT_RUN, DEFAULT_CANDIDATE
    sha, sid = "a" * 64, "S-1-5-21-1-2-3-1001"
    build = {"candidateSha": candidate, "executable": "C:/synthetic/build.exe", "bytes": 123, "sha256": sha,
             "testOnly": True, "desktopBuilt": False, "documentRendering": False}

    def fixture(kind, failed=False, cleanup_failed=False):
        thread = {"present": False, "complete": True, "handleClosed": True, "win32Error": 1008, "token": None}
        native = {"schema": 1, "status": "failed" if failed else "observed", "accountKind": kind,
            "parentPid": 101, "childPid": 102, "diagnosticOnly": True, "hostPolicyAccepted": True,
            "creationTimeJobVerified": True, "parentAndSelfIdentityMatch": True, "parentAndSelfPrivilegesMatch": False,
            "renderPolicyChanged": False, "comStarted": False, "webviewStarted": False, "javascriptStarted": False,
            "mermaidSourceBytes": 0, "childExitCode": 0, "failedStage": "synthetic-failure" if failed else None,
            "cleanup": {**{key: True for key in ("jobCreated", "jobEmpty", "profileCreated", "profileDeleted",
                "privateTreeCreated", "privateTreeRemoved", "ipcCompleted")}, "errors": [],
                "joins": [{"stream": name, "finished": True, "cancelRequested": False, "panicked": False} for name in ("stdout", "stderr")]}}
        for field, caller, observer in (("suspendedParentView", "parent-suspended-child", 101), ("childSelfView", "appcontainer-self", 102)):
            native[field] = {"complete": True, "caller": caller, "requestedSourceTokenAccess": 8,
                             "observerPid": observer, "subjectPid": 102, "callerThreadToken": thread}
        stdout = b"SYNTHETIC LOCAL FIXTURE ONLY\n" + ("test " + TEST + " ... " + MARKER).encode() + encoded(native) + b"\n"
        probe = {"path": "C:/synthetic/staged.exe", "bytes": 123, "sha256": sha}
        process = {"status": "failed" if failed else "passed", "pid": 101, "tool": "TokenProbe", "exitCode": 1 if failed else 0,
                   "cleanupErrors": [], "stdoutBytes": len(stdout), "stderrBytes": 0,
                   **{key: True for key in ("started", "exited", "streamsDrained")},
                   **{key: False for key in ("timedOut", "captureExceeded", "forcedProcessTermination", "forcedNodeTermination", "useShellExecute", "credentialsSpecified", "breakawayRequested")}}
        child = {"schema": 1, "status": "failed" if failed else "passed", "complete": not failed,
                 "candidateSha": candidate, "expectedAccountKind": kind, "expectedSid": sid,
                 "probe": probe, "testName": TEST, "process": process, "diagnosticStatus": native["status"]}
        context = {"schema": 1, "expectedAccountKind": kind, "expectedSid": sid, "actualSid": sid,
                   "accountKindVerified": True, "desktopRequired": False, "securityPolicyChanged": False, "existingAclChanged": False}
        audit = {"schema": 1, "source": candidate, "runId": run, "attempt": ATTEMPT, "localRunId": "b" * 32,
                 "expectedAccountKind": kind, "expectedProbeExeSha256": sha, "probe": probe, "testName": TEST,
                 "status": "failed" if failed or cleanup_failed else "passed", "accountSid": sid, "childResult": child,
                 "cleanupErrors": ["synthetic cleanup failure"] if cleanup_failed else [], "error": None,
                 **{key: True for key in ("accountCreated", "accountDeleted", "profileDeleted", "stageRemoved", "accountGroupCleanupConfirmed")},
                 **{key: False for key in ("changedAcl", "changedUacOrSecurityPolicy", "runtimeInstalled", "browserStartedByWrapper", "desktopRequired", "inheritedRunnerEnvironment", "passwordInLogsFilesArgumentsOrEnvironment", "originalProductReportsModified", "renderingPolicyChanged")},
                 "accountGroupCleanup": {"sid": sid, "readOnly": True, "complete": True, "errors": [], "groups": [
                    {"groupSid": value, "queried": True, "exactSidPresent": False} for value in ("S-1-5-32-544", "S-1-5-32-545")]},
                 "supervisor": {"status": "passed", "expectedAccountKind": kind, "exitCode": 0, "activeBeforeOuterCleanup": 0, "cleanupErrors": [],
                    **{key: True for key in ("success", "resumed", "jobAssigned", "jobEmpty", "accountKindVerified")},
                    **{key: False for key in ("inheritedParentEnvironment", "existingDesktopAclChanged", "productInnerCleanupProvedByOuterJob")}}}
        files = {"token-probe-result.json": encoded(native), "token-probe-child-result.json": encoded(child),
                 "token-probe-context.json": encoded(context), "token-probe-stdout.log": stdout, "token-probe-stderr.log": b""}
        audit["evidenceCopy"] = {"complete": True, "rejected": [], "files": [proof(name, data) for name, data in files.items()], "bytes": sum(map(len, files.values()))}
        files[AUDIT] = encoded(audit)
        files[INNER] = encoded({"schema": 1, "status": audit["status"], "complete": audit["status"] == "passed",
            "expectedAccountKind": kind, "source": candidate, "files": [proof(name, data) for name, data in files.items()],
            "totalBytes": sum(map(len, files.values()))})
        return files

    cases = ("complete", "native-failed", "outer-cleanup-failed", "missing-account", "missing-root",
             "api-digest", "wrong-candidate", "traversal", "case-collision", "duplicate", "symlink",
             "extra-binary", "oversized", "inner-hash", "marker-mismatch", "build-hash")
    outcomes = []
    with tempfile.TemporaryDirectory(prefix="SYNTHETIC-token-probe-") as temp:
        base = Path(temp)
        for case in cases:
            files = {"probe-build-record.json": encoded(build), "wrapper-regressions.json": encoded({
                "status": "passed", "tests": 1, "cases": [{"name": "SYNTHETIC ONLY", "passed": True}],
                "nativeTokenProbeExecuted": False, "windowsAccountOperations": False, "remoteTasksTriggered": False})}
            for phase in ("checkout", "pre-probe", "final"):
                files[f"source-{phase}.json"] = encoded({"phase": phase, "candidateSha": candidate,
                    "instrumentationSha": candidate, "readOnly": True, "refreshedIndex": False, "rawStatus": ""})
            for kind in KINDS:
                if case == "missing-account" and kind == "filtered-admin":
                    continue
                current = fixture(kind, failed=case == "native-failed", cleanup_failed=case == "outer-cleanup-failed")
                if kind == "filtered-admin" and case == "inner-hash":
                    value = parse(current[INNER]); value["files"][0]["sha256"] = "0" * 64; current[INNER] = encoded(value)
                if kind == "filtered-admin" and case == "marker-mismatch":
                    # Keep both manifests consistent, but alter the marker's native status.
                    current["token-probe-stdout.log"] = current["token-probe-stdout.log"].replace(b'"status":"observed"', b'"status":"failed"')
                    audit = parse(current[AUDIT]); audit["evidenceCopy"]["files"] = [proof(name, current[name]) for name in FIVE_FILES]
                    audit["evidenceCopy"]["bytes"] = sum(len(current[name]) for name in FIVE_FILES); current[AUDIT] = encoded(audit)
                    inner = parse(current[INNER]); inner["files"] = [proof(name, current[name]) for name in SIX_FILES]
                    inner["totalBytes"] = sum(len(current[name]) for name in SIX_FILES); current[INNER] = encoded(inner)
                files.update({kind + "/" + name: data for name, data in current.items()})
            if case == "missing-root":
                del files["source-pre-probe.json"]
            if case == "build-hash":
                value = dict(build, sha256="0" * 64); files["probe-build-record.json"] = encoded(value)
            files["manifest.json"] = encoded({"candidateSha": candidate, "scope": SCOPE, "files": [proof(name, data) for name, data in files.items()]})
            zip_path, api_path = base / "probe.zip", base / "artifacts.json"
            with warnings.catch_warnings():
                warnings.simplefilter("ignore", UserWarning)
                with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
                    for name, data in files.items():
                        archive.writestr(name, data)
                    extra = {"traversal": "../bad.json", "extra-binary": "probe.exe", "case-collision": "MANIFEST.JSON", "duplicate": "manifest.json"}.get(case)
                    if extra:
                        archive.writestr(extra, b"{}")
                    if case == "symlink":
                        info = zipfile.ZipInfo("pure-standard/"); info.create_system = 3; info.external_attr = (stat.S_IFLNK | 0o777) << 16
                        archive.writestr(info, "../outside")
                    if case == "oversized":
                        archive.writestr("filtered-admin/", b"x" * (FILE_LIMIT + 1))
            raw = zip_path.read_bytes()
            api_path.write_bytes(encoded({"artifacts": [{"name": f"mermaid-token-observation-{run}-1", "id": 1,
                "expired": False, "size_in_bytes": len(raw), "digest": "sha256:" + ("0" * 64 if case == "api-digest" else digest(raw)),
                "workflow_run": {"id": int(run), "head_sha": "0" * 40 if case == "wrong-candidate" else candidate}}]}))
            result = verify(api_path, zip_path, run, candidate)
            need(result["overallObservationComplete"] == (case == "complete"), "Synthetic observation gate failed: " + case)
            retained = case in ("complete", "native-failed", "outer-cleanup-failed", "missing-account", "missing-root")
            need(result["evidenceVerified"] == retained, "Synthetic integrity gate failed: " + case)
            if case == "outer-cleanup-failed":
                need(result["diagnosticObservedAccounts"] == list(KINDS), "Native observations lost after outer cleanup failure")
            if case == "missing-account":
                need(result["accounts"]["pure-standard"]["observationComplete"], "Existing verified account lost")
            outcomes.append({"name": case, "passed": True})
    return {"scope": "SYNTHETIC LOCAL FIXTURES ONLY", "windowsExecuted": False, "networkAccessed": False,
            "tests": len(outcomes), "passed": len(outcomes), "cases": outcomes}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--zip", dest="zip_path", type=Path)
    parser.add_argument("--artifacts", type=Path)
    parser.add_argument("--run", default=DEFAULT_RUN)
    parser.add_argument("--candidate", default=DEFAULT_CANDIDATE)
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if not args.self_test and (args.zip_path is None or args.artifacts is None):
        parser.error("--zip and --artifacts saved files are required")
    result = self_test() if args.self_test else verify(args.artifacts, args.zip_path, args.run, args.candidate)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if args.self_test or result["overallObservationComplete"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
