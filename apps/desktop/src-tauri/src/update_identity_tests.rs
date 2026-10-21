use super::super::tests::{serve_with_check, test_app};
use super::*;
use base64::{engine::general_purpose::STANDARD, Engine};
use std::cell::Cell;
#[cfg(target_os = "linux")]
use std::cell::RefCell;
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri_plugin_updater::UpdaterExt;

const NOW: u64 = 1800000100;

fn fixture() -> serde_json::Value {
    serde_json::from_str(include_str!(
        "../../../../tests/fixtures/updates/application-identity.json"
    ))
    .unwrap()
}
async fn load_envelope(envelope: serde_json::Value) -> Result<Update> {
    let data = fixture();
    let server = serve_with_check(
        b"never downloaded",
        "unused",
        200,
        None,
        Some((200, envelope.to_string(), Duration::ZERO)),
    );
    let app = test_app();
    app.updater_builder()
        .endpoints(vec![server.url.clone()])
        .unwrap()
        .pubkey(data["publicKey"].as_str().unwrap())
        .require_signed_manifest("milkup-desktop", "beta")
        .target(host_platform().unwrap())
        .version_comparator(|_, _| true)
        .no_proxy()
        .timeout(Duration::from_secs(2))
        .build()
        .unwrap()
        .check()
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "missing test update".into())
}
async fn load(case: &str) -> Update {
    load_envelope(fixture()["platforms"][host_platform().unwrap()][case].clone())
        .await
        .unwrap()
}

