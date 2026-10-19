//! Generic, host-owned output leases. No plugin-supplied path authorizes writes.
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs::{self, File},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, OnceLock,
    },
    time::{Duration, Instant},
};

#[cfg(target_os = "linux")]
#[path = "output_chromium.rs"]
mod chromium;
#[cfg(target_os = "linux")]
#[path = "output_linux.rs"]
mod linux;
type Result<T> = std::result::Result<T, String>;
pub(super) const MAX_HTML: usize = 32 * 1024 * 1024;
pub(super) const MAX_PDF: usize = 64 * 1024 * 1024;
const LEASE: Duration = Duration::from_secs(600);
fn error(e: impl std::fmt::Display) -> String {
    e.to_string()
}
fn source_file(path: &Path) -> std::io::Result<File> {
    let mut options = fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NONBLOCK | libc::O_CLOEXEC);
    }
    let file = options.open(path)?;
    if !file.metadata()?.is_file() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "Source is no longer a regular document",
        ));
    }
    Ok(file)
}

#[derive(Clone, Copy, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Format {
    Html,
    Pdf,
    Print,
}
#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum PageSize {
    A4,
    Letter,
}
#[derive(Serialize)]
pub(crate) struct Prepared {
    id: String,
}
#[derive(Serialize)]
pub(crate) struct Chosen {
    id: String,
    name: String,
}
#[derive(Serialize)]
pub(crate) struct Written {
    name: String,
    bytes: usize,
}
#[derive(Serialize)]
pub(crate) struct Printed {
    status: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    bytes: Option<usize>,
}

struct Job {
    format: Format,
    source: Option<PathBuf>,
    source_identity: Option<(u64, u64)>,
    created: Instant,
    cancelled: AtomicBool,
    state: Mutex<JobState>,
}
enum JobState {
    Prepared,
    Choosing,
    Chosen(Target),
    Running,
    Submitting,
    Complete,
}
fn jobs() -> &'static Mutex<HashMap<String, Arc<Job>>> {
    static JOBS: OnceLock<Mutex<HashMap<String, Arc<Job>>>> = OnceLock::new();
    JOBS.get_or_init(Default::default)
}
fn job(id: &str) -> Result<Arc<Job>> {
    let job = jobs()
        .lock()
        .map_err(error)?
        .get(id)
        .cloned()
        .ok_or("Unknown output lease")?;
    job.active()?;
    Ok(job)
}
impl Job {
    fn begin_submission(&self) -> Result<()> {
        let mut state = self.state.lock().map_err(error)?;
        self.active()?;
        if self.format != Format::Print || !matches!(*state, JobState::Running) {
            return Err("Print submission is invalid or already started".into());
        }
        *state = JobState::Submitting;
        Ok(())
    }

    fn cancel_before_submission(&self) -> Result<()> {
        let state = self.state.lock().map_err(error)?;
        // Once the helper is authorized to send, its spooler may already have
        // accepted the document. Wait for its bounded terminal result instead
        // of falsely reporting cancellation of an irreversible submission.
        if !matches!(*state, JobState::Submitting | JobState::Complete) {
            self.cancelled.store(true, Ordering::Release);
        }
        Ok(())
    }
    fn protect_target(&self, target: &Target) -> Result<()> {
        if let (Some(source), Ok(file)) = (self.source_identity, target.open()) {
            if identity(&file)? == source {
                return Err("Output cannot replace the captured source document".into());
            }
        }
        Ok(())
    }
    fn active(&self) -> Result<()> {
        if self.cancelled.load(Ordering::Acquire) || self.created.elapsed() >= LEASE {
            Err("Output cancelled or lease expired".into())
        } else {
            Ok(())
        }
    }
}

