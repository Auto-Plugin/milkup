//! Shared transaction regressions for desktop and the Tauri-free native harness.
use super::*;
struct Fixture(PathBuf);
impl Fixture {
    fn new() -> Self {
        let p = std::env::temp_dir().join(format!("milkup-catalog-test-{}", token()));
        std::fs::create_dir_all(&p).unwrap();
        Self(p)
    }
    fn read(&self) -> Value {
        read(&self.0).unwrap()
    }
    fn restart(&self) -> Value {
        INITIALIZED.get().unwrap().lock().unwrap().remove(&self.0);
        self.read()
    }
    fn prepare(&self, version: &str) -> Value {
        let state = self.read();
        let rev = state["entries"]
            .as_array()
            .unwrap()
            .first()
            .map(|e| e["revision"].as_u64().unwrap());
        prepare(
            &self.0,
            archive("test.plugin", version),
            "test:fixture".into(),
            rev,
        )
        .unwrap()
    }
    fn action(&self, action: Value) -> Value {
        let state = self.read();
        transition(
            &self.0,
            "test.plugin",
            state["entries"][0]["revision"].as_u64().unwrap(),
            action,
        )
        .unwrap()
    }
    fn candidate_action(&self, kind: &str) -> Value {
        let state = self.read();
        let p = &state["entries"][0]["pending"];
        let mut a = json!({"type":kind,"transactionId":p["transactionId"],"fingerprint":p["generation"]["capabilityFingerprint"]});
        if kind == "commit" {
            a["enabled"] = json!(true);
        }
        self.action(a)
    }
    fn install(&self, version: &str) -> Value {
        self.prepare(version);
        self.candidate_action("approve");
        self.candidate_action("beginTrial");
        self.candidate_action("commit")
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        FAILURE.with(|f| *f.borrow_mut() = None);
        TEST_FREE.with(|v| *v.borrow_mut() = None);
        if let Some(m) = INITIALIZED.get() {
            m.lock().unwrap().remove(&self.0);
        }
        let _ = std::fs::remove_dir_all(&self.0);
    }
}
fn archive(id: &str, version: &str) -> Value {
    json!({"format":"milkup-plugin","version":1,"manifest":{"id":id,"name":"Fixture","version":version,"host":"worker","main":"dist/main.js","permissions":["document:read"]},"files":[{"path":"dist/main.js","encoding":"utf8","content":"export default { activate() {} }"}]})
}

