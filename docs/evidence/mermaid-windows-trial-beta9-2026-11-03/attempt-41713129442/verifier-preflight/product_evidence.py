"""Local strict evidence primitives adapted from the frozen b241 verifier.
Installed-image mode is explicit; no linked-binary proof substitutes for installation.
The caller must configure candidate/run/harness hashes from exact frozen source.
"""

import argparse

import hashlib

import io

import json

import re

import stat

import subprocess

import struct

import tempfile

import warnings

import zipfile

import zlib

from pathlib import Path

from PIL import Image, ImageFile

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
        require(type(copy.get("totalBytes")) is int and copy["totalBytes"] == sum(len(files[name]) for name in reviewed), "Child copy aggregate mismatch")
        require(copy.get("source") == "new standard-account synthetic evidence only", "Child copy source declaration mismatch")
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

AUDIT_PREFIX = 'MILKUP_MERMAID_NATIVE_AUDIT '

NODE_REPLAY = r'''
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const H = await import(pathToFileURL(process.argv[2]).href);
const p=JSON.parse(readFileSync(0,'utf8'));
const hash=x=>createHash('sha256').update(x).digest('hex');
const pathSame=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.replaceAll('\\','/').toLowerCase()===b.replaceAll('\\','/').toLowerCase();
const fixtureNames=['ordinary','wide','c4','invalid'];
const phases=['native-drain','ui-close','ui-exit-wait','stdio-drain','normal-exit','native-final-verification','webdriver-detach'];
const stepNames=['01-initial-disabled-source','02-enable-and-exact-bytes','03-real-edit-save-replacement','04-undo-exact-original','05-redo-exact-edit','06-disable-and-reenable-in-place','07-wide','07-c4','07-invalid','08-final-disable'];
function ledgerReplay(packet) {
 const ledger=new H.AuditLedger(packet.sid,packet.sessionId,packet.account);
 assert(Array.isArray(packet.records)&&packet.records.length>0&&packet.records.length<=512);
 for(const record of packet.records){assert(packet.productPids.includes(record.productPid));ledger.accept(record,record.productPid)}
 const jobs=ledger.verifyAll();
 for(const match of packet.pngMatches??[]){const result=ledger.matchPng(match.productPid,match);if(match.requestId)assert.equal(result.requestId,match.requestId)}
 return {ledger,jobs};
}
function product(packet){
 const {report:r,outer,context,child,files,images,records,sid,sessionId,account}=packet;
 assert.equal(r.status,'passed'); assert.equal(r.candidateSha,packet.candidate);
 assert.equal(r.expectedAccountKind,account); assert.equal(r.runId,outer.localRunId);
 assert.equal(r.harnessSha256,packet.harnessSha);
 assert.equal(r.applicationSha256,outer.installation.installedBinary.sha256);assert(pathSame(r.application,outer.installation.installedBinary.path));
 assert.equal(r.runtime.version,outer.runtime.version);assert.equal(r.runtime.sha256,outer.runtime.sha256);assert(pathSame(r.runtime.executable,outer.runtime.path));
 assert.equal(r.driver.sha256,outer.driver.sha256);assert(pathSame(r.driver.executable,outer.driver.path));
 assert.equal(r.context.recordSha256,files['standard-context.json'].sha256);
 const {recordSha256,nodePid,nodeObservedSid,...recordedContext}=r.context;
 assert.deepEqual(recordedContext,context);assert.equal(nodeObservedSid,sid);
 assert.equal(nodePid,child.nodeRun.pid);
 H.validateContext(context,sid,sessionId,account);
 H.validateHostProcessToken(outer.supervisor.suspendedToken,sid,sessionId,account);
 for(const flag of ['realImeAccepted','systemDpiMatrixAccepted','installationAccepted','visualReviewAccepted'])assert.equal(r[flag],false);
 for(const field of ['failure','cleanupError','finalDiagnosticFailure'])assert.equal(r[field],undefined);
 assert.deepEqual(Object.keys(r.fixtures).sort(),fixtureNames.toSorted());
 for(const name of fixtureNames){
   const expected=Buffer.from(H.fixtures[name]); const authored=files[`fixture-${name}.md.log`],saved=files[`saved-${name}.md.log`];
   for(const file of [authored,saved]){assert(file);assert.equal(file.bytes,expected.length);assert.equal(file.sha256,hash(expected))}
   assert.equal(r.fixtures[name].bytes,expected.length);assert.equal(r.fixtures[name].sha256,hash(expected));
 }
 assert.deepEqual(r.launches.map(x=>x.fixture),fixtureNames);
 const productPids=r.launches.map(x=>x.productPid);assert.equal(new Set(productPids).size,4);
 assert.deepEqual(r.nativeAudit,records,'Report native audit must equal original product-log records');
 const {ledger,jobs}=ledgerReplay({sid,sessionId,account,records,productPids});
 for(const launch of r.launches){
   assert(pathSame(launch.fileArgument,r.fixtures[launch.fixture].path));
   assert.equal(launch.exitCode,0);assert.equal(launch.signal,null);assert.equal(launch.closedByUi,true);
   assert(launch.exitedAt&&launch.stdioClosedAt);H.assertCleanCloseConfirmation(launch);
   for(const flag of ['discardedOwnedUnsavedFixture','outerTerminationRequired'])assert.notEqual(launch[flag],true);
   const t=launch.teardown;assert.equal(t.afterFailure,false);assert.equal(t.ownedProductPid,launch.productPid);
   for(const flag of ['uiCloseAttempted','realUiCloseRequested','closedByUi'])assert.equal(t[flag],true);
   for(const flag of ['uiExitWaitFailed','uiExitDeadlineUnmet','outerTerminationRequired'])assert.notEqual(t[flag],true);
   assert.deepEqual(t.errors,[]);assert.deepEqual(t.phases.map(x=>x.phase),phases);assert(t.phases.every(x=>x.ok===true));
   assert.equal(t.phases[1].result.realUiCloseRequested,true);assert.equal(t.phases[2].result,true);assert.equal(t.phases[4].result,true);
   const own=jobs.filter(j=>j.productPid===launch.productPid);assert(own.length>0);
   assert.deepEqual(launch.nativeJobs,own.map(j=>({requestId:j.requestId,successful:j.finished.successful,cleanupVerified:true})));
   assert.equal(t.phases[0].result.innerCleanupVerified,true);assert(Number.isSafeInteger(t.phases[0].result.admittedJobs)&&t.phases[0].result.admittedJobs>=0&&t.phases[0].result.admittedJobs<=own.length);
   assert.deepEqual(t.phases[5].result,{admittedJobs:own.length,innerCleanupVerified:true});
   assert.equal(launch.capabilities.browserVersion,r.runtime.version);
   assert(launch.windowRect.width>=640&&launch.windowRect.height>=480);
 }
 assert.equal(r.processIdentities.length,6);
 const births=new Map();
 const first=r.processIdentities[0].values;
 const driver=first.find(v=>pathSame(v.image,r.driver.executable));assert(driver&&driver.pid!==nodePid);
 for(let i=0;i<6;i++){
   const expected=new Map([[nodePid,first.find(v=>v.pid===nodePid)?.image],[driver.pid,r.driver.executable]]);
   if(i>0&&i<5)expected.set(r.launches[i-1].productPid,r.application);
   H.validateProcessIdentities(r.processIdentities[i].values,expected,sid,sessionId,births,account);
 }
 assert.deepEqual(r.steps.map(x=>x.name),stepNames);
 const imageByName=new Map(images.map(x=>[x.name,x]));
 function validateImage(value,screenshot,fixture){
   assert(value&&typeof value.file==='string');const decoded=imageByName.get(value.file);assert(decoded);
   for(const key of ['bytes','sha256','width','height','pixelSha256'])assert.equal(value[key],decoded[key],`PNG ${key}`);
   for(const key of ['fullyDecoded','nonuniform','structuralValidation'])assert.equal(value[key],true);
   assert.equal(decoded.fullyDecoded,true);assert.equal(decoded.nonuniform,true);
   if(!screenshot){const launch=r.launches.find(x=>x.fixture===fixture);assert.equal(value.native.productPid,launch.productPid);assert.deepEqual(value.native,ledger.matchPng(launch.productPid,value));}
 }
 for(let i=0;i<r.steps.length;i++){
   const step=r.steps[i];assert.equal(step.passed,true);assert(step.startedAt&&step.finishedAt);
   const fixture=i<6?'ordinary':i===6?'wide':i===7?'c4':'invalid';assert.equal(step.fixture,fixture);
   assert.equal(step.screenshot.file,step.name+'-window.png');validateImage(step.screenshot,true,fixture);
   const s=step.after;assert.equal(s.visibility,'visible');assert.equal(s.vectorCount,0);assert.equal(s.developmentProbe,'undefined');assert.equal(s.diagnostics,'undefined');
   assert(pathSame(s.path,r.fixtures[fixture].path));assert.equal(s.dirty,false);
   if(step.image)validateImage(step.image,false,fixture);
   if(i>0&&i<9){const original=H.fixtures[fixture];const expected=(i===2||i===4)?original.replace('Draft','XDraft'):original;
     assert.equal(step.saved.bytes,Buffer.byteLength(expected));assert.equal(step.saved.sha256,hash(Buffer.from(expected)));}
   if([0,8,9].includes(i))assert.deepEqual(s.images,[]);
   else {assert(step.image);assert(s.images.some(x=>x.visible&&x.complete&&x.src.startsWith('blob:')&&x.naturalWidth===step.image.width&&x.naturalHeight===step.image.height));}
 }
 assert(r.steps[0].pluginDetails.includes('1.3.0'));
 assert.notEqual(r.steps[2].image.pixelSha256,r.steps[1].image.pixelSha256);
 assert.equal(r.steps[3].image.pixelSha256,r.steps[1].image.pixelSha256);
 assert.equal(r.steps[4].image.pixelSha256,r.steps[2].image.pixelSha256);
 const wide=r.steps[6],w=wide.after.images.find(x=>x.visible&&x.naturalWidth===wide.image.width);
 assert(w.naturalWidth>wide.after.editor.width&&Math.abs(w.rect.width-w.naturalWidth)<1&&w.naturalHeight>=40);
 const invalidPid=r.launches[3].productPid;
 assert(jobs.some(j=>j.productPid===invalidPid&&H.isUnknownGrammarRejection(j)));
 assert(r.steps[8].after.notices.some(x=>x.visible&&x.text.trim()));
 assert(r.steps[8].after.source.some(x=>x.visible&&x.text.includes('unknownWindowsMermaidGrammar')));
 assert(Array.isArray(r.inputs)&&r.inputs.some(x=>x.kind==='W3C-pointer-actions')&&r.inputs.some(x=>x.kind==='W3C-key-actions'));
 return {passed:true,nativeEvents:records.length,nativeJobs:jobs.length,successfulJobs:jobs.filter(j=>j.finished.successful).length,cancelledJobs:jobs.filter(j=>j.finished.cancelled).length,naturalUiCloses:4,steps:10,matchedPngs:7,processIdentityObservations:6};
}
try {
 if(p.mode==='ledger') {const {jobs}=ledgerReplay(p);console.log(JSON.stringify({passed:true,jobs:jobs.length}));}
 else console.log(JSON.stringify(product(p)));
} catch(error){console.log(JSON.stringify({passed:false,error:String(error),stack:error.stack}));process.exitCode=1}
'''