fn command_error(message: String) -> String {
    if message.starts_with("[output:") {
        return message;
    }
    let lower = message.to_lowercase();
    let kind = if lower.contains("cancel") || lower.contains("expired") {
        "aborted"
    } else if lower.contains("budget") || lower.contains("exceeds") {
        "too-large"
    } else if lower.contains("unsupported") || lower.contains("not available on this platform") {
        "unsupported"
    } else if lower.contains("changed") || lower.contains("replace") || lower.contains("read-only")
    {
        "conflict"
    } else {
        "unavailable"
    };
    format!("[output:{kind}] {message}")
}
#[tauri::command]
pub(crate) fn output_prepare(source_path: Option<String>, format: Format) -> Result<Prepared> {
    output_prepare_inner(source_path, format).map_err(command_error)
}
#[tauri::command]
pub(crate) fn output_abort(job_id: String) -> Result<bool> {
    output_abort_inner(job_id).map_err(command_error)
}
#[tauri::command]
pub(crate) async fn output_choose_target(job_id: String, title: String) -> Result<Option<Chosen>> {
    output_choose_target_inner(job_id, title)
        .await
        .map_err(command_error)
}
#[tauri::command]
pub(crate) async fn output_write_html(job_id: String, html: String) -> Result<Written> {
    output_write_html_inner(job_id, html)
        .await
        .map_err(command_error)
}
#[tauri::command]
pub(crate) async fn output_write_pdf(
    job_id: String,
    html: String,
    page_size: PageSize,
    landscape: bool,
) -> Result<Written> {
    output_write_pdf_inner(job_id, html, page_size, landscape)
        .await
        .map_err(command_error)
}
#[tauri::command]
pub(crate) async fn output_print(
    job_id: String,
    html: String,
    page_size: PageSize,
    landscape: bool,
) -> Result<Printed> {
    output_print_inner(job_id, html, page_size, landscape)
        .await
        .map_err(command_error)
}

fn output_prepare_inner(source_path: Option<String>, format: Format) -> Result<Prepared> {
    let source = source_path.map(PathBuf::from);
    if let Some(path) = &source {
        if !path.is_absolute() {
            return Err("Source path must be absolute".into());
        }
    }
    let id = crate::workspace::id("output")?;
    let source_identity = match source.as_ref().map(|path| source_file(path)) {
        Some(Ok(file)) => Some(identity(&file)?),
        Some(Err(e)) if e.kind() != std::io::ErrorKind::NotFound => return Err(error(e)),
        _ => None,
    };
    let mut registry = jobs().lock().map_err(error)?;
    registry.retain(|_, job| {
        let keep = job.created.elapsed() < LEASE
            && !matches!(job.state.lock().as_deref(), Ok(JobState::Complete));
        if !keep {
            job.cancelled.store(true, Ordering::Release);
        }
        keep
    });
    if registry.len() >= 4 {
        return Err("Output lease budget reached".into());
    }
    registry.insert(
        id.clone(),
        Arc::new(Job {
            format,
            source,
            source_identity,
            created: Instant::now(),
            cancelled: AtomicBool::new(false),
            state: Mutex::new(JobState::Prepared),
        }),
    );
    Ok(Prepared { id })
}

fn output_abort_inner(job_id: String) -> Result<bool> {
    if let Some(job) = jobs().lock().map_err(error)?.remove(&job_id) {
        // Serialize cancellation against final publication. A committed output
        // belongs to the user and is never removed by abort or plugin teardown.
        job.cancel_before_submission()?;
    }
    Ok(true)
}

async fn output_choose_target_inner(job_id: String, title: String) -> Result<Option<Chosen>> {
    let job = job(&job_id)?;
    if job.format == Format::Print {
        return Err("Print uses the native print dialog".into());
    }
    {
        let mut state = job.state.lock().map_err(error)?;
        if !matches!(*state, JobState::Prepared) {
            return Err("Output target has already been selected".into());
        }
        *state = JobState::Choosing;
    }
    let worker = job.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        #[cfg(target_os = "linux")]
        {
            linux::choose_target(&worker, title)
        }
        #[cfg(not(target_os = "linux"))]
        {
            let _ = (worker, title);
            Err("Native output selection is not available on this platform".into())
        }
    })
    .await
    .map_err(error)?;
    let mut state = job.state.lock().map_err(error)?;
    match result {
        Ok(Some(target)) => {
            job.active()?;
            let name = target.name.clone();
            *state = JobState::Chosen(target);
            Ok(Some(Chosen { id: job_id, name }))
        }
        Ok(None) => {
            *state = JobState::Complete;
            Ok(None)
        }
        Err(e) => {
            *state = JobState::Complete;
            Err(e)
        }
    }
}

