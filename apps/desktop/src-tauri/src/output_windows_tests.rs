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

#[test]
fn sharing_failure_keeps_old_output_and_cleans_only_owned_stage() {
    use std::os::windows::fs::OpenOptionsExt;
    let f = Fixture::new();
    let p = f.path("locked.html");
    fs::write(&p, "external original").unwrap();
    let target = Target::adopt(&p, None).unwrap();
    let external = fs::OpenOptions::new()
        .read(true)
        .share_mode(1 | 2)
        .open(&p)
        .unwrap();
    assert!(target.publish(&active(None), b"replacement").is_err());
    assert_eq!(fs::read(&p).unwrap(), b"external original");
    assert_eq!(fs::read_dir(&f.0).unwrap().count(), 1);
    drop(external);
    drop(target);
    Target::adopt(&p, None)
        .unwrap()
        .publish(&active(None), b"retry after new authorization")
        .unwrap();
    assert_eq!(fs::read(&p).unwrap(), b"retry after new authorization");
}

#[test]
fn cancellation_after_staging_preserves_destination_and_removes_stage() {
    let f = Fixture::new();
    let p = f.path("cancel-during-stage.html");
    fs::write(&p, "before").unwrap();
    let target = Target::adopt(&p, None).unwrap();
    let job = Arc::new(active(None));
    let state = job.state.lock().unwrap();
    let worker = job.clone();
    let thread = std::thread::spawn(move || target.publish(&worker, b"never publish"));
    let deadline = Instant::now() + Duration::from_secs(5);
    while fs::read_dir(&f.0).unwrap().count() < 2 {
        assert!(Instant::now() < deadline, "stage did not appear");
        std::thread::sleep(Duration::from_millis(5));
    }
    job.cancelled.store(true, Ordering::Release);
    drop(state);
    assert!(thread.join().unwrap().is_err());
    assert_eq!(fs::read(&p).unwrap(), b"before");
    assert_eq!(fs::read_dir(&f.0).unwrap().count(), 1);
}

#[test]
fn replace_keeps_destination_discretionary_permissions() {
    use std::{os::windows::io::AsRawHandle, ptr::null_mut};
    use windows_sys::Win32::{
        Foundation::LocalFree,
        Security::{
            Authorization::{GetSecurityInfo, SE_FILE_OBJECT},
            DACL_SECURITY_INFORMATION,
        },
    };
    fn acl(path: &Path) -> Vec<u8> {
        let file = File::open(path).unwrap();
        let mut dacl = null_mut();
        let mut descriptor = null_mut();
        assert_eq!(
            unsafe {
                GetSecurityInfo(
                    file.as_raw_handle(),
                    SE_FILE_OBJECT,
                    DACL_SECURITY_INFORMATION,
                    null_mut(),
                    null_mut(),
                    &mut dacl,
                    null_mut(),
                    &mut descriptor,
                )
            },
            0
        );
        let result = if dacl.is_null() {
            vec![]
        } else {
            unsafe {
                std::slice::from_raw_parts(dacl.cast::<u8>(), (*dacl).AclSize as usize).to_vec()
            }
        };
        unsafe {
            LocalFree(descriptor);
        }
        result
    }
    let f = Fixture::new();
    let p = f.path("permissions.html");
    fs::write(&p, "old").unwrap();
    let before = acl(&p);
    assert!(!before.is_empty());
    Target::adopt(&p, None)
        .unwrap()
        .publish(&active(None), b"new")
        .unwrap();
    assert_eq!(acl(&p), before);
    assert_eq!(fs::read(&p).unwrap(), b"new");
}

#[test]
fn command_lease_publishes_once_and_abort_prevents_late_write() {
    let f = Fixture::new();
    let source = f.path("document.md");
    fs::write(&source, "原文😀\r\n").unwrap();
    for cancel in [false, true] {
        let destination = f.path(if cancel {
            "cancel.html"
        } else {
            "complete.html"
        });
        let prepared = output_prepare(Some(source.to_str().unwrap().into()), Format::Html).unwrap();
        let lease = job(&prepared.id).unwrap();
        *lease.state.lock().unwrap() =
            JobState::Chosen(Target::adopt(&destination, Some(&source)).unwrap());
        if cancel {
            output_abort(prepared.id.clone()).unwrap();
        }
        let result = tauri::async_runtime::block_on(output_write_html(
            prepared.id.clone(),
            "<p>中文😀</p>".into(),
        ));
        assert_eq!(result.is_ok(), !cancel);
        assert!(tauri::async_runtime::block_on(output_write_html(
            prepared.id.clone(),
            "duplicate".into()
        ))
        .is_err());
        output_abort(prepared.id).unwrap();
        if cancel {
            assert!(!destination.exists());
        } else {
            assert_eq!(fs::read_to_string(destination).unwrap(), "<p>中文😀</p>");
        }
    }
    assert_eq!(fs::read_to_string(source).unwrap(), "原文😀\r\n");
}