def run_node(packet):
    require(sha256(read_input(HARNESS, TEXT_LIMIT)) == HARNESS_SHA,
            'Local pure AuditLedger harness differs from the pinned candidate')
    encoded = json.dumps(packet, ensure_ascii=False).encode()
    require(len(encoded) <= 12 * MIB, 'Offline replay input budget exceeded')
    result = subprocess.run(['node', '--input-type=module', '-e', NODE_REPLAY,
                             'offline-artifact-replay-only', str(HARNESS)],
                            input=encoded, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            timeout=30, cwd='/tmp', check=False)
    require(len(result.stdout) <= TEXT_LIMIT and len(result.stderr) <= TEXT_LIMIT,
            'Offline replay output budget exceeded')
    value = parse_json(result.stdout)
    if result.returncode != 0 or value.get('passed') is not True:
        error = ValueError('Offline strict harness replay failed: ' + str(value.get('error'))[:800])
        error.details = {'returncode': result.returncode, 'result': value,
                         'stderr': result.stderr.decode(errors='replace')}
        raise error
    return value

def read_native_records(files):
    records = []
    for fixture in FIXTURES:
        for line in files[f'{fixture}-product.log'].decode('utf-8-sig').splitlines():
            if line.startswith(AUDIT_PREFIX):
                # Production MAX_LINE_BYTES bounds serialized JSON; its fixed
                # prefix and the terminating newline are written afterward.
                payload = line[len(AUDIT_PREFIX):].encode()
                require(len(payload) <= 8192, 'Native audit JSON line budget exceeded')
                records.append(parse_json(payload))
                require(len(records) <= 512, 'Native audit event budget exceeded')
    return records

