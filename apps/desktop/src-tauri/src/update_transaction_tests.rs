use super::*;
use std::cell::RefCell;
use std::process::{Child, Command, Output, Stdio};
use std::time::{Duration, Instant};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Point {
    BeforeReplace,
    AfterReplace,
}
enum Fault {
    Fail(Point),
    Pause(Point, PathBuf),
    Collision,
}
thread_local! { static FAULT: RefCell<Option<Fault>> = const { RefCell::new(None) }; }

pub(super) fn pause_commit(after: bool, ready: PathBuf) {
    let point = if after {
        Point::AfterReplace
    } else {
        Point::BeforeReplace
    };
    FAULT.with(|fault| *fault.borrow_mut() = Some(Fault::Pause(point, ready)));
}

pub(super) fn before_create(path: &Path) -> std::result::Result<(), String> {
    FAULT.with(|fault| {
        if matches!(*fault.borrow(), Some(Fault::Collision)) {
            fs::write(path, b"foreign staging sentinel").map_err(|e| e.to_string())?;
        }
        Ok(())
    })
}

pub(super) fn checkpoint(point: Point) -> std::result::Result<(), String> {
    FAULT.with(|fault| match &*fault.borrow() {
        Some(Fault::Fail(expected)) if *expected == point => Err(format!("injected {point:?}")),
        Some(Fault::Pause(expected, ready)) if *expected == point => {
            fs::write(ready, b"holding actual lease at commit boundary")
                .map_err(|e| e.to_string())?;
            loop {
                std::thread::park_timeout(Duration::from_millis(50));
            }
        }
        _ => Ok(()),
    })
}
struct FaultReset;
impl Drop for FaultReset {
    fn drop(&mut self) {
        FAULT.with(|f| *f.borrow_mut() = None);
    }
}