#[test]
fn rejects_base64_worker_entry_even_when_decodable_utf8() {
    let mut a = archive("test.plugin", "1.0.0");
    a["files"][0]["encoding"] = json!("base64");
    a["files"][0]["content"] = json!("eA==");
    assert!(
        archive_decode(a).is_err(),
        "worker entry encoding must be utf8, not merely decodable"
    );
}
#[test]
fn prepare_leaves_active_and_data_unchanged_and_commit_retains_verified_previous() {
    let f = Fixture::new();
    let old = f.install("1.0.0");
    let old_path = old["entries"][0]["active"]["packageRoot"].as_str().unwrap();
    let old_bytes = std::fs::read(Path::new(old_path).join("dist/main.js")).unwrap();
    std::fs::write(f.0.join("test.plugin/data/sentinel"), b"user data").unwrap();
    let staged = f.prepare("2.0.0");
    assert_eq!(staged["entries"][0]["active"], old["entries"][0]["active"]);
    assert_eq!(staged["entries"][0]["enabled"], true);
    f.candidate_action("beginTrial");
    let committed = f.candidate_action("commit");
    assert_eq!(
        committed["entries"][0]["previous"],
        old["entries"][0]["active"]
    );
    assert_eq!(
        std::fs::read(Path::new(old_path).join("dist/main.js")).unwrap(),
        old_bytes
    );
    assert_eq!(
        std::fs::read(f.0.join("test.plugin/data/sentinel")).unwrap(),
        b"user data"
    );
}
#[test]
fn injected_mid_stage_failure_never_changes_catalog_or_old_bytes() {
    let f = Fixture::new();
    f.install("1.0.0");
    let before = std::fs::read(f.0.join(CATALOG)).unwrap();
    let snapshot = f.read();
    let mut a = archive("test.plugin", "2.0.0");
    a["files"]
        .as_array_mut()
        .unwrap()
        .push(json!({"path":"second.txt","encoding":"utf8","content":"later"}));
    FAILURE.with(|v| *v.borrow_mut() = Some(("stage-file", 1)));
    assert!(prepare(
        &f.0,
        a,
        "test:fixture".into(),
        snapshot["entries"][0]["revision"].as_u64()
    )
    .is_err());
    FAILURE.with(|v| *v.borrow_mut() = None);
    assert_eq!(std::fs::read(f.0.join(CATALOG)).unwrap(), before);
    assert_eq!(f.read()["entries"][0]["enabled"], true);
}
#[test]
fn commit_failure_before_replace_restores_old_decision_after_restart() {
    let f = Fixture::new();
    let old = f.install("1.0.0");
    f.prepare("2.0.0");
    let trial = f.candidate_action("beginTrial");
    let p = &trial["entries"][0]["pending"];
    FAILURE.with(|v| *v.borrow_mut() = Some(("before-catalog-replace", 0)));
    assert!(transition(&f.0,"test.plugin",trial["entries"][0]["revision"].as_u64().unwrap(),json!({"type":"commit","transactionId":p["transactionId"],"fingerprint":p["generation"]["capabilityFingerprint"],"enabled":true})).is_err());
    FAILURE.with(|v| *v.borrow_mut() = None);
    let recovered = f.restart();
    assert_eq!(
        recovered["entries"][0]["active"],
        old["entries"][0]["active"]
    );
    assert_eq!(recovered["entries"][0]["pending"]["phase"], "prepared");
    assert!(recovered["entries"][0]["pending"]["generation"]["approvedFingerprint"].is_null());
    assert_eq!(recovered["entries"][0]["enabled"], false);
}
#[test]
fn revision_and_candidate_identity_prevent_late_approval() {
    let f = Fixture::new();
    let a = f.prepare("1.0.0");
    let p = &a["entries"][0]["pending"];
    let action = json!({"type":"approve","transactionId":p["transactionId"],"fingerprint":p["generation"]["capabilityFingerprint"]});
    f.candidate_action("abort");
    let b = f.prepare("2.0.0");
    assert!(transition(
        &f.0,
        "test.plugin",
        a["entries"][0]["revision"].as_u64().unwrap(),
        action.clone()
    )
    .unwrap_err()
    .contains("conflict"));
    assert!(transition(
        &f.0,
        "test.plugin",
        b["entries"][0]["revision"].as_u64().unwrap(),
        action
    )
    .unwrap_err()
    .contains("conflict"));
    assert!(f.read()["entries"][0]["pending"]["generation"]["approvedFingerprint"].is_null());
}
#[test]
fn expanded_origins_require_new_approval_and_revocation_cannot_rollback_old_authority() {
    let f = Fixture::new();
    f.install("1.0.0");
    let mut a = archive("test.plugin", "2.0.0");
    a["manifest"]["permissions"] = json!(["document:read", "network:access"]);
    a["manifest"]["networkOrigins"] = json!(["https://example.com"]);
    let revision = f.read()["entries"][0]["revision"].as_u64();
    let staged = prepare(&f.0, a, "test:fixture".into(), revision).unwrap();
    assert!(staged["entries"][0]["pending"]["generation"]["approvedFingerprint"].is_null());
    f.candidate_action("approve");
    f.candidate_action("beginTrial");
    f.candidate_action("commit");
    f.action(json!({"type":"revokeApproval"}));
    let restored = f.action(json!({"type":"rollback"}));
    assert!(restored["entries"][0]["active"]["approvedFingerprint"].is_null());
    assert_eq!(restored["entries"][0]["enabled"], false);
}
#[test]
fn interrupted_startup_stays_disabled_and_late_complete_rejected() {
    let f = Fixture::new();
    let c = f.install("1.0.0");
    f.action(json!({"type":"disable"}));
    let starting =
        f.action(json!({"type":"startupBegin","generationId":c["entries"][0]["active"]["id"]}));
    let attempt = starting["entries"][0]["startAttempt"].clone();
    let restarted = f.restart();
    assert_eq!(restarted["entries"][0]["enabled"], false);
    assert!(transition(
        &f.0,
        "test.plugin",
        restarted["entries"][0]["revision"].as_u64().unwrap(),
        json!({"type":"startupComplete","attemptId":attempt})
    )
    .is_err());
}
#[test]
fn two_ids_commit_without_lost_catalog_updates() {
    let f = Fixture::new();
    prepare(
        &f.0,
        archive("test.first", "1.0.0"),
        "fixture:first".into(),
        None,
    )
    .unwrap();
    prepare(
        &f.0,
        archive("test.second", "1.0.0"),
        "fixture:second".into(),
        None,
    )
    .unwrap();
    let c = f.read();
    assert_eq!(c["entries"].as_array().unwrap().len(), 2);
    assert!(c["revision"].as_u64().unwrap() >= 2);
}
#[cfg(unix)]
#[test]
fn package_symlink_never_reads_or_writes_outside() {
    use std::os::unix::fs::symlink;
    let f = Fixture::new();
    let outside = Fixture::new();
    std::fs::create_dir_all(f.0.join("test.plugin")).unwrap();
    symlink(&outside.0, f.0.join("test.plugin/generations")).unwrap();
    assert!(prepare(
        &f.0,
        archive("test.plugin", "1.0.0"),
        "fixture".into(),
        None
    )
    .is_err());
    assert_eq!(std::fs::read_dir(&outside.0).unwrap().count(), 0);
}
#[test]
fn sealed_worker_snapshot_rejects_mutation_and_symlink() {
    let f = Fixture::new();
    let c = f.install("1.0.0");
    let g = &c["entries"][0]["active"];
    let id = g["id"].as_str().unwrap();
    assert!(read_worker_module(&f.0, "test.plugin", id)
        .unwrap()
        .contains("activate"));
    let path = Path::new(g["packageRoot"].as_str().unwrap()).join("dist/main.js");
    std::fs::write(&path, b"changed").unwrap();
    assert!(read_worker_module(&f.0, "test.plugin", id).is_err());
    #[cfg(unix)]
    {
        std::fs::remove_file(&path).unwrap();
        std::os::unix::fs::symlink("/etc/passwd", &path).unwrap();
        assert!(read_worker_module(&f.0, "test.plugin", id).is_err());
    }
}
#[test]
fn corrupt_primary_uses_backup_without_restoring_old_enabled_or_approval() {
    let f = Fixture::new();
    f.install("1.0.0");
    f.action(json!({"type":"disable"}));
    std::fs::write(f.0.join(CATALOG), b"{broken").unwrap();
    let c = f.restart();
    assert_eq!(c["entries"][0]["enabled"], false);
    assert!(c["entries"][0]["active"]["approvedFingerprint"].is_null());
    assert!(std::fs::read_dir(&f.0)
        .unwrap()
        .filter_map(|e| e.ok())
        .any(|e| e
            .file_name()
            .to_string_lossy()
            .starts_with("catalog-corrupt-")));
}
#[test]
fn tombstone_preserves_user_data_and_cannot_start_old_generation() {
    let f = Fixture::new();
    let old = f.install("1.0.0");
    std::fs::write(f.0.join("test.plugin/data/sentinel"), b"keep").unwrap();
    let removed = f.action(json!({"type":"remove"}));
    assert_eq!(removed["entries"][0]["tombstone"], true);
    assert_eq!(
        std::fs::read(f.0.join("test.plugin/data/sentinel")).unwrap(),
        b"keep"
    );
    assert!(read_worker_module(
        &f.0,
        "test.plugin",
        old["entries"][0]["active"]["id"].as_str().unwrap()
    )
    .is_err());
    assert_eq!(f.restart()["entries"][0]["tombstone"], true);
}
fn migration_validation(raw: &str, indices: &[usize]) -> Option<Value> {
    let parsed: Value = serde_json::from_str(raw).unwrap_or(Value::Null);
    Some(json!({"version":1,"rawSha256":digest(raw.as_bytes()),
        "records":indices.iter().map(|&index| json!({"index":index,"manifest":parsed["records"][index]["manifest"]})).collect::<Vec<_>>(),
        "diagnostics":[]}))
}
#[test]
fn migration_rejects_missing_or_unbound_validation_after_exact_backup() {
    let raw = serde_json::to_string(&json!({"version":1,"records":[{
        "manifest":archive("test.plugin","1.0.0")["manifest"]
    }]}))
    .unwrap();
    let valid = migration_validation(&raw, &[0]).unwrap();
    let mut bad_digest = valid.clone();
    bad_digest["rawSha256"] = json!("0".repeat(64));
    let mut duplicate = valid.clone();
    duplicate["records"]
        .as_array_mut()
        .unwrap()
        .push(valid["records"][0].clone());
    let mut outside = valid.clone();
    outside["records"][0]["index"] = json!(1);
    let mut mismatch = valid.clone();
    mismatch["records"][0]["manifest"]["version"] = json!("9.0.0");
    let mut wrong_version = valid.clone();
    wrong_version["version"] = json!(2);
    let mut excessive_diagnostics = valid.clone();
    excessive_diagnostics["diagnostics"] = json!(vec!["diagnosis"; 129]);
    let mut excessive_message = valid.clone();
    excessive_message["diagnostics"] = json!(["界".repeat(1025)]);
    for hint in [
        None,
        Some(bad_digest),
        Some(duplicate),
        Some(outside),
        Some(mismatch),
        Some(wrong_version),
        Some(excessive_diagnostics),
        Some(excessive_message),
    ] {
        let f = Fixture::new();
        assert!(migrate(&f.0, &raw, hint)
            .unwrap_err()
            .starts_with("[plugin-catalog:invalid]"));
        assert!(!f.0.join(CATALOG).exists());
        assert!(!f.0.join("test.plugin").exists());
        assert_eq!(
            std::fs::read(f.0.join(format!("legacy-registry-{}.json", digest(raw.as_bytes()))))
                .unwrap(),
            raw.as_bytes()
        );
        assert!(f.read()["migrationReceipt"].is_null());
    }
}
#[test]
fn migration_corrupt_root_is_backed_up_and_quarantined_once() {
    for raw in ["not JSON", "{}", r#"{"version":2,"records":[]}"#] {
        let f = Fixture::new();
        let c = migrate(&f.0, raw, migration_validation(raw, &[])).unwrap();
        assert!(c["entries"].as_array().unwrap().is_empty());
        assert_eq!(c["migrationReceipt"], digest(raw.as_bytes()));
        assert!(!c["diagnostics"].as_array().unwrap().is_empty());
        assert_eq!(migrate(&f.0, raw, None).unwrap(), c);
        assert_eq!(
            std::fs::read(f.0.join(format!("legacy-registry-{}.json", digest(raw.as_bytes()))))
                .unwrap(),
            raw.as_bytes()
        );
    }
}
#[test]
fn migration_missing_or_changed_old_package_is_quarantined_without_retry_loop() {
    for changed in [false, true] {
        let f = Fixture::new();
        let manifest = archive("test.missing", "1.0.0")["manifest"].clone();
        if changed {
            let package = f.0.join("test.missing/package");
            std::fs::create_dir_all(&package).unwrap();
            let mut other = manifest.clone();
            other["version"] = json!("2.0.0");
            std::fs::write(
                package.join("plugin.json"),
                serde_json::to_vec(&other).unwrap(),
            )
            .unwrap();
        }
        let raw = serde_json::to_string(&json!({"version":1,"records":[{
            "manifest":manifest,"enabled":false,"state":"disabled","approvals":{}
        }]}))
        .unwrap();
        let c = migrate(&f.0, &raw, migration_validation(&raw, &[0])).unwrap();
        assert!(c["entries"].as_array().unwrap().is_empty());
        assert_eq!(c["migrationReceipt"], digest(raw.as_bytes()));
        assert!(c["diagnostics"][0]
            .as_str()
            .unwrap()
            .contains("quarantined"));
        assert!(!f.0.join("test.missing/generations").exists());
    }
}
#[test]
fn migration_keeps_exact_backup_and_duplicate_ids_quarantined() {
    let f = Fixture::new();
    let record = json!({"manifest":archive("test.plugin","1.0.0")["manifest"],"enabled":true,"state":"enabled","approvals":{"permissions":["document:read"],"hosts":["worker"]}});
    let raw =
        serde_json::to_string(&json!({"version":1,"records":[record.clone(),record]})).unwrap();
    let c = migrate(&f.0, &raw, migration_validation(&raw, &[])).unwrap();
    assert!(c["entries"].as_array().unwrap().is_empty());
    assert_eq!(c["diagnostics"].as_array().unwrap().len(), 2);
    assert_eq!(
        std::fs::read(f.0.join(format!("legacy-registry-{}.json", digest(raw.as_bytes()))))
            .unwrap(),
        raw.as_bytes()
    );
    assert_eq!(
        migrate(&f.0, &raw, migration_validation(&raw, &[])).unwrap(),
        c
    );
    assert!(migrate(&f.0, "{}", None).is_err());
}
#[test]
fn malformed_package_fails_before_any_catalog_or_plugin_write() {
    let f = Fixture::new();
    let mut a = archive("test.plugin", "1.0.0");
    a["files"]
        .as_array_mut()
        .unwrap()
        .push(json!({"path":"dist/main.js/child","encoding":"base64","content":"!!!!"}));
    assert!(prepare(&f.0, a, "fixture".into(), None).is_err());
    assert!(!f.0.join("test.plugin").exists());
    assert!(!f.0.join(CATALOG).exists());
}
#[test]
fn insufficient_space_is_rejected_before_generation_or_authority_changes() {
    let f = Fixture::new();
    f.install("1.0.0");
    let before = f.read();
    let bytes = std::fs::read(f.0.join(CATALOG)).unwrap();
    let generations = std::fs::read_dir(f.0.join("test.plugin/generations"))
        .unwrap()
        .count();
    TEST_FREE.with(|v| *v.borrow_mut() = Some(0));
    let error = prepare(
        &f.0,
        archive("test.plugin", "2.0.0"),
        "test:fixture".into(),
        before["entries"][0]["revision"].as_u64(),
    )
    .unwrap_err();
    TEST_FREE.with(|v| *v.borrow_mut() = None);
    assert!(error.starts_with("[plugin-catalog:quota]"));
    assert_eq!(std::fs::read(f.0.join(CATALOG)).unwrap(), bytes);
    assert_eq!(
        std::fs::read_dir(f.0.join("test.plugin/generations"))
            .unwrap()
            .count(),
        generations
    );
    assert_eq!(f.read()["entries"][0]["enabled"], true);
}
#[test]
fn deletion_failure_is_durable_tombstone_and_can_retry_without_deleting_data() {
    let f = Fixture::new();
    let installed = f.install("1.0.0");
    let package = PathBuf::from(
        installed["entries"][0]["active"]["packageRoot"]
            .as_str()
            .unwrap(),
    );
    std::fs::write(f.0.join("test.plugin/data/sentinel"), b"keep").unwrap();
    FAILURE.with(|v| *v.borrow_mut() = Some(("gc-delete", 0)));
    let failed_cleanup = f.action(json!({"type":"remove"}));
    FAILURE.with(|v| *v.borrow_mut() = None);
    assert_eq!(failed_cleanup["entries"][0]["tombstone"], true);
    assert_eq!(failed_cleanup["entries"][0]["enabled"], false);
    assert!(failed_cleanup["entries"][0]["diagnostics"]
        .as_array()
        .unwrap()
        .iter()
        .any(|v| v.as_str().unwrap().contains("cleanup pending")));
    assert!(package.exists());
    assert_eq!(f.restart()["entries"][0]["tombstone"], true);
    let retried = f.action(json!({"type":"remove"}));
    assert_eq!(retried["entries"][0]["tombstone"], true);
    assert!(!package.exists());
    assert_eq!(
        std::fs::read(f.0.join("test.plugin/data/sentinel")).unwrap(),
        b"keep"
    );
}
#[test]
fn concurrent_different_ids_never_lose_catalog_updates() {
    use std::sync::{Arc, Barrier};
    let f = Fixture::new();
    f.read();
    let barrier = Arc::new(Barrier::new(4));
    let mut jobs = vec![];
    for id in ["test.alpha", "test.beta", "test.gamma", "test.delta"] {
        let barrier = barrier.clone();
        let root = f.0.clone();
        jobs.push(std::thread::spawn(move || {
            barrier.wait();
            prepare(&root, archive(id, "1.0.0"), format!("fixture:{id}"), None)
        }));
    }
    for job in jobs {
        job.join().unwrap().unwrap();
    }
    let c = f.read();
    let ids: BTreeSet<_> = c["entries"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["id"].as_str().unwrap())
        .collect();
    assert_eq!(
        ids,
        BTreeSet::from(["test.alpha", "test.beta", "test.gamma", "test.delta"])
    );
    assert_eq!(c["revision"], 4);
}
#[test]
fn migration_io_failure_preserves_backup_and_remains_retryable() {
    let f = Fixture::new();
    let a = archive("test.plugin", "1.0.0");
    let package = f.0.join("test.plugin/package");
    std::fs::create_dir_all(package.join("dist")).unwrap();
    std::fs::write(
        package.join("plugin.json"),
        serde_json::to_vec(&a["manifest"]).unwrap(),
    )
    .unwrap();
    std::fs::write(
        package.join("dist/main.js"),
        b"export default { activate() {} }",
    )
    .unwrap();
    let raw=serde_json::to_string(&json!({"version":1,"records":[{"manifest":a["manifest"],"enabled":true,"state":"enabled","approvals":{"hosts":["worker"],"permissions":["document:read"]}}]})).unwrap();
    FAILURE.with(|v| *v.borrow_mut() = Some(("stage-file", 0)));
    assert!(migrate(&f.0, &raw, migration_validation(&raw, &[0]))
        .unwrap_err()
        .starts_with("[plugin-catalog:io]"));
    FAILURE.with(|v| *v.borrow_mut() = None);
    assert!(f.read()["migrationReceipt"].is_null());
    assert_eq!(
        std::fs::read(f.0.join(format!("legacy-registry-{}.json", digest(raw.as_bytes()))))
            .unwrap(),
        raw.as_bytes()
    );
    let c = migrate(&f.0, &raw, migration_validation(&raw, &[0])).unwrap();
    assert_eq!(c["entries"].as_array().unwrap().len(), 1);
    assert_eq!(c["entries"][0]["enabled"], false);
    assert!(c["entries"][0]["pending"]["generation"]["approvedFingerprint"].is_null());
}
#[test]
fn rejects_checksummed_inconsistent_authority_states() {
    let f = Fixture::new();
    f.install("1.0.0");
    let catalog = decode(&std::fs::read(f.0.join(CATALOG)).unwrap()).unwrap();
    let mut cases = Vec::new();
    let mut c = catalog.clone();
    c.entries[0].active.as_mut().unwrap().approved_fingerprint = None;
    cases.push(("enabled without approval", c));
    let mut c = catalog.clone();
    c.entries[0].previous = c.entries[0].active.clone();
    cases.push(("duplicate generation", c));
    let mut c = catalog.clone();
    c.entries[0].enabled = false;
    c.entries[0].tombstone = true;
    c.entries[0].start_attempt = Some(token());
    cases.push(("tombstone startup", c));
    let mut c = catalog.clone();
    let mut generation = c.entries[0].active.clone().unwrap();
    generation.id = token();
    generation.verified = false;
    generation.approved_fingerprint = None;
    c.entries[0].enabled = false;
    c.entries[0].pending = Some(Candidate {
        transaction_id: token(),
        generation,
        phase: "trial".into(),
        restore_enabled: true,
    });
    cases.push(("unapproved trial", c.clone()));
    c.entries[0]
        .pending
        .as_mut()
        .unwrap()
        .generation
        .approved_fingerprint = Some(
        c.entries[0]
            .pending
            .as_ref()
            .unwrap()
            .generation
            .capability_fingerprint
            .clone(),
    );
    c.entries[0].enabled = true;
    cases.push(("enabled old during trial", c));
    for source in [String::new(), "bad\nsource".into(), "x".repeat(4097)] {
        let mut c = catalog.clone();
        c.entries[0].active.as_mut().unwrap().source_path = source;
        cases.push(("invalid source", c));
    }
    for (name, c) in cases {
        let checksum = digest(&serde_json::to_vec(&c).unwrap());
        let bytes = serde_json::to_vec(&Envelope {
            sha256: checksum,
            payload: c,
        })
        .unwrap();
        assert!(
            decode(&bytes).is_err(),
            "valid checksum must not authorize {name}"
        );
    }
}
#[test]
fn gc_retains_backup_generations_for_third_commit_corruption_recovery() {
    let f = Fixture::new();
    let first = f.install("1.0.0");
    let second = f.install("2.0.0");
    f.install("3.0.0");
    let oldest = PathBuf::from(
        first["entries"][0]["active"]["packageRoot"]
            .as_str()
            .unwrap(),
    );
    assert!(
        oldest.join("dist/main.js").exists(),
        "valid backup still references this verified generation"
    );
    std::fs::write(f.0.join(CATALOG), b"{corrupt").unwrap();
    let restored = f.restart();
    assert_eq!(
        restored["entries"][0]["active"]["id"],
        second["entries"][0]["active"]["id"]
    );
    assert_eq!(
        restored["entries"][0]["previous"]["id"],
        first["entries"][0]["active"]["id"]
    );
    assert_eq!(restored["entries"][0]["enabled"], false);
    for key in ["active", "previous"] {
        let g = &restored["entries"][0][key];
        assert!(Path::new(g["packageRoot"].as_str().unwrap())
            .join("dist/main.js")
            .exists());
        assert!(g["approvedFingerprint"].is_null());
    }
}
#[test]
fn migration_quarantines_bad_manifest_rows_without_poisoning_valid_plugin() {
    let f = Fixture::new();
    let mut records = Vec::new();
    for (index, id) in [
        "test.valid",
        "test.badname",
        "test.badcontributes",
        "test.badsettings",
    ]
    .iter()
    .enumerate()
    {
        let mut manifest = archive(id, "1.0.0")["manifest"].clone();
        match index {
            1 => {
                manifest.as_object_mut().unwrap().remove("name");
            }
            2 => manifest["contributes"] = json!({"commands":"not an array"}),
            3 => manifest["settings"] = json!({"not":"an array"}),
            _ => {}
        }
        let package = f.0.join(id).join("package");
        std::fs::create_dir_all(package.join("dist")).unwrap();
        std::fs::write(
            package.join("plugin.json"),
            serde_json::to_vec(&manifest).unwrap(),
        )
        .unwrap();
        std::fs::write(
            package.join("dist/main.js"),
            b"export default { activate() {} }",
        )
        .unwrap();
        records.push(json!({"manifest":manifest,"manifestPath":package.join("plugin.json"),"rootPath":package,"sourcePath":"test:legacy","dataRoot":f.0.join(id).join("data"),"storageRoot":f.0.join(id).join("storage"),"installedAt":1,"updatedAt":1,"trust":"untrusted","enabled":false,"state":"disabled","errors":[],"approvals":{"permissions":[],"hosts":[]}}));
    }
    let raw = serde_json::to_string(&json!({"version":1,"records":records})).unwrap();
    let result = migrate(&f.0, &raw, migration_validation(&raw, &[0])).unwrap();
    assert_eq!(
        result["entries"].as_array().unwrap().len(),
        1,
        "bad schema rows must not poison the whole adapter snapshot"
    );
    assert_eq!(result["entries"][0]["id"], "test.valid");
    assert!(result["diagnostics"].as_array().unwrap().len() >= 3);
    assert_eq!(
        std::fs::read(f.0.join(format!("legacy-registry-{}.json", digest(raw.as_bytes()))))
            .unwrap(),
        raw.as_bytes()
    );
}