def validate_product(files, account, decoded):
    outer = validate_outer(files, account, CANDIDATE, RUN_ID, ATTEMPT)
    report = parse_json(files['mermaid-product-e2e.json'])
    records = read_native_records(files)
    metadata = {name: {'bytes': len(data), 'sha256': sha256(data)} for name, data in files.items()}
    packet = {'report': report, 'outer': outer['audit'], 'context': outer['context'],
              'child': outer['child'], 'files': metadata, 'images': decoded,
              'records': records, 'sid': outer['sid'], 'sessionId': outer['sessionId'],
              'account': account, 'candidate': CANDIDATE, 'harnessSha': EXPECTED_WINDOWS_HARNESS_SHA}
    close_evidence = [validate_clean_close(launch) for launch in report['launches']]
    require(len(close_evidence) == 4, 'Four accepted closes per account required')
    summary = run_node(packet)
    summary['closeEvidence'] = close_evidence
    summary['sid'] = outer['sid']
    summary['sessionId'] = outer['sessionId']
    return summary

def _outer_int(value, low=0, high=0xffffffff):
    return type(value) is int and low <= value <= high

def _outer_flags(value, yes=(), no=()):
    require(isinstance(value, dict), "Outer evidence object missing")
    for key in yes:
        require(value.get(key) is True, "Outer true flag missing: " + key)
    for key in no:
        require(value.get(key) is False, "Outer false flag missing: " + key)

def _outer_equal(left, right):
    # Preserve JSON boolean/integer distinctions while ignoring object order.
    if type(left) is not type(right):
        return False
    if isinstance(left, dict):
        return left.keys() == right.keys() and all(_outer_equal(left[k], right[k]) for k in left)
    if isinstance(left, list):
        return len(left) == len(right) and all(_outer_equal(a, b) for a, b in zip(left, right))
    return left == right

def _outer_path(value):
    require(isinstance(value, str) and 0 < len(value) <= 32768 and
            not any(c in value for c in "\x00\r\n"), "Bounded Windows evidence path required")
    return value.replace("\\", "/").rstrip("/").casefold()

def _outer_host(token, sid, session, account):
    filtered = account == "filtered-admin"
    _outer_flags(token, ("ownerIsUser", "privilegesComplete"),
                 ("elevated", "uiAccess", "seDebugPrivilegePresent"))
    for key, expected in (("tokenType", 1), ("sessionId", session),
                          ("integrityRid", 8192), ("elevationType", 3 if filtered else 1),
                          ("hostDisallowedPrivilegeCount", 0)):
        require(type(token.get(key)) is int and token[key] == expected, "Outer host fact: " + key)
    require(token.get("sid") == sid and token.get("ownerSid") == sid, "Outer host SID/owner mismatch")
    require(token.get("pureStandardUser") is (not filtered) and token.get("filteredAdmin") is filtered,
            "Outer account class differs from actual token")
    require(token.get("administratorsGroupPresentIncludingDenyOnly") is filtered,
            "Outer administrator group observation mismatch")
    require("administratorsGroupAttributes" in token and
            _outer_equal(token["administratorsGroupAttributes"], 16 if filtered else None),
            "Outer administrator authority is not the admitted class")
    count, privileges = token.get("privilegeCount"), token.get("privileges")
    require(_outer_int(count, 0, 64) and isinstance(privileges, list) and len(privileges) == count,
            "Complete bounded ordinary privilege observations required")
    allowed = {"SeChangeNotifyPrivilege", "SeShutdownPrivilege", "SeUndockPrivilege",
               "SeIncreaseWorkingSetPrivilege", "SeTimeZonePrivilege"}
    seen = set()
    for item in privileges:
        require(isinstance(item, dict) and isinstance(item.get("name"), str) and
                item["name"] in allowed and item["name"] not in seen and
                _outer_int(item.get("attributes")), "Unknown/duplicate/malformed present privilege")
        seen.add(item["name"])

