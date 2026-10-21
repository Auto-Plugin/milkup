use super::super::tests::{serve_with_check, test_app};
use super::*;
use base64::{engine::general_purpose::STANDARD, Engine};
use std::cell::Cell;
use std::fs;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::AtomicU64;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri_plugin_updater::UpdaterExt;

const NOW: u64 = 1800000100;
const ID: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
fn vectors() -> serde_json::Value {
    serde_json::from_str(include_str!(
        "../../../../tests/fixtures/updates/application-identity.json"
    ))
    .unwrap()
}
fn raw(case: &str) -> String {
    vectors()["platforms"][identity::host_platform().unwrap()][case].to_string()
}
fn config() -> ReleaseChannel {
    ReleaseChannel {
        channel: "beta".into(),
        endpoints: vec![],
        public_key: Some(vectors()["publicKey"].as_str().unwrap().into()),
    }
}
async fn load(bytes: &str) -> Update {
    let server = serve_with_check(
        b"never downloaded",
        "unused",
        200,
        None,
        Some((200, bytes.into(), Duration::ZERO)),
    );
    let app = test_app();
    app.updater_builder()
        .endpoints(vec![server.url.clone()])
        .unwrap()
        .pubkey(config().public_key.unwrap())
        .require_signed_manifest("milkup-desktop", "beta")
        .target(identity::host_platform().unwrap())
        .version_comparator(|_, _| true)
        .timeout(Duration::from_secs(2))
        .no_proxy()
        .build()
        .unwrap()
        .check()
        .await
        .unwrap()
        .unwrap()
}
struct Temp(PathBuf);
impl Temp {
    fn new() -> Self {
        static SERIAL: AtomicU64 = AtomicU64::new(0);
        let root = std::env::temp_dir().join(format!(
            "milkup-handoff-{}-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
            SERIAL.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&root).unwrap();
        fs::write(root.join("synthetic-test-only"), b"handoff process fixture").unwrap();
        fs::write(
            root.join("inert-image"),
            STANDARD
                .decode(vectors()["application"].as_str().unwrap())
                .unwrap(),
        )
        .unwrap();
        Self(root)
    }
    fn trust(&self) -> policy::Store {
        trust(&self.0)
    }
    fn directory(&self) -> PathBuf {
        self.0.join("transaction")
    }
    fn canonical(&self) -> PathBuf {
        self.directory().join("transaction.json")
    }
    fn create(&self) -> transaction::Store {
        create(&self.0)
    }
}
impl Drop for Temp {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}
fn trust(root: &std::path::Path) -> policy::Store {
    // Restarted application already has the target version. This must not be
    // interpreted as permission to downgrade/install by the offline data API.
    policy::Store::new(
        root.to_path_buf(),
        "beta",
        &identity::host_platform().unwrap(),
        "2.0.0-beta.2",
    )
}
fn create(root: &std::path::Path) -> transaction::Store {
    transaction::Store::create(
        root.join("transaction"),
        transaction::Intent {
            transaction: ID.into(),
            previous_version: "2.0.0-beta.1".into(),
            expected_version: "2.0.0-beta.2".into(),
            installer_sha256: vectors()["installerSha256"].as_str().unwrap().into(),
        },
        NOW,
    )
    .unwrap()
}
fn accept(trust: &policy::Store, bytes: &str) {
    let verified = verify(bytes.as_bytes(), &config()).unwrap();
    trust
        .accept(&policy::Observation::from_manifest(&verified).unwrap(), NOW)
        .unwrap();
}
async fn prepared(fixture: &Temp) -> (transaction::Store, Update) {
    let update = load(&raw("valid")).await;
    accept(&fixture.trust(), &raw("valid"));
    (fixture.create(), update)
}
fn start(store: &mut transaction::Store) {
    for event in [
        transaction::Event::BeginHandoff,
        transaction::Event::LaunchAccepted,
    ] {
        let token = store.snapshot().unwrap().token();
        store.apply(&token, event, NOW).unwrap();
    }
}
fn disk(root: &std::path::Path) -> Vec<(PathBuf, Vec<u8>)> {
    fn walk(root: &std::path::Path, result: &mut Vec<(PathBuf, Vec<u8>)>) {
        for entry in fs::read_dir(root).unwrap() {
            let p = entry.unwrap().path();
            if p.is_dir() {
                walk(&p, result);
            } else {
                result.push((p.clone(), fs::read(p).unwrap()));
            }
        }
    }
    let mut result = vec![];
    walk(root, &mut result);
    result.sort();
    result
}

#[tokio::test]
async fn handoff_exact_raw_bytes_offline_reverification_and_bounds() {
    let fixture = Temp::new();
    let mut bytes = format!(" \n{}\r\n", raw("valid"));
    bytes.extend(std::iter::repeat_n(
        ' ',
        transaction::ENVELOPE_LIMIT - bytes.len(),
    ));
    let update = load(&bytes).await;
    assert_eq!(update.verified_envelope().unwrap(), bytes.as_bytes());
    accept(&fixture.trust(), &bytes);
    let mut store = fixture.create();
    let token = store.snapshot().unwrap().token();
    let record = retain_with(
        &update,
        &fixture.trust(),
        &mut store,
        &token,
        &AtomicBool::new(false),
        &config(),
        || Ok(NOW),
    )
    .unwrap();
    assert_eq!(
        record.handoff().unwrap().envelope.as_bytes(),
        bytes.as_bytes()
    );
    assert_eq!(record.handoff().unwrap().revision, record.token().revision);
    let before = fs::read(fixture.canonical()).unwrap();
    assert!(retain_with(
        &update,
        &fixture.trust(),
        &mut store,
        &token,
        &AtomicBool::new(false),
        &config(),
        || Ok(NOW)
    )
    .is_err());
    assert_eq!(fs::read(fixture.canonical()).unwrap(), before);
    assert!(verify(format!("{bytes} ").as_bytes(), &config()).is_err());
    let mut altered = update.clone();
    altered.version = "99.0.0".into();
    assert!(altered.verified_envelope().is_none());
    let mut key = config();
    key.public_key = Some("invalid key".into());
    assert!(verify(bytes.as_bytes(), &key).is_err());
    start(&mut store);
    drop(store);
    let snapshot = disk(&fixture.0);
    let observed = inspect_with(
        fixture.directory(),
        ID,
        &fixture.trust(),
        &AtomicBool::new(false),
        &config(),
        || Ok(NOW),
        || identity::inert_fixture_image(&fixture.0.join("inert-image"), "2.0.0-beta.2"),
    )
    .unwrap();
    assert_eq!(observed.disposition(), transaction::Phase::NeedsReview);
    assert_eq!(
        observed.verification(),
        transaction::Verification::Unverified
    );
    assert_eq!(disk(&fixture.0), snapshot);
    println!("HANDOFF exact 256 KiB envelope retained byte-for-byte; offline same-version match is data-only");
}

#[tokio::test]
async fn handoff_cancel_before_and_after_commit_preserves_evidence_without_late_success() {
    let fixture = Temp::new();
    let (mut store, update) = prepared(&fixture).await;
    let token = store.snapshot().unwrap().token();
    let before = fs::read(fixture.canonical()).unwrap();
    assert!(retain_with(
        &update,
        &fixture.trust(),
        &mut store,
        &token,
        &AtomicBool::new(true),
        &config(),
        || Ok(NOW)
    )
    .is_err());
    assert_eq!(fs::read(fixture.canonical()).unwrap(), before);
    let cancelled = AtomicBool::new(false);
    let clock_calls = Cell::new(0);
    let result = retain_with(
        &update,
        &fixture.trust(),
        &mut store,
        &token,
        &cancelled,
        &config(),
        || {
            let n = clock_calls.get();
            clock_calls.set(n + 1);
            if n == 1 {
                cancelled.store(true, Ordering::SeqCst);
            }
            Ok(NOW)
        },
    );
    assert!(result.is_err());
    let committed = store.snapshot().unwrap();
    assert_eq!(committed.phase(), transaction::Phase::Prepared);
    assert!(committed.handoff().is_some());
    assert_eq!(
        committed.verification(),
        transaction::Verification::Unverified
    );
    drop(store);
    assert!(inspect_with(
        fixture.directory(),
        ID,
        &fixture.trust(),
        &AtomicBool::new(false),
        &config(),
        || Ok(NOW),
        || panic!("not started")
    )
    .is_err());

    // Cancellation can also arrive inside the final policy reauthorization,
    // after persistence and the earlier cancellation check have both completed.
    let fixture = Temp::new();
    let (mut store, update) = prepared(&fixture).await;
    let token = store.snapshot().unwrap().token();
    let cancelled = AtomicBool::new(false);
    let ticks = Cell::new(0);
    let result = retain_with(
        &update,
        &fixture.trust(),
        &mut store,
        &token,
        &cancelled,
        &config(),
        || {
            let n = ticks.get();
            ticks.set(n + 1);
            if n == 2 {
                cancelled.store(true, Ordering::SeqCst);
            }
            Ok(NOW)
        },
    );
    assert!(
        result.is_err(),
        "late cancellation during final authorization must not publish success"
    );
    assert!(store.snapshot().unwrap().handoff().is_some());
}

struct Process(Option<Child>);
impl Drop for Process {
    fn drop(&mut self) {
        if let Some(c) = &mut self.0 {
            let _ = c.kill();
            let _ = c.wait();
        }
    }
}
impl Process {
    fn finish(mut self) -> String {
        wait_until(|| self.0.as_mut().unwrap().try_wait().unwrap().is_some());
        let out = self.0.take().unwrap().wait_with_output().unwrap();
        assert!(
            out.status.success(),
            "stdout={} stderr={}",
            String::from_utf8_lossy(&out.stdout),
            String::from_utf8_lossy(&out.stderr)
        );
        let stdout = String::from_utf8(out.stdout).unwrap();
        assert!(stdout.contains("1 passed") && stdout.contains("HANDOFF CHILD"));
        stdout
    }
    fn kill(&mut self) {
        let c = self.0.as_mut().unwrap();
        c.kill().unwrap();
        assert!(!c.wait().unwrap().success());
        self.0.take();
    }
}
fn wait_until(mut condition: impl FnMut() -> bool) {
    let start = Instant::now();
    while !condition() {
        assert!(start.elapsed() < Duration::from_secs(20), "child deadline");
        std::thread::sleep(Duration::from_millis(10));
    }
}
fn child(root: &std::path::Path, mode: &str) -> Process {
    Process(Some(Command::new(std::env::current_exe().unwrap())
        .args(["--exact","updates::handoff::tests::handoff_actual_child_restart_and_interrupted_atomic_capture","--nocapture"])
        .env("MILKUP_HANDOFF_TEST_ROOT",root).env("MILKUP_HANDOFF_TEST_MODE",mode)
        .stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().unwrap()))
}

#[tokio::test]
async fn handoff_actual_child_restart_and_interrupted_atomic_capture() {
    if let Some(root) = std::env::var_os("MILKUP_HANDOFF_TEST_ROOT") {
        let root = PathBuf::from(root);
        assert_eq!(root.parent(), Some(std::env::temp_dir().as_path()));
        assert!(root
            .file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with("milkup-handoff-"));
        assert_eq!(
            fs::read(root.join("synthetic-test-only")).unwrap(),
            b"handoff process fixture"
        );
        let mode = std::env::var("MILKUP_HANDOFF_TEST_MODE").unwrap();
        if mode.starts_with("capture-") {
            let update = load(&raw("valid")).await;
            let mut store = create(&root);
            let token = store.snapshot().unwrap().token();
            transaction::Store::pause_commit_for_test(mode == "capture-after", root.join("ready"));
            retain_with(
                &update,
                &trust(&root),
                &mut store,
                &token,
                &AtomicBool::new(false),
                &config(),
                || Ok(NOW),
            )
            .unwrap();
            panic!("paused child should be killed");
        }
        if mode == "busy" {
            assert!(matches!(
                transaction::Store::inspect(root.join("transaction")),
                Err(transaction::Error::Busy)
            ));
            println!("HANDOFF CHILD busy: real process lock held");
            return;
        }
        let before = disk(&root);
        let cancelled = AtomicBool::new(mode == "cancel");
        let clock_calls = Cell::new(0);
        let result = inspect_with(
            root.join("transaction"),
            if mode == "wrong-transaction" {
                "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
            } else {
                ID
            },
            &trust(&root),
            &cancelled,
            &config(),
            || {
                let n = clock_calls.get();
                clock_calls.set(n + 1);
                Ok(if mode == "expired" || (mode == "late-expiry" && n > 0) {
                    1800003600
                } else {
                    NOW
                })
            },
            || {
                if mode == "late-cancel" {
                    cancelled.store(true, Ordering::SeqCst);
                }
                if mode == "late-watermark" {
                    accept(&trust(&root), &raw("renewed"));
                }
                if mode == "late-transaction" {
                    // Deliberately simulate an uncooperative writer in our
                    // synthetic directory; the normal Store lease forbids this.
                    let path = root.join("transaction/transaction.json");
                    let mut value: serde_json::Value =
                        serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
                    let revision = value["revision"].as_u64().unwrap() + 1;
                    value["revision"] = revision.into();
                    value["handoff"]["revision"] = revision.into();
                    fs::write(path, serde_json::to_vec(&value).unwrap()).unwrap();
                }
                if mode == "same" {
                    assert!(matches!(
                        transaction::Store::open(root.join("transaction"), NOW),
                        Err(transaction::Error::Busy)
                    ));
                }
                identity::inert_fixture_image(
                    &root.join("inert-image"),
                    if mode == "old-image" {
                        "2.0.0-beta.1"
                    } else {
                        "2.0.0-beta.2"
                    },
                )
            },
        );
        if mode == "same" {
            let observation = result.unwrap();
            assert_eq!(observation.image().version(), "2.0.0-beta.2");
            assert_eq!(
                observation.verification(),
                transaction::Verification::Unverified
            );
            assert_eq!(observation.disposition(), transaction::Phase::NeedsReview);
        } else {
            assert!(result.is_err(), "{mode}");
        }
        if !matches!(mode.as_str(), "late-watermark" | "late-transaction") {
            assert_eq!(disk(&root), before, "read-only restart {mode}");
        }
        println!("HANDOFF CHILD {mode}: limited observation or safe refusal, no health/install");
        return;
    }

    for mode in [
        "same",
        "missing",
        "mixed",
        "changed",
        "expired",
        "advanced",
        "cancel",
        "late-cancel",
        "late-expiry",
        "late-watermark",
        "late-transaction",
        "old-image",
        "wrong-transaction",
        "truncated",
    ] {
        let fixture = Temp::new();
        let (mut store, update) = prepared(&fixture).await;
        let token = store.snapshot().unwrap().token();
        retain_with(
            &update,
            &fixture.trust(),
            &mut store,
            &token,
            &AtomicBool::new(false),
            &config(),
            || Ok(NOW),
        )
        .unwrap();
        start(&mut store);
        drop(store);
        let mut json: serde_json::Value =
            serde_json::from_slice(&fs::read(fixture.canonical()).unwrap()).unwrap();
        match mode {
            "missing" => {
                json.as_object_mut().unwrap().remove("handoff");
                json["schema"] = 1.into();
            }
            "mixed" => json["handoff"]["transaction"] = "b".repeat(32).into(),
            "changed" => {
                let mut envelope: serde_json::Value =
                    serde_json::from_str(json["handoff"]["envelope"].as_str().unwrap()).unwrap();
                let mut payload: serde_json::Value = serde_json::from_slice(
                    &STANDARD
                        .decode(envelope["payload"].as_str().unwrap())
                        .unwrap(),
                )
                .unwrap();
                payload["release"]["notes"] = "unsigned changed handoff".into();
                envelope["payload"] = STANDARD
                    .encode(serde_json::to_vec(&payload).unwrap())
                    .into();
                json["handoff"]["envelope"] = envelope.to_string().into();
            }
            "advanced" => accept(&fixture.trust(), &raw("renewed")),
            _ => {}
        }
        fs::write(fixture.canonical(), serde_json::to_vec(&json).unwrap()).unwrap();
        if mode == "truncated" {
            fs::write(fixture.canonical(), b"{partial record").unwrap();
        }
        let output = child(&fixture.0, mode).finish();
        println!(
            "{}",
            output
                .lines()
                .find(|l| l.starts_with("HANDOFF CHILD"))
                .unwrap()
        );
    }
    for after in [false, true] {
        let fixture = Temp::new();
        accept(&fixture.trust(), &raw("valid"));
        let mut writer = child(
            &fixture.0,
            if after {
                "capture-after"
            } else {
                "capture-before"
            },
        );
        wait_until(|| {
            fixture.0.join("ready").exists()
                || writer.0.as_mut().unwrap().try_wait().unwrap().is_some()
        });
        assert!(fixture.0.join("ready").exists());
        child(&fixture.0, "busy").finish();
        writer.kill();
        let json: serde_json::Value =
            serde_json::from_slice(&fs::read(fixture.canonical()).unwrap()).unwrap();
        assert_eq!(json["schema"], if after { 2 } else { 1 });
        assert_eq!(json["phase"], "Prepared");
        assert_eq!(json.get("handoff").is_some(), after);
        child(&fixture.0, "partial").finish();
        let orphans = fs::read_dir(fixture.directory())
            .unwrap()
            .filter(|e| {
                e.as_ref()
                    .unwrap()
                    .file_name()
                    .to_string_lossy()
                    .ends_with(".tmp")
            })
            .count();
        assert_eq!(orphans, usize::from(!after));
        println!(
            "HANDOFF KILL {}: atomic old/new record; orphan retained; not power-loss validation",
            if after { "after" } else { "before" }
        );
    }
}
