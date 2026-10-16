//! Session-scoped filesystem capabilities for the optional workspace plugin.
//! Paths never authorize IPC operations. Directory iteration is incremental and
//! bounded; file reads use a verified descriptor, not a later path reopen.
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
#[cfg(windows)]
use std::fs::OpenOptions;
use std::fs::{self, File, ReadDir};
use std::io::{self, Read, Seek, SeekFrom};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::UNIX_EPOCH;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

const DEFAULT_PAGE: usize = 100;
const MAX_PAGE: usize = 200;
const SCAN_BUDGET: usize = 512;
const MAX_ROOTS: usize = 8;
const MAX_CURSORS: usize = 16;
const MAX_ENTRIES: usize = 8192;
const MAX_OPENS: usize = 8;
const MAX_SCOPES: usize = 16;
const MAX_DEPTH: usize = 64;
const MAX_RELATIVE_BYTES: usize = 4096;
const ORDINARY_READ_LIMIT: u64 = 16 * 1024 * 1024;
type Result<T> = std::result::Result<T, String>;
fn err(error: impl std::fmt::Display) -> String {
    error.to_string()
}
pub(crate) fn id(kind: &str) -> Result<String> {
    static NEXT: AtomicU64 = AtomicU64::new(0);
    static SECRET: OnceLock<Result<[u8; 32]>> = OnceLock::new();
    let secret = SECRET
        .get_or_init(|| {
            let mut bytes = [0; 32];
            #[cfg(unix)]
            File::open("/dev/urandom")
                .and_then(|mut file| file.read_exact(&mut bytes))
                .map_err(err)?;
            #[cfg(windows)]
            {
                #[link(name = "bcrypt")]
                extern "system" {
                    fn BCryptGenRandom(
                        algorithm: *mut std::ffi::c_void,
                        output: *mut u8,
                        count: u32,
                        flags: u32,
                    ) -> i32;
                }
                if unsafe {
                    BCryptGenRandom(
                        std::ptr::null_mut(),
                        bytes.as_mut_ptr(),
                        bytes.len() as u32,
                        2,
                    )
                } < 0
                {
                    return Err("Workspace token entropy unavailable".into());
                }
            }
            Ok(bytes)
        })
        .as_ref()
        .map_err(Clone::clone)?;
    let mut hash = Sha256::new();
    hash.update(secret);
    hash.update(kind);
    hash.update(NEXT.fetch_add(1, Ordering::Relaxed).to_le_bytes());
    Ok(format!("{kind}-{:x}", hash.finalize()))
}