def _outer_sources(files, candidate):
    expected_paths = {"apps/desktop/src-tauri/Cargo.toml",
                      "apps/desktop/src-tauri/gen/schemas/desktop-schema.json",
                      "apps/desktop/src-tauri/gen/schemas/windows-schema.json"}
    snapshots, stable = {}, None
    for phase in ("checkout", "desktop-check", "final"):
        name = "mermaid-source-" + phase + ".json"
        require(name in files, "Required source phase missing: " + phase)
        value = parse_json(files[name])
        _outer_flags(value, ("readOnly",), ("refreshedIndex",))
        require(value.get("candidateSha") == candidate and value.get("instrumentationSha") == candidate
                and value.get("phase") == phase and value.get("rawStatus") == "",
                "Source candidate/phase/strict clean gate mismatch")
        entries = value.get("files")
        require(isinstance(entries, list) and len(entries) == 3, "Exact three source records required")
        measured = {}
        for item in entries:
            require(isinstance(item, dict) and isinstance(item.get("path"), str) and
                    item["path"] in expected_paths and item["path"] not in measured,
                    "Unknown/duplicate source path")
            parts = {}
            for role in ("head", "index", "worktree"):
                observation = item.get(role)
                require(isinstance(observation, dict), "Source byte observation missing")
                require(_outer_int(observation.get("bytes"), 1, 4 * 1024 * 1024), "Source size invalid")
                for key in ("sha256", "lfNormalizedSha256"):
                    require(isinstance(observation.get(key), str) and
                            re.fullmatch(r"[a-f0-9]{64}", observation[key]), "Source hash invalid")
                for key in ("crlf", "bareLf", "bareCr"):
                    require(_outer_int(observation.get(key), 0, observation["bytes"]), "Source EOL count invalid")
                require(2 * observation["crlf"] + observation["bareLf"] + observation["bareCr"] <= observation["bytes"],
                        "Impossible source EOL byte counts")
                parts[role] = {key: observation[key] for key in
                               ("bytes", "sha256", "lfNormalizedSha256", "crlf", "bareLf", "bareCr")}
            require(_outer_equal(parts["head"], parts["index"]), "HEAD/index source bytes differ")
            require(parts["head"]["lfNormalizedSha256"] == parts["worktree"]["lfNormalizedSha256"],
                    "Normalized working source differs from HEAD")
            oid = item.get("headObjectId")
            require(isinstance(oid, str) and re.fullmatch(r"[a-f0-9]{40}", oid) and
                    item.get("normalizedWorktreeObjectId") == oid, "Source normalized Git object differs")
            parts["headObjectId"] = oid
            measured[item["path"]] = parts
        require(set(measured) == expected_paths, "Source path set incomplete")
        if stable is None:
            stable = measured
        else:
            require(_outer_equal(stable, measured), "Source file bytes/hashes changed between phases")
        snapshots[phase] = value
    return snapshots

def _outer_profile(audit, sid):
    cleanup = audit.get("profileCleanup")
    require(isinstance(cleanup, dict), "Recorded profile cleanup missing")
    for key, expected in (("maxAttempts", 6), ("retryWindowMs", 3000), ("retryDelayMs", 500)):
        require(type(cleanup.get(key)) is int and cleanup[key] == expected, "Profile cleanup bound mismatch")
    for phase in ("before", "after"):
        value = cleanup.get(phase)
        _outer_flags(value, ("readOnly",))
        require(value.get("sid") == sid and type(value.get("profileKeyPresent")) is bool,
                "Profile state exact SID/registry observation missing")
        require(_outer_path(value.get("profilePath")) == _outer_path(audit.get("actualWindowsProfile")),
                "Profile state path differs from exact owned profile")
    after = cleanup["after"]
    _outer_flags(after, no=("profileKeyPresent", "profilePathPresent", "hkuHivePresent"))
    # Match the reviewed wrapper: CIM null is retained as unknown diagnostics,
    # while registry/path/HKU deletion observations must be explicit false.
    require("cimLoaded" in after and "cimMatches" in after and
            (after["cimLoaded"] is None or after["cimLoaded"] is False) and
            (after["cimMatches"] is None or _outer_int(after["cimMatches"], 0, 1)),
            "Profile CIM reports a loaded or ambiguous remaining profile")
    checks = cleanup.get("processChecks")
    require(isinstance(checks, list) and 1 <= len(checks) <= 12, "Profile process checks missing/unbounded")
    for item in checks:
        require(isinstance(item, dict) and item.get("phase") in ("before-delete", "after-delete-failure") and
                _outer_int(item.get("attempt"), 1, 6) and item.get("complete") is True and
                type(item.get("matchCount")) is int and item["matchCount"] == 0,
                "Profile deletion lacks complete exact-SID process emptiness")
    last = cleanup.get("lastProcessObservation")
    _outer_flags(last, ("readOnly", "complete"))
    require(last.get("sid") == sid and last.get("errors") == [] and last.get("records") == [] and
            type(last.get("matchCount")) is int and last["matchCount"] == 0,
            "Final profile process emptiness observation inconsistent")
    attempts = cleanup.get("attempts")
    require(isinstance(attempts, list) and len(attempts) <= 6, "Profile delete attempts invalid")
    if cleanup["before"]["profileKeyPresent"]:
        require(attempts and attempts[-1].get("returnedSuccess") is True and
                "win32Error" in attempts[-1] and attempts[-1]["win32Error"] is None,
                "Profile delete never returned success")
    else:
        require(not attempts, "Already-absent profile should not have a delete call")
    for index, item in enumerate(attempts):
        require(type(item.get("attempt")) is int and item["attempt"] == index + 1,
                "Profile retry order is inconsistent")
        if index < len(attempts) - 1:
            require(item.get("returnedSuccess") is False and type(item.get("win32Error")) is int and
                    item["win32Error"] == 32, "Only sharing-violation retry may precede successful deletion")
    group = audit.get("accountGroupCleanup")
    _outer_flags(group, ("readOnly", "complete"))
    require(group.get("sid") == sid and group.get("errors") == [], "Group cleanup identity/errors mismatch")
    entries = group.get("groups")
    require(isinstance(entries, list) and len(entries) == 2 and
            {item.get("groupSid") for item in entries} == {"S-1-5-32-545", "S-1-5-32-544"},
            "Both exact group cleanup observations required")
    for item in entries:
        _outer_flags(item, ("queried",), ("exactSidPresent",))