#[test]
fn concurrent_same_id_approval_and_abort_accept_only_one_revision() {
    use std::sync::{Arc, Barrier};
    let f = Fixture::new();
    let state = f.prepare("1.0.0");
    let entry = &state["entries"][0];
    let revision = entry["revision"].as_u64().unwrap();
    let pending = &entry["pending"];
    let barrier = Arc::new(Barrier::new(2));
    let jobs: Vec<_> = ["approve", "abort"]
        .into_iter()
        .map(|kind| {
            let action = json!({"type":kind,"transactionId":pending["transactionId"],"fingerprint":pending["generation"]["capabilityFingerprint"]});
            let root = f.0.clone();
            let barrier = barrier.clone();
            std::thread::spawn(move || {
                barrier.wait();
                transition(&root, "test.plugin", revision, action)
            })
        })
        .collect();
    let results: Vec<_> = jobs.into_iter().map(|job| job.join().unwrap()).collect();
    assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
    assert!(results
        .iter()
        .filter_map(|result| result.as_ref().err())
        .all(|error| error.starts_with("[plugin-catalog:conflict]")));
    assert_eq!(f.read()["entries"][0]["revision"], revision + 1);
}

#[test]
fn ordinary_reads_do_not_abort_live_trial_or_startup_attempt() {
    let f = Fixture::new();
    f.install("1.0.0");
    f.prepare("2.0.0");
    let trial = f.candidate_action("beginTrial");
    assert_eq!(f.read(), trial);
    assert_eq!(f.read(), trial);
    f.candidate_action("abort");
    let state = f.action(json!({"type":"disable"}));
    let started =
        f.action(json!({"type":"startupBegin","generationId":state["entries"][0]["active"]["id"]}));
    assert_eq!(f.read(), started);
    assert_eq!(f.read(), started);
    let attempt = started["entries"][0]["startAttempt"].clone();
    let disabled = f.action(json!({"type":"disable"}));
    assert!(transition(
        &f.0,
        "test.plugin",
        disabled["entries"][0]["revision"].as_u64().unwrap(),
        json!({"type":"startupComplete","attemptId":attempt})
    )
    .unwrap_err()
    .starts_with("[plugin-catalog:conflict]"));
}

