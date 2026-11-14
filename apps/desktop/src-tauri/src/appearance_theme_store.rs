//! Host-owned CSS files. This module stores raw text; it never marks CSS trusted.
//! Every load must be parsed and constrained by the appearance frontend before use.
//! File IO reuses the catalog's handle-relative directory/lock/atomic primitives.
//! On Windows those primitives require local NTFS and do not promise power-loss
//! directory-metadata durability. An uncertain replacement is reread before retry.
use crate::plugin_catalog::disk::Dir;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::io::Read;
use std::path::{Path, PathBuf};

type Result<T> = std::result::Result<T, String>;
const MAX_CSS: usize = 128 * 1024;
const MAX_STATE: usize = 4096;
const MAX_FILES: usize = 128;
const STATE: &str = "theme-v1.json";
const DEFAULT: &str = "default.css";
const DEFAULT_TEXT: &str = include_str!("../../src/appearance-default.css");
fn error(value: impl std::fmt::Display) -> String {
    format!("[appearance-theme] {value}")
}
fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn valid_digest(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|v| v.is_ascii_hexdigit() && !v.is_ascii_uppercase())
}
fn valid_theme_leaf(value: &str) -> bool {
    let Some(value) = value
        .strip_prefix("theme-")
        .and_then(|v| v.strip_suffix(".css"))
    else {
        return false;
    };
    let (hash, copy) = value
        .split_once("-copy")
        .map(|(h, n)| (h, Some(n)))
        .unwrap_or((value, None));
    valid_digest(hash)
        && copy.is_none_or(|v| {
            !v.is_empty()
                && v.len() <= 3
                && v.bytes().all(|b| b.is_ascii_digit())
                && v.parse::<usize>().is_ok_and(|n| n > 0 && n <= MAX_FILES)
        })
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Record {
    version: u8,
    name: String,
    leaf: String,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Envelope {
    sha256: String,
    record: Record,
}
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ThemeSnapshot {
    pub revision: String,
    pub name: String,
    pub text: Option<String>,
    pub path: String,
    pub is_default: bool,
    pub default_text: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub warning: Option<String>,
}
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ThemeCandidate {
    pub text: String,
    pub name: String,
    pub source_digest: String,
}
pub struct CandidateCommit {
    pub candidate: ThemeCandidate,
    pub expected_digest: String,
    pub expected_revision: String,
}
struct StoreLock {
    file: std::fs::File,
    owner_pid: u32,
}
impl StoreLock {
    fn new(file: std::fs::File) -> Self {
        Self {
            file,
            owner_pid: std::process::id(),
        }
    }
}
impl Drop for StoreLock {
    fn drop(&mut self) {
        // CLOEXEC closes an inherited descriptor only after exec. An unrelated
        // concurrent spawn can otherwise extend this lock beyond Store's life.
        // Release it explicitly, but never from a forked copy of the owner.
        if self.owner_pid == std::process::id() {
            let _ = fs2::FileExt::unlock(&self.file);
        }
    }
}
pub struct Store {
    dir: Dir,
    root: PathBuf,
    _lock: StoreLock,
}
impl Store {
    pub fn open(root: &Path) -> Result<Self> {
        let dir = Dir::open(root, true)?;
        let lock = StoreLock::new(dir.lock()?);
        if !dir.exists(DEFAULT)? {
            dir.create(DEFAULT, DEFAULT_TEXT.as_bytes())?;
        }
        Ok(Self {
            dir,
            root: root.into(),
            _lock: lock,
        })
    }
    fn bytes(&self) -> Result<Option<Vec<u8>>> {
        if self.dir.exists(STATE)? {
            self.dir.read(STATE, MAX_STATE).map(Some)
        } else {
            Ok(None)
        }
    }
    fn current_revision(bytes: Option<&[u8]>) -> String {
        bytes.map(digest).unwrap_or_else(|| "absent".into())
    }
    fn check_revision(&self, expected: &str) -> Result<Option<Vec<u8>>> {
        let old = self.bytes()?;
        if Self::current_revision(old.as_deref()) != expected {
            return Err(error(
                "主题已由另一操作更改，请重新读取后重试；当前主题已保留",
            ));
        }
        Ok(old)
    }
    fn decode(bytes: Option<&[u8]>) -> Result<Option<Record>> {
        let Some(bytes) = bytes else { return Ok(None) };
        let envelope: Envelope =
            serde_json::from_slice(bytes).map_err(|_| error("主题选择记录损坏，原字节已保留"))?;
        let r = envelope.record;
        let valid_leaf = r.leaf == DEFAULT || valid_theme_leaf(&r.leaf);
        if r.version != 1
            || !valid_name(&r.name)
            || !valid_leaf
            || envelope.sha256 != digest(&serde_json::to_vec(&r).map_err(error)?)
        {
            return Err(error("主题选择记录校验失败，原字节已保留"));
        }
        Ok(Some(r))
    }
    pub fn snapshot(&self) -> Result<ThemeSnapshot> {
        let bytes = self.bytes()?;
        let (record, mut warning) = match Self::decode(bytes.as_deref()) {
            Ok(v) => (v, None),
            Err(e) => (None, Some(e)),
        };
        let leaf = record.as_ref().map(|v| v.leaf.as_str()).unwrap_or(DEFAULT);
        let is_default = leaf == DEFAULT;
        let text = if is_default {
            match self.dir.read(DEFAULT, MAX_CSS) {
                Ok(bytes) if bytes == DEFAULT_TEXT.as_bytes() => {},
                _ => add_warning(&mut warning, "默认 CSS 示例已改动或不可读取，文件已保留；当前默认样式仍来自应用。可将编辑后的示例显式导入。"),
            }
            Some(DEFAULT_TEXT.into())
        } else {
            match self.dir.read(leaf, MAX_CSS).and_then(css_text) {
                Ok(value) => Some(value),
                Err(e) => {
                    add_warning(
                        &mut warning,
                        &format!("当前主题文件无法读取，选择记录和文件均未清空：{e}"),
                    );
                    None
                }
            }
        };
        Ok(ThemeSnapshot {
            revision: Self::current_revision(bytes.as_deref()),
            name: record
                .as_ref()
                .map(|v| v.name.clone())
                .unwrap_or_else(|| "系统默认主题".into()),
            text,
            path: self.root.join(leaf).to_string_lossy().into_owned(),
            is_default,
            default_text: DEFAULT_TEXT,
            warning,
        })
    }
    fn budget(&self) -> Result<()> {
        if self.dir.list()?.len() >= MAX_FILES {
            return Err(error(
                "主题文件保留数量已达上限；现有文件未删除。请先备份并整理主题目录。",
            ));
        }
        Ok(())
    }
    fn retain_corrupt(&self, previous: Option<&[u8]>) -> Result<()> {
        if Self::decode(previous).is_err() {
            let bytes = previous.expect("decode without bytes cannot fail");
            let leaf = format!("damaged-{}.json", digest(bytes));
            if !self.dir.exists(&leaf)? {
                self.budget()?;
                self.dir.create(&leaf, bytes)?;
            } else if self.dir.read(&leaf, MAX_STATE)? != bytes {
                return Err(error("损坏记录归档位置已被更改，未覆盖当前记录"));
            }
        }
        Ok(())
    }
    fn publish(&self, previous: Option<&[u8]>, record: Record) -> Result<ThemeSnapshot> {
        self.retain_corrupt(previous)?;
        let encoded = serde_json::to_vec(&Envelope {
            sha256: digest(&serde_json::to_vec(&record).map_err(error)?),
            record,
        })
        .map_err(error)?;
        if let Err(e) = self.dir.atomic(STATE, &encoded) {
            // Atomic rename can have committed before a later sync fails. Report
            // the observed revision, never silently replay against the old CAS.
            let observed = self.bytes().map(|v| Self::current_revision(v.as_deref()));
            return Err(error(format!(
                "主题写入未确认：{e}；重新读取结果：{observed:?}。请重读后再试。"
            )));
        }
        self.snapshot()
    }
    pub fn commit(&self, input: CandidateCommit) -> Result<ThemeSnapshot> {
        let previous = self.check_revision(&input.expected_revision)?;
        if !valid_digest(&input.expected_digest) {
            return Err(error("无效的主题内容摘要"));
        }
        let candidate = input.candidate;
        if digest(candidate.text.as_bytes()) != candidate.source_digest
            || candidate.text.len() > MAX_CSS
            || !valid_name(&candidate.name)
        {
            return Err(error("主题候选数据不一致"));
        }
        if candidate.source_digest != input.expected_digest {
            return Err(error("主题文件在验证后发生变化，未导入；请重新选择并验证"));
        }
        let mut leaf = format!("theme-{}.css", candidate.source_digest);
        if self.dir.exists(&leaf)? && self.dir.read(&leaf, MAX_CSS)? != candidate.text.as_bytes() {
            // An editor may modify a previously imported copy. Retain that file,
            // and give this explicit import a new private name instead of
            // overwriting it or making the original CSS impossible to import.
            let mut replacement = None;
            for n in 1..=MAX_FILES {
                let next = format!("theme-{}-copy{n}.css", candidate.source_digest);
                if !self.dir.exists(&next)? {
                    replacement = Some(next);
                    break;
                }
                if self.dir.read(&next, MAX_CSS)? == candidate.text.as_bytes() {
                    replacement = Some(next);
                    break;
                }
            }
            leaf = replacement.ok_or_else(|| error("主题副本数量已达上限；所有原文件保留"))?;
        }
        if !self.dir.exists(&leaf)? {
            self.budget()?;
            self.dir.create(&leaf, candidate.text.as_bytes())?;
        }
        self.publish(
            previous.as_deref(),
            Record {
                version: 1,
                name: candidate.name,
                leaf,
            },
        )
    }
    pub fn reset(&self, expected_revision: &str) -> Result<ThemeSnapshot> {
        let previous = self.check_revision(expected_revision)?;
        self.publish(
            previous.as_deref(),
            Record {
                version: 1,
                name: "系统默认主题".into(),
                leaf: DEFAULT.into(),
            },
        )
    }
    pub fn open_path(&self, expected_revision: &str) -> Result<PathBuf> {
        let bytes = self.check_revision(expected_revision)?;
        // Corrupt selection is not authority to open a path. Default recovery is
        // available through an explicit reset and keeps the corrupt bytes.
        let record = Self::decode(bytes.as_deref())?;
        let leaf = record.as_ref().map(|v| v.leaf.as_str()).unwrap_or(DEFAULT);
        // Validate the exact bounded ordinary leaf before requesting OS handling.
        self.dir.read(leaf, MAX_CSS)?;
        Ok(self.root.join(leaf))
    }
}
fn add_warning(warning: &mut Option<String>, text: &str) {
    if let Some(old) = warning {
        old.push(' ');
        old.push_str(text);
    } else {
        *warning = Some(text.into());
    }
}
fn valid_name(name: &str) -> bool {
    !name.trim().is_empty() && name.len() <= 512 && !name.chars().any(char::is_control)
}
fn css_text(bytes: Vec<u8>) -> Result<String> {
    if bytes.len() > MAX_CSS {
        return Err(error("CSS 超过 128 KiB"));
    }
    let text = String::from_utf8(bytes).map_err(|_| error("CSS 必须为 UTF-8 文本"))?;
    if text.contains('\0') {
        return Err(error("CSS 含 NUL 字符"));
    }
    Ok(text)
}
pub fn candidate_from_file(file: std::fs::File, name: String) -> Result<ThemeCandidate> {
    if !valid_name(&name) {
        return Err(error("主题文件名为空、过长或含控制字符"));
    }
    let metadata = file.metadata().map_err(error)?;
    if !metadata.is_file() || metadata.len() > MAX_CSS as u64 {
        return Err(error("主题必须是小于等于 128 KiB 的普通文件"));
    }
    let mut bytes = Vec::new();
    file.take(MAX_CSS as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(error)?;
    let source_digest = digest(&bytes);
    let text = css_text(bytes)?;
    Ok(ThemeCandidate {
        text,
        name,
        source_digest,
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::atomic::{AtomicU64, Ordering};
    fn read_candidate(path: &Path) -> Result<ThemeCandidate> {
        candidate_from_file(
            std::fs::File::open(path).map_err(error)?,
            path.file_stem().unwrap().to_string_lossy().into_owned(),
        )
    }
    static SERIAL: AtomicU64 = AtomicU64::new(0);
    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "milkup-theme-test-{}-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos(),
                SERIAL.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir(&path).unwrap();
            Self(path)
        }
        fn root(&self) -> PathBuf {
            self.0.join("主题 & files")
        }
        fn candidate(&self, name: &str, css: &[u8]) -> PathBuf {
            let path = self.0.join(name);
            fs::write(&path, css).unwrap();
            path
        }
        fn input(&self, path: &Path, revision: &str) -> CandidateCommit {
            CandidateCommit {
                candidate: read_candidate(path).unwrap(),
                expected_digest: read_candidate(path).unwrap().source_digest,
                expected_revision: revision.into(),
            }
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    #[test]
    fn copy_cas_reopen_missing_source_and_default_preserve_user_files() {
        let f = Fixture::new();
        let source = f.candidate(
            "中文 空格 & ' dollar$.css",
            b":root { --text: #123456; }\r\n",
        );
        let initial = Store::open(&f.root()).unwrap().snapshot().unwrap();
        assert_eq!(initial.revision, "absent");
        assert_eq!(fs::read(&initial.path).unwrap(), DEFAULT_TEXT.as_bytes());
        let selected = Store::open(&f.root())
            .unwrap()
            .commit(f.input(&source, &initial.revision))
            .unwrap();
        assert!(!selected.is_default);
        assert_eq!(
            selected.text.as_ref().unwrap().as_bytes(),
            fs::read(&source).unwrap()
        );
        fs::remove_file(&source).unwrap();
        let reopened = Store::open(&f.root()).unwrap().snapshot().unwrap();
        assert_eq!(reopened.text, selected.text);
        assert_eq!(
            Store::open(&f.root())
                .unwrap()
                .open_path(&reopened.revision)
                .unwrap()
                .to_str()
                .unwrap(),
            reopened.path
        );
        assert!(Store::open(&f.root()).unwrap().reset("absent").is_err());
        let reset = Store::open(&f.root())
            .unwrap()
            .reset(&reopened.revision)
            .unwrap();
        assert!(reset.is_default);
        assert!(Path::new(&reopened.path).exists());
    }
    #[test]
    fn changed_candidate_conflict_and_lock_contention_do_not_commit() {
        let f = Fixture::new();
        let path = f.candidate("theme.css", b"a { color: red; }");
        let mut input = f.input(&path, "absent");
        fs::write(&path, "a { color: blue; }").unwrap();
        input.candidate = read_candidate(&path).unwrap();
        let store = Store::open(&f.root()).unwrap();
        assert!(store.commit(input).unwrap_err().contains("发生变化"));
        assert_eq!(store.snapshot().unwrap().revision, "absent");
        assert!(Store::open(&f.root()).is_err());
        drop(store);
        assert!(Store::open(&f.root())
            .unwrap()
            .commit(f.input(&path, "absent"))
            .is_ok());
    }
    #[test]
    fn missing_bad_css_and_corrupt_selection_are_preserved_for_explicit_recovery() {
        let f = Fixture::new();
        let source = f.candidate("theme.css", b"p { color: red; }");
        let selected = Store::open(&f.root())
            .unwrap()
            .commit(f.input(&source, "absent"))
            .unwrap();
        fs::remove_file(&selected.path).unwrap();
        let missing = Store::open(&f.root()).unwrap().snapshot().unwrap();
        assert_eq!(missing.text, None);
        assert!(!missing.is_default);
        assert!(missing.warning.is_some());
        assert_eq!(missing.revision, selected.revision);
        assert!(Store::open(&f.root())
            .unwrap()
            .open_path(&missing.revision)
            .is_err());
        let bad = b"{broken manifest";
        fs::write(f.root().join(STATE), bad).unwrap();
        let damaged = Store::open(&f.root()).unwrap().snapshot().unwrap();
        assert!(damaged.warning.is_some());
        assert_eq!(fs::read(f.root().join(STATE)).unwrap(), bad);
        let restored = Store::open(&f.root())
            .unwrap()
            .reset(&damaged.revision)
            .unwrap();
        assert!(restored.is_default);
        assert_eq!(
            fs::read(f.root().join(format!("damaged-{}.json", digest(bad)))).unwrap(),
            bad
        );
        fs::write(f.root().join(DEFAULT), b"edited by user").unwrap();
        let default = Store::open(&f.root()).unwrap().snapshot().unwrap();
        assert_eq!(default.text.as_deref(), Some(DEFAULT_TEXT));
        assert!(default.warning.is_some());
        assert_eq!(fs::read(f.root().join(DEFAULT)).unwrap(), b"edited by user");
    }
    #[test]
    fn bounds_utf8_and_orphan_half_commit() {
        let f = Fixture::new();
        for (name, content) in [
            ("bad.css", vec![255]),
            ("big.css", vec![b'a'; MAX_CSS + 1]),
            ("nul.css", vec![0]),
        ] {
            let path = f.candidate(name, &content);
            assert!(read_candidate(&path).is_err());
        }
        let store = Store::open(&f.root()).unwrap();
        store
            .dir
            .create(&format!("theme-{}.css", digest(b"orphan")), b"orphan")
            .unwrap();
        // A crash after copy but before publication does not select the orphan.
        assert!(store.snapshot().unwrap().is_default);
        assert_eq!(store.snapshot().unwrap().revision, "absent");
    }
    #[test]
    fn reimporting_original_preserves_an_externally_edited_private_copy() {
        let f = Fixture::new();
        let source = f.candidate("theme.css", b"p { color: red; }");
        let first = Store::open(&f.root())
            .unwrap()
            .commit(f.input(&source, "absent"))
            .unwrap();
        fs::write(&first.path, "p { color: blue; }").unwrap();
        let second = Store::open(&f.root())
            .unwrap()
            .commit(f.input(&source, &first.revision))
            .unwrap();
        assert_ne!(first.path, second.path);
        assert_eq!(
            fs::read_to_string(&first.path).unwrap(),
            "p { color: blue; }"
        );
        assert_eq!(second.text.as_deref(), Some("p { color: red; }"));
        assert_eq!(
            Store::open(&f.root()).unwrap().snapshot().unwrap().path,
            second.path
        );
    }
    #[test]
    fn process_lock_probe() {
        let Some(root) = std::env::var_os("MILKUP_THEME_TEST_LOCK_ROOT") else {
            return;
        };
        assert!(Store::open(Path::new(&root)).is_err());
    }
    #[test]
    fn separate_process_cannot_publish_while_lock_is_held() {
        let f = Fixture::new();
        let store = Store::open(&f.root()).unwrap();
        let status = std::process::Command::new(std::env::current_exe().unwrap())
            .arg("--exact")
            .arg("appearance_theme_store::tests::process_lock_probe")
            .arg("--nocapture")
            .env("MILKUP_THEME_TEST_LOCK_ROOT", f.root())
            .status()
            .unwrap();
        assert!(status.success());
        assert_eq!(store.snapshot().unwrap().revision, "absent");
        drop(store);
        assert!(Store::open(&f.root()).unwrap().reset("absent").is_ok());
    }
    #[cfg(unix)]
    #[test]
    fn inherited_descriptor_does_not_extend_a_dropped_store_lock() {
        use std::io::Write;
        use std::os::fd::{AsRawFd, FromRawFd};

        fn pipe() -> (std::fs::File, std::fs::File) {
            let mut fds = [-1; 2];
            assert_eq!(unsafe { libc::pipe(fds.as_mut_ptr()) }, 0);
            let pair = unsafe {
                (
                    std::fs::File::from_raw_fd(fds[0]),
                    std::fs::File::from_raw_fd(fds[1]),
                )
            };
            for fd in fds {
                assert_eq!(
                    unsafe { libc::fcntl(fd, libc::F_SETFD, libc::FD_CLOEXEC) },
                    0
                );
            }
            pair
        }

        // Keep this deliberate fork/exec gap out of the parallel runner's
        // unrelated locks. The probe is still a real process, not a mock or a
        // serialization gate around the test suite.
        const PROBE: &str = "MILKUP_THEME_TEST_INHERITED_LOCK_PROBE";
        if std::env::var_os(PROBE).as_deref() != Some(std::ffi::OsStr::new("1")) {
            let status = std::process::Command::new(std::env::current_exe().unwrap())
                .arg("--exact")
                .arg("appearance_theme_store::tests::inherited_descriptor_does_not_extend_a_dropped_store_lock")
                .arg("--nocapture")
                .env(PROBE, "1")
                .status()
                .unwrap();
            assert!(status.success());
            return;
        }
        let f = Fixture::new();
        let store = Store::open(&f.root()).unwrap();
        let (mut ready_read, ready_write) = pipe();
        let (release_read, mut release_write) = pipe();
        let ready_read_fd = ready_read.as_raw_fd();
        let ready_write_fd = ready_write.as_raw_fd();
        let release_read_fd = release_read.as_raw_fd();
        let release_write_fd = release_write.as_raw_fd();
        let pid = unsafe { libc::fork() };
        assert!(pid >= 0);
        if pid == 0 {
            // A multithreaded test runner may have forked while other tests hold
            // locks. Use only async-signal-safe syscalls before _exit, no Rust
            // destructors/allocator and no application work in this child.
            unsafe {
                libc::close(ready_read_fd);
                libc::close(release_write_fd);
                let ready = [1u8];
                if libc::write(ready_write_fd, ready.as_ptr().cast(), 1) != 1 {
                    libc::_exit(2);
                }
                let mut wait = libc::pollfd {
                    fd: release_read_fd,
                    events: libc::POLLIN,
                    revents: 0,
                };
                let signalled =
                    libc::poll(&mut wait, 1, 5000) == 1 && wait.revents & libc::POLLIN != 0;
                libc::_exit(if signalled { 0 } else { 3 });
            }
        }
        drop(ready_write);
        drop(release_read);
        let mut ready = [0u8];
        let mut wait = libc::pollfd {
            fd: ready_read_fd,
            events: libc::POLLIN,
            revents: 0,
        };
        let ready_result = if unsafe { libc::poll(&mut wait, 1, 5000) } == 1 {
            ready_read.read_exact(&mut ready)
        } else {
            Err(std::io::Error::new(
                std::io::ErrorKind::TimedOut,
                "inherited descriptor probe did not become ready",
            ))
        };
        let blocked_while_owned = Store::open(&f.root()).is_err();
        drop(store);
        // The child still owns its inherited CLOEXEC descriptor. The old
        // close-only release reliably returns EAGAIN at this point.
        let reopened = Store::open(&f.root());
        let release_result = release_write.write_all(&[1]);
        let mut status = 0;
        let waited = unsafe { libc::waitpid(pid, &mut status, 0) };
        // Reap the bounded child before reporting any failed assertion.
        ready_result.unwrap();
        assert_eq!(ready, [1]);
        assert!(blocked_while_owned);
        release_result.unwrap();
        assert_eq!(waited, pid);
        assert!(libc::WIFEXITED(status));
        assert_eq!(libc::WEXITSTATUS(status), 0);
        let reopened = reopened.expect("inherited descriptor must not extend Store lifetime");
        // Closing the old inherited descriptor cannot release this new lock.
        assert!(Store::open(&f.root()).is_err());
        drop(reopened);
        assert!(Store::open(&f.root()).is_ok());
    }
    #[test]
    fn selected_raw_css_is_not_cached_as_verified_and_open_is_revision_bound() {
        let f = Fixture::new();
        let source = f.candidate("theme.css", b"p { color: red; }");
        let selected = Store::open(&f.root())
            .unwrap()
            .commit(f.input(&source, "absent"))
            .unwrap();
        fs::write(&selected.path, "broken CSS needs frontend validation").unwrap();
        let reread = Store::open(&f.root()).unwrap().snapshot().unwrap();
        assert_eq!(
            reread.text.as_deref(),
            Some("broken CSS needs frontend validation")
        );
        assert_eq!(reread.revision, selected.revision);
        let reset = Store::open(&f.root())
            .unwrap()
            .reset(&selected.revision)
            .unwrap();
        assert!(Store::open(&f.root())
            .unwrap()
            .open_path(&selected.revision)
            .is_err());
        assert!(Store::open(&f.root())
            .unwrap()
            .open_path(&reset.revision)
            .is_ok());
        assert_eq!(
            fs::read_to_string(selected.path).unwrap(),
            "broken CSS needs frontend validation"
        );
    }
    #[cfg(unix)]
    #[test]
    fn theme_store_does_not_follow_selected_state_symlink() {
        use std::os::unix::fs::symlink;
        let f = Fixture::new();
        let store = Store::open(&f.root()).unwrap();
        let outside = f.candidate("outside.json", b"outside");
        symlink(&outside, f.root().join(STATE)).unwrap();
        assert!(store.snapshot().is_err());
        assert!(store.reset("absent").is_err());
        assert_eq!(fs::read(&outside).unwrap(), b"outside");
    }
}