def validate_outer(files, account, candidate, run_id, attempt):
    require(account in ("pure-standard", "filtered-admin"), "Unknown expected account")
    require(isinstance(candidate, str) and re.fullmatch(r"[a-f0-9]{40}", candidate), "Exact candidate required")
    require(isinstance(run_id, str) and re.fullmatch(r"[1-9][0-9]*", run_id) and
            isinstance(attempt, str) and re.fullmatch(r"[1-9][0-9]*", attempt), "Exact run/attempt required")
    source = _outer_sources(files, candidate)
    names = ("windows-standard-product-audit.json", "standard-context.json", "standard-child-result.json")
    require(all(name in files for name in names), "Outer/context/child records required")
    audit, context, child = (parse_json(files[name]) for name in names)
    require(type(audit.get("schema")) is int and audit["schema"] == 1 and audit.get("status") == "passed" and
            audit.get("source") == candidate and audit.get("runId") == run_id and
            audit.get("attempt") == attempt and audit.get("expectedAccountKind") == account,
            "Exact outer passed identity missing")
    require(audit.get("mode") == "nsis-current-user" and isinstance(audit.get("installation"), dict) and
            audit.get("installedDirectoryRemoved") is True, "Actual current-user installation evidence required")
    require(_outer_equal(audit["installation"], parse_json(files["installation-result.json"])),
            "Outer installation differs from retained installation bytes")
    _outer_flags(audit, ("accountCreated", "accountDeleted", "profileDeleted", "stageRemoved", "accountGroupCleanupConfirmed", "installerExecuted"),
                 ("changedAcl", "changedUacOrSecurityPolicy", "runtimeInstalled", "fixedRuntimeUsed",
                  "artifactUploadedByHarness", "passwordInLogsFilesArgumentsOrEnvironment", "outerCleanupProvesProductInnerCleanup"))
    require(audit.get("cleanupErrors") == [] and "error" in audit and audit["error"] is None and
            "secondaryFailure" not in audit, "Outer failure/cleanup was not clean")
    sid, local_run = audit.get("accountSid"), audit.get("localRunId")
    require(isinstance(sid, str) and re.fullmatch(r"S-1-5-21-(?:[1-9][0-9]*-){3}[1-9][0-9]*", sid), "Exact account SID missing")
    require(isinstance(local_run, str) and re.fullmatch(r"[a-f0-9]{32}", local_run), "Local run GUID missing")
    expected_groups = {"S-1-5-32-545"} | ({"S-1-5-32-544"} if account == "filtered-admin" else set())
    groups = audit.get("localGroupSids")
    require(isinstance(groups, list) and len(groups) == len(expected_groups) and set(groups) == expected_groups,
            "Fresh account initial membership mismatch")
    require(_outer_equal(audit.get("standardContext"), context) and _outer_equal(audit.get("childResult"), child),
            "Embedded outer context/child differs from retained bytes")
    session = context.get("sessionId")
    require(_outer_int(session, 1) and context.get("expectedSessionId") == session and
            type(context.get("expectedSessionId")) is int, "Exact nonzero session missing")
    require(context.get("status") == "ready" and context.get("actualSid") == sid and
            context.get("expectedSid") == sid and context.get("expectedAccountKind") == account,
            "Child context identity mismatch")
    _outer_flags(context, ("accountKindVerified", "interactive"), ("existingDesktopAclChanged", "securityPolicyChanged"))
    require(context.get("pureStandard") is (account == "pure-standard") and
            context.get("filteredAdmin") is (account == "filtered-admin") and context.get("blockedReasons") == [],
            "Child context account class/blockers mismatch")
    desktop, runner = context.get("desktop"), audit.get("runnerContext")
    for current in (desktop, runner):
        _outer_flags(current, ("desktopEligible", "windowStationVisible", "inputDesktopOpened", "sameInputDesktop"),
                     ("existingDesktopAclChanged", "privilegesAdjusted"))
        require(type(current.get("sessionId")) is int and current["sessionId"] == session and
                current.get("blockedReasons") == [], "Existing interactive session/preflight mismatch")
    _outer_host(desktop.get("token"), sid, session, account)
    folders = context.get("knownFolders")
    require(isinstance(folders, dict), "Actual Windows known folders missing")
    for field in ("profile", "roamingAppData", "localAppData"):
        _outer_path(folders.get(field))
    profile = _outer_path(folders["profile"])
    require(profile == _outer_path(audit.get("actualWindowsProfile")), "Owned profile differs from real known folder")
    scratch = profile + "/.milkup-mermaid-product-" + local_run
    require(_outer_path(context.get("scratchRoot")) == scratch and
            _outer_path(context.get("work")) == scratch + "/work" and
            _outer_path(context.get("evidence")) == scratch + "/evidence", "Run-owned scratch identity mismatch")
    for label in ("binary", "runtime", "driver"):
        identity = audit.get(label)
        require(isinstance(identity, dict) and isinstance(identity.get("sha256"), str) and
                re.fullmatch(r"[a-f0-9]{64}", identity["sha256"]) and _outer_int(identity.get("bytes"), 1),
                "Actual bounded executable identity missing: " + label)
        _outer_path(identity.get("path"))
    require(audit["runtime"].get("kind") == "existing-machine-Evergreen" and
            isinstance(audit["runtime"].get("version"), str) and
            re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+", audit["runtime"]["version"]),
            "Actual existing Evergreen identity required")
    supervisor = audit.get("supervisor")
    _outer_flags(supervisor, ("success", "resumed", "jobAssigned", "jobEmpty", "accountKindVerified"),
                 ("inheritedParentEnvironment", "existingDesktopAclChanged", "productInnerCleanupProvedByOuterJob"))
    require(supervisor.get("status") == "passed" and supervisor.get("expectedAccountKind") == account and
            type(supervisor.get("sessionId")) is int and supervisor["sessionId"] == session and
            _outer_int(supervisor.get("pid"), 1) and supervisor["pid"] == desktop.get("pid") and
            type(desktop.get("pid")) is int and supervisor.get("cleanupErrors") == [] and
            supervisor.get("error") is None, "Outer coordinator identity/status/cleanup mismatch")
    for key in ("exitCode", "activeBeforeOuterCleanup"):
        require(type(supervisor.get(key)) is int and supervisor[key] == 0, "Outer Job stop was not a natural completed exit")
    _outer_host(supervisor.get("suspendedToken"), sid, session, account)
    require(child.get("status") == "passed" and child.get("expectedAccountKind") == account and
            child.get("startedNode") is True and type(child.get("nodeExitCode")) is int and
            child["nodeExitCode"] == 0 and "error" in child and child["error"] is None, "Node coordinator child did not pass")
    node = child.get("nodeRun")
    _outer_flags(node, ("started", "exited", "streamsDrained"),
                 ("timedOut", "captureExceeded", "forcedNodeTermination", "forcedProcessTermination",
                  "useShellExecute", "credentialsSpecified", "breakawayRequested"))
    require(node.get("status") == "passed" and node.get("tool") == "Node" and
            type(node.get("exitCode")) is int and node["exitCode"] == 0 and _outer_int(node.get("pid"), 1) and
            node.get("cleanupErrors") == [] and node.get("error") is None, "Node process execution/cleanup incomplete")
    for stream in ("stdout", "stderr"):
        filename = "node-" + stream + ".log"
        require(filename in files and type(node.get(stream + "Bytes")) is int and
                node[stream + "Bytes"] == len(files[filename]), "Node stream capture length differs from retained log")
    copy = audit.get("evidenceCopy")
    _outer_flags(copy, ("complete",))
    require(copy.get("manifest") == "evidence-files.json" and copy.get("rejected") == [] and
            type(copy.get("rejectedCount")) is int and copy["rejectedCount"] == 0 and
            type(copy.get("rejectionsOmitted")) is int and copy["rejectionsOmitted"] == 0,
            "Retained evidence copy has unaccounted rejected files")
    require("evidence-files.json" in files, "Bounded copy manifest missing")
    manifest = parse_json(files["evidence-files.json"])
    require(manifest.get("complete") is True and manifest.get("rejected") == [] and
            type(manifest.get("rejectedCount")) is int and manifest["rejectedCount"] == 0 and
            type(manifest.get("rejectionsOmitted")) is int and manifest["rejectionsOmitted"] == 0 and
            isinstance(manifest.get("files"), list) and type(copy.get("files")) is int and
            copy["files"] == len(manifest["files"]) and type(copy.get("bytes")) is int and
            type(manifest.get("totalBytes")) is int and copy["bytes"] == manifest["totalBytes"],
            "Outer copy summary differs from retained complete manifest")
    _outer_profile(audit, sid)
    return {"sid": sid, "sessionId": session, "audit": audit, "context": context,
            "child": child, "sourceSnapshots": source, "outerCleanupVerified": True}