#[test]
fn backup_replacement_failure_leaves_primary_decision_byte_exact() {
    let f = Fixture::new();
    f.install("1.0.0");
    let before = std::fs::read(f.0.join(CATALOG)).unwrap();
    let state = f.read();
    // A directory at the backup leaf is a real disk error, not a mock callback.
    std::fs::remove_file(f.0.join(BACKUP)).unwrap();
    std::fs::create_dir(f.0.join(BACKUP)).unwrap();
    let error = transition(
        &f.0,
        "test.plugin",
        state["entries"][0]["revision"].as_u64().unwrap(),
        json!({"type":"disable"}),
    )
    .unwrap_err();
    assert!(
        error.starts_with("[plugin-catalog:io]") || error.starts_with("[plugin-catalog:invalid]")
    );
    assert_eq!(std::fs::read(f.0.join(CATALOG)).unwrap(), before);
    assert!(f.read()["entries"][0]["enabled"].as_bool().unwrap());
}

#[test]
fn corrupt_primary_and_backup_fail_closed_and_retain_original_bytes() {
    let f = Fixture::new();
    f.install("1.0.0");
    std::fs::write(f.0.join(CATALOG), b"primary corrupt\n").unwrap();
    std::fs::write(f.0.join(BACKUP), b"backup corrupt\n").unwrap();
    INITIALIZED.get().unwrap().lock().unwrap().remove(&f.0);
    assert!(read(&f.0)
        .unwrap_err()
        .starts_with("[plugin-catalog:corrupt]"));
    assert_eq!(
        std::fs::read(f.0.join(CATALOG)).unwrap(),
        b"primary corrupt\n"
    );
    assert_eq!(
        std::fs::read(f.0.join(BACKUP)).unwrap(),
        b"backup corrupt\n"
    );
}