#[derive(Clone, Debug, Serialize)]
pub(crate) struct WorkspaceRoot {
    pub id: String,
    pub key: String,
    pub label: String,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceEntry {
    pub id: String,
    pub name: String,
    pub kind: &'static str,
    pub relative_path: String,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspacePage {
    pub entries: Vec<WorkspaceEntry>,
    pub next_cursor: Option<String>,
    pub scanned: usize,
    pub skipped: usize,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PreparedOpen {
    pub id: String,
    pub path: String,
    pub size_bytes: u64,
    pub readonly: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct Stamp {
    identity: (u64, u64),
    size: u64,
    modified: u128,
    changed: i128,
}
fn stamp(file: &File) -> Result<Stamp> {
    let metadata = file.metadata().map_err(err)?;
    let modified = metadata
        .modified()
        .map_err(err)?
        .duration_since(UNIX_EPOCH)
        .map_err(err)?
        .as_nanos();
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        Ok(Stamp {
            identity: (metadata.dev(), metadata.ino()),
            size: metadata.len(),
            modified,
            changed: metadata.ctime() as i128 * 1_000_000_000 + metadata.ctime_nsec() as i128,
        })
    }
    #[cfg(windows)]
    {
        Ok(Stamp {
            identity: windows_identity(file)?,
            size: metadata.len(),
            modified,
            changed: 0,
        })
    }
    #[cfg(not(any(unix, windows)))]
    {
        Err("Workspace handles are unsupported on this platform".into())
    }
}

struct CheckedPath {
    file: File,
    ancestors: Vec<(String, Stamp)>,
    _guards: Vec<File>,
}
#[derive(Clone)]
struct EntryRecord {
    public: WorkspaceEntry,
    stamp: Stamp,
    ancestors: Vec<(String, Stamp)>,
}
struct Root {
    public: WorkspaceRoot,
    path: PathBuf,
    file: File,
    baseline: Stamp,
    _guards: Vec<File>,
    active: AtomicBool,
    entries: Mutex<HashMap<String, EntryRecord>>,
    cursors: Mutex<HashMap<String, Arc<Cursor>>>,
}
struct Cursor {
    id: String,
    directory: EntryRecord,
    cancelled: AtomicBool,
    scan: Mutex<ReadDir>,
    _handle: File,
    _guards: Vec<File>,
}
struct OpenLease {
    root: Arc<Root>,
    entry: EntryRecord,
    file: Mutex<File>,
    active: AtomicBool,
    used: AtomicBool,
    ready: AtomicBool,
    prepared_document: Mutex<Option<String>>,
    _guards: Vec<File>,
}
#[derive(Default)]
struct Scope {
    roots: HashMap<String, Arc<Root>>,
    opens: HashMap<String, Arc<OpenLease>>,
}
#[derive(Default)]
pub(crate) struct WorkspaceRegistry(Mutex<HashMap<String, Scope>>);

fn relative_components(relative: &str) -> Result<Vec<&str>> {
    if relative.is_empty()
        || relative.len() > MAX_RELATIVE_BYTES
        || relative.contains(['\\', ':'])
        || relative.chars().any(|ch| ch <= '\u{1f}' || ch == '\u{7f}')
        || relative.starts_with('/')
    {
        return Err("Workspace path must be a bounded relative path".into());
    }
    let parts: Vec<_> = relative.split('/').collect();
    if parts.len() > MAX_DEPTH
        || parts.iter().any(|part| {
            part.is_empty() || *part == "." || *part == ".." || part.ends_with(['.', ' '])
        })
    {
        return Err("Workspace path contains an invalid component".into());
    }
    Ok(parts)
}
fn supported(path: &Path) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .is_some_and(|extension| {
            matches!(
                extension.to_ascii_lowercase().as_str(),
                "md" | "markdown" | "mdown" | "mkd"
            )
        })
}

#[cfg(unix)]
pub(crate) fn open_child(
    parent: &File,
    _parent_path: &Path,
    name: &std::ffi::OsStr,
    directory: bool,
) -> io::Result<File> {
    use std::os::fd::{AsRawFd, FromRawFd};
    use std::os::unix::ffi::OsStrExt;
    let name = std::ffi::CString::new(name.as_bytes())
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "NUL path"))?;
    let flags = libc::O_RDONLY
        | libc::O_CLOEXEC
        | libc::O_NOFOLLOW
        | libc::O_NONBLOCK
        | if directory { libc::O_DIRECTORY } else { 0 };
    // The parent descriptor anchors traversal even if an ancestor is renamed.
    let fd = unsafe { libc::openat(parent.as_raw_fd(), name.as_ptr(), flags) };
    if fd < 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(unsafe { File::from_raw_fd(fd) })
    }
}
#[cfg(windows)]
pub(crate) fn open_child(
    _parent: &File,
    parent_path: &Path,
    name: &std::ffi::OsStr,
    directory: bool,
) -> io::Result<File> {
    use std::os::windows::fs::{MetadataExt, OpenOptionsExt};
    // Ancestors remain open without FILE_SHARE_DELETE until the leaf is opened.
    let path = parent_path.join(name);
    let file = OpenOptions::new()
        .read(true)
        .share_mode(if directory { 1 | 2 } else { 1 | 2 | 4 })
        .custom_flags(0x00200000 | 0x02000000)
        .open(&path)?;
    if file.metadata()?.file_attributes() & 0x400 != 0 {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "Workspace reparse points are not followed",
        ));
    }
    if !directory && file.metadata()?.is_dir() {
        let locked = OpenOptions::new()
            .read(true)
            .share_mode(1 | 2)
            .custom_flags(0x00200000 | 0x02000000)
            .open(&path)?;
        if locked.metadata()?.file_attributes() & 0x400 != 0
            || windows_identity(&locked).map_err(io::Error::other)?
                != windows_identity(&file).map_err(io::Error::other)?
        {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "Workspace directory changed during open",
            ));
        }
        return Ok(locked);
    }
    Ok(file)
}
#[cfg(windows)]
pub(crate) fn windows_identity(file: &File) -> Result<(u64, u64)> {
    use std::os::windows::io::AsRawHandle;
    #[repr(C)]
    struct Info {
        attributes: u32,
        creation: [u32; 2],
        access: [u32; 2],
        write: [u32; 2],
        volume: u32,
        size_high: u32,
        size_low: u32,
        links: u32,
        index_high: u32,
        index_low: u32,
    }
    #[link(name = "kernel32")]
    extern "system" {
        fn GetFileInformationByHandle(handle: *mut std::ffi::c_void, info: *mut Info) -> i32;
    }
    let mut info = std::mem::MaybeUninit::<Info>::uninit();
    if unsafe { GetFileInformationByHandle(file.as_raw_handle(), info.as_mut_ptr()) } == 0 {
        return Err(err(io::Error::last_os_error()));
    }
    let info = unsafe { info.assume_init() };
    Ok((
        info.volume as u64,
        ((info.index_high as u64) << 32) | info.index_low as u64,
    ))
}
pub(crate) fn open_absolute_directory(path: &Path) -> Result<(File, Vec<File>)> {
    if !path.is_absolute() {
        return Err("Workspace root must be absolute".into());
    }
    let mut prefix = PathBuf::new();
    let mut guards = Vec::new();
    let mut current: Option<File> = None;
    for component in path.components() {
        match component {
            Component::Prefix(_) => prefix.push(component.as_os_str()),
            Component::RootDir => {
                prefix.push(component.as_os_str());
                #[cfg(unix)]
                let file = File::open(&prefix).map_err(err)?;
                #[cfg(windows)]
                let file = {
                    use std::os::windows::fs::OpenOptionsExt;
                    OpenOptions::new()
                        .read(true)
                        .share_mode(1 | 2)
                        .custom_flags(0x00200000 | 0x02000000)
                        .open(&prefix)
                        .map_err(err)?
                };
                current = Some(file);
            }
            Component::Normal(name) => {
                let parent = current.take().ok_or("Missing absolute workspace anchor")?;
                let child = open_child(&parent, &prefix, name, true).map_err(err)?;
                if !child.metadata().map_err(err)?.is_dir() {
                    return Err("Workspace ancestor is not a directory".into());
                }
                guards.push(parent);
                current = Some(child);
                prefix.push(name);
            }
            _ => return Err("Workspace root contains relative components".into()),
        }
    }
    Ok((current.ok_or("Missing workspace root")?, guards))
}
impl Root {
    fn ensure_active(&self) -> Result<()> {
        if self.active.load(Ordering::Acquire) {
            Ok(())
        } else {
            Err("Workspace root was released or refreshed".into())
        }
    }
    fn check_root(&self, strict: bool) -> Result<()> {
        self.ensure_active()?;
        let (current, _) = open_absolute_directory(&self.path)?;
        let current = stamp(&current)?;
        if current.identity != self.baseline.identity || (strict && current != self.baseline) {
            return Err("Workspace root changed; refresh or choose it again".into());
        }
        Ok(())
    }
    fn open_relative(&self, relative: &str) -> Result<Option<CheckedPath>> {
        let parts = relative_components(relative)?;
        self.check_root(false)?;
        let mut current = self.file.try_clone().map_err(err)?;
        let mut path = self.path.clone();
        let mut relative_parent = String::new();
        let mut ancestors = vec![(String::new(), stamp(&current)?)];
        let mut guards = Vec::new();
        for (index, part) in parts.iter().enumerate() {
            let next = match open_child(
                &current,
                &path,
                std::ffi::OsStr::new(part),
                index + 1 < parts.len(),
            ) {
                Ok(file) => file,
                Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
                Err(error) => {
                    return Err(format!("Workspace path is unavailable or unsafe: {error}"))
                }
            };
            guards.push(current);
            current = next;
            path.push(part);
            if !relative_parent.is_empty() {
                relative_parent.push('/');
            }
            relative_parent.push_str(part);
            if index + 1 < parts.len() {
                if !current.metadata().map_err(err)?.is_dir() {
                    return Err("Workspace ancestor is not a directory".into());
                }
                ancestors.push((relative_parent.clone(), stamp(&current)?));
            }
        }
        Ok(Some(CheckedPath {
            file: current,
            ancestors,
            _guards: guards,
        }))
    }
    fn validate(&self, entry: &EntryRecord) -> Result<CheckedPath> {
        let checked = if entry.public.relative_path.is_empty() {
            self.check_root(false)?;
            CheckedPath {
                file: self.file.try_clone().map_err(err)?,
                ancestors: Vec::new(),
                _guards: Vec::new(),
            }
        } else {
            self.open_relative(&entry.public.relative_path)?
                .ok_or("Workspace entry was deleted")?
        };
        let current = stamp(&checked.file)?;
        let target_changed = if entry.public.kind == "directory" {
            current.identity != entry.stamp.identity
        } else {
            current != entry.stamp
        };
        let ancestors_changed = checked.ancestors.len() != entry.ancestors.len()
            || checked.ancestors.iter().zip(&entry.ancestors).any(
                |((path, stamp), (old_path, old_stamp))| {
                    path != old_path || stamp.identity != old_stamp.identity
                },
            );
        if target_changed || ancestors_changed {
            return Err("Workspace entry or ancestor was replaced; refresh required".into());
        }
        Ok(checked)
    }
    fn root_entry(&self) -> EntryRecord {
        EntryRecord {
            public: WorkspaceEntry {
                id: self.public.id.clone(),
                name: self.public.label.clone(),
                kind: "directory",
                relative_path: String::new(),
            },
            stamp: self.baseline.clone(),
            ancestors: Vec::new(),
        }
    }
    fn resolve(&self, relative: &str) -> Result<Option<WorkspaceEntry>> {
        let Some(checked) = self.open_relative(relative)? else {
            return Ok(None);
        };
        let metadata = checked.file.metadata().map_err(err)?;
        let kind = if metadata.is_dir() {
            "directory"
        } else if metadata.is_file() && supported(Path::new(relative)) {
            "file"
        } else {
            return Err("Unsupported workspace entry type".into());
        };
        let entry = EntryRecord {
            public: WorkspaceEntry {
                id: id("entry")?,
                name: relative.rsplit('/').next().unwrap().into(),
                kind,
                relative_path: relative.into(),
            },
            stamp: stamp(&checked.file)?,
            ancestors: checked.ancestors,
        };
        self.ensure_active()?;
        let mut entries = self.entries.lock().map_err(err)?;
        if entries.len() >= MAX_ENTRIES {
            return Err("Workspace entry budget reached; refresh required".into());
        }
        entries.insert(entry.public.id.clone(), entry.clone());
        Ok(Some(entry.public))
    }
}