fn take_target(job: &Job, format: Format) -> Result<Target> {
    job.active()?;
    if job.format != format {
        return Err("Output format does not match its lease".into());
    }
    let mut state = job.state.lock().map_err(error)?;
    if !matches!(*state, JobState::Chosen(_)) {
        return Err("Output target is missing or consumed".into());
    }
    match std::mem::replace(&mut *state, JobState::Running) {
        JobState::Chosen(target) => Ok(target),
        _ => unreachable!(),
    }
}
fn complete<T>(job: &Job, result: Result<T>) -> Result<T> {
    if let Ok(mut state) = job.state.lock() {
        *state = JobState::Complete;
    }
    result
}
fn validate_html(html: &str) -> Result<()> {
    if html.is_empty() || html.len() > MAX_HTML {
        Err("Output HTML exceeds its 32 MiB budget or is empty".into())
    } else {
        Ok(())
    }
}

async fn output_write_html_inner(job_id: String, html: String) -> Result<Written> {
    validate_html(&html)?;
    let job = job(&job_id)?;
    let target = take_target(&job, Format::Html)?;
    tauri::async_runtime::spawn_blocking(move || {
        let result = target.publish(&job, html.as_bytes());
        complete(&job, result)
    })
    .await
    .map_err(error)?
}
async fn output_write_pdf_inner(
    job_id: String,
    html: String,
    page_size: PageSize,
    landscape: bool,
) -> Result<Written> {
    validate_html(&html)?;
    let job = job(&job_id)?;
    let target = take_target(&job, Format::Pdf)?;
    tauri::async_runtime::spawn_blocking(move || {
        let result = render(&job, html, page_size, landscape).and_then(|result| match result {
            NativeResult::Pdf(bytes, _) => target.publish(&job, &bytes),
            _ => Err("PDF renderer did not return a document".into()),
        });
        complete(&job, result)
    })
    .await
    .map_err(error)?
}
async fn output_print_inner(
    job_id: String,
    html: String,
    page_size: PageSize,
    landscape: bool,
) -> Result<Printed> {
    validate_html(&html)?;
    let job = job(&job_id)?;
    {
        let mut state = job.state.lock().map_err(error)?;
        if job.format != Format::Print || !matches!(*state, JobState::Prepared) {
            return Err("Print lease is invalid or consumed".into());
        }
        *state = JobState::Running;
    }
    tauri::async_runtime::spawn_blocking(move || {
        let result = render(&job, html, page_size, landscape).and_then(|result| match result {
            NativeResult::Cancelled => Ok(Printed {
                status: "cancelled",
                name: None,
                bytes: None,
            }),
            NativeResult::Printed => Ok(Printed {
                status: "printed",
                name: None,
                bytes: None,
            }),
            NativeResult::Pdf(bytes, Some(target)) => {
                let written = target.publish(&job, &bytes)?;
                Ok(Printed {
                    status: "printed",
                    name: Some(written.name),
                    bytes: Some(written.bytes),
                })
            }
            _ => Err("Print operation did not return its selected destination".into()),
        });
        complete(&job, result)
    })
    .await
    .map_err(error)?
}
enum NativeResult {
    Chosen(Target),
    Pdf(Vec<u8>, Option<Target>),
    Printed,
    Cancelled,
}
fn render(
    job: &Arc<Job>,
    html: String,
    page_size: PageSize,
    landscape: bool,
) -> Result<NativeResult> {
    #[cfg(target_os = "linux")]
    {
        linux::render(job, html, page_size, landscape)
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (job, html, page_size, landscape);
        Err("Native PDF and printing are not available on this platform".into())
    }
}