#[test]
fn changed_candidate_cannot_commit_or_replace_retained_active_generation() {
    let f = Fixture::new();
    let old = f.install("1.0.0");
    f.prepare("2.0.0");
    let trial = f.candidate_action("beginTrial");
    let pending = &trial["entries"][0]["pending"];
    let before = std::fs::read(f.0.join(CATALOG)).unwrap();
    let module =
        Path::new(pending["generation"]["packageRoot"].as_str().unwrap()).join("dist/main.js");
    std::fs::write(module, b"changed after verified trial started").unwrap();
    assert!(transition(&f.0, "test.plugin", trial["entries"][0]["revision"].as_u64().unwrap(),
        json!({"type":"commit","transactionId":pending["transactionId"],"fingerprint":pending["generation"]["capabilityFingerprint"],"enabled":true})).unwrap_err().starts_with("[plugin-catalog:corrupt]"));
    assert_eq!(std::fs::read(f.0.join(CATALOG)).unwrap(), before);
    let recovered = f.restart();
    assert_eq!(
        recovered["entries"][0]["active"],
        old["entries"][0]["active"]
    );
    assert_eq!(recovered["entries"][0]["enabled"], false);
    assert_eq!(recovered["entries"][0]["pending"]["phase"], "prepared");
    assert!(recovered["entries"][0]["pending"]["generation"]["approvedFingerprint"].is_null());
}

