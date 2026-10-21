//! Executable recovery feasibility checks, not a recovery/reset implementation.
//! Only private synthetic temp directories are opened. A valid current manifest
//! cannot reconstruct lost historical high water without an independent anchor.
use super::*;

const NOW: u64 = 1_800_000_100;
const DAMAGED: &[u8] = b"{synthetic truncated trust state";
const CHILD_ROOT: &str = "MILKUP_TRUST_RECOVERY_TEST_ROOT";
const CHILD_FAILURE: &str = "MILKUP_TRUST_RECOVERY_TEST_FAILURE";

struct Fixture(PathBuf);

impl Fixture {
    fn new() -> Self {
        static SERIAL: AtomicU64 = AtomicU64::new(0);
        let path = std::env::temp_dir().join(format!(
            "milkup-trust-recovery-{}-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
            SERIAL.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&path).unwrap();
        fs::write(
            path.join("synthetic-test-only"),
            b"recovery feasibility fixture",
        )
        .unwrap();
        Self(path)
    }

    fn store(&self) -> Store {
        Store::new(self.0.clone(), "beta", "windows-x86_64", "2.0.0-beta.1")
    }

    fn state(&self) -> PathBuf {
        self.store().directory.join("state.json")
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.0).unwrap();
    }
}

fn statement(version: &str, sequence: u64) -> Observation {
    Observation {
        version: version.into(),
        freshness: Freshness {
            sequence,
            issued_at: NOW - 100,
            expires_at: NOW + 3500,
            rollback_from: None,
        },
        statement_hash: format!("{:x}", Sha256::digest(format!("{version}/{sequence}"))),
    }
}

#[test]
fn recovery_blocker_same_damage_and_old_snapshot_hide_different_high_water() {
    let first = Fixture::new();
    let second = Fixture::new();
    let low = statement("2.0.0-beta.2", 2);
    for fixture in [&first, &second] {
        fixture.store().accept(&low, NOW).unwrap();
    }
    let old_snapshot = first.store().read().unwrap().unwrap();
    assert_eq!(second.store().read().unwrap().unwrap(), old_snapshot);
    second
        .store()
        .accept(&statement("2.0.0-beta.4", 4), NOW)
        .unwrap();
    let newer_history = second.store().read().unwrap().unwrap();
    let incoming = statement("2.0.0-beta.3", 5);
    let scope = &first.store().scope;
    // Both policies receive a time-valid observation. The old snapshot would
    // permit it; the lost newer history correctly requires withdrawal authority.
    assert!(observe(Some(&old_snapshot), &incoming, scope, "2.0.0-beta.1", NOW).is_ok());
    assert!(observe(Some(&newer_history), &incoming, scope, "2.0.0-beta.1", NOW).is_err());
    // Installed version, a higher offered version, and even a valid signature
    // cannot reconstruct the missing sequence floor either.
    let replay = statement("2.0.0-beta.5", 3);
    assert!(observe(Some(&old_snapshot), &replay, scope, "2.0.0-beta.1", NOW).is_ok());
    assert!(observe(Some(&newer_history), &replay, scope, "2.0.0-beta.1", NOW).is_err());
    for fixture in [&first, &second] {
        fs::write(fixture.state(), DAMAGED).unwrap();
        for candidate in [&incoming, &replay] {
            assert!(fixture.store().accept(candidate, NOW).is_err());
            assert_eq!(fs::read(fixture.state()).unwrap(), DAMAGED);
        }
    }
    assert_eq!(
        fs::read(first.state()).unwrap(),
        fs::read(second.state()).unwrap()
    );
    eprintln!("RECOVERY BLOCKED: identical damaged bytes + identical old snapshot hide beta.2/sequence 2 versus beta.4/sequence 4; neither current candidate proves the lost floors");
}

#[test]
fn recovery_blocker_preserves_each_corrupt_record_across_retries_and_reopen() {
    let fixture = Fixture::new();
    let store = fixture.store();
    let high = statement("2.0.0-beta.4", 4);
    store.accept(&high, NOW).unwrap();
    let mut wrong_scope = store.read().unwrap().unwrap();
    wrong_scope.scope = "other-product/beta/windows-x86_64".into();
    let mut contradictory = store.read().unwrap().unwrap();
    contradictory.highest_version = "1.0.0".into();
    let samples = [
        Vec::new(),
        vec![0xff, 0xfe],
        DAMAGED.to_vec(),
        vec![b'x'; MAX_STATE_BYTES as usize + 1],
        serde_json::to_vec(&wrong_scope).unwrap(),
        serde_json::to_vec(&contradictory).unwrap(),
    ];
    for bytes in samples {
        fs::write(fixture.state(), &bytes).unwrap();
        for _ in 0..3 {
            let reopened = fixture.store();
            assert!(reopened.accept(&high, NOW).is_err());
            assert!(reopened.authorize(&high, NOW).is_err());
            assert_eq!(fs::read(fixture.state()).unwrap(), bytes);
        }
        let mut leaves = fs::read_dir(&store.directory)
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .collect::<Vec<_>>();
        leaves.sort();
        assert_eq!(leaves, ["state.json", "state.lock"]);
        eprintln!(
            "PRESERVED synthetic state: bytes={} sha256={:x}",
            bytes.len(),
            Sha256::digest(&bytes)
        );
    }
}