#[derive(PartialEq, Debug)]
struct Fingerprint {
    identity: (u64, u64),
    digest: Vec<u8>,
}
struct Target {
    path: PathBuf,
    parent: PathBuf,
    directory: File,
    _guards: Vec<File>,
    name: String,
    initial: Option<Fingerprint>,
    permissions: Option<fs::Permissions>,
}
fn identity(file: &File) -> Result<(u64, u64)> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        let m = file.metadata().map_err(error)?;
        Ok((m.dev(), m.ino()))
    }
    #[cfg(windows)]
    {
        crate::workspace::windows_identity(file)
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = file;
        Err("Output identities unavailable".into())
    }
}
impl Target {
    fn adopt(path: &Path, source: Option<&Path>) -> Result<Self> {
        let parent = path.parent().ok_or("Output has no parent")?.to_path_buf();
        let name = path
            .file_name()
            .and_then(|s| s.to_str())
            .filter(|s| !s.is_empty() && !s.chars().any(char::is_control))
            .ok_or("Invalid output name")?
            .to_owned();
        let (directory, guards) = crate::workspace::open_absolute_directory(&parent)?;
        let mut target = Self {
            path: path.to_owned(),
            parent,
            directory,
            _guards: guards,
            name,
            initial: None,
            permissions: None,
        };
        target.protect_source(source)?;
        target.initial = target.fingerprint()?;
        if target.initial.is_some() {
            let m = target.open()?.metadata().map_err(error)?;
            if m.permissions().readonly() {
                return Err("Output destination is read-only".into());
            }
            target.permissions = Some(m.permissions());
        }
        Ok(target)
    }
    fn open(&self) -> Result<File> {
        crate::workspace::open_child(&self.directory, &self.parent, self.name.as_ref(), false)
            .map_err(error)
    }
    fn fingerprint(&self) -> Result<Option<Fingerprint>> {
        let mut file = match crate::workspace::open_child(
            &self.directory,
            &self.parent,
            self.name.as_ref(),
            false,
        ) {
            Ok(file) => file,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(e) => return Err(error(e)),
        };
        if !file.metadata().map_err(error)?.is_file() {
            return Err("Output destination is not a regular file".into());
        }
        let id = identity(&file)?;
        if file.metadata().map_err(error)?.len() > MAX_PDF as u64 {
            return Err("Existing output exceeds the 64 MiB verification budget".into());
        }
        let mut hash = Sha256::new();
        let mut block = [0u8; 65536];
        let mut size = 0usize;
        loop {
            let n = file.read(&mut block).map_err(error)?;
            if n == 0 {
                break;
            }
            size += n;
            if size > MAX_PDF {
                return Err("Existing output changed beyond its verification budget".into());
            }
            hash.update(&block[..n]);
        }
        Ok(Some(Fingerprint {
            identity: id,
            digest: hash.finalize().to_vec(),
        }))
    }
    fn protect_source(&self, source: Option<&Path>) -> Result<()> {
        if let Some(source) = source {
            if source == self.path {
                return Err("Output cannot replace the source document".into());
            }
            if let (Ok(source), Ok(target)) = (source_file(source), self.open()) {
                if identity(&source)? == identity(&target)? {
                    return Err("Output cannot replace an alias of the source document".into());
                }
            }
        }
        crate::resources::protect_output_destination(&self.path, self.open().ok().as_ref())
    }
    fn verify(&self, source: Option<&Path>) -> Result<()> {
        let (now, _) = crate::workspace::open_absolute_directory(&self.parent)?;
        if identity(&now)? != identity(&self.directory)? {
            return Err("Output directory changed".into());
        }
        self.protect_source(source)?;
        if let Ok(file) = self.open() {
            if file.metadata().map_err(error)?.permissions().readonly() {
                return Err("Output destination became read-only".into());
            }
        }
        if self.fingerprint()? != self.initial {
            return Err("Output destination changed; choose it again".into());
        }
        Ok(())
    }
    fn publish(&self, job: &Job, bytes: &[u8]) -> Result<Written> {
        if bytes.len() > MAX_PDF {
            return Err("Output exceeds its 64 MiB budget".into());
        }
        job.active()?;
        self.verify(job.source.as_deref())?;
        job.protect_target(self)?;
        #[cfg(target_os = "linux")]
        {
            use std::os::fd::{AsRawFd, FromRawFd};
            let name = std::ffi::CString::new(self.name.as_str()).map_err(error)?;
            let temp_name = std::ffi::CString::new(format!(
                ".milkup-{}.tmp",
                crate::workspace::id("output-stage")?
            ))
            .map_err(error)?;
            let fd = unsafe {
                libc::openat(
                    self.directory.as_raw_fd(),
                    temp_name.as_ptr(),
                    libc::O_WRONLY
                        | libc::O_CREAT
                        | libc::O_EXCL
                        | libc::O_NOFOLLOW
                        | libc::O_CLOEXEC,
                    0o600,
                )
            };
            if fd < 0 {
                return Err(error(std::io::Error::last_os_error()));
            }
            let mut temp = unsafe { File::from_raw_fd(fd) };
            let result = (|| {
                temp.write_all(bytes).map_err(error)?;
                if let Some(permissions) = &self.permissions {
                    temp.set_permissions(permissions.clone()).map_err(error)?;
                }
                temp.sync_all().map_err(error)?;
                let _state = job.state.lock().map_err(error)?;
                job.active()?;
                self.verify(job.source.as_deref())?;
                job.protect_target(self)?;
                // Recheck immediately before rename, matching document-save's
                // existing external-writer boundary. New targets use NOREPLACE.
                let flags = if self.initial.is_none() {
                    libc::RENAME_NOREPLACE
                } else {
                    0
                };
                if unsafe {
                    libc::renameat2(
                        self.directory.as_raw_fd(),
                        temp_name.as_ptr(),
                        self.directory.as_raw_fd(),
                        name.as_ptr(),
                        flags,
                    )
                } != 0
                {
                    return Err(error(std::io::Error::last_os_error()));
                }
                // Publication is committed. A directory fsync failure must not
                // cause an abort path to remove this user-owned output.
                let _ = self.directory.sync_all();
                Ok(Written {
                    name: self.name.clone(),
                    bytes: bytes.len(),
                })
            })();
            if result.is_err() {
                unsafe {
                    libc::unlinkat(self.directory.as_raw_fd(), temp_name.as_ptr(), 0);
                }
            }
            result
        }
        #[cfg(not(target_os = "linux"))]
        {
            Err("Atomic output publication is not available on this platform".into())
        }
    }
}

