//! Test-only prior-generation fixture. Never distributed with the product.
//! Real beta.9 UI must first create and close an enabled, approved installation.
//! This helper then uses production catalog transactions, rather than editing
//! checksums or injecting frontend IPC, to simulate a previously approved bundle.
//! It does NOT prove that either synthetic module was historically shipped.
#[allow(dead_code)]
#[path = "../../../apps/desktop/src-tauri/src/plugin_catalog.rs"]
mod catalog;
use base64::Engine;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{fs, path::Path};
const ID: &str = "milkup.diagrams";
fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn entry(v: &Value) -> Value {
    v["entries"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["id"] == ID)
        .unwrap()
        .clone()
}
fn read_plain(path: &Path, limit: u64) -> Vec<u8> {
    let m = fs::symlink_metadata(path).unwrap();
    assert!(m.is_file() && !m.file_type().is_symlink() && m.len() <= limit);
    fs::read(path).unwrap()
}
fn run(receipt_path: &Path, receipt_hash: &str, scenario: &str, out: &Path) {
    assert!(matches!(scenario, "same-version" | "startup-failure"));
    let receipt_bytes = read_plain(receipt_path, 2 * 1024 * 1024);
    assert_eq!(hash(&receipt_bytes), receipt_hash);
    let receipt: Value = serde_json::from_slice(&receipt_bytes).unwrap();
    assert_eq!(receipt["status"], "passed");
    assert_eq!(receipt["migration"]["phase"], "prepare");
    assert_eq!(receipt["migration"]["choice"], "enabled");
    assert_eq!(
        receipt["migration"]["auditContract"],
        "shipped-beta9-preparation-only"
    );
    assert_eq!(
        receipt["applicationSha256"],
        "5d4df1a7f6e7962be12d624437f620fe5775885e79b7a97b4b519a676ec95d84"
    );
    assert_eq!(receipt["launches"].as_array().unwrap().len(), 1);
    assert_eq!(receipt["launches"][0]["closedByUi"], true);
    let old = &receipt["migration"]["catalog"];
    let catalog_path = Path::new(old["path"].as_str().unwrap());
    assert_eq!(catalog_path.file_name().unwrap(), "catalog-v1.json");
    let root = catalog_path.parent().unwrap();
    let known = &receipt["context"]["knownFolders"];
    assert!(["localAppData", "roamingAppData"].iter().any(|key| root
        == Path::new(known[key].as_str().unwrap())
            .join("app.milkup.desktop")
            .join("plugins")));
    assert_eq!(
        hash(&read_plain(catalog_path, 16 * 1024 * 1024)),
        old["sha256"]
    );
    let before = entry(&catalog::read(root).unwrap());
    assert_eq!(before["enabled"], true);
    assert_eq!(before["tombstone"], false);
    assert!(before["pending"].is_null() && before["startAttempt"].is_null());
    let active = &before["active"];
    assert_eq!(active["verified"], true);
    assert_eq!(
        active["approvedFingerprint"],
        active["capabilityFingerprint"]
    );
    assert_eq!(active["manifest"]["version"], "1.3.0");
    assert_eq!(active["contentSha256"], old["contentSha256"]);
    assert_eq!(active["sourcePath"], old["sourcePath"]);
    let package = Path::new(active["packageRoot"].as_str().unwrap());
    let envelope: Value =
        serde_json::from_slice(&read_plain(catalog_path, 16 * 1024 * 1024)).unwrap();
    let sealed = entry(&envelope["payload"]);
    let mut files = vec![];
    let main = active["manifest"]["main"]
        .as_str()
        .unwrap()
        .trim_start_matches("./");
    for (name, seal) in sealed["active"]["files"].as_object().unwrap() {
        if name == "plugin.json" {
            continue;
        }
        assert!(!name.contains("..") && !Path::new(name).is_absolute());
        let bytes = read_plain(&package.join(name), 32 * 1024 * 1024);
        assert_eq!(hash(&bytes), seal["sha256"]);
        let (encoding, content) = if name == main {
            let original = String::from_utf8(bytes).unwrap();
            let prefix = if scenario == "startup-failure" {
                "throw new Error('MILKUP_SYNTHETIC_PRIOR_STARTUP_FAILURE');\n"
            } else {
                "/* MILKUP_SYNTHETIC_SAME_VERSION_PRIOR_BYTES */\n"
            };
            ("utf8", format!("{prefix}{original}"))
        } else {
            (
                "base64",
                base64::engine::general_purpose::STANDARD.encode(bytes),
            )
        };
        files.push(json!({"path":name,"encoding":encoding,"content":content}));
    }
    let archive =
        json!({"format":"milkup-plugin","version":1,"manifest":active["manifest"],"files":files});
    let mut current = entry(
        &catalog::prepare(
            root,
            archive,
            active["sourcePath"].as_str().unwrap().into(),
            before["revision"].as_u64(),
        )
        .unwrap(),
    );
    let txn = current["pending"]["transactionId"].clone();
    let fingerprint = current["pending"]["generation"]["capabilityFingerprint"].clone();
    // Deliberately model the prior approved generation via real native transitions;
    // no claim that the test-only throwing module passed a historical runtime trial.
    for action in ["approve", "beginTrial", "commit"] {
        let mut command = json!({"type":action,"transactionId":txn,"fingerprint":fingerprint});
        if action == "commit" {
            command["enabled"] = json!(true);
        }
        current = entry(
            &catalog::transition(root, ID, current["revision"].as_u64().unwrap(), command).unwrap(),
        );
    }
    assert_eq!(current["enabled"], true);
    assert_eq!(current["active"]["manifest"], active["manifest"]);
    assert_ne!(current["active"]["contentSha256"], active["contentSha256"]);
    assert_eq!(current["previous"]["id"], active["id"]);
    let proof = json!({"schema":1,"status":"passed","scope":"synthetic-prior-approved-bundle-not-historical-release","scenario":scenario,
        "runId":receipt["runId"],"candidateSha":receipt["candidateSha"],"sid":receipt["context"]["actualSid"],
        "baselineReceiptSha256":receipt_hash,"catalogPath":catalog_path,"catalogSha256":hash(&read_plain(catalog_path,16*1024*1024)),
        "before":before,"after":current});
    use std::io::Write;
    let mut f = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(out)
        .unwrap();
    f.write_all(&serde_json::to_vec_pretty(&proof).unwrap())
        .unwrap();
    f.sync_all().unwrap();
}
fn main() {
    let args: Vec<String> = std::env::args().collect();
    assert_eq!(args.len(), 5, "receipt receiptSha256 scenario output");
    run(Path::new(&args[1]), &args[2], &args[3], Path::new(&args[4]));
}