#[test]
fn recovery_blocker_concurrent_peer_retry_never_restores_a_stale_observation() {
    let fixture = Fixture::new();
    let stale = statement("2.0.0-beta.2", 2);
    let higher = statement("2.0.0-beta.4", 4);
    let store = fixture.store();
    store.accept(&stale, NOW).unwrap();
    let held = store.locked().unwrap();
    let peer = fixture.store();
    let candidate = higher.clone();
    let busy = std::thread::spawn(move || peer.accept(&candidate, NOW))
        .join()
        .unwrap();
    assert!(busy.unwrap_err().contains("另一个应用实例"));
    assert_eq!(store.read().unwrap().unwrap().latest, stale);
    drop(held);
    // A normal retry after contention still advances the intact record.
    let peer = fixture.store();
    let candidate = higher.clone();
    std::thread::spawn(move || peer.accept(&candidate, NOW))
        .join()
        .unwrap()
        .unwrap();
    assert!(store.authorize(&stale, NOW).is_err());
    assert_eq!(
        store.read().unwrap().unwrap().highest_version,
        higher.version
    );
    fs::write(fixture.state(), DAMAGED).unwrap();
    let peer = fixture.store();
    std::thread::spawn(move || {
        assert!(peer.accept(&higher, NOW).is_err());
        assert!(peer.authorize(&higher, NOW).is_err());
    })
    .join()
    .unwrap();
    assert!(store.accept(&stale, NOW).is_err());
    assert_eq!(fs::read(fixture.state()).unwrap(), DAMAGED);
}

#[test]
fn recovery_blocker_new_process_does_not_treat_damage_as_first_use() {
    if let Some(root) = std::env::var_os(CHILD_ROOT) {
        let root = PathBuf::from(root);
        assert_eq!(root.parent(), Some(std::env::temp_dir().as_path()));
        assert!(root
            .file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with("milkup-trust-recovery-"));
        assert_eq!(
            fs::read(root.join("synthetic-test-only")).unwrap(),
            b"recovery feasibility fixture"
        );
        let store = Store::new(root, "beta", "windows-x86_64", "2.0.0-beta.1");
        let path = store.directory.join("state.json");
        assert_eq!(fs::read(&path).unwrap(), DAMAGED);
        let candidate = statement("2.0.0-beta.5", 5);
        let expected = match std::env::var(CHILD_FAILURE).unwrap().as_str() {
            "busy" => "另一个应用实例",
            "damaged" => "损坏",
            _ => panic!("unexpected synthetic probe"),
        };
        assert!(store
            .accept(&candidate, NOW)
            .unwrap_err()
            .contains(expected));
        assert!(store
            .authorize(&candidate, NOW)
            .unwrap_err()
            .contains(expected));
        assert_eq!(fs::read(path).unwrap(), DAMAGED);
        println!("FRESH PROCESS REFUSED UNKNOWN HIGH WATER: {expected}");
        return;
    }
    let fixture = Fixture::new();
    fixture
        .store()
        .accept(&statement("2.0.0-beta.4", 4), NOW)
        .unwrap();
    fs::write(fixture.state(), DAMAGED).unwrap();
    let test = format!(
        "{}::recovery_blocker_new_process_does_not_treat_damage_as_first_use",
        module_path!().split_once("::").unwrap().1
    );
    for failure in ["busy", "damaged"] {
        let held = (failure == "busy").then(|| fixture.store().locked().unwrap());
        let output = std::process::Command::new(std::env::current_exe().unwrap())
            .args(["--exact", &test, "--nocapture"])
            .env(CHILD_ROOT, &fixture.0)
            .env(CHILD_FAILURE, failure)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        let stdout = String::from_utf8_lossy(&output.stdout);
        assert!(stdout.contains("FRESH PROCESS REFUSED UNKNOWN HIGH WATER"));
        assert!(stdout.contains("1 passed"));
        eprintln!("{}", stdout);
        assert_eq!(fs::read(fixture.state()).unwrap(), DAMAGED);
        drop(held);
    }
}