#[test]
fn sidecar_candidate_remains_unactivated_even_after_explicit_approval() {
    let f = Fixture::new();
    let mut a = archive("test.plugin", "1.0.0");
    a["manifest"]["host"] = json!("sidecar");
    prepare(&f.0, a, "test:sidecar".into(), None).unwrap();
    let approved = f.candidate_action("approve");
    let pending = &approved["entries"][0]["pending"];
    let error = transition(&f.0, "test.plugin", approved["entries"][0]["revision"].as_u64().unwrap(),
        json!({"type":"beginTrial","transactionId":pending["transactionId"],"fingerprint":pending["generation"]["capabilityFingerprint"]})).unwrap_err();
    assert!(error.starts_with("[plugin-catalog:unsupported]"));
    assert_eq!(f.read(), approved);
    assert!(approved["entries"][0]["active"].is_null());
    assert_eq!(approved["entries"][0]["enabled"], false);
}

#[test]
fn beta3_interrupted_first_install_remains_visible_for_review_after_restart() {
    let f = Fixture::new();
    f.prepare("1.0.0");
    f.candidate_action("approve");
    let trial = f.candidate_action("beginTrial");
    let restarted = f.restart();
    let e = &restarted["entries"][0];
    assert_eq!(
        e["pending"]["generation"]["id"],
        trial["entries"][0]["pending"]["generation"]["id"]
    );
    assert_eq!(e["pending"]["phase"], "prepared");
    assert!(e["pending"]["generation"]["approvedFingerprint"].is_null());
    assert_eq!(e["enabled"], false);
    assert!(!e["diagnostics"].as_array().unwrap().is_empty());
    assert_eq!(f.restart(), restarted);
    f.candidate_action("approve");
    f.candidate_action("beginTrial");
    assert_eq!(f.candidate_action("commit")["entries"][0]["enabled"], true);
}

#[test]
fn beta3_failed_candidate_retains_sealed_bytes_and_requires_exact_identity_for_retry_or_cleanup() {
    for upgrading in [false, true] {
        let f = Fixture::new();
        let old = if upgrading {
            Some(f.install("1.0.0"))
        } else {
            None
        };
        f.prepare("2.0.0");
        f.candidate_action("approve");
        let trial = f.candidate_action("beginTrial");
        let pending = &trial["entries"][0]["pending"];
        let root = PathBuf::from(pending["generation"]["packageRoot"].as_str().unwrap());
        let data = f.0.join("test.plugin/data/sentinel");
        std::fs::write(&data, b"user data").unwrap();
        let orphan = root.parent().unwrap().join(token());
        std::fs::create_dir(&orphan).unwrap();
        std::fs::write(orphan.join("orphan.js"), b"unreferenced").unwrap();
        let failure = json!({"type":"failCandidate","transactionId":pending["transactionId"],"fingerprint":pending["generation"]["capabilityFingerprint"],"message":"FIRST_INSTALL_FAILURE"});
        let failed = f.action(failure.clone());
        assert_eq!(failed["entries"][0]["pending"]["phase"], "prepared");
        assert_eq!(
            failed["entries"][0]["pending"]["generation"],
            pending["generation"]
        );
        assert_eq!(failed["entries"][0]["enabled"], false);
        assert!(root.join("dist/main.js").exists());
        assert!(!orphan.exists());
        assert!(read_worker_module(
            &f.0,
            "test.plugin",
            pending["generation"]["id"].as_str().unwrap()
        )
        .is_err());
        assert!(failed["entries"][0]["diagnostics"]
            .to_string()
            .contains("FIRST_INSTALL_FAILURE"));
        if let Some(old) = old {
            assert_eq!(failed["entries"][0]["active"], old["entries"][0]["active"]);
        }
        assert!(transition(
            &f.0,
            "test.plugin",
            trial["entries"][0]["revision"].as_u64().unwrap(),
            failure.clone()
        )
        .is_err());
        let mut wrong = failure;
        wrong["transactionId"] = json!(token());
        assert!(transition(
            &f.0,
            "test.plugin",
            failed["entries"][0]["revision"].as_u64().unwrap(),
            wrong
        )
        .is_err());
        assert_eq!(f.restart(), failed);
        f.candidate_action("beginTrial");
        let committed = f.candidate_action("commit");
        assert_eq!(
            committed["entries"][0]["active"]["id"],
            pending["generation"]["id"]
        );
        assert_eq!(std::fs::read(&data).unwrap(), b"user data");
        f.prepare("3.0.0");
        f.candidate_action("approve");
        let trial = f.candidate_action("beginTrial");
        let p = &trial["entries"][0]["pending"];
        f.action(json!({"type":"failCandidate","transactionId":p["transactionId"],"fingerprint":p["generation"]["capabilityFingerprint"],"message":"retry failed"}));
        f.candidate_action("abort");
        assert!(!Path::new(p["generation"]["packageRoot"].as_str().unwrap()).exists());
        assert!(root.exists());
        assert_eq!(std::fs::read(data).unwrap(), b"user data");
    }
}