struct Temp(PathBuf);
impl Temp {
    fn new() -> Self {
        static SERIAL: AtomicU64 = AtomicU64::new(0);
        let path = std::env::temp_dir().join(format!(
            "milkup-identity-{}-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
            SERIAL.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&path).unwrap();
        fs::write(
            path.join("inert-image"),
            STANDARD
                .decode(fixture()["application"].as_str().unwrap())
                .unwrap(),
        )
        .unwrap();
        Self(path)
    }
    fn image(&self) -> CurrentImage {
        #[cfg(target_os = "linux")]
        let (sha256, size) = read_image(File::open(self.0.join("inert-image")).unwrap()).unwrap();
        #[cfg(not(target_os = "linux"))]
        let (sha256, size) = {
            let bytes = fs::read(self.0.join("inert-image")).unwrap();
            (format!("{:x}", Sha256::digest(&bytes)), bytes.len() as u64)
        };
        CurrentImage {
            version: "2.0.0-beta.2".into(),
            platform: host_platform().unwrap(),
            sha256,
            size,
            process: std::process::id(),
        }
    }
    fn trust(&self) -> policy::Store {
        policy::Store::new(
            self.0.clone(),
            "beta",
            &host_platform().unwrap(),
            "2.0.0-beta.1",
        )
    }
    fn transaction(&self) -> transaction::Store {
        let intent = transaction::Intent {
            transaction: "a".repeat(32),
            previous_version: "2.0.0-beta.1".into(),
            expected_version: "2.0.0-beta.2".into(),
            installer_sha256: fixture()["installerSha256"].as_str().unwrap().into(),
        };
        let mut store =
            transaction::Store::create(self.0.join("transaction"), intent, NOW).unwrap();
        for event in [
            transaction::Event::BeginHandoff,
            transaction::Event::LaunchAccepted,
        ] {
            let token = store.snapshot().unwrap().token();
            store.apply(&token, event, NOW).unwrap();
        }
        store
    }
    fn bytes(&self) -> Vec<(PathBuf, Vec<u8>)> {
        fn walk(root: &std::path::Path, out: &mut Vec<(PathBuf, Vec<u8>)>) {
            for entry in fs::read_dir(root).unwrap() {
                let path = entry.unwrap().path();
                if path.is_dir() {
                    walk(&path, out);
                } else {
                    out.push((path.clone(), fs::read(path).unwrap()));
                }
            }
        }
        let mut result = Vec::new();
        walk(&self.0, &mut result);
        result.sort();
        result
    }
}
impl Drop for Temp {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}
fn accept(trust: &policy::Store, update: &Update) {
    trust
        .accept(&policy::Observation::from_update(update).unwrap(), NOW)
        .unwrap();
}

#[tokio::test]
async fn identity_signed_extension_requires_signature_scope_and_strict_schema() {
    let valid = load("valid").await;
    assert!(Declaration::from_update(&valid, &host_platform().unwrap()).is_ok());
    for case in [
        "missing",
        "unknownSchema",
        "oldSchema",
        "missingVersion",
        "extraField",
        "wrongVersion",
        "wrongPlatform",
        "badDigest",
        "zeroSize",
        "oversize",
        "ambiguous",
    ] {
        let update = load(case).await;
        assert!(update.has_verified_manifest());
        assert!(
            Declaration::from_update(&update, &host_platform().unwrap()).is_err(),
            "{case}"
        );
    }
    for case in ["wrongProduct", "wrongChannel"] {
        assert!(
            load_envelope(fixture()["platforms"][host_platform().unwrap()][case].clone())
                .await
                .is_err()
        );
    }
    let mut tampered = fixture()["platforms"][host_platform().unwrap()]["valid"].clone();
    let mut payload: serde_json::Value = serde_json::from_slice(
        &STANDARD
            .decode(tampered["payload"].as_str().unwrap())
            .unwrap(),
    )
    .unwrap();
    payload["release"]["platforms"][host_platform().unwrap()]["application"]["sha256"] =
        "b".repeat(64).into();
    tampered["payload"] = STANDARD
        .encode(serde_json::to_vec(&payload).unwrap())
        .into();
    assert!(
        load_envelope(tampered).await.is_err(),
        "unsigned changed image digest"
    );
    let mut mutated = valid.clone();
    mutated.raw_json["platforms"][host_platform().unwrap()]["application"]["size"] = 1.into();
    assert!(Declaration::from_update(&mutated, &host_platform().unwrap()).is_err());
    let mut retargeted = valid.clone();
    retargeted.target = "other-platform".into();
    assert!(Declaration::from_update(&retargeted, &host_platform().unwrap()).is_err());
    println!("IDENTITY: real minisign, scope, strict nested schema, tampering and selection binding checked");
}

#[tokio::test]
async fn identity_match_is_read_only_unverified_and_revision_bound() {
    let fixture = Temp::new();
    let update = load("valid").await;
    let trust = fixture.trust();
    accept(&trust, &update);
    let mut tx = fixture.transaction();
    let token = tx.snapshot().unwrap().token();
    let before = fixture.bytes();
    for _ in 0..2 {
        let matched = verify_with(
            &update,
            &trust,
            &mut tx,
            &token,
            || Ok(NOW),
            || Ok(fixture.image()),
        )
        .unwrap();
        assert_eq!(matched.transaction, token);
        assert_eq!(matched.image.sha256, fixture.image().sha256);
        assert_eq!(
            matched.statement_sha256,
            format!(
                "{:x}",
                Sha256::digest(serde_json::to_vec(update.verified_release().unwrap()).unwrap())
            )
        );
    }
    assert_eq!(fixture.bytes(), before);
    assert_eq!(
        tx.snapshot().unwrap().verification(),
        transaction::Verification::Unverified
    );
    let reviewed = tx
        .apply(&token, transaction::Event::RequireReview, NOW)
        .unwrap();
    assert!(verify_with(
        &update,
        &trust,
        &mut tx,
        &token,
        || Ok(NOW),
        || panic!("stale revision must fail before I/O")
    )
    .is_err());
    let mut other = reviewed.token();
    other.transaction = "b".repeat(32);
    assert!(verify_with(
        &update,
        &trust,
        &mut tx,
        &other,
        || Ok(NOW),
        || panic!("wrong transaction")
    )
    .is_err());
    assert!(verify_with(
        &update,
        &trust,
        &mut tx,
        &reviewed.token(),
        || Ok(NOW),
        || Ok(fixture.image())
    )
    .is_ok());
    assert_eq!(
        tx.snapshot().unwrap().phase(),
        transaction::Phase::NeedsReview
    );
    assert_eq!(
        tx.snapshot().unwrap().verification(),
        transaction::Verification::Unverified
    );
}

#[tokio::test]
async fn identity_mixed_installer_image_and_false_local_observations_fail() {
    for case in ["mixedInstaller", "mixedImage", "valid"] {
        let fixture = Temp::new();
        let update = load(case).await;
        let trust = fixture.trust();
        accept(&trust, &update);
        let mut tx = fixture.transaction();
        let token = tx.snapshot().unwrap().token();
        let before = fixture.bytes();
        for altered in 0..5 {
            let result = verify_with(
                &update,
                &trust,
                &mut tx,
                &token,
                || Ok(NOW),
                || {
                    let mut image = fixture.image();
                    match altered {
                        0 => image.version = "2.0.0-beta.1".into(),
                        1 => image.platform = "other-x86_64".into(),
                        2 => image.process = image.process.wrapping_add(1),
                        3 => image.size += 1,
                        _ => image.sha256 = "0".repeat(64),
                    }
                    Ok(image)
                },
            );
            assert!(result.is_err(), "{case}/{altered}");
        }
        if case != "valid" {
            assert!(verify_with(
                &update,
                &trust,
                &mut tx,
                &token,
                || Ok(NOW),
                || Ok(fixture.image())
            )
            .is_err());
        }
        assert_eq!(fixture.bytes(), before);
        assert_eq!(
            tx.snapshot().unwrap().verification(),
            transaction::Verification::Unverified
        );
    }
}

#[tokio::test]
async fn identity_rechecks_expiry_and_replay_after_read_without_reset() {
    let fixture = Temp::new();
    let update = load("valid").await;
    let trust = fixture.trust();
    accept(&trust, &update);
    let mut tx = fixture.transaction();
    let token = tx.snapshot().unwrap().token();
    let before = fixture.bytes();
    for case in ["expired", "future", "replay"] {
        let invalid = load(case).await;
        assert!(verify_with(
            &invalid,
            &trust,
            &mut tx,
            &token,
            || Ok(NOW),
            || panic!("policy must reject before read")
        )
        .is_err());
    }
    let ticks = Cell::new(0);
    assert!(verify_with(
        &update,
        &trust,
        &mut tx,
        &token,
        || {
            let tick = ticks.get();
            ticks.set(tick + 1);
            Ok(if tick == 0 { NOW } else { 1800003600 })
        },
        || Ok(fixture.image())
    )
    .is_err());
    assert_eq!(ticks.get(), 2);
    assert_eq!(fixture.bytes(), before);
    let renewal = load("renewed").await;
    assert!(verify_with(
        &update,
        &trust,
        &mut tx,
        &token,
        || Ok(NOW),
        || {
            accept(&trust, &renewal); // Simulate another coordinator while hashing.
            Ok(fixture.image())
        }
    )
    .is_err());
    assert!(verify_with(
        &update,
        &trust,
        &mut tx,
        &token,
        || Ok(NOW),
        || panic!("replay")
    )
    .is_err());
    assert!(verify_with(
        &renewal,
        &trust,
        &mut tx,
        &token,
        || Ok(NOW),
        || Ok(fixture.image())
    )
    .is_ok());
    assert_eq!(
        tx.snapshot().unwrap().verification(),
        transaction::Verification::Unverified
    );
    println!("IDENTITY: expiry during I/O and superseded sequence reject; fresh retry succeeds without health");
}

#[tokio::test]
async fn identity_missing_or_damaged_trust_never_creates_or_repairs_files() {
    let fixture = Temp::new();
    let update = load("valid").await;
    let trust = fixture.trust();
    let mut tx = fixture.transaction();
    let token = tx.snapshot().unwrap().token();
    let before = fixture.bytes();
    assert!(verify_with(
        &update,
        &trust,
        &mut tx,
        &token,
        || Ok(NOW),
        || panic!("missing trust")
    )
    .is_err());
    assert_eq!(fixture.bytes(), before);
    assert!(!fixture.0.join("update-trust").exists());
    accept(&trust, &update);
    let state = fixture
        .bytes()
        .into_iter()
        .find(|(p, _)| p.file_name().unwrap() == "state.json")
        .unwrap()
        .0;
    let lease = std::fs::File::open(state.parent().unwrap().join("state.lock")).unwrap();
    fs2::FileExt::try_lock_exclusive(&lease).unwrap();
    let locked = fixture.bytes();
    assert!(verify_with(
        &update,
        &trust,
        &mut tx,
        &token,
        || Ok(NOW),
        || panic!("trust lease busy")
    )
    .is_err());
    assert_eq!(fixture.bytes(), locked);
    drop(lease);
    fs::write(&state, b"{original damage").unwrap();
    let damaged = fixture.bytes();
    assert!(verify_with(
        &update,
        &trust,
        &mut tx,
        &token,
        || Ok(NOW),
        || panic!("damaged trust")
    )
    .is_err());
    assert_eq!(fixture.bytes(), damaged);
}

#[cfg(target_os = "linux")]
thread_local! { static AFTER_CHUNK: RefCell<Option<Box<dyn FnOnce()>>> = const { RefCell::new(None) }; }
#[cfg(target_os = "linux")]
pub(super) fn after_read_chunk() {
    let action = AFTER_CHUNK.with(|cell| cell.borrow_mut().take());
    if let Some(action) = action {
        action();
    }
}

#[cfg(target_os = "linux")]
#[test]
fn identity_descriptor_hash_survives_path_replacement_and_rejects_mid_read_change() {
    let fixture = Temp::new();
    let path = fixture.0.join("inert-image");
    let original = fixture.image();
    let pinned = File::open(&path).unwrap();
    fs::rename(&path, fixture.0.join("old-inert-image")).unwrap();
    fs::write(&path, b"different inert bytes").unwrap();
    let (hash, size) = read_image(pinned).unwrap();
    assert_eq!((hash, size), (original.sha256.clone(), original.size));
    let (new_hash, _) = read_image(File::open(&path).unwrap()).unwrap();
    assert_ne!(new_hash, original.sha256);
    assert_eq!(new_hash, fixture.image().sha256);
    fs::write(&path, vec![b'a'; 128 * 1024]).unwrap();
    let mutate = path.clone();
    AFTER_CHUNK.with(|cell| {
        *cell.borrow_mut() = Some(Box::new(move || {
            fs::OpenOptions::new()
                .write(true)
                .open(mutate)
                .unwrap()
                .set_len(1)
                .unwrap();
        }))
    });
    assert!(read_image(File::open(&path).unwrap()).is_err());
    let oversized = fs::OpenOptions::new().write(true).open(&path).unwrap();
    oversized.set_len(MAX_IMAGE_BYTES + 1).unwrap();
    drop(oversized);
    assert!(read_image(File::open(&path).unwrap()).is_err());
    println!("IDENTITY: pinned descriptor reads original after pathname replacement; changed and oversized files rejected");
}

#[cfg(target_os = "linux")]
#[test]
fn identity_actual_current_image_is_read_only_without_starting_a_candidate() {
    let length = fs::metadata("/proc/self/exe").unwrap().len();
    if length > MAX_IMAGE_BYTES {
        assert!(observe_current().is_err());
        println!("IDENTITY: current debug test image {length} exceeds limit; rejected. A separate stripped test-harness run must demonstrate successful actual observation.");
        return;
    }
    let observed = observe_current().unwrap();
    assert_eq!(observed.version, env!("CARGO_PKG_VERSION"));
    assert_eq!(observed.platform, host_platform().unwrap());
    assert_eq!(observed.process, std::process::id());
    assert_eq!(observed.size, fs::metadata("/proc/self/exe").unwrap().len());
    assert_eq!(observed.sha256.len(), 64);
    println!("IDENTITY: read current test process image: {} bytes; no candidate executed; no signed match or health claim", observed.size);
}

#[cfg(not(target_os = "linux"))]
#[test]
fn identity_unsupported_current_image_never_falls_back_to_a_path() {
    assert!(observe_current().is_err());
}