def _close_bounded(value):
    require(isinstance(value, dict) and set(value) == {'text', 'bytes', 'sha256', 'truncated'},
            'Closed bounded close-response record required')
    require(isinstance(value['text'], str) and type(value['bytes']) is int and value['bytes'] >= 0
            and type(value['truncated']) is bool and isinstance(value['sha256'], str)
            and re.fullmatch(r'[a-f0-9]{64}', value['sha256']), 'Bounded close-response types invalid')
    encoded = value['text'].encode('utf-8')
    require(len(encoded) <= 2048 and value['truncated'] == (value['bytes'] > 2048),
            'Bounded close-response byte/truncation mismatch')
    if not value['truncated']:
        require(len(encoded) == value['bytes'] and sha256(encoded) == value['sha256'],
                'Complete close-response bytes/hash differ from retained raw text')
    else:
        # StringDecoder.write may withhold an incomplete trailing UTF-8 scalar.
        # The digest describes the unavailable complete body, not this fragment.
        require(2045 <= len(encoded) <= 2048 and len(encoded) <= value['bytes'],
                'Truncated UTF-8 response must preserve the actual bounded prefix')
    return not value['truncated']

def validate_clean_close(launch):
    """Check the frozen harness's recorded acceptance, without inventing a deadline
    or treating absence of a dialog observation as proof that no dialog existed.
    """
    import math
    require(isinstance(launch, dict), 'Actual close record required')
    require(type(launch.get('productPid')) is int and launch['productPid'] > 0,
            'Directly spawned product identity required')
    require(type(launch.get('exitCode')) is int and launch['exitCode'] == 0
            and 'signal' in launch and launch['signal'] is None,
            'Natural held-product exit zero required')
    exit_time = launch.get('exitObservedMonotonicMs')
    require(type(exit_time) in (int, float) and math.isfinite(exit_time) and exit_time >= 0,
            'Directly observed monotonic product exit timestamp required')
    require(launch.get('closedByUi') is True and isinstance(launch.get('exitedAt'), str)
            and isinstance(launch.get('stdioClosedAt'), str), 'Actual UI close and drained stdio required')
    for key in ('unexpectedUnsavedConfirmation', 'discardedOwnedUnsavedFixture', 'outerTerminationRequired'):
        require(launch.get(key) is not True, 'Failed close evidence retained: ' + key)
    teardown = launch.get('teardown')
    require(isinstance(teardown, dict) and teardown.get('afterFailure') is False
            and type(teardown.get('ownedProductPid')) is int
            and teardown['ownedProductPid'] == launch['productPid'], 'Exact successful close owner required')
    for key in ('uiCloseAttempted', 'realUiCloseRequested', 'closedByUi'):
        require(teardown.get(key) is True, 'Actual requested/accepted UI close required: ' + key)
    for key in ('uiExitWaitFailed', 'uiExitDeadlineUnmet', 'outerTerminationRequired'):
        require(teardown.get(key) is not True, 'Failed wait/fallback cannot satisfy close: ' + key)
    require(teardown.get('errors') == [], 'Close errors must remain failures')
    phases = teardown.get('phases')
    expected = ['native-drain', 'ui-close', 'ui-exit-wait', 'stdio-drain', 'normal-exit',
                'native-final-verification', 'webdriver-detach']
    require(isinstance(phases, list) and [x.get('phase') for x in phases] == expected
            and all(x.get('ok') is True for x in phases), 'Seven successful natural-close phases required')
    require(phases[1].get('result', {}).get('realUiCloseRequested') is True and
            phases[2].get('result') is True and phases[4].get('result') is True,
            'Frozen harness must accept the held exit within its original deadline')
    require(phases[0].get('result', {}).get('innerCleanupVerified') is True and
            phases[5].get('result', {}).get('innerCleanupVerified') is True,
            'Native cleanup remains independent of product exit')
    summary = {'fixture': launch.get('fixture'), 'productPid': launch['productPid'],
               'acceptedNaturalUiClose': True, 'heldExitCode': 0,
               'heldExitObservedMonotonicMs': exit_time, 'configuredWaitBudgetMs': 15000,
               'deadlineAcceptedByFrozenHarnessResult': True,
               'independentMonotonicDeadlineRecomputed': False,
               'dialogAbsenceInferredFromNullMissingContextOrExit': False,
               'retainedProbeObservations': [], 'omittedProbeObservations': 0}
    if 'closeConfirmationProbes' not in launch:
        summary['probeHistoryPresent'] = False
        summary['probeObservationCount'] = 0
        return summary  # Held exit may be observed before the first UI probe.
    history = launch['closeConfirmationProbes']
    require(isinstance(history, dict) and history.get('retainedLimit') == 32
            and type(history.get('retainedLimit')) is int, 'Bounded close probe history required')
    total, omitted, observations = history.get('total'), history.get('omitted'), history.get('observations')
    require(type(total) is int and 1 <= total <= 4096 and type(omitted) is int and omitted >= 0
            and isinstance(observations, list) and len(observations) == min(total, 32),
            'Close probe sequence/count bounds invalid')
    require('firstVisibleDialog' not in history, 'A retained positive dialog cannot become a clean close')
    require([item.get('sequence') for item in observations] == list(range(1, len(observations)+1)),
            'Retained first close-probe sequence differs')
    retained = list(observations)
    if total > 32:
        last = history.get('lastObservation')
        require(isinstance(last, dict) and type(last.get('sequence')) is int
                and last['sequence'] == total and omitted == total-33, 'Final bounded close observation missing')
        retained.append(last)
    else:
        require('lastObservation' not in history and omitted == 0, 'Unexpected extra close history')
    summary.update(probeHistoryPresent=True, probeObservationCount=total, omittedProbeObservations=omitted)
    for row in retained:
        require(type(row.get('sequence')) is int and isinstance(row.get('startedAt'), str),
                'Exact close observation sequence/start required')
        decision = row.get('decision')
        require(decision in ('no-visible-unsaved-dialog', 'null-result-awaiting-owned-exit',
                            'closed-context-awaiting-owned-exit', 'interrupted', 'pending'),
                'Failed/positive/unknown close probe decision: ' + str(decision))
        require(row.get('value') is not True, 'A literal observed dialog blocks clean close')
        if decision != 'pending':
            require(isinstance(row.get('finishedAt'), str), 'Terminal close observation lacks completion')
        if decision in ('pending', 'interrupted'):
            require(row['sequence'] == total, 'Only the final exit-raced observation may be unfinished/interrupted')
        if 'error' in row:
            _close_bounded(row['error'])
        response_complete = False
        raw_value = None
        raw_decoded = False
        protocol_error = None
        value_error_envelope = False
        if 'response' in row:
            require(type(row.get('httpStatus')) is int and 100 <= row['httpStatus'] <= 599,
                    'Original close response HTTP status required')
            response_complete = _close_bounded(row['response'])
            if response_complete:
                envelope = parse_json(row['response']['text'].encode())
                raw_value = envelope['value'] if isinstance(envelope, dict) and 'value' in envelope else envelope
                protocol_error = raw_value.get('error') if isinstance(raw_value, dict) and isinstance(raw_value.get('error'), str) else None
                value_error_envelope = (isinstance(envelope, dict) and 'value' in envelope
                                        and isinstance(envelope['value'], dict) and 'error' in envelope['value'])
                raw_decoded = True
                require(raw_value is not True, 'Complete raw response preserves a positive dialog value')
                if 200 <= row['httpStatus'] < 300 and not protocol_error:
                    require(raw_value is not True, 'Complete raw response reports a real dialog')
                    actual_type = ('null' if raw_value is None else 'boolean' if type(raw_value) is bool
                                   else 'number' if type(raw_value) in (int, float) else 'string'
                                   if isinstance(raw_value, str) else 'object')
                    if 'valueType' in row:
                        require(row['valueType'] == actual_type, 'Recorded close value type differs from raw response')
                    if 'value' in row:
                        require(_outer_equal(row['value'], raw_value), 'Recorded close value differs from raw response')
        if decision == 'no-visible-unsaved-dialog':
            require(row.get('valueType') == 'boolean' and row.get('value') is False,
                    'No-visible-dialog decision requires actual boolean false')
            require('response' in row and 200 <= row['httpStatus'] < 300,
                    'Completed boolean probe requires a successful original HTTP response')
            if raw_decoded:
                require(200 <= row['httpStatus'] < 300 and raw_value is False and not protocol_error,
                        'No-visible-dialog decision is not the complete raw boolean false')
        elif decision == 'null-result-awaiting-owned-exit':
            require(row.get('valueType') == 'null' and 'value' in row and row['value'] is None,
                    'Null probe must preserve explicit original null')
            require('response' in row and 200 <= row['httpStatus'] < 300,
                    'Completed null probe requires a successful original HTTP response')
            if raw_decoded:
                require(200 <= row['httpStatus'] < 300 and raw_value is None and not protocol_error,
                        'Null decision differs from complete raw response')
        elif decision == 'closed-context-awaiting-owned-exit':
            code = row.get('webDriverErrorCode')
            require(code in ('no such window', 'no such frame', 'invalid session id', 'target frame detached')
                    and 'response' in row and 'error' in row, 'Closed-context response requires recorded protocol code')
            require('valueType' not in row and 'value' not in row, 'Protocol errors cannot invent returned script values')
            if code == 'target frame detached':
                require(row['httpStatus'] == 404 and teardown['realUiCloseRequested'] is True,
                        'Detached target requires HTTP404 after the real close request')
                if raw_decoded:
                    require(value_error_envelope and protocol_error == code,
                            'Detached target requires own JSON envelope.value.error; messages are not authority')
            elif raw_decoded:
                require(protocol_error == code, 'Recorded protocol code differs from complete raw response')
        # Pending/interrupted are explicitly inconclusive. The owned process
        # may have exited while a request still awaited its final callback.
        summary['retainedProbeObservations'].append({
            'sequence': row['sequence'], 'decision': decision,
            'recordedValueType': row.get('valueType'), 'recordedValuePresent': 'value' in row,
            'recordedValue': row.get('value'), 'httpStatus': row.get('httpStatus'),
            'protocolErrorCode': row.get('webDriverErrorCode'), 'rawResponsePresent': 'response' in row,
            'rawResponseComplete': response_complete, 'rawSemanticsIndependentlyDecoded': raw_decoded,
            'rawResponseTruncated': row.get('response', {}).get('truncated'),
            'rawBooleanFalseObserved': decision == 'no-visible-unsaved-dialog' and raw_decoded and raw_value is False,
            'isOwnedExitProof': False,
        })
    return summary


def configure(*, candidate, run_id, attempt, harness, harness_sha, windows_harness_sha):
    global CANDIDATE, RUN_ID, ATTEMPT, HARNESS, HARNESS_SHA, EXPECTED_WINDOWS_HARNESS_SHA
    CANDIDATE, RUN_ID, ATTEMPT = candidate, run_id, attempt
    HARNESS, HARNESS_SHA = Path(harness), harness_sha
    EXPECTED_WINDOWS_HARNESS_SHA = windows_harness_sha