#[test]
fn beta3_rejected_first_install_is_tombstoned_and_does_not_return_on_restart() {
    let f = Fixture::new();
    let prepared = f.prepare("1.0.0");
    let root = PathBuf::from(
        prepared["entries"][0]["pending"]["generation"]["packageRoot"]
            .as_str()
            .unwrap(),
    );
    let rejected = f.candidate_action("abort");
    assert_eq!(rejected["entries"][0]["tombstone"], true);
    assert!(rejected["entries"][0]["pending"].is_null());
    assert!(!root.exists());
    assert_eq!(f.restart(), rejected);
}

#[test]
fn beta3_tampered_first_candidate_stays_visible_but_cannot_be_approved_or_executed() {
    let f = Fixture::new();
    f.prepare("1.0.0");
    let approved = f.candidate_action("approve");
    let p = &approved["entries"][0]["pending"];
    let root = PathBuf::from(p["generation"]["packageRoot"].as_str().unwrap());
    let original = std::fs::read(root.join("dist/main.js")).unwrap();
    std::fs::write(root.join("dist/main.js"), b"tampered").unwrap();
    let recovered = f.restart();
    assert_eq!(
        recovered["entries"][0]["pending"]["generation"]["id"],
        p["generation"]["id"]
    );
    assert!(recovered["entries"][0]["pending"]["generation"]["approvedFingerprint"].is_null());
    assert_eq!(f.restart(), recovered);
    for kind in ["approve", "beginTrial", "commit"] {
        let action = json!({"type":kind,"transactionId":p["transactionId"],"fingerprint":p["generation"]["capabilityFingerprint"]});
        assert!(transition(
            &f.0,
            "test.plugin",
            recovered["entries"][0]["revision"].as_u64().unwrap(),
            action
        )
        .is_err());
    }
    // Repeated corruption after an explicit repair/approval must revoke approval again,
    // even when the diagnostic text is already present in the catalog.
    std::fs::write(root.join("dist/main.js"), original).unwrap();
    f.candidate_action("approve");
    std::fs::write(root.join("dist/main.js"), b"tampered").unwrap();
    let repeated = f.restart();
    assert!(repeated["entries"][0]["pending"]["generation"]["approvedFingerprint"].is_null());
    assert_eq!(f.read(), repeated);
    f.candidate_action("abort");
    assert!(!root.exists());
}

#[test]
fn beta3_backup_recovery_preserves_first_candidate_without_restoring_approval() {
    let f = Fixture::new();
    f.prepare("1.0.0");
    f.candidate_action("approve");
    let trial = f.candidate_action("beginTrial");
    std::fs::write(f.0.join(CATALOG), b"broken catalog").unwrap();
    let recovered = f.restart();
    assert_eq!(
        recovered["entries"][0]["pending"]["generation"]["id"],
        trial["entries"][0]["pending"]["generation"]["id"]
    );
    assert_eq!(recovered["entries"][0]["pending"]["phase"], "prepared");
    assert!(recovered["entries"][0]["pending"]["generation"]["approvedFingerprint"].is_null());
    assert_eq!(recovered["entries"][0]["enabled"], false);
}

#[test]
fn beta4_atomic_bundled_replacement_keeps_previous_bytes_and_never_inherits_approval() {
    let f = Fixture::new();
    let source = "bundled:fixture.milkup-plugin";
    prepare(&f.0, archive("test.plugin", "1.0.0"), source.into(), None).unwrap();
    let before = f.candidate_action("approve");
    let e = &before["entries"][0];
    let p = &e["pending"];
    let module = Path::new(p["generation"]["packageRoot"].as_str().unwrap()).join("dist/main.js");
    let old_bytes = std::fs::read(&module).unwrap();
    let replacement = json!({"transactionId":p["transactionId"],"generationId":p["generation"]["id"],"sourcePath":p["generation"]["sourcePath"],"fingerprint":p["generation"]["capabilityFingerprint"]});
    let after = prepare_with_replacement(
        &f.0,
        archive("test.plugin", "2.0.0"),
        source.into(),
        e["revision"].as_u64(),
        Some(replacement),
    )
    .unwrap();
    let candidate = &after["entries"][0]["pending"];
    assert_eq!(candidate["generation"]["manifest"]["version"], "2.0.0");
    assert_ne!(candidate["transactionId"], p["transactionId"]);
    assert_ne!(candidate["generation"]["id"], p["generation"]["id"]);
    assert!(candidate["generation"]["approvedFingerprint"].is_null());
    assert_eq!(std::fs::read(module).unwrap(), old_bytes);
    assert_eq!(after["entries"][0]["enabled"], false);
}

fn bundled_replacement_identity(state: &Value) -> Value {
    let p = &state["entries"][0]["pending"];
    json!({"transactionId":p["transactionId"],"generationId":p["generation"]["id"],"sourcePath":p["generation"]["sourcePath"],"fingerprint":p["generation"]["capabilityFingerprint"]})
}

#[test]
fn beta4_bundled_replacement_disk_failures_preserve_catalog_candidate_and_userdata() {
    for point in ["stage-file", "before-catalog-replace"] {
        let f = Fixture::new();
        let source = "bundled:fixture.milkup-plugin";
        let before = prepare(&f.0, archive("test.plugin", "1.0.0"), source.into(), None).unwrap();
        let module = Path::new(
            before["entries"][0]["pending"]["generation"]["packageRoot"]
                .as_str()
                .unwrap(),
        )
        .join("dist/main.js");
        let old_bytes = std::fs::read(&module).unwrap();
        let catalog_bytes = std::fs::read(f.0.join(CATALOG)).unwrap();
        let sentinel = f.0.join("test.plugin/data/sentinel");
        std::fs::write(&sentinel, b"user data").unwrap();
        FAILURE.with(|v| *v.borrow_mut() = Some((point, 0)));
        assert!(prepare_with_replacement(
            &f.0,
            archive("test.plugin", "2.0.0"),
            source.into(),
            before["entries"][0]["revision"].as_u64(),
            Some(bundled_replacement_identity(&before))
        )
        .is_err());
        FAILURE.with(|v| *v.borrow_mut() = None);
        assert_eq!(std::fs::read(f.0.join(CATALOG)).unwrap(), catalog_bytes);
        assert_eq!(f.read(), before);
        assert_eq!(std::fs::read(&module).unwrap(), old_bytes);
        assert_eq!(std::fs::read(&sentinel).unwrap(), b"user data");
        let retry = prepare_with_replacement(
            &f.0,
            archive("test.plugin", "2.0.0"),
            source.into(),
            before["entries"][0]["revision"].as_u64(),
            Some(bundled_replacement_identity(&before)),
        )
        .unwrap();
        assert_eq!(
            retry["entries"][0]["pending"]["generation"]["manifest"]["version"],
            "2.0.0"
        );
    }
}