struct Fixture(PathBuf);
impl Fixture {
    fn new() -> Self {
        static SERIAL: AtomicU64 = AtomicU64::new(0);
        let path = std::env::temp_dir().join(format!(
            "milkup-observation-store-{}-{}-{}",
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
            b"transaction store process fixture",
        )
        .unwrap();
        Self(path)
    }
    fn directory(&self) -> PathBuf {
        self.0.join("transaction")
    }
    fn canonical(&self) -> PathBuf {
        self.directory().join("transaction.json")
    }
    fn create(&self) -> Store {
        Store::create(self.directory(), intent(), 100).unwrap()
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}
fn intent() -> Intent {
    Intent {
        transaction: "1".repeat(32),
        previous_version: "2.0.0-beta.1".into(),
        expected_version: "2.0.0-beta.2".into(),
        installer_sha256: "a".repeat(64),
    }
}
fn apply(store: &mut Store, event: Event, now: u64) -> Record {
    let token = store.snapshot().unwrap().token();
    store.apply(&token, event, now).unwrap()
}

#[test]
fn transaction_store_real_files_cas_cancel_and_known_failure_retry() {
    let fixture = Fixture::new();
    let mut store = fixture.create();
    let first = store.snapshot().unwrap();
    assert_eq!(first.verification(), Verification::Unverified);
    let cancelled = store.apply(&first.token(), Event::Cancel, 101).unwrap();
    assert_eq!(cancelled.phase(), Phase::Cancelled);
    let bytes = fs::read(fixture.canonical()).unwrap();
    assert!(matches!(
        store.apply(&first.token(), Event::Retry, 102),
        Err(Error::Conflict)
    ));
    assert_eq!(fs::read(fixture.canonical()).unwrap(), bytes);
    let retry = apply(&mut store, Event::Retry, 102);
    let handoff = apply(&mut store, Event::BeginHandoff, 103);
    assert!(matches!(
        store.apply(&retry.token(), Event::Cancel, 104),
        Err(Error::Conflict)
    ));
    assert!(matches!(
        store.apply(&handoff.token(), Event::Cancel, 104),
        Err(Error::Invalid(_))
    ));
    assert_eq!(
        apply(&mut store, Event::LaunchRejected, 105).phase(),
        Phase::LaunchRejected
    );
    apply(&mut store, Event::Retry, 106);
    apply(&mut store, Event::BeginHandoff, 107);
    let accepted = apply(&mut store, Event::LaunchAccepted, 108);
    assert_eq!(accepted.phase(), Phase::AwaitingCompletion);
    assert_eq!(accepted.verification(), Verification::Unverified);
    let mut wrong = accepted.token();
    wrong.transaction = "2".repeat(32);
    assert!(matches!(
        store.apply(&wrong, Event::RequireReview, 109),
        Err(Error::Conflict)
    ));
    drop(store);
    let mut reopened = Store::open(fixture.directory(), 109).unwrap();
    let review = reopened.snapshot().unwrap();
    assert_eq!(review.phase(), Phase::NeedsReview);
    assert_eq!(review.token().revision, accepted.token().revision + 1);
    assert!(matches!(
        reopened.apply(&review.token(), Event::Retry, 110),
        Err(Error::Invalid(_))
    ));
    let bytes = fs::read(fixture.canonical()).unwrap();
    drop(reopened);
    assert_eq!(
        Store::open(fixture.directory(), 110)
            .unwrap()
            .snapshot()
            .unwrap(),
        review
    );
    assert_eq!(fs::read(fixture.canonical()).unwrap(), bytes);
}

#[test]
fn transaction_store_write_failures_force_reread_before_retry_even_after_replace() {
    for point in [Point::BeforeReplace, Point::AfterReplace] {
        let fixture = Fixture::new();
        let mut store = fixture.create();
        let before = store.snapshot().unwrap();
        let bytes = fs::read(fixture.canonical()).unwrap();
        {
            FAULT.with(|f| *f.borrow_mut() = Some(Fault::Fail(point)));
            let _reset = FaultReset;
            assert!(matches!(
                store.apply(&before.token(), Event::BeginHandoff, 101),
                Err(Error::ReloadRequired(_))
            ));
        }
        assert!(matches!(
            store.apply(&before.token(), Event::BeginHandoff, 101),
            Err(Error::ReloadRequired(_))
        ));
        let observed = store.snapshot().unwrap();
        if point == Point::BeforeReplace {
            assert_eq!(observed, before);
            assert_eq!(fs::read(fixture.canonical()).unwrap(), bytes);
            assert_eq!(
                apply(&mut store, Event::Cancel, 102).phase(),
                Phase::Cancelled
            );
        } else {
            assert_eq!(observed.phase(), Phase::HandoffPending);
            assert_eq!(observed.token().revision, before.token().revision + 1);
            assert!(matches!(
                store.apply(&before.token(), Event::BeginHandoff, 102),
                Err(Error::Conflict)
            ));
            apply(&mut store, Event::LaunchRejected, 102);
            assert_eq!(
                apply(&mut store, Event::Retry, 103).phase(),
                Phase::Prepared
            );
        }
        assert!(!fs::read_dir(fixture.directory()).unwrap().any(|e| e
            .unwrap()
            .file_name()
            .to_string_lossy()
            .ends_with(".tmp")));
        println!("INJECTED {point:?}: canonical reread and sync completed before retry");
    }
}

#[test]
fn transaction_store_damage_missing_and_claimed_health_never_reset_or_verify() {
    let fixture = Fixture::new();
    let mut store = fixture.create();
    let good = store.snapshot().unwrap();
    let mut health_claim = serde_json::to_value(&good).unwrap();
    health_claim["phase"] = "HealthConfirmed".into();
    let mut extra = serde_json::to_value(&good).unwrap();
    extra["verified"] = true.into();
    let mut legacy = serde_json::to_value(&good).unwrap();
    legacy["schema"] = 0.into();
    drop(store);
    for bytes in [
        vec![],
        vec![0xff],
        b"{truncated".to_vec(),
        vec![b'x'; LIMIT + 1],
        serde_json::to_vec(&health_claim).unwrap(),
        serde_json::to_vec(&extra).unwrap(),
        serde_json::to_vec(&legacy).unwrap(),
    ] {
        fs::write(fixture.canonical(), &bytes).unwrap();
        for _ in 0..2 {
            assert!(matches!(
                Store::open(fixture.directory(), 102),
                Err(Error::Corrupt(_))
            ));
            assert_eq!(fs::read(fixture.canonical()).unwrap(), bytes);
            assert!(Store::create(fixture.directory(), intent(), 102).is_err());
            assert_eq!(fs::read(fixture.canonical()).unwrap(), bytes);
        }
        println!("CORRUPT PRESERVED: {} bytes", bytes.len());
    }
    fs::remove_file(fixture.canonical()).unwrap();
    fs::write(
        fixture.directory().join(".transaction-orphan.tmp"),
        serde_json::to_vec(&good).unwrap(),
    )
    .unwrap();
    assert!(matches!(
        Store::open(fixture.directory(), 103),
        Err(Error::Corrupt(_))
    ));
    assert!(!fixture.canonical().exists());
    assert!(fixture.directory().join(".transaction-orphan.tmp").exists());
    // The shared sync-open primitive must never recreate a missing record.
    assert!(open_regular_for_sync(&fixture.canonical()).is_err());
    assert!(!fixture.canonical().exists());
}

#[test]
fn transaction_store_actual_create_collision_and_failed_reread_preserve_evidence() {
    let fixture = Fixture::new();
    let mut store = fixture.create();
    let first = store.snapshot().unwrap();
    let original = fs::read(fixture.canonical()).unwrap();
    {
        FAULT.with(|f| *f.borrow_mut() = Some(Fault::Collision));
        let _reset = FaultReset;
        assert!(matches!(
            store.apply(&first.token(), Event::BeginHandoff, 101),
            Err(Error::ReloadRequired(_))
        ));
    }
    assert_eq!(fs::read(fixture.canonical()).unwrap(), original);
    let collisions = fs::read_dir(fixture.directory())
        .unwrap()
        .map(|e| e.unwrap().path())
        .filter(|p| p.extension().is_some_and(|ext| ext == "tmp"))
        .collect::<Vec<_>>();
    assert_eq!(collisions.len(), 1);
    assert_eq!(
        fs::read(&collisions[0]).unwrap(),
        b"foreign staging sentinel"
    );
    assert!(matches!(
        store.apply(&first.token(), Event::Cancel, 102),
        Err(Error::ReloadRequired(_))
    ));
    assert_eq!(store.snapshot().unwrap(), first);
    apply(&mut store, Event::Cancel, 102);
    apply(&mut store, Event::Retry, 103);
    let token = store.snapshot().unwrap().token();
    {
        FAULT.with(|f| *f.borrow_mut() = Some(Fault::Fail(Point::AfterReplace)));
        let _reset = FaultReset;
        assert!(matches!(
            store.apply(&token, Event::BeginHandoff, 104),
            Err(Error::ReloadRequired(_))
        ));
    }
    fs::write(fixture.canonical(), b"{damage during uncertain result").unwrap();
    assert!(matches!(store.snapshot(), Err(Error::Corrupt(_))));
    assert!(matches!(
        store.apply(&token, Event::Cancel, 105),
        Err(Error::ReloadRequired(_))
    ));
    assert_eq!(
        fs::read(fixture.canonical()).unwrap(),
        b"{damage during uncertain result"
    );
    assert_eq!(
        fs::read(&collisions[0]).unwrap(),
        b"foreign staging sentinel"
    );
}

#[cfg(unix)]
#[test]
fn transaction_store_reuses_alias_rejection_without_touching_other_files() {
    use std::os::unix::fs::symlink;
    let fixture = Fixture::new();
    let mut store = fixture.create();
    let record = store.snapshot().unwrap();
    drop(store);
    let outside = fixture.0.join("outside.json");
    let original = serde_json::to_vec(&record).unwrap();
    fs::write(&outside, &original).unwrap();
    fs::remove_file(fixture.canonical()).unwrap();
    for hard in [false, true] {
        if hard {
            fs::hard_link(&outside, fixture.canonical()).unwrap();
        } else {
            symlink(&outside, fixture.canonical()).unwrap();
        }
        assert!(Store::open(fixture.directory(), 102).is_err());
        assert_eq!(fs::read(&outside).unwrap(), original);
        fs::remove_file(fixture.canonical()).unwrap();
    }
    let alias = fixture.0.join("alias");
    symlink(fixture.directory(), &alias).unwrap();
    assert!(Store::open(alias, 102).is_err());
}

struct Process(Option<Child>);
impl Drop for Process {
    fn drop(&mut self) {
        if let Some(child) = &mut self.0 {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}
impl Process {
    fn finish(mut self) -> Output {
        wait_until(|| self.0.as_mut().unwrap().try_wait().unwrap().is_some());
        self.0.take().unwrap().wait_with_output().unwrap()
    }
    fn kill(&mut self) {
        self.0.as_mut().unwrap().kill().unwrap();
        assert!(!self.0.as_mut().unwrap().wait().unwrap().success());
        self.0.take();
    }
}
fn wait_until(mut condition: impl FnMut() -> bool) {
    let started = Instant::now();
    while !condition() {
        assert!(
            started.elapsed() < Duration::from_secs(15),
            "child fixture deadline"
        );
        std::thread::sleep(Duration::from_millis(10));
    }
}
fn child(root: &Path, mode: &str) -> Process {
    let name = format!(
        "{}::transaction_store_real_process_lock_and_interruptions",
        module_path!().split_once("::").unwrap().1
    );
    Process(Some(
        Command::new(std::env::current_exe().unwrap())
            .args(["--exact", &name, "--nocapture"])
            .env("MILKUP_TRANSACTION_TEST_ROOT", root)
            .env("MILKUP_TRANSACTION_TEST_MODE", mode)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap(),
    ))
}

#[test]
fn transaction_store_real_process_lock_and_interruptions() {
    if let Some(root) = std::env::var_os("MILKUP_TRANSACTION_TEST_ROOT") {
        let root = PathBuf::from(root);
        assert_eq!(root.parent(), Some(std::env::temp_dir().as_path()));
        assert!(root
            .file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with("milkup-observation-store-"));
        assert_eq!(
            fs::read(root.join("synthetic-test-only")).unwrap(),
            b"transaction store process fixture"
        );
        let mode = std::env::var("MILKUP_TRANSACTION_TEST_MODE").unwrap();
        if mode == "busy" {
            assert!(matches!(
                Store::open(root.join("transaction"), 105),
                Err(Error::Busy)
            ));
            println!("CHILD CONFIRMED REAL LEASE CONTENTION");
            return;
        }
        let point = match mode.as_str() {
            "before" | "initial" => Point::BeforeReplace,
            "after" => Point::AfterReplace,
            _ => panic!("bad fixture mode"),
        };
        if mode == "initial" {
            FAULT.with(|f| *f.borrow_mut() = Some(Fault::Pause(point, root.join("ready"))));
            let _ = Store::create(root.join("transaction"), intent(), 100).unwrap();
        } else {
            let mut store = Store::open(root.join("transaction"), 102).unwrap();
            apply(&mut store, Event::Retry, 103);
            FAULT.with(|f| *f.borrow_mut() = Some(Fault::Pause(point, root.join("ready"))));
            apply(&mut store, Event::BeginHandoff, 104);
        }
        panic!("paused child should have been killed");
    }

    for mode in ["before", "after", "initial"] {
        let fixture = Fixture::new();
        if mode != "initial" {
            let mut store = fixture.create();
            apply(&mut store, Event::Cancel, 101);
        }
        let mut holder = child(&fixture.0, mode);
        wait_until(|| {
            fixture.0.join("ready").exists()
                || holder.0.as_mut().unwrap().try_wait().unwrap().is_some()
        });
        assert!(
            fixture.0.join("ready").exists(),
            "holder did not reach commit checkpoint"
        );
        let busy = child(&fixture.0, "busy").finish();
        assert!(
            busy.status.success(),
            "{}",
            String::from_utf8_lossy(&busy.stderr)
        );
        let stdout = String::from_utf8_lossy(&busy.stdout);
        assert!(
            stdout.contains("CHILD CONFIRMED REAL LEASE CONTENTION") && stdout.contains("1 passed")
        );
        holder.kill();
        if mode == "initial" {
            assert!(!fixture.canonical().exists());
            assert!(matches!(
                Store::open(fixture.directory(), 105),
                Err(Error::Corrupt(_))
            ));
            assert!(Store::create(fixture.directory(), intent(), 105).is_err());
            assert!(!fixture.canonical().exists());
        } else {
            let canonical: Record =
                serde_json::from_slice(&fs::read(fixture.canonical()).unwrap()).unwrap();
            assert_eq!(canonical.revision, if mode == "before" { 2 } else { 3 });
            assert_eq!(
                canonical.phase,
                if mode == "before" {
                    Phase::Prepared
                } else {
                    Phase::HandoffPending
                }
            );
            let mut reopened = Store::open(fixture.directory(), 105).unwrap();
            let review = reopened.snapshot().unwrap();
            assert_eq!(review.phase(), Phase::NeedsReview);
            assert_eq!(review.verification(), Verification::Unverified);
            assert_eq!(review.revision, canonical.revision + 1);
            assert!(matches!(
                reopened.apply(&canonical.token(), Event::Cancel, 106),
                Err(Error::Conflict)
            ));
        }
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
        assert_eq!(orphans, usize::from(mode != "after"));
        println!("KILL/REOPEN {mode}: lease released; no health or orphan promotion; not a power-loss test");
    }
}