impl WorkspaceRegistry {
    fn create_scope(&self) -> Result<String> {
        let mut scopes = self.0.lock().map_err(err)?;
        if scopes.len() >= MAX_SCOPES {
            return Err("Workspace scope budget reached".into());
        }
        let key = id("scope")?;
        scopes.insert(key.clone(), Scope::default());
        Ok(key)
    }
    fn root(&self, scope_id: &str, root_id: &str) -> Result<Arc<Root>> {
        self.0
            .lock()
            .map_err(err)?
            .get(scope_id)
            .and_then(|scope| scope.roots.get(root_id))
            .cloned()
            .ok_or("Unknown or released workspace root".into())
    }
    fn adopt_selected(&self, scope_id: &str, selected: &Path) -> Result<WorkspaceRoot> {
        // Only the native picker (or in-module tests) calls this path-taking method.
        let (selected_file, _) = open_absolute_directory(selected)?;
        let path = selected.canonicalize().map_err(err)?;
        let (file, guards) = open_absolute_directory(&path)?;
        let baseline = stamp(&file)?;
        if baseline.identity != stamp(&selected_file)?.identity {
            return Err("Selected workspace root changed".into());
        }
        let mut hash = Sha256::new();
        hash.update(path.as_os_str().as_encoded_bytes());
        hash.update(baseline.identity.0.to_le_bytes());
        hash.update(baseline.identity.1.to_le_bytes());
        let public = WorkspaceRoot {
            id: id("root")?,
            key: format!("{:x}", hash.finalize()),
            label: path
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("Workspace")
                .into(),
        };
        let root = Arc::new(Root {
            public: public.clone(),
            path,
            file,
            baseline,
            _guards: guards,
            active: AtomicBool::new(true),
            entries: Mutex::new(HashMap::new()),
            cursors: Mutex::new(HashMap::new()),
        });
        let mut scopes = self.0.lock().map_err(err)?;
        let scope = scopes
            .get_mut(scope_id)
            .ok_or("Workspace scope was released")?;
        if scope.roots.len() >= MAX_ROOTS {
            return Err("Workspace root budget reached".into());
        }
        scope.roots.insert(public.id.clone(), root);
        Ok(public)
    }
    fn revoke_root(&self, scope_id: &str, root_id: &str) -> Result<Vec<String>> {
        let mut scopes = self.0.lock().map_err(err)?;
        let Some(scope) = scopes.get_mut(scope_id) else {
            return Ok(Vec::new());
        };
        if let Some(root) = scope.roots.remove(root_id) {
            root.active.store(false, Ordering::Release);
            root.cursors.lock().map_err(err)?.clear();
        }
        let ids: Vec<_> = scope
            .opens
            .iter()
            .filter(|(_, lease)| lease.root.public.id == root_id)
            .map(|(id, _)| id.clone())
            .collect();
        let mut documents = Vec::new();
        for id in ids {
            if let Some(lease) = scope.opens.remove(&id) {
                lease.active.store(false, Ordering::Release);
                if let Some(document) = lease.prepared_document.lock().map_err(err)?.take() {
                    documents.push(document);
                }
            }
        }
        Ok(documents)
    }
    fn revoke_scope(&self, scope_id: &str) -> Result<Vec<String>> {
        let Some(scope) = self.0.lock().map_err(err)?.remove(scope_id) else {
            return Ok(Vec::new());
        };
        for root in scope.roots.values() {
            root.active.store(false, Ordering::Release);
            root.cursors.lock().map_err(err)?.clear();
        }
        let mut documents = Vec::new();
        for lease in scope.opens.values() {
            lease.active.store(false, Ordering::Release);
            if let Some(document) = lease.prepared_document.lock().map_err(err)?.take() {
                documents.push(document);
            }
        }
        Ok(documents)
    }
    fn list(
        &self,
        scope_id: &str,
        root_id: &str,
        directory_id: Option<&str>,
        cursor_id: Option<&str>,
        limit: Option<usize>,
    ) -> Result<WorkspacePage> {
        let limit = limit.unwrap_or(DEFAULT_PAGE);
        if limit == 0 || limit > MAX_PAGE {
            return Err("Workspace page size must be between 1 and 200".into());
        }
        let root = self.root(scope_id, root_id)?;
        let cursor = if let Some(cursor_id) = cursor_id {
            let cursor = root
                .cursors
                .lock()
                .map_err(err)?
                .get(cursor_id)
                .cloned()
                .ok_or("Unknown or cancelled workspace cursor")?;
            if directory_id.is_some_and(|id| id != cursor.directory.public.id) {
                return Err("Workspace cursor belongs to another directory".into());
            }
            cursor
        } else {
            let mut directory = if let Some(id) = directory_id {
                root.entries
                    .lock()
                    .map_err(err)?
                    .get(id)
                    .cloned()
                    .ok_or("Unknown workspace directory")?
            } else {
                root.root_entry()
            };
            if directory.public.kind != "directory" {
                return Err("Workspace entry is not a directory".into());
            }
            let checked = root.validate(&directory)?;
            directory.stamp = stamp(&checked.file)?;
            #[cfg(target_os = "linux")]
            let scan = {
                use std::os::fd::AsRawFd;
                fs::read_dir(format!("/proc/self/fd/{}", checked.file.as_raw_fd())).map_err(err)?
            };
            #[cfg(all(unix, not(target_os = "linux")))]
            let scan = {
                use std::os::fd::AsRawFd;
                fs::read_dir(format!("/dev/fd/{}", checked.file.as_raw_fd())).map_err(err)?
            };
            #[cfg(windows)]
            let scan =
                fs::read_dir(root.path.join(&directory.public.relative_path)).map_err(err)?;
            let cursor = Arc::new(Cursor {
                id: id("cursor")?,
                directory,
                cancelled: AtomicBool::new(false),
                scan: Mutex::new(scan),
                _handle: checked.file,
                _guards: checked._guards,
            });
            let mut cursors = root.cursors.lock().map_err(err)?;
            if cursors.len() >= MAX_CURSORS {
                return Err("Workspace cursor budget reached; cancel unused listings".into());
            }
            cursors.insert(cursor.id.clone(), cursor.clone());
            cursor
        };
        let result = (|| {
            if cursor.cancelled.load(Ordering::Acquire) {
                return Err("Workspace listing was cancelled".into());
            }
            if stamp(&root.validate(&cursor.directory)?.file)? != cursor.directory.stamp {
                return Err("Workspace directory changed; restart listing".into());
            }
            let mut entries = Vec::new();
            let mut scanned = 0;
            let mut skipped = 0;
            let mut done = false;
            let mut scan = cursor
                .scan
                .try_lock()
                .map_err(|_| "Workspace cursor already has a page in flight")?;
            while entries.len() < limit && scanned < SCAN_BUDGET {
                root.ensure_active()?;
                if cursor.cancelled.load(Ordering::Acquire) {
                    return Err("Workspace listing was cancelled".into());
                }
                let Some(next) = scan.next() else {
                    done = true;
                    break;
                };
                scanned += 1;
                let next = match next {
                    Ok(next) => next,
                    Err(_) => {
                        skipped += 1;
                        continue;
                    }
                };
                let Some(name) = next.file_name().to_str().map(str::to_owned) else {
                    skipped += 1;
                    continue;
                };
                let relative = if cursor.directory.public.relative_path.is_empty() {
                    name
                } else {
                    format!("{}/{}", cursor.directory.public.relative_path, name)
                };
                if relative_components(&relative).is_err() {
                    skipped += 1;
                    continue;
                }
                // No follow: unsupported links, devices, sockets and files are skipped.
                let kind = match next.file_type() {
                    Ok(kind) => kind,
                    Err(_) => {
                        skipped += 1;
                        continue;
                    }
                };
                if kind.is_symlink()
                    || (!kind.is_dir() && !(kind.is_file() && supported(Path::new(&relative))))
                {
                    skipped += 1;
                    continue;
                }
                match root.resolve(&relative) {
                    Ok(Some(entry)) => entries.push(entry),
                    Ok(None) => skipped += 1,
                    Err(error) if error.contains("budget") => return Err(error),
                    Err(_) => skipped += 1,
                }
            }
            if stamp(&root.validate(&cursor.directory)?.file)? != cursor.directory.stamp {
                return Err("Workspace directory changed; restart listing".into());
            }
            if cursor.cancelled.load(Ordering::Acquire) {
                return Err("Workspace listing was cancelled".into());
            }
            Ok(WorkspacePage {
                entries,
                next_cursor: if done { None } else { Some(cursor.id.clone()) },
                scanned,
                skipped,
            })
        })();
        if result
            .as_ref()
            .map_or(true, |page| page.next_cursor.is_none())
        {
            root.cursors.lock().map_err(err)?.remove(&cursor.id);
        }
        result
    }
    fn cancel_cursor(&self, scope_id: &str, cursor_id: &str) -> Result<()> {
        let roots: Vec<_> = self
            .0
            .lock()
            .map_err(err)?
            .get(scope_id)
            .map(|scope| scope.roots.values().cloned().collect())
            .unwrap_or_default();
        for root in roots {
            if let Some(cursor) = root.cursors.lock().map_err(err)?.remove(cursor_id) {
                cursor.cancelled.store(true, Ordering::Release);
            }
        }
        Ok(())
    }
    fn prepare(&self, scope_id: &str, file_id: &str) -> Result<PreparedOpen> {
        let roots: Vec<_> = self
            .0
            .lock()
            .map_err(err)?
            .get(scope_id)
            .ok_or("Unknown workspace scope")?
            .roots
            .values()
            .cloned()
            .collect();
        let mut found = None;
        for root in roots {
            let entry = root.entries.lock().map_err(err)?.get(file_id).cloned();
            if let Some(entry) = entry {
                found = Some((root, entry));
                break;
            }
        }
        let (root, entry) = found.ok_or("Unknown or stale workspace file")?;
        if entry.public.kind != "file" {
            return Err("Workspace entry is not a file".into());
        }
        let checked = root.validate(&entry)?;
        let metadata = checked.file.metadata().map_err(err)?;
        let public = PreparedOpen {
            id: id("open")?,
            path: root
                .path
                .join(&entry.public.relative_path)
                .to_str()
                .ok_or("Workspace path is not Unicode")?
                .into(),
            size_bytes: metadata.len(),
            readonly: metadata.permissions().readonly(),
        };
        let lease = Arc::new(OpenLease {
            root,
            entry,
            file: Mutex::new(checked.file),
            _guards: checked._guards,
            active: AtomicBool::new(true),
            used: AtomicBool::new(false),
            ready: AtomicBool::new(false),
            prepared_document: Mutex::new(None),
        });
        let mut scopes = self.0.lock().map_err(err)?;
        let scope = scopes
            .get_mut(scope_id)
            .ok_or("Workspace scope was released")?;
        lease.root.ensure_active()?;
        if scope.opens.len() >= MAX_OPENS {
            return Err("Workspace open budget reached".into());
        }
        scope.opens.insert(public.id.clone(), lease);
        Ok(public)
    }
    fn lease(&self, scope_id: &str, open_id: &str) -> Result<Arc<OpenLease>> {
        self.0
            .lock()
            .map_err(err)?
            .get(scope_id)
            .and_then(|scope| scope.opens.get(open_id))
            .cloned()
            .ok_or("Unknown or released workspace open".into())
    }
    fn finish(&self, scope_id: &str, open_id: &str, accepted: bool) -> Result<Vec<String>> {
        let mut scopes = self.0.lock().map_err(err)?;
        let lease = scopes
            .get(scope_id)
            .and_then(|scope| scope.opens.get(open_id))
            .cloned();
        let Some(lease) = lease else {
            return if accepted {
                Err("Workspace open was released".into())
            } else {
                Ok(Vec::new())
            };
        };
        if accepted
            && (!lease.ready.load(Ordering::Acquire)
                || !lease.active.load(Ordering::Acquire)
                || !lease.root.active.load(Ordering::Acquire))
        {
            return Err("Workspace open is not ready or was revoked".into());
        }
        scopes.get_mut(scope_id).unwrap().opens.remove(open_id);
        lease.active.store(false, Ordering::Release);
        let document = lease.prepared_document.lock().map_err(err)?.take();
        Ok(if accepted {
            Vec::new()
        } else {
            document.into_iter().collect()
        })
    }
}
impl OpenLease {
    fn ensure_active(&self) -> Result<()> {
        if !self.active.load(Ordering::Acquire) {
            return Err("Workspace open was cancelled".into());
        }
        self.root.ensure_active()
    }
    fn check(&self) -> Result<()> {
        if !self.active.load(Ordering::Acquire) {
            return Err("Workspace open was cancelled".into());
        }
        self.root.validate(&self.entry)?;
        Ok(())
    }
    fn take_reader(&self) -> Result<File> {
        self.check()?;
        if self.used.swap(true, Ordering::AcqRel) {
            return Err("Workspace open has already been consumed".into());
        }
        let file = self.file.lock().map_err(err)?.try_clone().map_err(err)?;
        if stamp(&file)? != self.entry.stamp {
            return Err("Workspace file changed before reading".into());
        }
        Ok(file)
    }
}