#[test]
fn beta4_bundled_replacement_rejects_stale_identity_version_and_user_receipts() {
    let source = "bundled:fixture.milkup-plugin";
    for case in [
        "revision",
        "transactionId",
        "generationId",
        "fingerprint",
        "trial",
        "tombstone",
        "source",
        "user",
        "same",
        "lower",
        "build",
        "corrupt",
    ] {
        let f = Fixture::new();
        let receipt = if case == "user" {
            "user:fixture"
        } else {
            source
        };
        let mut before =
            prepare(&f.0, archive("test.plugin", "1.0.0"), receipt.into(), None).unwrap();
        if case == "trial" {
            f.candidate_action("approve");
            before = f.candidate_action("beginTrial");
        }
        let mut identity = bundled_replacement_identity(&before);
        if case == "source" {
            identity["sourcePath"] = json!("bundled:wrong.milkup-plugin");
        }
        if ["transactionId", "generationId", "fingerprint"].contains(&case) {
            identity[case] = json!("wrong");
        }
        if case == "tombstone" {
            before = f.action(json!({"type":"remove"}));
        }
        if case == "corrupt" {
            let module = Path::new(
                before["entries"][0]["pending"]["generation"]["packageRoot"]
                    .as_str()
                    .unwrap(),
            )
            .join("dist/main.js");
            std::fs::write(module, b"corrupted old candidate").unwrap();
        }
        let bytes = std::fs::read(f.0.join(CATALOG)).unwrap();
        let revision = before["entries"][0]["revision"].as_u64().unwrap();
        let version = match case {
            "same" => "1.0.0",
            "lower" => "0.9.0",
            "build" => "1.0.0+new",
            _ => "2.0.0",
        };
        let result = prepare_with_replacement(
            &f.0,
            archive("test.plugin", version),
            if case == "source" {
                "bundled:other.milkup-plugin".into()
            } else {
                receipt.into()
            },
            Some(if case == "revision" {
                revision + 1
            } else {
                revision
            }),
            Some(identity),
        );
        assert!(result.is_err(), "case {case} must fail closed");
        assert_eq!(
            std::fs::read(f.0.join(CATALOG)).unwrap(),
            bytes,
            "case {case}"
        );
    }
}

#[test]
fn beta4_bundled_replacement_preserves_enabled_active_and_backup_candidate() {
    let f = Fixture::new();
    let source = "bundled:fixture.milkup-plugin";
    prepare(&f.0, archive("test.plugin", "1.0.0"), source.into(), None).unwrap();
    f.candidate_action("approve");
    f.candidate_action("beginTrial");
    let active = f.candidate_action("commit");
    let before = prepare(
        &f.0,
        archive("test.plugin", "1.1.0"),
        source.into(),
        active["entries"][0]["revision"].as_u64(),
    )
    .unwrap();
    let sentinel = f.0.join("test.plugin/storage/sentinel");
    std::fs::write(&sentinel, b"storage").unwrap();
    let after = prepare_with_replacement(
        &f.0,
        archive("test.plugin", "2.0.0"),
        source.into(),
        before["entries"][0]["revision"].as_u64(),
        Some(bundled_replacement_identity(&before)),
    )
    .unwrap();
    assert_eq!(
        after["entries"][0]["active"],
        before["entries"][0]["active"]
    );
    assert_eq!(after["entries"][0]["enabled"], true);
    assert!(after["entries"][0]["pending"]["generation"]["approvedFingerprint"].is_null());
    assert_eq!(std::fs::read(&sentinel).unwrap(), b"storage");
    std::fs::write(f.0.join(CATALOG), b"corrupt primary").unwrap();
    let recovered = f.restart();
    assert_eq!(
        recovered["entries"][0]["pending"]["generation"]["id"],
        before["entries"][0]["pending"]["generation"]["id"]
    );
    assert_eq!(recovered["entries"][0]["pending"]["phase"], "prepared");
    assert!(recovered["entries"][0]["pending"]["generation"]["approvedFingerprint"].is_null());
    assert_eq!(recovered["entries"][0]["enabled"], false);
    assert_eq!(std::fs::read(sentinel).unwrap(), b"storage");
}

#[test]
fn beta4_concurrent_bundled_replacements_accept_only_one_revision() {
    let f = Fixture::new();
    let source = "bundled:fixture.milkup-plugin";
    let before = prepare(&f.0, archive("test.plugin", "1.0.0"), source.into(), None).unwrap();
    let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
    let handles: Vec<_> = ["2.0.0", "3.0.0"]
        .into_iter()
        .map(|version| {
            let root = f.0.clone();
            let barrier = barrier.clone();
            let identity = bundled_replacement_identity(&before);
            let revision = before["entries"][0]["revision"].as_u64();
            std::thread::spawn(move || {
                barrier.wait();
                prepare_with_replacement(
                    &root,
                    archive("test.plugin", version),
                    source.into(),
                    revision,
                    Some(identity),
                )
            })
        })
        .collect();
    let results: Vec<_> = handles.into_iter().map(|h| h.join().unwrap()).collect();
    assert_eq!(results.iter().filter(|r| r.is_ok()).count(), 1);
    assert!(results
        .iter()
        .find_map(|r| r.as_ref().err())
        .unwrap()
        .contains("conflict"));
    assert_eq!(
        f.read()["entries"][0]["revision"].as_u64().unwrap(),
        before["entries"][0]["revision"].as_u64().unwrap() + 1
    );
}

#[test]
fn beta4_bundled_replacement_records_new_source_without_forging_the_old_receipt() {
    let f = Fixture::new();
    let old_source = "bundled:test.plugin-1.0.0.milkup-plugin";
    let new_source = "bundled:test.plugin-2.0.0.milkup-plugin";
    let before = prepare(
        &f.0,
        archive("test.plugin", "1.0.0"),
        old_source.into(),
        None,
    )
    .unwrap();
    let after = prepare_with_replacement(
        &f.0,
        archive("test.plugin", "2.0.0"),
        new_source.into(),
        before["entries"][0]["revision"].as_u64(),
        Some(bundled_replacement_identity(&before)),
    )
    .unwrap();
    assert_eq!(
        after["entries"][0]["pending"]["generation"]["sourcePath"],
        new_source
    );
    assert!(after["entries"][0]["diagnostics"]
        .as_array()
        .unwrap()
        .iter()
        .any(|v| v.as_str().unwrap_or_default().contains(old_source)));
}