#[cfg(test)]
mod fixture_tests {
    use super::*;
    #[test]
    fn synthetic_variants_preserve_manifest_and_real_native_generation_seals() {
        for scenario in ["same-version", "startup-failure"] {
            let base = std::env::temp_dir().join(format!(
                "milkup-migration-fixture-{}-{scenario}",
                std::process::id()
            ));
            assert!(!base.exists());
            fs::create_dir(&base).unwrap();
            let root = base.join("app.milkup.desktop/plugins");
            fs::create_dir_all(&root).unwrap();
            let archive = json!({"format":"milkup-plugin","version":1,"manifest":{"id":ID,"name":"Diagrams fixture","version":"1.3.0","host":"worker","main":"dist/plugin.js","permissions":["document:read"]},"files":[{"path":"dist/plugin.js","encoding":"utf8","content":"export default { activate() {} }"}]});
            let mut e = entry(
                &catalog::prepare(
                    &root,
                    archive,
                    "bundled:diagrams.milkup-plugin".into(),
                    None,
                )
                .unwrap(),
            );
            let txn = e["pending"]["transactionId"].clone();
            let fingerprint = e["pending"]["generation"]["capabilityFingerprint"].clone();
            for kind in ["approve", "beginTrial", "commit"] {
                let mut a = json!({"type":kind,"transactionId":txn,"fingerprint":fingerprint});
                if kind == "commit" {
                    a["enabled"] = json!(true);
                }
                e = entry(
                    &catalog::transition(&root, ID, e["revision"].as_u64().unwrap(), a).unwrap(),
                );
            }
            let catalog_path = root.join("catalog-v1.json");
            let receipt = json!({"status":"passed","applicationSha256":"5d4df1a7f6e7962be12d624437f620fe5775885e79b7a97b4b519a676ec95d84","runId":"local-fixture-unit-test","candidateSha":"local-fixture-unit-test","context":{"actualSid":"unit-test-not-Windows-evidence","knownFolders":{"localAppData":base,"roamingAppData":base}},"launches":[{"closedByUi":true}],"migration":{"phase":"prepare","choice":"enabled","auditContract":"shipped-beta9-preparation-only","catalog":{"path":catalog_path,"sha256":hash(&fs::read(&catalog_path).unwrap()),"sourcePath":e["active"]["sourcePath"],"contentSha256":e["active"]["contentSha256"]}}});
            let receipt_path = base.join("receipt.json");
            let bytes = serde_json::to_vec(&receipt).unwrap();
            fs::write(&receipt_path, &bytes).unwrap();
            let out = base.join("proof.json");
            run(&receipt_path, &hash(&bytes), scenario, &out);
            let proof: Value = serde_json::from_slice(&fs::read(out).unwrap()).unwrap();
            assert_eq!(proof["scenario"], scenario);
            assert_eq!(
                proof["after"]["active"]["manifestSha256"],
                e["active"]["manifestSha256"]
            );
            let module = fs::read_to_string(
                Path::new(proof["after"]["active"]["packageRoot"].as_str().unwrap())
                    .join("dist/plugin.js"),
            )
            .unwrap();
            assert_eq!(
                module.starts_with("throw new Error"),
                scenario == "startup-failure"
            );
            fs::remove_dir_all(base).unwrap();
        }
    }
}