#[test]
fn network_device_and_pipe_sources_are_rejected_without_opening_them() {
    for path in [
        r"\\.\pipe\milkup-output-must-not-connect",
        r"\\server\share\source.md",
        r"\\?\UNC\server\share\source.md",
        r"C:\file.md:stream",
    ] {
        assert!(
            output_prepare(Some(path.into()), Format::Html).is_err(),
            "accepted {path}"
        );
        assert!(
            Target::adopt(Path::new(path), None).is_err(),
            "accepted target {path}"
        );
    }
}

#[test]
fn deleted_source_and_open_document_case_aliases_remain_protected() {
    let f = Fixture::new();
    let source = f.path("Original-Ö.md");
    let alias = f.path("original-ö.MD");
    fs::write(&source, "original").unwrap();
    let id = crate::workspace::id("output-deleted-document").unwrap();
    crate::resources::register_document(&id, &source);
    fs::remove_file(&source).unwrap();
    assert!(Target::adopt(&alias, Some(&source)).is_err());
    assert!(Target::adopt(&alias, None).is_err());
    crate::resources::resources_release_document(id).unwrap();
    // A different directory with the same name does not alias the source.
    let other = f.path("other");
    fs::create_dir(&other).unwrap();
    assert!(Target::adopt(&other.join("original-ö.MD"), Some(&source)).is_ok());
    assert!(!alias.exists());
}

#[test]
fn junction_ancestor_cannot_redirect_output_into_another_directory() {
    use std::{
        ffi::c_void,
        os::windows::{fs::OpenOptionsExt, io::AsRawHandle},
        ptr::null_mut,
    };
    type Handle = *mut c_void;
    #[link(name = "kernel32")]
    extern "system" {
        fn DeviceIoControl(
            device: Handle,
            code: u32,
            input: *const c_void,
            input_size: u32,
            output: *mut c_void,
            output_size: u32,
            returned: *mut u32,
            overlapped: *mut c_void,
        ) -> i32;
    }
    // Mount-point junction creation needs no symlink privilege. Failure is a test
    // failure, never a skipped security assertion. Only generated temp paths used.
    fn junction(link: &Path, target: &Path) {
        std::fs::create_dir(link).unwrap();
        let canonical = target.canonicalize().unwrap();
        let canonical = canonical.to_str().unwrap();
        let print = canonical.strip_prefix("\\\\?\\").unwrap_or(canonical);
        let substitute: Vec<u16> = format!("\\??\\{print}").encode_utf16().collect();
        let print: Vec<u16> = print.encode_utf16().collect();
        let mut data = Vec::new();
        data.extend_from_slice(&0xa0000003u32.to_le_bytes()); // IO_REPARSE_TAG_MOUNT_POINT
        data.extend_from_slice(
            &((8 + (substitute.len() + print.len() + 2) * 2) as u16).to_le_bytes(),
        );
        data.extend_from_slice(&0u16.to_le_bytes());
        data.extend_from_slice(&0u16.to_le_bytes());
        data.extend_from_slice(&((substitute.len() * 2) as u16).to_le_bytes());
        data.extend_from_slice(&(((substitute.len() + 1) * 2) as u16).to_le_bytes());
        data.extend_from_slice(&((print.len() * 2) as u16).to_le_bytes());
        for c in substitute
            .into_iter()
            .chain(Some(0))
            .chain(print)
            .chain(Some(0))
        {
            data.extend_from_slice(&c.to_le_bytes());
        }
        let file = std::fs::OpenOptions::new()
            .write(true)
            .custom_flags(0x02000000 | 0x00200000)
            .open(link)
            .unwrap();
        let mut returned = 0;
        assert_ne!(
            unsafe {
                DeviceIoControl(
                    file.as_raw_handle(),
                    0x000900a4,
                    data.as_ptr().cast(),
                    data.len() as u32,
                    null_mut(),
                    0,
                    &mut returned,
                    null_mut(),
                )
            },
            0,
            "junction creation failed: {}",
            std::io::Error::last_os_error()
        );
    }

    let root = Fixture::new();
    let external = Fixture::new();
    let target = external.path("keep.html");
    fs::write(&target, "external original").unwrap();
    let link = root.path("redirect");
    junction(&link, &external.0);
    assert!(Target::adopt(&link.join("keep.html"), None).is_err());
    assert!(Target::adopt(&link.join("new.html"), None).is_err());
    assert_eq!(fs::read(&target).unwrap(), b"external original");
    assert_eq!(fs::read_dir(&external.0).unwrap().count(), 1);
    fs::remove_dir(link).unwrap();
}
