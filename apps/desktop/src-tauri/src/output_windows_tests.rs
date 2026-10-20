//! Actual Windows filesystem tests. No GUI, Runtime or renderer is started.
use super::*;

struct Fixture(PathBuf);
impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(crate::workspace::id("output-windows").unwrap());
        fs::create_dir(&root).unwrap();
        Self(root)
    }
    fn path(&self, name: &str) -> PathBuf {
        self.0.join(name)
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.0).expect("all output handles must be released");
    }
}
fn active(source: Option<PathBuf>) -> Job {
    let source_identity = source
        .as_ref()
        .map(|p| identity(&File::open(p).unwrap()).unwrap());
    Job {
        format: Format::Html,
        source,
        source_identity,
        created: Instant::now(),
        cancelled: AtomicBool::new(false),
        state: Mutex::new(JobState::Running),
    }
}

#[test]
fn native_html_publication_preserves_unicode_source_and_replaces_complete_output() {
    let f = Fixture::new();
    let source = f.path("原文 😀.md");
    let destination = f.path("导出 😀.html");
    let original = "# 中文\r\n**混合 😀**\n";
    fs::write(&source, original).unwrap();
    let job = active(Some(source.clone()));
    let bytes = "<!doctype html><h1>中文 😀</h1>".as_bytes();
    {
        let target = Target::adopt(&destination, Some(&source)).unwrap();
        assert_eq!(target.publish(&job, bytes).unwrap().bytes, bytes.len());
    }
    assert_eq!(fs::read(&destination).unwrap(), bytes);
    {
        let target = Target::adopt(&destination, Some(&source)).unwrap();
        target.publish(&job, b"replacement").unwrap();
    }
    assert_eq!(fs::read(&destination).unwrap(), b"replacement");
    assert_eq!(fs::read(&source).unwrap(), original.as_bytes());
    assert_eq!(fs::read_dir(&f.0).unwrap().count(), 2);
}

#[test]
fn source_aliases_open_documents_and_captured_identity_never_authorize_output() {
    let f = Fixture::new();
    let source = f.path("source.md");
    let alias = f.path("alias.html");
    fs::write(&source, "original").unwrap();
    fs::hard_link(&source, &alias).unwrap();
    assert!(Target::adopt(&source, Some(&source)).is_err());
    assert!(Target::adopt(&alias, Some(&source)).is_err());
    let id = crate::workspace::id("output-registered").unwrap();
    crate::resources::register_document(&id, &source);
    assert!(Target::adopt(&alias, None).is_err());
    crate::resources::resources_release_document(id).unwrap();
    let job = active(Some(source.clone()));
    fs::remove_file(&source).unwrap();
    fs::write(&source, "new source").unwrap();
    let target = Target::adopt(&alias, Some(&source)).unwrap();
    assert!(target
        .publish(&job, b"must not replace captured source")
        .is_err());
    assert_eq!(fs::read(&alias).unwrap(), b"original");
    assert_eq!(fs::read(&source).unwrap(), b"new source");
}

#[test]
fn changed_or_late_created_destinations_keep_external_bytes() {
    let f = Fixture::new();
    for exists in [false, true] {
        let p = f.path(if exists { "existing.html" } else { "new.html" });
        if exists {
            fs::write(&p, "before").unwrap();
        }
        let target = Target::adopt(&p, None).unwrap();
        fs::write(&p, "external edit").unwrap();
        assert!(target.publish(&active(None), b"export").is_err());
        assert_eq!(fs::read(&p).unwrap(), b"external edit");
    }
    assert_eq!(fs::read_dir(&f.0).unwrap().count(), 2);
}

#[test]
fn cancelled_expired_and_consumed_jobs_cannot_publish() {
    let f = Fixture::new();
    let p = f.path("cancelled.html");
    let target = Target::adopt(&p, None).unwrap();
    let mut job = active(None);
    job.cancelled.store(true, Ordering::Release);
    assert!(target.publish(&job, b"cancelled").is_err());
    job.cancelled.store(false, Ordering::Release);
    job.created = Instant::now() - LEASE;
    assert!(target.publish(&job, b"expired").is_err());
    assert!(!p.exists());
    let job = active(None);
    *job.state.lock().unwrap() = JobState::Chosen(Target::adopt(&p, None).unwrap());
    assert!(take_target(&job, Format::Pdf).is_err());
    assert!(take_target(&job, Format::Html).is_ok());
    assert!(take_target(&job, Format::Html).is_err());
}

#[test]
fn windows_ambiguous_names_and_streams_are_rejected_before_authorization() {
    let f = Fixture::new();
    fs::write(f.path("existing.html"), "untouched").unwrap();
    for name in [
        "existing.html:stream",
        "trailing.",
        "trailing ",
        "NUL.html",
        "CON",
        "COM1.html",
    ] {
        assert!(
            Target::adopt(&f.path(name), None).is_err(),
            "accepted {name}"
        );
    }
    assert_eq!(fs::read(f.path("existing.html")).unwrap(), b"untouched");
    assert_eq!(fs::read_dir(&f.0).unwrap().count(), 1);
}

#[test]
fn readonly_destination_and_pinned_parent_preserve_original_files() {
    let f = Fixture::new();
    let p = f.path("readonly.html");
    fs::write(&p, "original").unwrap();
    let target = Target::adopt(&p, None).unwrap();
    let original_permissions = fs::metadata(&p).unwrap().permissions();
    let mut readonly = original_permissions.clone();
    readonly.set_readonly(true);
    fs::set_permissions(&p, readonly).unwrap();
    assert!(target.publish(&active(None), b"replacement").is_err());
    assert_eq!(fs::read(&p).unwrap(), b"original");
    fs::set_permissions(&p, original_permissions).unwrap();
    assert_eq!(
        fs::rename(&f.0, f.0.with_extension("moved"))
            .unwrap_err()
            .raw_os_error(),
        Some(32)
    );
}

#[test]
fn abort_after_commit_preserves_user_owned_output() {
    let f = Fixture::new();
    let p = f.path("committed.html");
    let prepared = output_prepare(None, Format::Html).unwrap();
    let lease = job(&prepared.id).unwrap();
    let target = Target::adopt(&p, None).unwrap();
    target.publish(&lease, b"committed").unwrap();
    output_abort(prepared.id.clone()).unwrap();
    output_abort(prepared.id).unwrap();
    assert_eq!(fs::read(&p).unwrap(), b"committed");
    assert_eq!(fs::read_dir(&f.0).unwrap().count(), 1);
}