pub fn run_helper_if_requested() -> bool {
    if std::env::args_os().nth(1).as_deref()
        != Some(std::ffi::OsStr::new("--milkup-internal-output-helper"))
    {
        return false;
    }
    #[cfg(target_os = "linux")]
    {
        linux::run_guarded();
    }
    true
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::*;
    use std::os::unix::fs::{symlink, PermissionsExt};
    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let p = std::env::temp_dir().join(crate::workspace::id("output-test").unwrap());
            fs::create_dir(&p).unwrap();
            Self(p)
        }
        fn path(&self, name: &str) -> PathBuf {
            self.0.join(name)
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    fn active(source: Option<PathBuf>) -> Job {
        let source_identity = source
            .as_ref()
            .and_then(|p| File::open(p).ok())
            .as_ref()
            .map(identity)
            .transpose()
            .unwrap();
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
    fn print_submission_and_abort_have_one_winner() {
        for _ in 0..64 {
            let mut value = active(None);
            value.format = Format::Print;
            let job = Arc::new(value);
            let gate = Arc::new(std::sync::Barrier::new(2));
            let submit_job = job.clone();
            let submit_gate = gate.clone();
            let submit = std::thread::spawn(move || {
                submit_gate.wait();
                submit_job.begin_submission()
            });
            gate.wait();
            job.cancel_before_submission().unwrap();
            if submit.join().unwrap().is_ok() {
                assert!(matches!(*job.state.lock().unwrap(), JobState::Submitting));
                assert!(!job.cancelled.load(Ordering::Acquire));
                job.cancel_before_submission().unwrap();
                assert!(job.active().is_ok());
            } else {
                assert!(job.cancelled.load(Ordering::Acquire));
                assert!(matches!(*job.state.lock().unwrap(), JobState::Running));
            }
        }
    }
    #[test]
    fn physical_submission_is_single_use_and_late_abort_preserves_outcome() {
        let mut job = active(None);
        assert!(job.begin_submission().is_err());
        job.format = Format::Print;
        job.begin_submission().unwrap();
        assert!(job.begin_submission().is_err());
        job.cancel_before_submission().unwrap();
        assert!(job.active().is_ok());
        complete(&job, Ok(())).unwrap();
        job.cancel_before_submission().unwrap();
        assert!(!job.cancelled.load(Ordering::Acquire));
    }
    #[test]
    fn explicit_submission_error_is_not_reclassified_as_cancelled() {
        let message = "[output:unavailable] Print submission status is unknown; printer reported cancellation";
        assert_eq!(command_error(message.into()), message);
        assert!(command_error("Output cancelled before submission".into())
            .starts_with("[output:aborted]"));
    }
    #[test]
    fn output_preserves_source_and_rejects_path_hardlink_and_symlink_aliases() {
        let f = Fixture::new();
        let source = f.path("source.md");
        fs::write(&source, "原文\r\n").unwrap();
        fs::hard_link(&source, f.path("alias.html")).unwrap();
        symlink(&source, f.path("link.html")).unwrap();
        for p in [&source, &f.path("alias.html"), &f.path("link.html")] {
            assert!(Target::adopt(p, Some(&source)).is_err());
        }
        let target = Target::adopt(&f.path("copy.html"), Some(&source)).unwrap();
        target
            .publish(&active(Some(source.clone())), "<h1>中文</h1>".as_bytes())
            .unwrap();
        assert_eq!(fs::read_to_string(&source).unwrap(), "原文\r\n");
        assert_eq!(
            fs::read_to_string(f.path("copy.html")).unwrap(),
            "<h1>中文</h1>"
        );
        assert_eq!(fs::read_dir(&f.0).unwrap().count(), 4);
    }
    #[test]
    fn output_protects_other_open_documents_and_captured_source_identity() {
        let f = Fixture::new();
        let source = f.path("other.md");
        fs::write(&source, "other").unwrap();
        let id = crate::workspace::id("registered-output-test").unwrap();
        crate::resources::register_document(&id, &source);
        fs::hard_link(&source, f.path("other.pdf")).unwrap();
        assert!(Target::adopt(&f.path("other.pdf"), None).is_err());
        crate::resources::resources_release_document(id).unwrap();
        let job = active(Some(source.clone()));
        fs::remove_file(&source).unwrap();
        fs::write(&source, "replacement").unwrap();
        let old_alias = Target::adopt(&f.path("other.pdf"), Some(&source)).unwrap();
        assert!(old_alias
            .publish(&job, b"must not replace old source")
            .is_err());
        assert_eq!(fs::read_to_string(f.path("other.pdf")).unwrap(), "other");
    }
    #[test]
    fn output_rechecks_existing_absent_and_replaced_directory_destinations() {
        let f = Fixture::new();
        let p = f.path("existing.html");
        fs::write(&p, "old").unwrap();
        let target = Target::adopt(&p, None).unwrap();
        fs::write(&p, "external edit").unwrap();
        assert!(target.publish(&active(None), b"export").is_err());
        assert_eq!(fs::read_to_string(&p).unwrap(), "external edit");
        let p = f.path("new.html");
        let target = Target::adopt(&p, None).unwrap();
        fs::write(&p, "external create").unwrap();
        assert!(target.publish(&active(None), b"export").is_err());
        assert_eq!(fs::read_to_string(&p).unwrap(), "external create");
        let directory = f.path("folder");
        fs::create_dir(&directory).unwrap();
        let target = Target::adopt(&directory.join("new.html"), None).unwrap();
        fs::rename(&directory, f.path("moved")).unwrap();
        fs::create_dir(&directory).unwrap();
        assert!(target.publish(&active(None), b"export").is_err());
        assert!(!directory.join("new.html").exists());
        assert!(!f.path("moved/new.html").exists());
    }
    #[test]
    fn cancelled_expired_readonly_and_consumed_leases_do_not_publish() {
        let f = Fixture::new();
        let p = f.path("out.html");
        let target = Target::adopt(&p, None).unwrap();
        let job = active(None);
        job.cancelled.store(true, Ordering::Release);
        assert!(target.publish(&job, b"cancelled").is_err());
        assert!(!p.exists());
        let mut job = active(None);
        job.created = Instant::now() - LEASE;
        assert!(target.publish(&job, b"expired").is_err());
        fs::write(&p, "original").unwrap();
        let target = Target::adopt(&p, None).unwrap();
        fs::set_permissions(&p, fs::Permissions::from_mode(0o444)).unwrap();
        assert!(target.publish(&active(None), b"readonly").is_err());
        assert_eq!(fs::read_to_string(&p).unwrap(), "original");
        fs::set_permissions(&p, fs::Permissions::from_mode(0o600)).unwrap();
        let job = active(None);
        *job.state.lock().unwrap() = JobState::Chosen(Target::adopt(&p, None).unwrap());
        assert!(take_target(&job, Format::Pdf).is_err());
        assert!(take_target(&job, Format::Html).is_ok());
        assert!(take_target(&job, Format::Html).is_err());
    }
    #[test]
    fn successful_atomic_overwrite_preserves_mode_and_abort_keeps_published_output() {
        let f = Fixture::new();
        let p = f.path("out.html");
        fs::write(&p, "old").unwrap();
        fs::set_permissions(&p, fs::Permissions::from_mode(0o640)).unwrap();
        let prepared = output_prepare(None, Format::Html).unwrap();
        let job = job(&prepared.id).unwrap();
        let target = Target::adopt(&p, None).unwrap();
        let result = target.publish(&job, b"new").unwrap();
        assert_eq!(result.bytes, 3);
        assert_eq!(
            fs::metadata(&p).unwrap().permissions().mode() & 0o777,
            0o640
        );
        output_abort(prepared.id.clone()).unwrap();
        output_abort(prepared.id).unwrap();
        assert_eq!(fs::read(&p).unwrap(), b"new");
        assert_eq!(fs::read_dir(&f.0).unwrap().count(), 1);
        assert!(super::job("forged-output-lease").is_err());
    }
    #[test]
    fn excessive_existing_output_is_rejected_before_writing() {
        let f = Fixture::new();
        let p = f.path("huge.pdf");
        File::create(&p)
            .unwrap()
            .set_len(MAX_PDF as u64 + 1)
            .unwrap();
        assert!(Target::adopt(&p, None).is_err());
        assert!(validate_html("").is_err());
        assert!(validate_html(&"x".repeat(MAX_HTML + 1)).is_err());
    }
    #[test]
    fn replaced_source_and_target_fifos_cannot_block_output_authorization() {
        let f = Fixture::new();
        let fifo = f.path("external-fifo.md");
        let name = std::ffi::CString::new(fifo.to_str().unwrap()).unwrap();
        assert_eq!(unsafe { libc::mkfifo(name.as_ptr(), 0o600) }, 0);
        assert!(output_prepare(Some(fifo.to_string_lossy().into_owned()), Format::Html).is_err());
        assert!(Target::adopt(&fifo, None).is_err());
    }
}
