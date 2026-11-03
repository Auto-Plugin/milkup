"""Verify a downloaded Actions ZIP without executing its installer or plugins.

Usage: python verify-delivery.py artifact.zip artifact-api.json new-extraction-dir
The API JSON is the actual GitHub artifact object, including digest/expires_at.
"""
import hashlib
import json
import re
import stat
import sys
import zipfile
from pathlib import Path, PurePosixPath


def sha(data):
    return hashlib.sha256(data).hexdigest()


def verify(archive, metadata, output):
    api = json.loads(metadata.read_text())
    digest = api["digest"]
    assert re.fullmatch(r"sha256:[a-f0-9]{64}", digest)
    assert api["expired"] is False and api["expires_at"]
    archive_bytes = archive.read_bytes()
    assert sha(archive_bytes) == digest.split(":", 1)[1], "GitHub ZIP digest mismatch"
    assert len(archive_bytes) == api["size_in_bytes"], "GitHub ZIP size mismatch"
    assert not output.exists(), "Extraction destination must be new"
    files = {}
    with zipfile.ZipFile(archive) as zipped:
        entries = zipped.infolist()
        assert len(entries) <= 64, "Archive entry budget"
        assert sum(item.file_size for item in entries) <= 128 * 1024 * 1024
        for item in entries:
            name = item.filename
            relative = PurePosixPath(name)
            assert name and not relative.is_absolute() and "\\" not in name
            assert all(part not in (".", "..") for part in relative.parts)
            assert not (item.flag_bits & 1), "Encrypted entry"
            assert stat.S_IFMT(item.external_attr >> 16) != stat.S_IFLNK, "Symlink entry"
            if item.is_dir():
                continue
            assert name not in files, "Duplicate entry"
            assert item.file_size <= 80 * 1024 * 1024
            files[name] = zipped.read(item)
            assert len(files[name]) == item.file_size
    assert len(files) <= 32
    required = {"README.md", "FEEDBACK.md", "MERMAID-LICENSE.txt", "manifest.json", "plugins.json", "SHA256SUMS.txt"}
    required |= {f"samples/{name}.md" for name in ("ordinary", "wide", "c4", "invalid")}
    reports = ("installation-result.json", "installed-binary-comparison.json", "windows-standard-product-audit.json", "mermaid-product-e2e.json")
    required |= {"reports/" + name for name in reports}
    assert required <= files.keys()
    checksums = {}
    for line in files["SHA256SUMS.txt"].decode("ascii").splitlines():
        matched = re.fullmatch(r"([a-f0-9]{64})  ([A-Za-z0-9_.\-/]+)", line)
        assert matched and matched[2] not in checksums
        checksums[matched[2]] = matched[1]
    assert checksums.keys() == files.keys() - {"SHA256SUMS.txt"}
    for name, expected in checksums.items():
        assert sha(files[name]) == expected, "Payload checksum mismatch: " + name
    manifest = json.loads(files["manifest.json"])
    assert manifest["version"] == "2.0.0-beta.8"
    assert re.fullmatch(r"[a-f0-9]{40}", manifest["candidateSha"])
    assert manifest["status"] == "verified-for-user-trial" and manifest["deliveryReady"] is True
    assert manifest["installerExecuted"] is True and manifest["releaseCreated"] is False
    assert manifest["installMode"] == "currentUser" and manifest["signing"] == "unsigned"
    dependencies = manifest["dependencies"]
    assert dependencies["status"] == "passed" and dependencies["readOnly"] is True
    assert dependencies["applicationSha256"] == manifest["extractedApplication"]["sha256"]
    assert dependencies["dlls"] and dependencies["extraVcRuntimeDlls"] == []
    assert dependencies["webview2Loader"] == "static-no-loader-dll-import"
    assert dependencies["webview2Runtime"] == "external-existing-Evergreen"
    installer = manifest["installer"]
    assert installer["deliveredName"] in files
    assert files[installer["deliveredName"]].startswith(b"MZ")
    assert sha(files[installer["deliveredName"]]) == installer["sha256"]
    assert len(files[installer["deliveredName"]]) == installer["bytes"]
    assert [name for name in files if name.endswith(".exe")] == [installer["deliveredName"]]
    plugins = json.loads(files["plugins.json"])
    assert len(plugins) == 10 and len({plugin["id"] for plugin in plugins}) == 10
    plugin_names = set()
    for plugin in plugins:
        name = "plugins/" + plugin["archiveFile"]
        plugin_names.add(name)
        assert sha(files[name]) == plugin["sha256"] and len(files[name]) == plugin["bytes"]
        package = json.loads(files[name])
        assert package["manifest"]["id"] == plugin["id"]
        assert package["manifest"]["version"] == plugin["version"]
        if plugin["id"] == "milkup.diagrams":
            assert plugin["version"] == "1.3.0" and package["manifest"]["host"] == "worker"
    assert set(files) == required | plugin_names | {installer["deliveredName"]}
    for name in reports:
        value = json.loads(files["reports/" + name])
        assert value["status"] == "passed", name
    product = json.loads(files["reports/mermaid-product-e2e.json"])
    assert product["candidateSha"] == manifest["candidateSha"]
    assert len(product["steps"]) == 10 and all(step["passed"] is True for step in product["steps"])
    assert len(product["launches"]) == 4 and all(launch["closedByUi"] is True for launch in product["launches"])
    audit = json.loads(files["reports/windows-standard-product-audit.json"])
    assert audit["source"] == manifest["candidateSha"]
    assert all(audit[field] is True for field in ("profileDeleted", "accountDeleted", "stageRemoved", "installerExecuted"))
    assert audit["cleanupErrors"] == []
    output.mkdir(parents=True)
    for name, data in files.items():
        target = output.joinpath(*PurePosixPath(name).parts)
        target.parent.mkdir(parents=True, exist_ok=True)
        with target.open("xb") as stream:
            stream.write(data)
    return {
        "status": "passed", "artifactId": api["id"], "artifactName": api["name"],
        "candidateSha": manifest["candidateSha"], "zipBytes": len(archive_bytes),
        "zipSha256": sha(archive_bytes), "expiresAt": api["expires_at"],
        "downloadAccess": "GitHub authentication required for Actions artifact URL",
        "installer": {key: installer[key] for key in ("deliveredName", "bytes", "sha256")},
        "fileCount": len(files), "pluginCount": len(plugins), "installedStepsPassed": 10,
        "normalUiCloses": 4, "sourceReportsRetained": list(reports),
        "actualPeDependencies": dependencies,
        "installerOrPluginExecutedByThisVerifier": False,
    }


if __name__ == "__main__":
    assert len(sys.argv) == 4
    print(json.dumps(verify(*(Path(arg) for arg in sys.argv[1:])), indent=2))
