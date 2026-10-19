//! Executes the real catalog in fresh OS processes; no Tauri or runtime hooks.
use serde_json::Value;
use std::path::PathBuf;
use std::process::{Command, Output};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

static SERIAL: AtomicU64 = AtomicU64::new(0);
struct Profile(PathBuf);
impl Profile {
    fn new() -> Self {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "milkup-catalog-process-{}-{stamp}-{}",
            std::process::id(),
            SERIAL.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir(&root).unwrap();
        Self(root)
    }
    fn command(&self, operation: &str) -> Output {
        Command::new(env!("CARGO_BIN_EXE_catalog-probe"))
            .arg(operation)
            .arg(&self.0)
            .output()
            .unwrap()
    }
    fn run(&self, operation: &str) -> Value {
        let output = self.command(operation);
        assert!(
            output.status.success(),
            "{operation}: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        serde_json::from_slice(&output.stdout).unwrap()
    }
}
impl Drop for Profile {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

#[test]
fn fresh_process_recovers_interrupted_trial_without_changing_old_package() {
    let profile = Profile::new();
    let before = profile.run("seed-interrupted-trial");
    let entry = &before["entries"][0];
    assert_eq!(entry["pending"]["phase"], "trial");
    let module = PathBuf::from(entry["active"]["packageRoot"].as_str().unwrap()).join("main.js");
    let original = std::fs::read(&module).unwrap();
    let recovered = profile.run("read");
    let after = &recovered["entries"][0];
    assert!(after["pending"].is_null());
    assert_eq!(after["enabled"], false);
    assert_eq!(after["active"], entry["active"]);
    assert_eq!(std::fs::read(module).unwrap(), original);
    assert_eq!(profile.run("read"), recovered);
}

#[test]
fn fresh_process_disables_interrupted_startup_without_repeated_revision_changes() {
    let profile = Profile::new();
    let before = profile.run("seed-interrupted-startup");
    assert!(before["entries"][0]["startAttempt"].is_string());
    assert_eq!(before["entries"][0]["enabled"], true);
    let recovered = profile.run("read");
    assert!(recovered["entries"][0]["startAttempt"].is_null());
    assert_eq!(recovered["entries"][0]["enabled"], false);
    assert_eq!(
        recovered["entries"][0]["active"],
        before["entries"][0]["active"]
    );
    assert_eq!(profile.run("read"), recovered);
}

#[test]
fn other_process_cannot_read_or_mutate_while_native_catalog_lock_is_owned() {
    let profile = Profile::new();
    let initial = profile.run("read");
    let lock = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(profile.0.join("catalog.lock"))
        .unwrap();
    fs2::FileExt::try_lock_exclusive(&lock).unwrap();
    for operation in ["read", "seed-interrupted-trial"] {
        let output = profile.command(operation);
        assert!(!output.status.success());
        assert!(String::from_utf8_lossy(&output.stderr).contains("[plugin-catalog:conflict]"));
    }
    assert!(!profile.0.join("test.process").exists());
    fs2::FileExt::unlock(&lock).unwrap();
    drop(lock);
    assert_eq!(profile.run("read"), initial);
}