fn cleanup_documents(registry: &super::LargeFileRegistry, documents: Vec<String>) -> Result<()> {
    let mut stores = registry.0.lock().map_err(err)?;
    for document in documents {
        if let Some(mut store) = stores.remove(&document) {
            store.piece_tree.close()?;
        }
    }
    Ok(())
}
fn scratch_directory() -> Result<Arc<super::piece_tree::WorkingDirectory>> {
    let path = std::env::temp_dir().join(id("milkup-workspace")?);
    let mut builder = fs::DirBuilder::new();
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    builder.create(&path).map_err(err)?;
    Ok(Arc::new(super::piece_tree::WorkingDirectory(path)))
}
fn read_lease(
    registry: &WorkspaceRegistry,
    scope_id: &str,
    open_id: &str,
    document_id: String,
) -> Result<super::OpenFileResult> {
    let lease = registry.lease(scope_id, open_id)?;
    let mut file = lease.take_reader()?;
    file.seek(SeekFrom::Start(0)).map_err(err)?;
    let mut text = String::new();
    file.take(ORDINARY_READ_LIMIT + 1)
        .read_to_string(&mut text)
        .map_err(err)?;
    if text.len() as u64 > ORDINARY_READ_LIMIT {
        return Err("Workspace file exceeds ordinary read budget; use large-file open".into());
    }
    lease.check()?;
    lease.ready.store(true, Ordering::Release);
    Ok(super::OpenFileResult {
        document_id,
        file: super::DocumentFileIdentity {
            path: lease
                .root
                .path
                .join(&lease.entry.public.relative_path)
                .to_str()
                .ok_or("Workspace path is not Unicode")?
                .into(),
        },
        disk_snapshot_hash: super::snapshot_hash(&text),
        text,
    })
}
fn open_large_lease(
    registry: &WorkspaceRegistry,
    large: &super::LargeFileRegistry,
    scope_id: &str,
    open_id: &str,
    document_id: String,
) -> Result<super::LargeFileOpenResult> {
    let lease = registry.lease(scope_id, open_id)?;
    let prepared = prepare_large(&lease)?;
    publish_large(
        registry,
        large,
        scope_id,
        open_id,
        document_id,
        &lease,
        prepared,
    )
}
struct PreparedLarge {
    tree: super::piece_tree::PieceTree,
    disk_snapshot_hash: String,
    path: String,
}
fn prepare_large(lease: &OpenLease) -> Result<PreparedLarge> {
    let mut file = lease.take_reader()?;
    file.seek(SeekFrom::Start(0)).map_err(err)?;
    let disk_snapshot_hash =
        super::hash_open_file_contents_with_progress(&mut file, || lease.ensure_active())?;
    file.seek(SeekFrom::Start(0)).map_err(err)?;
    lease.check()?;
    let directory = scratch_directory()?;
    // Source bytes arrive through the verified handle; all temporary writes stay
    // in a newly-created private directory, never under a mutable source path.
    let mut tree = super::piece_tree::PieceTree::open_from_file_with_progress(
        &directory.0.join("source.md"),
        file,
        directory.0.join("append.work"),
        || lease.ensure_active(),
    )?;
    tree.retain_working_directory(directory);
    lease.check()?;
    let path = lease
        .root
        .path
        .join(&lease.entry.public.relative_path)
        .to_str()
        .ok_or("Workspace path is not Unicode")?
        .to_owned();
    Ok(PreparedLarge {
        tree,
        disk_snapshot_hash,
        path,
    })
}
fn publish_large(
    registry: &WorkspaceRegistry,
    large: &super::LargeFileRegistry,
    scope_id: &str,
    open_id: &str,
    document_id: String,
    lease: &Arc<OpenLease>,
    prepared: PreparedLarge,
) -> Result<super::LargeFileOpenResult> {
    let PreparedLarge {
        tree,
        disk_snapshot_hash,
        path,
    } = prepared;
    let size_bytes = tree.byte_len();
    let line_count = tree.line_count();
    // Serialize publication with revocation. No descriptor opened in a released
    // scope can insert an orphaned large-file registration after cancellation.
    let scopes = registry.0.lock().map_err(err)?;
    let current = scopes
        .get(scope_id)
        .and_then(|scope| scope.opens.get(open_id))
        .ok_or("Workspace open was released")?;
    if !Arc::ptr_eq(current, lease) || !lease.active.load(Ordering::Acquire) {
        return Err("Workspace open was cancelled".into());
    }
    lease.root.ensure_active()?;
    let mut stores = large.0.lock().map_err(err)?;
    if stores.contains_key(&document_id) {
        return Err("Document ID is already open".into());
    }
    stores.insert(
        document_id.clone(),
        super::LargeFileRegistration {
            path: path.clone(),
            size_bytes,
            piece_tree: tree,
            disk_snapshot_hash,
            version: 0,
            saved_version: 0,
        },
    );
    *lease.prepared_document.lock().map_err(err)? = Some(document_id.clone());
    lease.ready.store(true, Ordering::Release);
    Ok(super::LargeFileOpenResult {
        document_id,
        path,
        version: 0,
        size_bytes,
        line_count,
    })
}

