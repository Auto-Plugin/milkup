//! Native installation authority. Only trusted desktop orchestration calls this module.
//! No plugin RPC exposes these operations. Paths are native-derived and Unix IO is
//! descriptor-relative; unsupported platforms never fall back to legacy writes.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

type Result<T> = std::result::Result<T, String>;
const MAX_FILE: usize = 32 * 1024 * 1024;
const MAX_PACKAGE: usize = 64 * 1024 * 1024;
const MAX_MANIFEST: usize = 1024 * 1024;
const MAX_CATALOG: usize = 16 * 1024 * 1024;
const MAX_FILES: usize = 4096;
const MAX_ENTRIES: usize = 512;
const RESERVE: u64 = 16 * 1024 * 1024;
const MAX_REVISION: u64 = 9_007_199_254_740_991;
const CATALOG: &str = "catalog-v1.json";
const BACKUP: &str = "catalog-v1.backup.json";
static LOCK: Mutex<()> = Mutex::new(());
static INITIALIZED: OnceLock<Mutex<BTreeSet<PathBuf>>> = OnceLock::new();
static SERIAL: AtomicU64 = AtomicU64::new(0);
fn err(code: &str, message: impl std::fmt::Display) -> String {
    format!("[plugin-catalog:{code}] {message}")
}
fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn token() -> String {
    let time = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    digest(
        format!(
            "{time}:{}:{}",
            std::process::id(),
            SERIAL.fetch_add(1, Ordering::Relaxed)
        )
        .as_bytes(),
    )
}
fn next(n: u64) -> Result<u64> {
    n.checked_add(1)
        .filter(|v| *v <= MAX_REVISION)
        .ok_or_else(|| err("quota", "revision exhausted"))
}
fn hash_valid(s: &str) -> bool {
    s.len() == 64
        && s.bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn id_valid(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 128
        && s.split(['.', '-']).all(|p| {
            !p.is_empty()
                && p.as_bytes()[0].is_ascii_lowercase()
                && p.bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
        })
}
fn bounded_message(s: &str) -> String {
    s.chars().take(1024).collect()
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct FileSeal {
    sha256: String,
    bytes: u64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Generation {
    id: String,
    manifest: Value,
    manifest_sha256: String,
    content_sha256: String,
    capability_fingerprint: String,
    approved_fingerprint: Option<String>,
    verified: bool,
    source_path: String,
    files: BTreeMap<String, FileSeal>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Candidate {
    transaction_id: String,
    generation: Generation,
    phase: String,
    restore_enabled: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Entry {
    id: String,
    revision: u64,
    active: Option<Generation>,
    previous: Option<Generation>,
    pending: Option<Candidate>,
    enabled: bool,
    tombstone: bool,
    start_attempt: Option<String>,
    diagnostics: Vec<String>,
}
impl Entry {
    fn new(id: String) -> Self {
        Self {
            id,
            revision: 0,
            active: None,
            previous: None,
            pending: None,
            enabled: false,
            tombstone: false,
            start_attempt: None,
            diagnostics: vec![],
        }
    }
    fn note(&mut self, message: &str) {
        self.diagnostics.push(bounded_message(message));
        if self.diagnostics.len() > 32 {
            self.diagnostics.remove(0);
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Catalog {
    version: u32,
    revision: u64,
    entries: Vec<Entry>,
    diagnostics: Vec<String>,
    migration_receipt: Option<String>,
}
impl Default for Catalog {
    fn default() -> Self {
        Self {
            version: 1,
            revision: 0,
            entries: vec![],
            diagnostics: vec![],
            migration_receipt: None,
        }
    }
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Envelope {
    sha256: String,
    payload: Catalog,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Archive {
    format: String,
    version: u32,
    manifest: Value,
    files: Vec<ArchiveFile>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ArchiveFile {
    path: String,
    encoding: String,
    content: String,
}
#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", deny_unknown_fields)]
enum Action {
    #[serde(rename_all = "camelCase")]
    Approve {
        transaction_id: String,
        fingerprint: String,
    },
    #[serde(rename_all = "camelCase")]
    ApproveActive {
        generation_id: String,
        fingerprint: String,
    },
    #[serde(rename_all = "camelCase")]
    BeginTrial {
        transaction_id: String,
        fingerprint: String,
    },
    #[serde(rename_all = "camelCase")]
    Commit {
        transaction_id: String,
        fingerprint: String,
        enabled: bool,
    },
    #[serde(rename_all = "camelCase")]
    Abort {
        transaction_id: String,
        fingerprint: String,
    },
    #[serde(rename_all = "camelCase")]
    FailCandidate {
        transaction_id: String,
        fingerprint: String,
        message: String,
    },
    #[serde(rename_all = "camelCase")]
    StartupBegin {
        generation_id: String,
    },
    #[serde(rename_all = "camelCase")]
    StartupComplete {
        attempt_id: String,
    },
    Disable,
    RevokeApproval,
    Rollback,
    Remove,
    #[serde(rename_all = "camelCase")]
    MarkFailed {
        generation_id: String,
        message: String,
    },
}

fn portable_path(input: &str) -> Result<String> {
    if input.len() > 1024 || input.starts_with(['/', '\\']) || input.chars().any(|c| c.is_control())
    {
        return Err(err("invalid", "package path must be bounded and relative"));
    }
    let normalized = input.replace('\\', "/");
    let parts: Vec<_> = normalized
        .split('/')
        .filter(|p| !p.is_empty() && *p != ".")
        .collect();
    if parts.is_empty() || parts.len() > 32 {
        return Err(err("invalid", "package path depth"));
    }
    for p in &parts {
        let lower = p.to_lowercase();
        let stem = lower.split('.').next().unwrap_or("");
        let device = matches!(stem, "con" | "prn" | "aux" | "nul" | "conin$" | "conout$")
            || ["com", "lpt"].iter().any(|prefix| {
                stem.strip_prefix(prefix).is_some_and(|v| {
                    matches!(
                        v,
                        "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "¹" | "²" | "³"
                    )
                })
            });
        if *p == ".."
            || p.ends_with(['.', ' '])
            || p.contains(['<', '>', ':', '"', '|', '?', '*'])
            || device
        {
            return Err(err("invalid", "nonportable package path"));
        }
    }
    Ok(parts.join("/"))
}
fn base64(s: &str) -> Result<Vec<u8>> {
    if s.len() % 4 != 0 || s.len() / 4 * 3 > MAX_FILE + 2 {
        return Err(err("invalid", "invalid or oversized base64"));
    }
    let mut out = Vec::with_capacity(s.len() / 4 * 3);
    let val = |b: u8| -> Result<u8> {
        match b {
            b'A'..=b'Z' => Ok(b - b'A'),
            b'a'..=b'z' => Ok(b - b'a' + 26),
            b'0'..=b'9' => Ok(b - b'0' + 52),
            b'+' => Ok(62),
            b'/' => Ok(63),
            _ => Err(err("invalid", "noncanonical base64")),
        }
    };
    for (i, c) in s.as_bytes().chunks_exact(4).enumerate() {
        let a = val(c[0])?;
        let b = val(c[1])?;
        let pad = if c[2] == b'=' {
            2
        } else if c[3] == b'=' {
            1
        } else {
            0
        };
        if pad > 0 && i + 1 != s.len() / 4 {
            return Err(err("invalid", "interior base64 padding"));
        }
        out.push((a << 2) | (b >> 4));
        if pad == 2 {
            if c[3] != b'=' || b & 15 != 0 {
                return Err(err("invalid", "base64 padding bits"));
            }
        } else {
            let c2 = val(c[2])?;
            out.push((b << 4) | (c2 >> 2));
            if pad == 1 {
                if c2 & 3 != 0 {
                    return Err(err("invalid", "base64 padding bits"));
                }
            } else {
                out.push((c2 << 6) | val(c[3])?);
            }
        }
    }
    if out.len() > MAX_FILE {
        return Err(err("quota", "file exceeds 32MiB"));
    }
    Ok(out)
}
fn strings(value: Option<&Value>, label: &str) -> Result<Vec<String>> {
    let Some(value) = value else {
        return Ok(vec![]);
    };
    let a = value
        .as_array()
        .ok_or_else(|| err("invalid", format!("{label} must be array")))?;
    let mut out = Vec::new();
    let mut seen = BTreeSet::new();
    if a.len() > 256 {
        return Err(err("quota", "manifest list exceeds budget"));
    }
    for x in a {
        let s = x.as_str().ok_or_else(|| err("invalid", label))?;
        if s.len() > 2048 || !seen.insert(s) {
            return Err(err("invalid", format!("invalid/duplicate {label}")));
        }
        out.push(s.to_owned());
    }
    Ok(out)
}
fn manifest_fields(m: &Value) -> Result<(String, String)> {
    if !m.is_object() || serde_json::to_vec(m).map_err(|e| err("invalid", e))?.len() > MAX_MANIFEST
    {
        return Err(err("quota", "manifest exceeds 1MiB or is not object"));
    }
    let id = m["id"]
        .as_str()
        .filter(|id| id_valid(id))
        .ok_or_else(|| err("invalid", "plugin id"))?
        .to_owned();
    let version = m["version"]
        .as_str()
        .ok_or_else(|| err("invalid", "manifest version"))?;
    semver::Version::parse(version).map_err(|_| err("invalid", "manifest semver"))?;
    let host = m
        .get("host")
        .map_or(Some("worker"), Value::as_str)
        .filter(|h| matches!(*h, "worker" | "dom" | "sidecar"))
        .ok_or_else(|| err("invalid", "manifest host"))?;
    let permissions = strings(m.get("permissions"), "permissions")?;
    const PERMISSIONS: &[&str] = &[
        "document:read",
        "document:write",
        "document:output",
        "view:read",
        "view:write",
        "file:read",
        "file:write",
        "file:delete",
        "app:control",
        "app:updates",
        "workspace:read",
        "settings:write",
        "app:keymap",
        "app:plugins",
        "images:import",
        "network:access",
    ];
    if permissions
        .iter()
        .any(|p| !PERMISSIONS.contains(&p.as_str()))
    {
        return Err(err("invalid", "unknown permission"));
    }
    let origins = strings(m.get("networkOrigins"), "networkOrigins")?;
    if !origins.is_empty() && !permissions.iter().any(|p| p == "network:access") {
        return Err(err("invalid", "origins require network permission"));
    }
    for origin in &origins {
        let url = tauri::Url::parse(origin).map_err(|_| err("invalid", "network origin"))?;
        if !matches!(url.scheme(), "http" | "https")
            || url.host_str().is_none()
            || !url.username().is_empty()
            || url.password().is_some()
            || url.query().is_some()
            || url.fragment().is_some()
            || url.path() != "/"
            || url.origin().ascii_serialization() != *origin
        {
            return Err(err("invalid", "network origin must be exact"));
        }
    }
    if host == "dom"
        && (permissions != vec!["document:read".to_string()] || m.get("networkOrigins").is_some())
    {
        return Err(err("invalid", "DOM capability profile"));
    }
    if let Some(main) = m.get("main") {
        portable_path(main.as_str().ok_or_else(|| err("invalid", "main path"))?)?;
    }
    strings(m.get("resources"), "resources")?;
    Ok((id, host.into()))
}
fn capability(m: &Value) -> Result<String> {
    let (_, host) = manifest_fields(m)?;
    let mut permissions = strings(m.get("permissions"), "permissions")?;
    permissions.sort();
    let mut origins = strings(m.get("networkOrigins"), "networkOrigins")?;
    origins.sort();
    Ok(digest(
        &serde_json::to_vec(
            &json!({"host":host,"permissions":permissions,"networkOrigins":origins}),
        )
        .map_err(|e| err("invalid", e))?,
    ))
}
fn archive_decode(value: Value) -> Result<(Value, BTreeMap<String, Vec<u8>>)> {
    let archive: Archive = serde_json::from_value(value).map_err(|e| err("invalid", e))?;
    if archive.format != "milkup-plugin" || archive.version != 1 {
        return Err(err("invalid", "package format/version"));
    }
    let (_, host) = manifest_fields(&archive.manifest)?;
    if archive.files.len() > MAX_FILES {
        return Err(err("quota", "package exceeds 4096 files"));
    }
    let mut files = BTreeMap::new();
    let mut names = BTreeSet::new();
    let mut dirs = BTreeSet::new();
    let mut bytes = 0usize;
    for file in archive.files {
        let path = portable_path(&file.path)?;
        let key = path.to_lowercase();
        if key.split('/').next() == Some("plugin.json")
            || names.contains(&key)
            || dirs.contains(&key)
        {
            return Err(err(
                "invalid",
                "reserved, duplicate or conflicting package file",
            ));
        }
        let parts: Vec<_> = key.split('/').collect();
        for i in 1..parts.len() {
            let parent = parts[..i].join("/");
            if names.contains(&parent) {
                return Err(err("invalid", "file/directory collision"));
            }
            dirs.insert(parent);
        }
        names.insert(key);
        if host != "sidecar"
            && archive.manifest["main"]
                .as_str()
                .map(portable_path)
                .transpose()?
                .as_deref()
                == Some(path.as_str())
            && file.encoding != "utf8"
        {
            return Err(err("invalid", "Worker/DOM entry encoding must be utf8"));
        }
        let content = match file.encoding.as_str() {
            "utf8" => file.content.into_bytes(),
            "base64" => base64(&file.content)?,
            _ => return Err(err("invalid", "file encoding")),
        };
        if content.len() > MAX_FILE {
            return Err(err("quota", "file exceeds 32MiB"));
        }
        bytes = bytes
            .checked_add(content.len())
            .ok_or_else(|| err("quota", "package length overflow"))?;
        if bytes > MAX_PACKAGE {
            return Err(err("quota", "package exceeds 64MiB"));
        }
        files.insert(path, content);
    }
    if let Some(main) = archive.manifest["main"].as_str() {
        let path = portable_path(main)?;
        let bytes = files
            .get(&path)
            .ok_or_else(|| err("invalid", "missing package entry"))?;
        if host != "sidecar" && std::str::from_utf8(bytes).is_err() {
            return Err(err("invalid", "module must be UTF-8"));
        }
    }
    for resource in strings(archive.manifest.get("resources"), "resources")? {
        if !files.contains_key(&portable_path(&resource)?) {
            return Err(err("invalid", "missing package resource"));
        }
    }
    Ok((archive.manifest, files))
}
fn generation_relative(id: &str, g: &Generation) -> String {
    format!("{id}/generations/{}", g.id)
}
fn sealed_content(files: &BTreeMap<String, FileSeal>) -> String {
    digest(&serde_json::to_vec(files).expect("serializable file seals"))
}
fn validate_generation(id: &str, g: &Generation) -> Result<()> {
    if !hash_valid(&g.id)
        || manifest_fields(&g.manifest)?.0 != id
        || g.manifest_sha256
            != digest(&serde_json::to_vec(&g.manifest).map_err(|e| err("corrupt", e))?)
        || g.capability_fingerprint != capability(&g.manifest)?
        || g.content_sha256 != sealed_content(&g.files)
        || g.approved_fingerprint
            .as_ref()
            .is_some_and(|a| a != &g.capability_fingerprint)
        || g.source_path.is_empty()
        || g.source_path.len() > 4096
        || g.source_path.chars().any(|c| c.is_control())
        || g.files.len() > MAX_FILES + 1
    {
        return Err(err("corrupt", "generation metadata mismatch"));
    }
    let mut total = 0u64;
    for (path, seal) in &g.files {
        if portable_path(path)? != *path
            || !hash_valid(&seal.sha256)
            || seal.bytes > MAX_FILE as u64
        {
            return Err(err("corrupt", "file seal"));
        }
        total += seal.bytes;
    }
    if total > MAX_PACKAGE as u64 + MAX_MANIFEST as u64 || !g.files.contains_key("plugin.json") {
        return Err(err("corrupt", "generation file budget/manifest"));
    }
    Ok(())
}
fn validate_catalog(c: &Catalog) -> Result<()> {
    if c.version != 1
        || c.revision > MAX_REVISION
        || c.entries.len() > MAX_ENTRIES
        || c.diagnostics.len() > 128
        || c.migration_receipt.as_ref().is_some_and(|v| !hash_valid(v))
    {
        return Err(err("corrupt", "catalog shape/budget"));
    }
    let mut ids = BTreeSet::new();
    for e in &c.entries {
        if !id_valid(&e.id)
            || !ids.insert(&e.id)
            || e.revision > MAX_REVISION
            || e.diagnostics.len() > 32
            || e.start_attempt.as_ref().is_some_and(|v| !hash_valid(v))
        {
            return Err(err("corrupt", "entry identity/state"));
        }
        let mut generations = BTreeSet::new();
        for g in [&e.active, &e.previous].into_iter().flatten() {
            if !generations.insert(&g.id) {
                return Err(err("corrupt", "duplicate generation identity"));
            }
            validate_generation(&e.id, g)?;
            if !g.verified {
                return Err(err("corrupt", "unverified active/previous"));
            }
        }
        if let Some(p) = &e.pending {
            if !generations.insert(&p.generation.id) {
                return Err(err("corrupt", "duplicate candidate generation"));
            }
            validate_generation(&e.id, &p.generation)?;
            if !hash_valid(&p.transaction_id)
                || !matches!(p.phase.as_str(), "prepared" | "trial")
                || p.generation.verified
                || (p.phase == "trial"
                    && (!approve_ok(&p.generation) || e.enabled || e.start_attempt.is_some()))
            {
                return Err(err("corrupt", "candidate state"));
            }
        }
        if (e.tombstone && (e.enabled || e.pending.is_some() || e.start_attempt.is_some()))
            || (e.enabled && !e.active.as_ref().is_some_and(approve_ok))
            || (e.start_attempt.is_some() && (!e.enabled || e.active.is_none()))
        {
            return Err(err("corrupt", "entry state conflict"));
        }
    }
    Ok(())
}
fn encode(c: &Catalog) -> Result<Vec<u8>> {
    validate_catalog(c)?;
    let bytes = serde_json::to_vec(c).map_err(|e| err("io", e))?;
    let bytes = serde_json::to_vec(&Envelope {
        sha256: digest(&bytes),
        payload: c.clone(),
    })
    .map_err(|e| err("io", e))?;
    if bytes.len() > MAX_CATALOG {
        return Err(err("quota", "catalog exceeds 16MiB"));
    }
    Ok(bytes)
}
fn decode(bytes: &[u8]) -> Result<Catalog> {
    let e: Envelope = serde_json::from_slice(bytes).map_err(|e| err("corrupt", e))?;
    if e.sha256 != digest(&serde_json::to_vec(&e.payload).map_err(|e| err("corrupt", e))?) {
        return Err(err("corrupt", "catalog checksum mismatch"));
    }
    validate_catalog(&e.payload)?;
    Ok(e.payload)
}

#[cfg(unix)]
pub(crate) mod disk {
    use super::*;
    use std::ffi::CString;
    use std::fs::File;
    use std::io::{Read, Write};
    use std::os::fd::{AsRawFd, FromRawFd};
    pub struct Dir(File);
    impl Dir {
        pub fn open(path: &Path, create: bool) -> Result<Self> {
            if !path.is_absolute() {
                return Err(err("invalid", "catalog root must be absolute"));
            }
            let mut d = Self(File::open("/").map_err(|e| err("io", e))?);
            for c in path.components() {
                match c {
                    std::path::Component::RootDir => {}
                    std::path::Component::Normal(n) => {
                        let name = n
                            .to_str()
                            .ok_or_else(|| err("invalid", "non UTF8 app data path"))?;
                        d = d.child(name, create)?;
                    }
                    _ => return Err(err("invalid", "noncanonical root")),
                }
            }
            Ok(d)
        }
        fn c(s: &str) -> Result<CString> {
            CString::new(s).map_err(|_| err("invalid", "NUL path"))
        }
        fn raw(&self, s: &str, flags: i32, mode: u32) -> Result<File> {
            if s.is_empty() || s == "." || s == ".." || s.contains('/') {
                return Err(err("invalid", "invalid relative IO component"));
            }
            let s = Self::c(s)?;
            let fd = unsafe {
                libc::openat(
                    self.0.as_raw_fd(),
                    s.as_ptr(),
                    flags | libc::O_NOFOLLOW | libc::O_CLOEXEC | libc::O_NONBLOCK,
                    mode,
                )
            };
            if fd < 0 {
                return Err(err("io", std::io::Error::last_os_error()));
            }
            Ok(unsafe { File::from_raw_fd(fd) })
        }
        pub fn child(&self, name: &str, create: bool) -> Result<Self> {
            if create {
                let c = Self::c(name)?;
                if name.contains('/') || name == "." || name == ".." {
                    return Err(err("invalid", "directory component"));
                }
                if unsafe { libc::mkdirat(self.0.as_raw_fd(), c.as_ptr(), 0o700) } != 0 {
                    let e = std::io::Error::last_os_error();
                    if e.kind() != std::io::ErrorKind::AlreadyExists {
                        return Err(err("io", e));
                    }
                } else {
                    self.sync()?;
                }
            }
            Ok(Self(self.raw(
                name,
                libc::O_RDONLY | libc::O_DIRECTORY,
                0,
            )?))
        }
        pub fn path(&self, relative: &str, create: bool) -> Result<Self> {
            let mut d = Self(self.0.try_clone().map_err(|e| err("io", e))?);
            for part in relative.split('/') {
                d = d.child(part, create)?;
            }
            Ok(d)
        }
        pub fn exists(&self, name: &str) -> Result<bool> {
            let c = Self::c(name)?;
            let mut st = std::mem::MaybeUninit::<libc::stat>::uninit();
            if unsafe {
                libc::fstatat(
                    self.0.as_raw_fd(),
                    c.as_ptr(),
                    st.as_mut_ptr(),
                    libc::AT_SYMLINK_NOFOLLOW,
                )
            } == 0
            {
                return Ok(true);
            }
            let e = std::io::Error::last_os_error();
            if e.kind() == std::io::ErrorKind::NotFound {
                Ok(false)
            } else {
                Err(err("io", e))
            }
        }
        pub fn read(&self, path: &str, limit: usize) -> Result<Vec<u8>> {
            let (parent, name) = path.rsplit_once('/').unwrap_or(("", path));
            let d = if parent.is_empty() {
                Self(self.0.try_clone().map_err(|e| err("io", e))?)
            } else {
                self.path(parent, false)?
            };
            let file = d.raw(name, libc::O_RDONLY, 0)?;
            let meta = file.metadata().map_err(|e| err("io", e))?;
            if !meta.is_file() || meta.len() > limit as u64 {
                return Err(err("quota", "resource must be bounded regular file"));
            }
            let mut out = Vec::new();
            file.take(limit as u64 + 1)
                .read_to_end(&mut out)
                .map_err(|e| err("io", e))?;
            if out.len() > limit {
                return Err(err("quota", "resource grew beyond budget"));
            }
            Ok(out)
        }
        pub fn create(&self, path: &str, bytes: &[u8]) -> Result<()> {
            let (parent, name) = path.rsplit_once('/').unwrap_or(("", path));
            let d = if parent.is_empty() {
                Self(self.0.try_clone().map_err(|e| err("io", e))?)
            } else {
                self.path(parent, true)?
            };
            let mut f = d.raw(name, libc::O_WRONLY | libc::O_CREAT | libc::O_EXCL, 0o600)?;
            f.write_all(bytes).map_err(|e| err("io", e))?;
            f.sync_all().map_err(|e| err("io", e))?;
            d.sync()
        }
        pub fn sync(&self) -> Result<()> {
            self.0.sync_all().map_err(|e| err("io", e))
        }
        pub fn atomic(&self, name: &str, bytes: &[u8]) -> Result<()> {
            let temp = format!(".catalog-tmp-{}", token());
            self.create(&temp, bytes)?;
            let a = Self::c(&temp)?;
            let b = Self::c(name)?;
            if unsafe {
                libc::renameat(
                    self.0.as_raw_fd(),
                    a.as_ptr(),
                    self.0.as_raw_fd(),
                    b.as_ptr(),
                )
            } != 0
            {
                return Err(err("io", std::io::Error::last_os_error()));
            }
            self.sync().map_err(|e| {
                err(
                    "io",
                    format!("replacement may be committed; reread catalog before retry: {e}"),
                )
            })
        }
        pub fn lock(&self) -> Result<File> {
            let f = self.raw("catalog.lock", libc::O_RDWR | libc::O_CREAT, 0o600)?;
            if !f.metadata().map_err(|e| err("io", e))?.is_file() {
                return Err(err("io", "catalog lock not regular file"));
            }
            fs2::FileExt::try_lock_exclusive(&f)
                .map_err(|e| err("conflict", format!("catalog busy: {e}")))?;
            Ok(f)
        }
        pub fn free(&self) -> Result<u64> {
            #[cfg(test)]
            if let Some(value) = TEST_FREE.with(|v| *v.borrow()) {
                return Ok(value);
            }
            let mut stat = std::mem::MaybeUninit::<libc::statvfs>::uninit();
            if unsafe { libc::fstatvfs(self.0.as_raw_fd(), stat.as_mut_ptr()) } != 0 {
                return Err(err("io", std::io::Error::last_os_error()));
            }
            let s = unsafe { stat.assume_init() };
            Ok((s.f_bavail as u64).saturating_mul(s.f_frsize as u64))
        }
        pub fn list(&self) -> Result<Vec<(String, bool)>> {
            let fd = unsafe { libc::dup(self.0.as_raw_fd()) };
            if fd < 0 {
                return Err(err("io", "dup directory"));
            }
            let dir = unsafe { libc::fdopendir(fd) };
            if dir.is_null() {
                unsafe { libc::close(fd) };
                return Err(err("io", "fdopendir"));
            }
            let result = (|| {
                let mut out = vec![];
                loop {
                    let ent = unsafe { libc::readdir(dir) };
                    if ent.is_null() {
                        break;
                    }
                    let name = unsafe { std::ffi::CStr::from_ptr((*ent).d_name.as_ptr()) }
                        .to_str()
                        .map_err(|_| err("invalid", "non UTF8 directory entry"))?
                        .to_owned();
                    if name == "." || name == ".." {
                        continue;
                    }
                    let c = Self::c(&name)?;
                    let mut st = std::mem::MaybeUninit::<libc::stat>::uninit();
                    if unsafe {
                        libc::fstatat(
                            self.0.as_raw_fd(),
                            c.as_ptr(),
                            st.as_mut_ptr(),
                            libc::AT_SYMLINK_NOFOLLOW,
                        )
                    } != 0
                    {
                        return Err(err("io", "stat directory entry"));
                    }
                    let st = unsafe { st.assume_init() };
                    let mode = st.st_mode & libc::S_IFMT;
                    if mode != libc::S_IFDIR && mode != libc::S_IFREG {
                        return Err(err("invalid", "symlink or special package entry"));
                    }
                    out.push((name, mode == libc::S_IFDIR));
                    if out.len() > MAX_FILES + MAX_ENTRIES {
                        return Err(err("quota", "directory entry budget"));
                    }
                }
                out.sort();
                Ok(out)
            })();
            unsafe { libc::closedir(dir) };
            result
        }
        pub fn remove_tree(&self, name: &str) -> Result<()> {
            let dir = self.child(name, false)?;
            for (n, is_dir) in dir.list()? {
                if is_dir {
                    dir.remove_tree(&n)?;
                } else {
                    dir.unlink(&n, false)?;
                }
            }
            self.unlink(name, true)?;
            self.sync()
        }
        fn unlink(&self, name: &str, directory: bool) -> Result<()> {
            let c = Self::c(name)?;
            if unsafe {
                libc::unlinkat(
                    self.0.as_raw_fd(),
                    c.as_ptr(),
                    if directory { libc::AT_REMOVEDIR } else { 0 },
                )
            } != 0
            {
                return Err(err("io", std::io::Error::last_os_error()));
            }
            Ok(())
        }
    }
}
#[cfg(windows)]
#[path = "plugin_catalog_windows.rs"]
pub(crate) mod disk;
#[cfg(not(any(unix, windows)))]
pub(crate) mod disk {
    use super::*;
    pub struct Dir;
    impl Dir {
        pub fn open(_: &Path, _: bool) -> Result<Self> {
            Err(err(
                "unsupported",
                "safe native catalog mutation is not implemented on this platform",
            ))
        }
        pub fn path(&self, _: &str, _: bool) -> Result<Self> {
            Err(err("unsupported", "catalog"))
        }
        pub fn exists(&self, _: &str) -> Result<bool> {
            Err(err("unsupported", "catalog"))
        }
        pub fn read(&self, _: &str, _: usize) -> Result<Vec<u8>> {
            Err(err("unsupported", "catalog"))
        }
        pub fn create(&self, _: &str, _: &[u8]) -> Result<()> {
            Err(err("unsupported", "catalog"))
        }
        pub fn sync(&self) -> Result<()> {
            Err(err("unsupported", "catalog"))
        }
        pub fn atomic(&self, _: &str, _: &[u8]) -> Result<()> {
            Err(err("unsupported", "catalog"))
        }
        pub fn lock(&self) -> Result<std::fs::File> {
            Err(err("unsupported", "catalog"))
        }
        pub fn free(&self) -> Result<u64> {
            Err(err("unsupported", "catalog"))
        }
        pub fn list(&self) -> Result<Vec<(String, bool)>> {
            Err(err("unsupported", "catalog"))
        }
        pub fn remove_tree(&self, _: &str) -> Result<()> {
            Err(err("unsupported", "catalog"))
        }
    }
}
use disk::Dir;

struct Store {
    dir: Dir,
    root: PathBuf,
    _file_lock: std::fs::File,
}
impl Store {
    fn open(root: &Path) -> Result<Self> {
        let dir = Dir::open(root, true)?;
        let lock = dir.lock()?;
        Ok(Self {
            dir,
            root: root.to_owned(),
            _file_lock: lock,
        })
    }
    fn load(&self) -> Result<Catalog> {
        if self.dir.exists(CATALOG)? {
            let raw = self.dir.read(CATALOG, MAX_CATALOG)?;
            if let Ok(c) = decode(&raw) {
                return Ok(c);
            }
        }
        if self.dir.exists(BACKUP)? {
            let raw = self.dir.read(BACKUP, MAX_CATALOG)?;
            let mut c = decode(&raw)?;
            if self.dir.exists(CATALOG)? {
                let damaged = self.dir.read(CATALOG, MAX_CATALOG)?;
                self.dir
                    .create(&format!("catalog-corrupt-{}.json", token()), &damaged)?;
            }
            for e in &mut c.entries {
                e.enabled = false;
                e.start_attempt = None;
                if let Some(p) = &mut e.pending {
                    p.phase = "prepared".into();
                    p.restore_enabled = false;
                    p.generation.approved_fingerprint = None;
                }
                for g in [&mut e.active, &mut e.previous].into_iter().flatten() {
                    g.approved_fingerprint = None;
                }
                e.revision = next(e.revision)?;
                e.note(
                    "Recovered catalog backup; all activation/approval requires explicit review",
                );
            }
            c.revision = next(c.revision)?;
            c.diagnostics.push("Primary catalog unavailable/corrupt; backup recovered fail-closed, old approval not restored".into());
            self.dir.atomic(CATALOG, &encode(&c)?)?;
            return Ok(c);
        }
        if self.dir.exists(CATALOG)? {
            return Err(err(
                "corrupt",
                "catalog invalid; no valid backup (original retained)",
            ));
        }
        Ok(Catalog::default())
    }
    fn save(&self, c: &mut Catalog) -> Result<()> {
        c.revision = next(c.revision)?;
        let bytes = encode(c)?;
        if self.dir.exists(CATALOG)? {
            let old = self.dir.read(CATALOG, MAX_CATALOG)?;
            decode(&old)?;
            self.dir.atomic(BACKUP, &old)?;
        }
        failpoint("before-catalog-replace")?;
        self.dir.atomic(CATALOG, &bytes)
    }
    fn wire(&self, c: &Catalog) -> Result<Value> {
        let mut out = serde_json::to_value(c).map_err(|e| err("io", e))?;
        for entry in out["entries"]
            .as_array_mut()
            .ok_or_else(|| err("corrupt", "entries"))?
        {
            let id = entry["id"].as_str().unwrap().to_owned();
            entry["dataRoot"] = json!(self.root.join(&id).join("data").to_string_lossy());
            entry["storageRoot"] = json!(self.root.join(&id).join("storage").to_string_lossy());
            for key in ["active", "previous"] {
                if !entry[key].is_null() {
                    self.wire_generation(&id, &mut entry[key]);
                }
            }
            if !entry["pending"].is_null() {
                self.wire_generation(&id, &mut entry["pending"]["generation"]);
            }
        }
        Ok(out)
    }
    fn wire_generation(&self, id: &str, g: &mut Value) {
        let generation = g["id"].as_str().unwrap().to_owned();
        g.as_object_mut().unwrap().remove("files");
        g["packageRoot"] = json!(self
            .root
            .join(id)
            .join("generations")
            .join(generation)
            .to_string_lossy());
    }
    fn stage(
        &self,
        id: &str,
        manifest: Value,
        mut files: BTreeMap<String, Vec<u8>>,
        source: String,
    ) -> Result<Generation> {
        if source.is_empty() || source.len() > 4096 || source.chars().any(|c| c.is_control()) {
            return Err(err("invalid", "source path metadata"));
        }
        files.insert(
            "plugin.json".into(),
            serde_json::to_vec(&manifest).map_err(|e| err("invalid", e))?,
        );
        let bytes: u64 = files.values().map(|v| v.len() as u64).sum();
        if self.dir.free()?
            < bytes
                .saturating_add(RESERVE)
                .saturating_add((MAX_CATALOG * 2) as u64)
        {
            return Err(err(
                "quota",
                "insufficient space for candidate and recovery reserve",
            ));
        }
        let generation = token();
        let dir = self
            .dir
            .path(&format!("{id}/generations/{generation}"), true)?;
        let mut seals = BTreeMap::new();
        for (path, bytes) in &files {
            failpoint("stage-file")?;
            dir.create(path, bytes)?;
            seals.insert(
                path.clone(),
                FileSeal {
                    sha256: digest(bytes),
                    bytes: bytes.len() as u64,
                },
            );
        }
        dir.sync()?;
        self.dir.path(&format!("{id}/generations"), false)?.sync()?;
        self.dir.path(id, false)?.sync()?;
        self.dir.sync()?;
        self.dir.path(&format!("{id}/data"), true)?;
        self.dir.path(&format!("{id}/storage"), true)?;
        Ok(Generation {
            id: generation,
            manifest_sha256: digest(&serde_json::to_vec(&manifest).map_err(|e| err("invalid", e))?),
            capability_fingerprint: capability(&manifest)?,
            content_sha256: sealed_content(&seals),
            manifest,
            approved_fingerprint: None,
            verified: false,
            source_path: source,
            files: seals,
        })
    }
    fn verify(&self, id: &str, g: &Generation) -> Result<()> {
        validate_generation(id, g)?;
        let dir = self.dir.path(&generation_relative(id, g), false)?;
        let mut actual = BTreeMap::new();
        collect_files(&dir, "", 0, &mut actual)?;
        if actual.len() != g.files.len() {
            return Err(err("corrupt", "generation file set changed"));
        }
        for (path, seal) in &g.files {
            let bytes = actual
                .get(path)
                .ok_or_else(|| err("corrupt", "missing sealed file"))?;
            if bytes.len() as u64 != seal.bytes || digest(bytes) != seal.sha256 {
                return Err(err("corrupt", "generation bytes changed"));
            }
        }
        Ok(())
    }
    fn gc(&self, c: &Catalog, id: &str) -> Result<()> {
        let e = c
            .entries
            .iter()
            .find(|e| e.id == id)
            .ok_or_else(|| err("conflict", "unknown plugin"))?;
        let mut refs: BTreeSet<String> = [
            e.active.as_ref(),
            e.previous.as_ref(),
            e.pending.as_ref().map(|p| &p.generation),
        ]
        .into_iter()
        .flatten()
        .filter(|_| !e.tombstone)
        .map(|g| g.id.clone())
        .collect();
        // The previous durable catalog remains a recovery decision. Keep its
        // verified generations until a later backup no longer references them.
        if !e.tombstone && self.dir.exists(BACKUP)? {
            let backup = decode(&self.dir.read(BACKUP, MAX_CATALOG)?)?;
            if let Some(old) = backup
                .entries
                .iter()
                .find(|old| old.id == id && !old.tombstone)
            {
                for generation in [&old.active, &old.previous].into_iter().flatten() {
                    refs.insert(generation.id.clone());
                }
            }
        }
        let generations = self.dir.path(&format!("{id}/generations"), false)?;
        for (name, is_dir) in generations.list()? {
            if !is_dir || !hash_valid(&name) {
                return Err(err("corrupt", "unexpected generation entry; retained"));
            }
            if !refs.contains(name.as_str()) {
                failpoint("gc-delete")?;
                generations.remove_tree(&name)?;
            }
        }
        Ok(())
    }
}
fn collect_files(
    dir: &Dir,
    prefix: &str,
    depth: usize,
    out: &mut BTreeMap<String, Vec<u8>>,
) -> Result<()> {
    if depth > 32 {
        return Err(err("quota", "package directory depth"));
    }
    for (name, is_dir) in dir.list()? {
        let path = if prefix.is_empty() {
            name.clone()
        } else {
            format!("{prefix}/{name}")
        };
        portable_path(&path)?;
        if is_dir {
            collect_files(&dir.path(&name, false)?, &path, depth + 1, out)?;
        } else {
            let bytes = dir.read(&name, MAX_FILE)?;
            if out.len() >= MAX_FILES + 1
                || out
                    .values()
                    .map(Vec::len)
                    .sum::<usize>()
                    .saturating_add(bytes.len())
                    > MAX_PACKAGE + MAX_MANIFEST
            {
                return Err(err("quota", "installed package budget"));
            }
            out.insert(path, bytes);
        }
    }
    Ok(())
}
#[cfg(test)]
thread_local! {
    static FAILURE:std::cell::RefCell<Option<(&'static str,usize)>>=const{std::cell::RefCell::new(None)};
    static TEST_FREE:std::cell::RefCell<Option<u64>>=const{std::cell::RefCell::new(None)};
}
fn failpoint(_phase: &str) -> Result<()> {
    #[cfg(test)]
    {
        return FAILURE.with(|f| {
            let mut f = f.borrow_mut();
            if let Some((phase, count)) = f.as_mut() {
                if *phase == _phase {
                    if *count == 0 {
                        return Err(err("io", format!("injected {_phase}")));
                    }
                    *count -= 1;
                }
            }
            Ok(())
        });
    }
    #[cfg(not(test))]
    Ok(())
}

fn candidate<'a>(e: &'a mut Entry, txn: &str, fingerprint: &str) -> Result<&'a mut Candidate> {
    e.pending
        .as_mut()
        .filter(|p| p.transaction_id == txn && p.generation.capability_fingerprint == fingerprint)
        .ok_or_else(|| err("conflict", "candidate transaction/fingerprint changed"))
}
fn approve_ok(g: &Generation) -> bool {
    g.approved_fingerprint.as_deref() == Some(g.capability_fingerprint.as_str())
}
fn entry_mut<'a>(c: &'a mut Catalog, id: &str, revision: u64) -> Result<&'a mut Entry> {
    c.entries
        .iter_mut()
        .find(|e| e.id == id && e.revision == revision)
        .ok_or_else(|| err("conflict", "entry revision changed"))
}
fn recover(store: &Store, c: &mut Catalog) -> Result<()> {
    let mut changed = false;
    for e in &mut c.entries {
        let mut dirty = false;
        if e.pending.as_ref().is_some_and(|p| p.phase == "trial") {
            let p = e.pending.as_mut().unwrap();
            p.phase = "prepared".into();
            p.restore_enabled = false;
            p.generation.approved_fingerprint = None;
            e.enabled = false;
            e.start_attempt = None;
            e.note("Interrupted candidate trial retained for explicit review/retry; old installation retained disabled");
            dirty = true;
        }
        if e.start_attempt.take().is_some() {
            e.enabled = false;
            e.note("Previous startup did not complete; automatic retry disabled");
            dirty = true;
        }
        if !e.tombstone {
            if let Some(g) = &e.active {
                if let Err(error) = store.verify(&e.id, g) {
                    e.enabled = false;
                    if let Some(g) = &mut e.active {
                        g.approved_fingerprint = None;
                    }
                    e.note(&format!("Active generation quarantined: {error}"));
                    dirty = true;
                }
            }
            if let Some(p) = &e.pending {
                if let Err(error) = store.verify(&e.id, &p.generation) {
                    let p = e.pending.as_mut().unwrap();
                    dirty |= p.phase != "prepared"
                        || p.generation.approved_fingerprint.is_some()
                        || p.restore_enabled;
                    p.phase = "prepared".into();
                    p.generation.approved_fingerprint = None;
                    p.restore_enabled = false;
                    let message = bounded_message(&format!(
                        "Invalid candidate quarantined for removal/reinstall: {error}"
                    ));
                    if !e.diagnostics.contains(&message) {
                        e.note(&message);
                        dirty = true;
                    }
                }
            }
        }
        if dirty {
            e.revision = next(e.revision)?;
            changed = true;
        }
    }
    if changed {
        store.save(c)?;
    }
    Ok(())
}
fn with_store<T>(root: &Path, f: impl FnOnce(&Store, &mut Catalog) -> Result<T>) -> Result<T> {
    let _guard = LOCK
        .lock()
        .map_err(|_| err("io", "catalog lock poisoned"))?;
    let store = Store::open(root)?;
    let mut c = store.load()?;
    let initialized = INITIALIZED.get_or_init(|| Mutex::new(BTreeSet::new()));
    let mut initialized = initialized
        .lock()
        .map_err(|_| err("io", "initialization lock poisoned"))?;
    if !initialized.contains(root) {
        recover(&store, &mut c)?;
        initialized.insert(root.to_owned());
    }
    drop(initialized);
    f(&store, &mut c)
}
pub fn read(root: &Path) -> Result<Value> {
    with_store(root, |s, c| s.wire(c))
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PreparedReplacement {
    source_path: String,
    transaction_id: String,
    generation_id: String,
    fingerprint: String,
}

pub fn prepare(
    root: &Path,
    archive: Value,
    source_path: String,
    expected_revision: Option<u64>,
) -> Result<Value> {
    prepare_with_replacement(root, archive, source_path, expected_revision, None)
}

/// Internal host operation. The host supplies bytes from its closed bundled index;
/// source metadata only restricts eligibility and never authenticates archive contents.
pub fn prepare_with_replacement(
    root: &Path,
    archive: Value,
    source_path: String,
    expected_revision: Option<u64>,
    replace_pending: Option<Value>,
) -> Result<Value> {
    let replacement: Option<PreparedReplacement> = replace_pending
        .map(serde_json::from_value)
        .transpose()
        .map_err(|e| err("invalid", e))?;
    let (manifest, files) = archive_decode(archive)?;
    let id = manifest_fields(&manifest)?.0;
    with_store(root, move |s, c| {
        let index = c.entries.iter().position(|e| e.id == id);
        match index {
            Some(i) => {
                if expected_revision != Some(c.entries[i].revision) {
                    return Err(err("conflict", "entry revision changed"));
                }
                let e = &c.entries[i];
                if let Some(identity) = &replacement {
                    if e.tombstone || e.start_attempt.is_some() {
                        return Err(err(
                            "conflict",
                            "replacement requires a retained idle entry",
                        ));
                    }
                    let p = e
                        .pending
                        .as_ref()
                        .filter(|p| {
                            p.transaction_id == identity.transaction_id
                                && p.generation.id == identity.generation_id
                                && p.generation.capability_fingerprint == identity.fingerprint
                                && p.generation.source_path == identity.source_path
                        })
                        .ok_or_else(|| err("conflict", "replacement candidate identity changed"))?;
                    if p.phase != "prepared"
                        || !source_path.starts_with("bundled:")
                        || !p.generation.source_path.starts_with("bundled:")
                    {
                        return Err(err(
                            "conflict",
                            "replacement requires exact prepared bundled receipts",
                        ));
                    }
                    let version = |m: &Value| -> Result<semver::Version> {
                        semver::Version::parse(m["version"].as_str().unwrap_or_default())
                            .map_err(|e| err("invalid", e))
                    };
                    let next_version = version(&manifest)?;
                    if !next_version
                        .cmp_precedence(&version(&p.generation.manifest)?)
                        .is_gt()
                    {
                        return Err(err("conflict", "bundled replacement must be newer"));
                    }
                    if let Some(active) = &e.active {
                        if !active.source_path.starts_with("bundled:")
                            || !next_version
                                .cmp_precedence(&version(&active.manifest)?)
                                .is_gt()
                        {
                            return Err(err("conflict", "bundled replacement cannot replace a user receipt or downgrade active"));
                        }
                    }
                    s.verify(&id, &p.generation)?;
                } else if e.pending.is_some() || e.start_attempt.is_some() {
                    return Err(err("conflict", "resolve existing candidate/startup first"));
                }
            }
            None => {
                if expected_revision.is_some() || replacement.is_some() {
                    return Err(err("conflict", "plugin no longer exists"));
                }
                if c.entries.len() >= MAX_ENTRIES {
                    return Err(err("quota", "catalog exceeds 512 entries"));
                }
            }
        }
        let mut generation = s.stage(&id, manifest, files, source_path)?;
        if let Some(i) = index {
            if let Some(old) = &c.entries[i].active {
                if replacement.is_none()
                    && !c.entries[i].tombstone
                    && approve_ok(old)
                    && old.capability_fingerprint == generation.capability_fingerprint
                {
                    generation.approved_fingerprint =
                        Some(generation.capability_fingerprint.clone());
                }
            }
        }
        let e = if let Some(i) = index {
            &mut c.entries[i]
        } else {
            c.entries.push(Entry::new(id.clone()));
            c.entries.last_mut().unwrap()
        };
        if e.tombstone {
            e.active = None;
            e.previous = None;
            e.enabled = false;
        }
        e.tombstone = false;
        if replacement.is_some() {
            let retired = e.pending.as_ref().unwrap();
            e.note(&format!("Superseded prepared bundled candidate {} from {}; retained prior bytes until normal collection", retired.generation.id, retired.generation.source_path));
        }
        e.pending = Some(Candidate {
            transaction_id: token(),
            generation,
            phase: "prepared".into(),
            restore_enabled: e.enabled,
        });
        e.revision = next(e.revision)?;
        s.save(c)?;
        s.wire(c)
    })
}
pub fn transition(
    root: &Path,
    plugin_id: &str,
    expected_revision: u64,
    action: Value,
) -> Result<Value> {
    if !id_valid(plugin_id) {
        return Err(err("invalid", "plugin id"));
    }
    let action: Action = serde_json::from_value(action).map_err(|e| err("invalid", e))?;
    with_store(root, |s, c| {
        let e = entry_mut(c, plugin_id, expected_revision)?;
        if e.tombstone && !matches!(action, Action::Remove) {
            return Err(err("conflict", "plugin is removed"));
        }
        let mut collect = false;
        match action {
            Action::Approve {
                transaction_id,
                fingerprint,
            } => {
                let p = candidate(e, &transaction_id, &fingerprint)?;
                if p.phase != "prepared" {
                    return Err(err("conflict", "candidate already in trial"));
                }
                s.verify(plugin_id, &p.generation)?;
                p.generation.approved_fingerprint = Some(fingerprint);
            }
            Action::ApproveActive {
                generation_id,
                fingerprint,
            } => {
                if e.start_attempt.is_some()
                    || e.pending.as_ref().is_some_and(|p| p.phase == "trial")
                {
                    return Err(err("conflict", "plugin activation in progress"));
                }
                let g = e
                    .active
                    .as_mut()
                    .filter(|g| g.id == generation_id && g.capability_fingerprint == fingerprint)
                    .ok_or_else(|| err("conflict", "active generation changed"))?;
                s.verify(plugin_id, g)?;
                g.approved_fingerprint = Some(fingerprint);
            }
            Action::BeginTrial {
                transaction_id,
                fingerprint,
            } => {
                if e.start_attempt.is_some() {
                    return Err(err("conflict", "startup in progress"));
                }
                let enabled = e.enabled;
                let p = candidate(e, &transaction_id, &fingerprint)?;
                if p.phase != "prepared" || !approve_ok(&p.generation) {
                    return Err(err("conflict", "candidate is not prepared and approved"));
                }
                if manifest_fields(&p.generation.manifest)?.1 == "sidecar" {
                    return Err(err(
                        "unsupported",
                        "sidecar cannot safely perform read-only trial",
                    ));
                }
                s.verify(plugin_id, &p.generation)?;
                p.phase = "trial".into();
                p.restore_enabled = enabled;
                e.enabled = false;
            }
            Action::Commit {
                transaction_id,
                fingerprint,
                enabled,
            } => {
                let p = candidate(e, &transaction_id, &fingerprint)?;
                if p.phase != "trial" || !approve_ok(&p.generation) {
                    return Err(err("conflict", "commit requires approved restricted trial"));
                }
                s.verify(plugin_id, &p.generation)?;
                let mut g = e.pending.take().unwrap().generation;
                g.verified = true;
                if let Some(old) = e.active.take() {
                    if old.verified {
                        e.previous = Some(old);
                    }
                }
                e.active = Some(g);
                e.enabled = enabled;
                e.start_attempt = None;
                collect = true;
            }
            Action::Abort {
                transaction_id,
                fingerprint,
            } => {
                let p = candidate(e, &transaction_id, &fingerprint)?;
                let restore = p.restore_enabled;
                e.pending = None;
                // Explicit rejection of a first installation is a durable user decision.
                e.tombstone = e.active.is_none();
                e.enabled = restore && e.active.as_ref().is_some_and(approve_ok);
                e.start_attempt = None;
                e.note("Candidate aborted; old installation retained");
                collect = true;
            }
            Action::FailCandidate {
                transaction_id,
                fingerprint,
                message,
            } => {
                let p = candidate(e, &transaction_id, &fingerprint)?;
                p.phase = "prepared".into();
                // Runtime cleanup/restart is the manager's responsibility. Never infer that
                // a retained old installation is live from a failed candidate transaction.
                e.enabled = false;
                e.start_attempt = None;
                e.note(&format!(
                    "Candidate activation failed: {}",
                    bounded_message(&message)
                ));
                collect = true;
            }
            Action::StartupBegin { generation_id } => {
                if e.start_attempt.is_some()
                    || e.pending.as_ref().is_some_and(|p| p.phase == "trial")
                {
                    return Err(err("conflict", "activation already in progress"));
                }
                let g = e
                    .active
                    .as_ref()
                    .filter(|g| g.id == generation_id && g.verified && approve_ok(g))
                    .ok_or_else(|| {
                        err("conflict", "active generation unavailable or not approved")
                    })?;
                if manifest_fields(&g.manifest)?.1 == "sidecar" {
                    return Err(err(
                        "unsupported",
                        "sidecar catalog activation not supported",
                    ));
                }
                s.verify(plugin_id, g)?;
                e.enabled = true;
                e.start_attempt = Some(token());
            }
            Action::StartupComplete { attempt_id } => {
                if e.start_attempt.as_ref() != Some(&attempt_id) {
                    return Err(err("conflict", "startup attempt changed"));
                }
                e.start_attempt = None;
            }
            Action::Disable => {
                e.enabled = false;
                e.start_attempt = None;
                if let Some(p) = &mut e.pending {
                    p.restore_enabled = false;
                    if p.phase == "trial" {
                        e.pending = None;
                    }
                }
            }
            Action::RevokeApproval => {
                e.enabled = false;
                e.start_attempt = None;
                for g in [&mut e.active, &mut e.previous].into_iter().flatten() {
                    g.approved_fingerprint = None;
                }
                if let Some(p) = &mut e.pending {
                    p.generation.approved_fingerprint = None;
                    p.restore_enabled = false;
                    if p.phase == "trial" {
                        e.pending = None;
                    }
                }
            }
            Action::MarkFailed {
                generation_id,
                message,
            } => {
                if e.active.as_ref().map(|g| g.id.as_str()) != Some(generation_id.as_str()) {
                    return Err(err("conflict", "failed generation is no longer active"));
                }
                e.enabled = false;
                e.start_attempt = None;
                e.note(&format!("Activation failed: {}", bounded_message(&message)));
            }
            Action::Rollback => {
                if e.pending.is_some() || e.start_attempt.is_some() {
                    return Err(err("conflict", "resolve candidate/startup before rollback"));
                }
                let previous = e
                    .previous
                    .as_ref()
                    .filter(|g| g.verified)
                    .ok_or_else(|| err("conflict", "no verified previous installation"))?;
                s.verify(plugin_id, previous)?;
                std::mem::swap(&mut e.active, &mut e.previous);
                e.enabled = false;
                e.note("Restored previous verified package; requires a new activation epoch");
            }
            Action::Remove => {
                e.enabled = false;
                e.tombstone = true;
                e.start_attempt = None;
                e.pending = None;
                for g in [&mut e.active, &mut e.previous].into_iter().flatten() {
                    g.approved_fingerprint = None;
                }
                collect = true;
            }
        }
        e.revision = next(e.revision)?;
        s.save(c)?;
        if collect {
            if let Err(error) = s.gc(c, plugin_id) {
                let e = c.entries.iter_mut().find(|e| e.id == plugin_id).unwrap();
                e.note(&format!("Package cleanup pending (data retained): {error}"));
                e.revision = next(e.revision)?;
                s.save(c)?;
            }
        }
        s.wire(c)
    })
}

/// Import a legacy record only from the native-derived legacy package directory.
/// Legacy approvals are never promoted: older records did not bind complete scope.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MigrationValidation {
    version: u32,
    raw_sha256: String,
    records: Vec<MigrationRecord>,
    diagnostics: Vec<String>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct MigrationRecord {
    index: usize,
    manifest: Value,
}
pub fn migrate(root: &Path, legacy_raw: &str, validation: Option<Value>) -> Result<Value> {
    if legacy_raw.len() > MAX_CATALOG {
        return Err(err("quota", "legacy registry exceeds 16MiB"));
    }
    let receipt = digest(legacy_raw.as_bytes());
    with_store(root, |s, c| {
        if let Some(old) = &c.migration_receipt {
            return if old == &receipt {
                s.wire(c)
            } else {
                Err(err("conflict", "legacy migration already decided"))
            };
        }
        if !c.entries.is_empty() {
            return Err(err("conflict", "migrate before new catalog installations"));
        }
        let backup = format!("legacy-registry-{receipt}.json");
        if s.dir.exists(&backup)? {
            if s.dir.read(&backup, MAX_CATALOG)? != legacy_raw.as_bytes() {
                return Err(err("corrupt", "legacy backup differs"));
            }
        } else {
            failpoint("migration-backup")?;
            s.dir.create(&backup, legacy_raw.as_bytes())?;
        }
        // Full manifest/legacy schema validation belongs to the shared trusted-host
        // parser. Bind its decisions to these exact backed-up bytes and rows; never
        // silently fall back to importing unvalidated rows through our narrower
        // native security schema.
        let validation: MigrationValidation = serde_json::from_value(
            validation
                .ok_or_else(|| err("invalid", "migration validation required; backup retained"))?,
        )
        .map_err(|e| err("invalid", format!("migration validation: {e}")))?;
        if validation.version != 1
            || validation.raw_sha256 != receipt
            || validation.records.len() > MAX_ENTRIES
            || validation.diagnostics.len() > 128
            || validation
                .diagnostics
                .iter()
                .any(|s| s.chars().count() > 1024)
        {
            return Err(err(
                "invalid",
                "migration validation bounds or raw digest differ",
            ));
        }
        let raw = serde_json::from_str::<Value>(legacy_raw).ok();
        let records = raw.as_ref().and_then(|raw| {
            raw.get("records")
                .and_then(Value::as_array)
                .filter(|records| raw["version"] == 1 && records.len() <= MAX_ENTRIES)
        });
        let mut validated = BTreeSet::new();
        for hint in &validation.records {
            let record = records
                .and_then(|records| records.get(hint.index))
                .ok_or_else(|| err("invalid", "migration validation index outside raw records"))?;
            if !hint.manifest.is_object()
                || record.get("manifest") != Some(&hint.manifest)
                || !validated.insert(hint.index)
            {
                return Err(err(
                    "invalid",
                    "migration validation duplicate index or manifest differs",
                ));
            }
        }
        for diagnostic in validation.diagnostics {
            if c.diagnostics.len() < 128 {
                c.diagnostics.push(diagnostic);
            }
        }
        let Some(records) = records else {
            // A corrupt legacy root is a quarantined input, not a reason to repeat
            // migration forever. Nonempty hints were rejected above before mutation.
            if c.diagnostics.len() < 128 {
                c.diagnostics
                    .push("Legacy JSON/root quarantined; complete raw backup retained".into());
            }
            c.migration_receipt = Some(receipt);
            s.save(c)?;
            return s.wire(c);
        };
        let mut counts = BTreeMap::new();
        for r in records {
            if let Some(id) = r["manifest"]["id"].as_str() {
                *counts.entry(id).or_insert(0usize) += 1;
            }
        }
        for (index, r) in records.iter().enumerate() {
            if !validated.contains(&index) {
                if c.diagnostics.len() < 128 {
                    c.diagnostics.push(format!(
                        "Legacy record {index} quarantined: shared schema validation absent"
                    ));
                }
                continue;
            }
            let mut staging = false;
            let imported = (|| -> Result<Entry> {
                if !r.is_object()
                    || !r["enabled"].is_boolean()
                    || !matches!(
                        r["state"].as_str(),
                        Some("installed" | "enabled" | "disabled" | "failed")
                    )
                    || !r["approvals"].is_object()
                {
                    return Err(err("invalid", "legacy record fields"));
                }
                let (id, _) = manifest_fields(&r["manifest"])?;
                if counts.get(id.as_str()) != Some(&1) {
                    return Err(err("invalid", "duplicate legacy id"));
                }
                let legacy = s.dir.path(&format!("{id}/package"), false)?;
                let actual: Value =
                    serde_json::from_slice(&legacy.read("plugin.json", MAX_MANIFEST)?)
                        .map_err(|e| err("invalid", e))?;
                if actual != r["manifest"] {
                    return Err(err("invalid", "legacy disk manifest differs from registry"));
                }
                let mut files = BTreeMap::new();
                collect_files(&legacy, "", 0, &mut files)?;
                files.remove("plugin.json");
                // Reuse complete portable path/collision/entry checks without trusting old file layout.
                let file_values: Vec<Value> = files
                    .iter()
                    .map(|(path, bytes)| match std::str::from_utf8(bytes) {
                        Ok(text) => json!({"path":path,"encoding":"utf8","content":text}),
                        Err(_) => {
                            json!({"path":path,"encoding":"base64","content":encode_base64(bytes)})
                        }
                    })
                    .collect();
                let (manifest, files) = archive_decode(
                    json!({"format":"milkup-plugin","version":1,"manifest":actual,"files":file_values}),
                )?;
                let source = r["sourcePath"]
                    .as_str()
                    .filter(|s| !s.is_empty())
                    .unwrap_or("legacy:installed")
                    .to_owned();
                staging = true;
                let generation = s.stage(&id, manifest, files, source)?;
                let mut e = Entry::new(id);
                e.revision = 1;
                e.pending = Some(Candidate {
                    transaction_id: token(),
                    generation,
                    phase: "prepared".into(),
                    restore_enabled: false,
                });
                e.note("Legacy package preserved as unapproved candidate; complete capability scope requires confirmation and restricted trial");
                Ok(e)
            })();
            match imported {
                Ok(e) => c.entries.push(e),
                Err(error) => {
                    // Missing/invalid old files quarantine only that record. A new
                    // stage failure must not commit a partial receipt preventing retry.
                    if staging {
                        return Err(error);
                    }
                    if c.diagnostics.len() < 128 {
                        c.diagnostics.push(bounded_message(&format!(
                            "Legacy record {index} quarantined: {error}"
                        )));
                    }
                }
            }
        }
        c.migration_receipt = Some(receipt);
        s.save(c)?;
        s.wire(c)
    })
}
fn encode_base64(bytes: &[u8]) -> String {
    const ABC: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for c in bytes.chunks(3) {
        let a = c[0];
        let b = *c.get(1).unwrap_or(&0);
        let d = *c.get(2).unwrap_or(&0);
        out.push(ABC[(a >> 2) as usize] as char);
        out.push(ABC[(((a & 3) << 4) | (b >> 4)) as usize] as char);
        out.push(if c.len() > 1 {
            ABC[(((b & 15) << 2) | (d >> 6)) as usize] as char
        } else {
            '='
        });
        out.push(if c.len() > 2 {
            ABC[(d & 63) as usize] as char
        } else {
            '='
        });
    }
    out
}
fn selected<'a>(e: &'a Entry, generation: &str) -> Result<&'a Generation> {
    if e.tombstone {
        return Err(err("conflict", "plugin removed"));
    }
    if let Some(p) = &e.pending {
        if p.generation.id == generation && p.phase == "trial" && approve_ok(&p.generation) {
            return Ok(&p.generation);
        }
    }
    e.active
        .as_ref()
        .filter(|g| g.id == generation && g.verified && approve_ok(g) && e.enabled)
        .ok_or_else(|| err("conflict", "generation is not authorized for activation"))
}
pub fn read_worker_module(root: &Path, plugin_id: &str, generation: &str) -> Result<String> {
    with_store(root, |s, c| {
        let e = c
            .entries
            .iter()
            .find(|e| e.id == plugin_id)
            .ok_or_else(|| err("conflict", "unknown plugin"))?;
        let g = selected(e, generation)?;
        if manifest_fields(&g.manifest)?.1 != "worker" {
            return Err(err("invalid", "generation is not worker"));
        }
        let main = portable_path(
            g.manifest["main"]
                .as_str()
                .ok_or_else(|| err("invalid", "worker main missing"))?,
        )?;
        let seal = g
            .files
            .get(&main)
            .ok_or_else(|| err("corrupt", "missing module seal"))?;
        let bytes = s
            .dir
            .path(&generation_relative(plugin_id, g), false)?
            .read(&main, MAX_FILE)?;
        if bytes.len() as u64 != seal.bytes || digest(&bytes) != seal.sha256 {
            return Err(err(
                "corrupt",
                "worker source differs from sealed generation",
            ));
        }
        String::from_utf8(bytes).map_err(|_| err("invalid", "worker module is not UTF8"))
    })
}
pub fn read_dom_module(root: &Path, plugin_id: &str, expected: &Value) -> Result<String> {
    with_store(root, |s, c| {
        let e = c
            .entries
            .iter()
            .find(|e| e.id == plugin_id && !e.tombstone)
            .ok_or_else(|| err("conflict", "unknown plugin"))?;
        let g = e
            .pending
            .as_ref()
            .filter(|p| {
                p.phase == "trial"
                    && p.generation.manifest == *expected
                    && approve_ok(&p.generation)
            })
            .map(|p| &p.generation)
            .or_else(|| {
                e.active
                    .as_ref()
                    .filter(|g| g.manifest == *expected && e.enabled && approve_ok(g))
            })
            .ok_or_else(|| err("conflict", "DOM generation is not authorized"))?;
        if manifest_fields(&g.manifest)?.1 != "dom" {
            return Err(err("invalid", "not DOM generation"));
        }
        let main = portable_path(
            g.manifest["main"]
                .as_str()
                .ok_or_else(|| err("invalid", "DOM main missing"))?,
        )?;
        let seal = g
            .files
            .get(&main)
            .ok_or_else(|| err("corrupt", "missing DOM source seal"))?;
        let bytes = s
            .dir
            .path(&generation_relative(plugin_id, g), false)?
            .read(&main, 8 * 1024 * 1024)?;
        if bytes.len() as u64 != seal.bytes || digest(&bytes) != seal.sha256 {
            return Err(err("corrupt", "DOM module differs from sealed bytes"));
        }
        String::from_utf8(bytes).map_err(|_| err("invalid", "DOM module UTF8"))
    })
}
pub fn read_icon(root: &Path, plugin_id: &str) -> Result<Vec<u8>> {
    with_store(root, |s, c| {
        let e = c
            .entries
            .iter()
            .find(|e| e.id == plugin_id && !e.tombstone)
            .ok_or_else(|| err("conflict", "unknown plugin"))?;
        let g = e
            .active
            .as_ref()
            .or_else(|| e.pending.as_ref().map(|p| &p.generation))
            .ok_or_else(|| err("conflict", "missing generation"))?;
        let icon = g.manifest["icon"]
            .as_str()
            .ok_or_else(|| err("invalid", "no icon"))?;
        if !strings(g.manifest.get("resources"), "resources")?
            .iter()
            .any(|p| p == icon)
            || !icon.ends_with(".png")
        {
            return Err(err("invalid", "icon must be declared PNG resource"));
        }
        let icon = portable_path(icon)?;
        let seal = g
            .files
            .get(&icon)
            .ok_or_else(|| err("corrupt", "icon seal missing"))?;
        let bytes = s
            .dir
            .path(&generation_relative(plugin_id, g), false)?
            .read(&icon, 256 * 1024)?;
        if bytes.len() as u64 != seal.bytes || digest(&bytes) != seal.sha256 {
            return Err(err("corrupt", "icon changed"));
        }
        Ok(bytes)
    })
}

#[cfg(all(test, any(unix, windows)))]
#[path = "plugin_catalog_tests.rs"]
mod tests;