fn transport_error(error: String) -> String {
    let code = if error.contains("budget") || error.contains("page size") {
        "quota"
    } else if error.contains("relative path")
        || error.contains("invalid component")
        || error.contains("unsafe")
        || error.contains("reparse")
    {
        "invalid-path"
    } else if error.contains("changed")
        || error.contains("replaced")
        || error.contains("deleted")
        || error.contains("cursor")
    {
        "invalidated"
    } else if error.contains("released") || error.contains("cancelled") || error.contains("revoked")
    {
        "revoked"
    } else if error.contains("already") || error.contains("in flight") {
        "busy"
    } else if error.contains("Unknown") {
        "invalid-token"
    } else {
        "unavailable"
    };
    format!("[{code}] {error}")
}

#[tauri::command]
pub(crate) fn workspace_create_scope(registry: State<WorkspaceRegistry>) -> Result<String> {
    (|| registry.create_scope())().map_err(transport_error)
}
#[tauri::command]
pub(crate) async fn workspace_choose_root(
    app: AppHandle,
    registry: State<'_, WorkspaceRegistry>,
    scope_id: String,
) -> Result<Option<WorkspaceRoot>> {
    async {
        if !registry.0.lock().map_err(err)?.contains_key(&scope_id) {
            return Err("Unknown workspace scope".into());
        }
        let (send, receive) = tokio::sync::oneshot::channel();
        app.dialog().file().pick_folder(move |selection| {
            let _ = send.send(selection);
        });
        let Some(selected) = receive.await.map_err(err)? else {
            return Ok(None);
        };
        registry
            .adopt_selected(&scope_id, &selected.into_path().map_err(err)?)
            .map(Some)
    }
    .await
    .map_err(transport_error)
}
#[tauri::command]
pub(crate) async fn workspace_list_children(
    registry: State<'_, WorkspaceRegistry>,
    scope_id: String,
    root_id: String,
    directory_id: Option<String>,
    cursor: Option<String>,
    limit: Option<usize>,
) -> Result<WorkspacePage> {
    async {
        registry.list(
            &scope_id,
            &root_id,
            directory_id.as_deref(),
            cursor.as_deref(),
            limit,
        )
    }
    .await
    .map_err(transport_error)
}
#[tauri::command]
pub(crate) fn workspace_resolve_entry(
    registry: State<WorkspaceRegistry>,
    scope_id: String,
    root_id: String,
    relative_path: String,
) -> Result<Option<WorkspaceEntry>> {
    (|| registry.root(&scope_id, &root_id)?.resolve(&relative_path))().map_err(transport_error)
}
#[tauri::command]
pub(crate) fn workspace_refresh_root(
    registry: State<WorkspaceRegistry>,
    large: State<super::LargeFileRegistry>,
    scope_id: String,
    root_id: String,
) -> Result<WorkspaceRoot> {
    (|| {
        let root = registry.root(&scope_id, &root_id)?;
        root.check_root(false)?;
        cleanup_documents(&large, registry.revoke_root(&scope_id, &root_id)?)?;
        registry.adopt_selected(&scope_id, &root.path)
    })()
    .map_err(transport_error)
}
#[tauri::command]
pub(crate) fn workspace_cancel_cursor(
    registry: State<WorkspaceRegistry>,
    scope_id: String,
    cursor: String,
) -> Result<()> {
    (|| registry.cancel_cursor(&scope_id, &cursor))().map_err(transport_error)
}
#[tauri::command]
pub(crate) fn workspace_release_root(
    registry: State<WorkspaceRegistry>,
    large: State<super::LargeFileRegistry>,
    scope_id: String,
    root_id: String,
) -> Result<()> {
    (|| cleanup_documents(&large, registry.revoke_root(&scope_id, &root_id)?))()
        .map_err(transport_error)
}
#[tauri::command]
pub(crate) fn workspace_release_scope(
    registry: State<WorkspaceRegistry>,
    large: State<super::LargeFileRegistry>,
    scope_id: String,
) -> Result<()> {
    (|| cleanup_documents(&large, registry.revoke_scope(&scope_id)?))().map_err(transport_error)
}
#[tauri::command]
pub(crate) fn workspace_prepare_open(
    registry: State<WorkspaceRegistry>,
    scope_id: String,
    file_id: String,
) -> Result<PreparedOpen> {
    (|| registry.prepare(&scope_id, &file_id))().map_err(transport_error)
}
#[tauri::command]
pub(crate) async fn workspace_read_file(
    registry: State<'_, WorkspaceRegistry>,
    scope_id: String,
    open_id: String,
    document_id: String,
) -> Result<super::OpenFileResult> {
    async { read_lease(&registry, &scope_id, &open_id, document_id) }
        .await
        .map_err(transport_error)
}
#[tauri::command]
pub(crate) async fn workspace_open_large_file(
    registry: State<'_, WorkspaceRegistry>,
    large: State<'_, super::LargeFileRegistry>,
    scope_id: String,
    open_id: String,
    document_id: String,
) -> Result<super::LargeFileOpenResult> {
    async { open_large_lease(&registry, &large, &scope_id, &open_id, document_id) }
        .await
        .map_err(transport_error)
}
#[tauri::command]
pub(crate) fn workspace_validate_open(
    registry: State<WorkspaceRegistry>,
    scope_id: String,
    open_id: String,
) -> Result<bool> {
    (|| {
        registry.lease(&scope_id, &open_id)?.check()?;
        Ok(true)
    })()
    .map_err(transport_error)
}
#[tauri::command]
pub(crate) fn workspace_finish_open(
    registry: State<WorkspaceRegistry>,
    large: State<super::LargeFileRegistry>,
    scope_id: String,
    open_id: String,
    accepted: bool,
) -> Result<()> {
    (|| {
        if accepted {
            registry.lease(&scope_id, &open_id)?.check()?;
        }
        cleanup_documents(&large, registry.finish(&scope_id, &open_id, accepted)?)
    })()
    .map_err(transport_error)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;
    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let path = std::env::temp_dir().join(id("workspace-test").unwrap());
            fs::create_dir(&path).unwrap();
            Self(path)
        }
        fn write(&self, relative: &str, text: &str) {
            let path = self.0.join(relative);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, text).unwrap();
        }
        fn register(&self) -> (WorkspaceRegistry, String, WorkspaceRoot) {
            let registry = WorkspaceRegistry::default();
            let scope = registry.create_scope().unwrap();
            let root = registry.adopt_selected(&scope, &self.0).unwrap();
            (registry, scope, root)
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    fn entry(
        registry: &WorkspaceRegistry,
        scope: &str,
        root: &WorkspaceRoot,
        path: &str,
    ) -> WorkspaceEntry {
        registry
            .root(scope, &root.id)
            .unwrap()
            .resolve(path)
            .unwrap()
            .unwrap()
    }
    fn large_registry() -> super::super::LargeFileRegistry {
        super::super::LargeFileRegistry(Mutex::new(HashMap::new()))
    }

    #[test]
    fn opaque_scoped_tokens_and_stable_root_keys_do_not_expose_paths() {
        let fixture = Fixture::new();
        fixture.write("中文 😀/文档.md", "safe");
        let (registry, scope, root) = fixture.register();
        let other_scope = registry.create_scope().unwrap();
        let same = registry.adopt_selected(&other_scope, &fixture.0).unwrap();
        assert_eq!(same.key, root.key);
        assert_ne!(same.id, root.id);
        assert!(!root.id.contains(fixture.0.to_str().unwrap()));
        assert!(registry.root(&other_scope, &root.id).is_err());
        let first = entry(&registry, &scope, &root, "中文 😀/文档.md");
        let second = entry(&registry, &scope, &root, "中文 😀/文档.md");
        assert_ne!(first.id, second.id);
        assert_eq!(first.relative_path, "中文 😀/文档.md");
        assert!(registry.prepare(&other_scope, &first.id).is_err());
        assert!(registry
            .root(&scope, &root.id)
            .unwrap()
            .resolve("missing.md")
            .unwrap()
            .is_none());
    }
    #[test]
    fn rejects_traversal_absolute_ads_control_and_ambiguous_windows_paths() {
        for path in [
            "",
            "../x.md",
            "a/../x.md",
            "/x.md",
            "C:/x.md",
            "a\\x.md",
            "//host/x",
            "a//b",
            "./x",
            "a/.",
            "a/",
            "x.md:stream",
            "a\0b",
            "a\nb",
            "a /x",
            "a./x",
        ] {
            assert!(relative_components(path).is_err(), "{path:?}");
        }
        assert!(relative_components(&"x/".repeat(65)).is_err());
        assert!(relative_components("中文/😀.md").is_ok());
    }
    #[test]
    fn incremental_pagination_has_default_max_and_scan_budgets() {
        let fixture = Fixture::new();
        for n in 0..350 {
            fixture.write(&format!("{n:04}.md"), "x");
        }
        let (registry, scope, root) = fixture.register();
        let mut page = registry.list(&scope, &root.id, None, None, None).unwrap();
        assert_eq!(page.entries.len(), DEFAULT_PAGE);
        let mut names = HashSet::new();
        loop {
            assert!(page.scanned <= SCAN_BUDGET);
            assert!(page.entries.len() <= MAX_PAGE);
            for entry in page.entries {
                assert!(names.insert(entry.name));
            }
            match page.next_cursor {
                Some(cursor) => {
                    page = registry
                        .list(&scope, &root.id, None, Some(&cursor), Some(MAX_PAGE))
                        .unwrap()
                }
                None => break,
            }
        }
        assert_eq!(names.len(), 350);
        assert!(registry
            .list(&scope, &root.id, None, None, Some(201))
            .is_err());
        assert!(registry
            .list(&scope, &root.id, None, None, Some(0))
            .is_err());
    }
    #[test]
    fn sparse_directory_returns_empty_continuation_instead_of_scanning_everything() {
        let fixture = Fixture::new();
        for n in 0..1200 {
            fixture.write(&format!("{n}.bin"), "x");
        }
        let (registry, scope, root) = fixture.register();
        let page = registry.list(&scope, &root.id, None, None, None).unwrap();
        assert!(page.entries.is_empty());
        assert_eq!(page.scanned, SCAN_BUDGET);
        assert_eq!(page.skipped, SCAN_BUDGET);
        assert!(page.next_cursor.is_some());
    }
    #[test]
    fn cancelling_cursor_and_releasing_scope_revoke_existing_tokens() {
        let fixture = Fixture::new();
        fixture.write("a.md", "a");
        fixture.write("b.md", "b");
        let (registry, scope, root) = fixture.register();
        let page = registry
            .list(&scope, &root.id, None, None, Some(1))
            .unwrap();
        let cursor = page.next_cursor.unwrap();
        registry.cancel_cursor(&scope, &cursor).unwrap();
        assert!(registry
            .list(&scope, &root.id, None, Some(&cursor), None)
            .is_err());
        let file = entry(&registry, &scope, &root, "a.md");
        let prepared = registry.prepare(&scope, &file.id).unwrap();
        registry.revoke_scope(&scope).unwrap();
        assert!(registry.prepare(&scope, &file.id).is_err());
        assert!(registry.lease(&scope, &prepared.id).is_err());
        assert!(registry.adopt_selected(&scope, &fixture.0).is_err());
    }
    #[test]
    fn atomic_sibling_save_preserves_file_entry_but_invalidates_old_directory_cursor() {
        let fixture = Fixture::new();
        fixture.write("a.md", "old");
        fixture.write("b.md", "safe b");
        let (registry, scope, root) = fixture.register();
        let b = entry(&registry, &scope, &root, "b.md");
        let page = registry
            .list(&scope, &root.id, None, None, Some(1))
            .unwrap();
        fixture.write("new.tmp", "new");
        fs::rename(fixture.0.join("new.tmp"), fixture.0.join("a.md")).unwrap();
        let prepared = registry.prepare(&scope, &b.id).unwrap();
        assert_eq!(
            read_lease(&registry, &scope, &prepared.id, "b".into())
                .unwrap()
                .text,
            "safe b"
        );
        assert!(registry
            .list(&scope, &root.id, None, page.next_cursor.as_deref(), None)
            .is_err());
        assert_eq!(
            registry
                .list(&scope, &root.id, None, None, None)
                .unwrap()
                .entries
                .len(),
            2
        );
    }
    #[test]
    fn replaced_or_deleted_target_and_replaced_ancestor_invalidate_entry() {
        let fixture = Fixture::new();
        fixture.write("dir/a.md", "old");
        let (registry, scope, root) = fixture.register();
        let file = entry(&registry, &scope, &root, "dir/a.md");
        fixture.write("dir/next.tmp", "new");
        fs::rename(fixture.0.join("dir/next.tmp"), fixture.0.join("dir/a.md")).unwrap();
        assert!(registry.prepare(&scope, &file.id).is_err());
        let file = entry(&registry, &scope, &root, "dir/a.md");
        fs::rename(fixture.0.join("dir"), fixture.0.join("old-dir")).unwrap();
        fixture.write("dir/a.md", "new");
        assert!(registry.prepare(&scope, &file.id).is_err());
        let file = entry(&registry, &scope, &root, "dir/a.md");
        fs::remove_file(fixture.0.join("dir/a.md")).unwrap();
        assert!(registry.prepare(&scope, &file.id).is_err());
        assert!(registry
            .root(&scope, &root.id)
            .unwrap()
            .resolve("dir/a.md")
            .unwrap()
            .is_none());
    }
    #[cfg(unix)]
    #[test]
    fn symlinks_and_symlink_roots_are_not_capabilities() {
        use std::os::unix::fs::symlink;
        let fixture = Fixture::new();
        let outside = Fixture::new();
        outside.write("secret.md", "outside");
        fixture.write("a.md", "inside");
        symlink(&outside.0, fixture.0.join("escape")).unwrap();
        symlink(fixture.0.join("a.md"), fixture.0.join("alias.md")).unwrap();
        let (registry, scope, root) = fixture.register();
        let root_handle = registry.root(&scope, &root.id).unwrap();
        assert!(root_handle.resolve("escape/secret.md").is_err());
        assert!(root_handle.resolve("alias.md").is_err());
        assert_eq!(
            registry
                .list(&scope, &root.id, None, None, None)
                .unwrap()
                .entries
                .len(),
            1
        );
        assert!(registry
            .adopt_selected(&scope, &fixture.0.join("escape"))
            .is_err());
    }
    #[cfg(unix)]
    #[test]
    fn verified_descriptor_never_follows_a_later_ancestor_swap() {
        use std::os::unix::fs::symlink;
        let fixture = Fixture::new();
        let outside = Fixture::new();
        fixture.write("dir/a.md", "inside");
        outside.write("a.md", "outside");
        let (registry, scope, root) = fixture.register();
        let file = entry(&registry, &scope, &root, "dir/a.md");
        let prepared = registry.prepare(&scope, &file.id).unwrap();
        let lease = registry.lease(&scope, &prepared.id).unwrap();
        let mut reader = lease.take_reader().unwrap();
        fs::rename(fixture.0.join("dir"), fixture.0.join("old")).unwrap();
        symlink(&outside.0, fixture.0.join("dir")).unwrap();
        let mut text = String::new();
        reader.read_to_string(&mut text).unwrap();
        assert_eq!(text, "inside");
        assert!(lease.check().is_err());
    }
    #[test]
    fn changed_file_after_prepare_cannot_return_content_or_be_accepted() {
        let fixture = Fixture::new();
        fixture.write("a.md", "old");
        let (registry, scope, root) = fixture.register();
        let file = entry(&registry, &scope, &root, "a.md");
        let prepared = registry.prepare(&scope, &file.id).unwrap();
        fixture.write("a.md", "new content");
        assert!(read_lease(&registry, &scope, &prepared.id, "a".into()).is_err());
        assert!(registry.finish(&scope, &prepared.id, true).is_err());
    }
    #[test]
    fn revoked_open_rejects_late_large_publication_and_removes_working_files() {
        let fixture = Fixture::new();
        fixture.write("a.md", &"中文😀\n".repeat(1000));
        let (registry, scope, root) = fixture.register();
        let file = entry(&registry, &scope, &root, "a.md");
        let prepared = registry.prepare(&scope, &file.id).unwrap();
        let lease = registry.lease(&scope, &prepared.id).unwrap();
        let large = large_registry();
        let pending = prepare_large(&lease).unwrap();
        let work_dir = pending.tree.add_path.parent().unwrap().to_path_buf();
        assert!(work_dir.exists());
        cleanup_documents(&large, registry.revoke_scope(&scope).unwrap()).unwrap();
        assert!(publish_large(
            &registry,
            &large,
            &scope,
            &prepared.id,
            "late".into(),
            &lease,
            pending
        )
        .is_err());
        assert!(large.0.lock().unwrap().is_empty());
        assert!(!work_dir.exists());
    }
    #[test]
    fn prepared_large_cleanup_and_acceptance_keep_existing_document_semantics() {
        let fixture = Fixture::new();
        fixture.write("a.md", "中文😀\nsecond");
        let (registry, scope, root) = fixture.register();
        let file = entry(&registry, &scope, &root, "a.md");
        let large = large_registry();
        let first = registry.prepare(&scope, &file.id).unwrap();
        open_large_lease(&registry, &large, &scope, &first.id, "cancel".into()).unwrap();
        let work = large
            .0
            .lock()
            .unwrap()
            .get("cancel")
            .unwrap()
            .piece_tree
            .add_path
            .parent()
            .unwrap()
            .to_path_buf();
        cleanup_documents(&large, registry.finish(&scope, &first.id, false).unwrap()).unwrap();
        assert!(large.0.lock().unwrap().is_empty());
        assert!(!work.exists());
        let second = registry.prepare(&scope, &file.id).unwrap();
        let opened =
            open_large_lease(&registry, &large, &scope, &second.id, "accepted".into()).unwrap();
        assert_eq!(opened.line_count, 2);
        cleanup_documents(&large, registry.finish(&scope, &second.id, true).unwrap()).unwrap();
        cleanup_documents(&large, registry.revoke_scope(&scope).unwrap()).unwrap();
        let stores = large.0.lock().unwrap();
        assert_eq!(
            stores["accepted"]
                .piece_tree
                .read_range(0, "中文😀".len())
                .unwrap(),
            "中文😀"
        );
        assert_eq!(
            stores["accepted"].path,
            fixture.0.join("a.md").to_str().unwrap()
        );
    }
    #[test]
    fn private_snapshot_can_outlive_the_document_for_recovery_streaming() {
        let fixture = Fixture::new();
        fixture.write("a.md", "safe snapshot");
        let (registry, scope, root) = fixture.register();
        let file = entry(&registry, &scope, &root, "a.md");
        let prepared = registry.prepare(&scope, &file.id).unwrap();
        let large = large_registry();
        open_large_lease(&registry, &large, &scope, &prepared.id, "a".into()).unwrap();
        let (mut snapshot, work) = {
            let stores = large.0.lock().unwrap();
            let tree = &stores["a"].piece_tree;
            (
                tree.snapshot().unwrap(),
                tree.add_path.parent().unwrap().to_path_buf(),
            )
        };
        cleanup_documents(
            &large,
            registry.finish(&scope, &prepared.id, false).unwrap(),
        )
        .unwrap();
        assert!(work.exists());
        let output = fixture.0.join("recovery-copy.md");
        snapshot.write_to(&output).unwrap();
        assert_eq!(fs::read_to_string(output).unwrap(), "safe snapshot");
        drop(snapshot);
        assert!(!work.exists());
    }
    #[test]
    fn utf16_large_file_uses_descriptor_and_existing_encoding_roundtrip() {
        let fixture = Fixture::new();
        let text = "中文😀\r\nnext";
        let bytes: Vec<_> = [0xff, 0xfe]
            .into_iter()
            .chain(text.encode_utf16().flat_map(u16::to_le_bytes))
            .collect();
        fs::write(fixture.0.join("a.md"), bytes).unwrap();
        let (registry, scope, root) = fixture.register();
        let file = entry(&registry, &scope, &root, "a.md");
        let prepared = registry.prepare(&scope, &file.id).unwrap();
        let large = large_registry();
        open_large_lease(&registry, &large, &scope, &prepared.id, "a".into()).unwrap();
        let stores = large.0.lock().unwrap();
        let tree = &stores["a"].piece_tree;
        assert_eq!(
            tree.encoding(),
            super::super::piece_tree::BaseEncoding::Utf16Le
        );
        assert_eq!(tree.read_range(0, tree.byte_len()).unwrap(), text);
    }
    #[test]
    fn root_replacement_changes_stable_key_and_old_tokens_stay_invalid() {
        let fixture = Fixture::new();
        fixture.write("a.md", "a");
        let (registry, scope, root) = fixture.register();
        let moved = fixture.0.with_extension("moved");
        fs::rename(&fixture.0, &moved).unwrap();
        fs::create_dir(&fixture.0).unwrap();
        assert!(registry.list(&scope, &root.id, None, None, None).is_err());
        let replaced = registry.adopt_selected(&scope, &fixture.0).unwrap();
        assert_ne!(replaced.key, root.key);
        fs::remove_dir_all(moved).unwrap();
    }
    #[test]
    fn cancellation_interrupts_snapshot_copy_and_index_and_cleans_partial_work() {
        let source = Fixture::new();
        source.write("large.md", &"x".repeat(1024 * 1024));
        for cancel_at in [3, 20] {
            let staging = Fixture::new();
            let mut checks = 0;
            let result = super::super::piece_tree::PieceTree::open_from_file_with_progress(
                &staging.0.join("source.md"),
                File::open(source.0.join("large.md")).unwrap(),
                staging.0.join("append.work"),
                || {
                    checks += 1;
                    if checks >= cancel_at {
                        Err("cancelled".into())
                    } else {
                        Ok(())
                    }
                },
            );
            assert!(result.is_err());
            assert_eq!(checks, cancel_at);
            assert_eq!(fs::read_dir(&staging.0).unwrap().count(), 0);
        }
    }
    #[test]
    fn cancellation_interrupts_hash_at_the_next_bounded_chunk() {
        let fixture = Fixture::new();
        fixture.write("large.md", &"x".repeat(1024 * 1024));
        let mut file = File::open(fixture.0.join("large.md")).unwrap();
        let mut checks = 0;
        let result = super::super::hash_open_file_contents_with_progress(&mut file, || {
            checks += 1;
            if checks == 3 {
                Err("cancelled".into())
            } else {
                Ok(())
            }
        });
        assert!(result.is_err());
        assert_eq!(file.stream_position().unwrap(), 2 * 64 * 1024);
    }
}
