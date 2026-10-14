//! Durable, opt-in-to-restore copies. Source paths are labels, never write targets.
use crate::recovery_storage::{admit_export, StorageGuard, StorageStatus};
use crate::LargeFileRegistry;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::State;

const MAX_BYTES: u64 = 256 * 1024 * 1024;
fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}
fn now() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos()
}
fn safe(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 180
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-')
}
fn snapshot_name(value: &str) -> bool {
    value
        .strip_prefix("snapshot-")
        .map(|n| !n.is_empty() && n.bytes().all(|b| b.is_ascii_digit()))
        .unwrap_or(false)
}
pub(crate) fn private_dir(path: &Path) -> Result<(), String> {
    let mut builder = fs::DirBuilder::new();
    builder.recursive(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    builder.create(path).map_err(err)
}
fn sync_dir(path: &Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        File::open(path)
            .and_then(|file| file.sync_all())
            .map_err(err)?;
    }
    let _ = path;
    Ok(())
}
fn digest(path: &Path) -> Result<(u64, String), String> {
    let mut file = File::open(path).map_err(err)?;
    let mut hash = Sha256::new();
    let mut size = 0;
    let mut buffer = [0; 65536];
    loop {
        let n = file.read(&mut buffer).map_err(err)?;
        if n == 0 {
            break;
        }
        size += n as u64;
        if size > MAX_BYTES {
            return Err("恢复副本超过 256 MiB 预算".into());
        }
        hash.update(&buffer[..n]);
    }
    Ok((size, format!("{:x}", hash.finalize())))
}
fn birth(pid: u32) -> Option<String> {
    #[cfg(target_os = "linux")]
    {
        let stat = fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
        return stat
            .rsplit_once(") ")?
            .1
            .split_whitespace()
            .nth(19)
            .map(str::to_owned);
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = pid;
        None
    }
}
fn owner_active(pid: u32, expected_birth: &Option<String>) -> bool {
    #[cfg(target_os = "linux")]
    {
        if let Ok(stat) = fs::read_to_string(format!("/proc/{pid}/stat")) {
            if let Some((_, fields)) = stat.rsplit_once(") ") {
                if fields.starts_with("Z ") {
                    return false;
                }
                if let (Some(actual), Some(expected)) = (birth(pid), expected_birth) {
                    return actual == *expected;
                }
            }
        }
    }
    let _ = expected_birth;
    #[cfg(unix)]
    {
        extern "C" {
            fn kill(pid: i32, signal: i32) -> i32;
        }
        if pid == 0 || pid > i32::MAX as u32 {
            return true;
        }
        return unsafe {
            kill(pid as i32, 0) == 0 || std::io::Error::last_os_error().raw_os_error() != Some(3)
        };
    }
    #[cfg(windows)]
    {
        #[link(name = "kernel32")]
        extern "system" {
            fn OpenProcess(access: u32, inherit: i32, pid: u32) -> *mut std::ffi::c_void;
            fn CloseHandle(handle: *mut std::ffi::c_void) -> i32;
        }
        unsafe {
            let handle = OpenProcess(0x00100000, 0, pid);
            if handle.is_null() {
                return std::io::Error::last_os_error().raw_os_error() != Some(87);
            }
            CloseHandle(handle);
            return true;
        }
    }
    #[cfg(not(any(unix, windows)))]
    {
        true
    }
}
#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Record {
    schema: u8,
    pub(crate) id: String,
    owner_pid: u32,
    owner_birth: Option<String>,
    pub(crate) original_path: Option<String>,
    pub(crate) version: usize,
    pub(crate) created_at: u64,
    pub(crate) bytes: u64,
    sha256: String,
    payload: String,
    previous: Option<String>,
    pub(crate) disposition: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Checkpoint {
    key: String,
    document_id: String,
    original_path: Option<String>,
    version: usize,
    native_version: Option<usize>,
    text: Option<String>,
}
pub(crate) struct RecoveryStore {
    root: PathBuf,
    owner: String,
    gate: Mutex<()>,
}
impl RecoveryStore {
    pub(crate) fn new(root: PathBuf) -> Self {
        Self {
            root,
            owner: format!("{}-{}", std::process::id(), now()),
            gate: Mutex::new(()),
        }
    }
    fn directory(&self, id: &str) -> Result<PathBuf, String> {
        if !safe(id) {
            return Err("Invalid recovery identifier".into());
        }
        let path = self.root.join(id);
        if path
            .symlink_metadata()
            .map(|m| m.file_type().is_symlink())
            .unwrap_or(false)
        {
            return Err("Recovery directory is a symlink".into());
        }
        Ok(path)
    }
    fn read(&self, id: &str) -> Result<Record, String> {
        let dir = self.directory(id)?;
        let path = dir.join("manifest.json");
        if fs::symlink_metadata(&path)
            .map_err(err)?
            .file_type()
            .is_symlink()
            || fs::metadata(&path).map_err(err)?.len() > 65536
        {
            return Err("Invalid recovery manifest".into());
        }
        let record: Record = serde_json::from_slice(&fs::read(path).map_err(err)?).map_err(err)?;
        if record.schema != 1
            || record.id != id
            || !snapshot_name(&record.payload)
            || record
                .previous
                .as_ref()
                .map(|p| !snapshot_name(p))
                .unwrap_or(false)
            || record.bytes > MAX_BYTES
        {
            return Err("Invalid recovery record".into());
        }
        Ok(record)
    }
    fn commit(&self, dir: &Path, record: &Record) -> Result<(), String> {
        let pending = dir.join(format!("manifest-{}.pending", now()));
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&pending)
            .map_err(err)?;
        file.write_all(&serde_json::to_vec(record).map_err(err)?)
            .map_err(err)?;
        file.sync_all().map_err(err)?;
        drop(file);
        crate::replace_file_atomically(&pending, &dir.join("manifest.json"))?;
        sync_dir(dir)
    }
    fn checkpoint(
        &self,
        input: Checkpoint,
        expected_bytes: u64,
        write: impl FnOnce(&Path) -> Result<(), String>,
    ) -> Result<Record, String> {
        let _guard = self.gate.lock().map_err(err)?;
        if !safe(&input.key) {
            return Err("Invalid recovery key".into());
        }
        if expected_bytes > MAX_BYTES {
            return Err("恢复副本超过 256 MiB 预算；已有恢复点保留".into());
        }
        let storage = StorageGuard::acquire(&self.root)?;
        storage.admit(expected_bytes)?;
        let id = format!("{}-{}", self.owner, input.key);
        let dir = self.directory(&id)?;
        private_dir(&dir)?;
        sync_dir(&self.root)?;
        let old = if dir.join("manifest.json").exists() {
            Some(self.read(&id)?)
        } else {
            None
        };
        if let Some(record) = &old {
            if record.version > input.version {
                return Err("Stale recovery version".into());
            }
        }
        let payload = format!("snapshot-{}", now());
        let target = dir.join(&payload);
        write(&target)?;
        let (bytes, sha256) = digest(&target)?;
        if bytes > expected_bytes {
            return Err("恢复副本超过本次保留预算，未发布新恢复点".into());
        }
        let record = Record {
            schema: 1,
            id,
            owner_pid: std::process::id(),
            owner_birth: birth(std::process::id()),
            original_path: input.original_path,
            version: input.version,
            created_at: (now() / 1_000_000) as u64,
            bytes,
            sha256,
            payload,
            previous: old.as_ref().map(|r| r.payload.clone()),
            disposition: "pending".into(),
        };
        self.commit(&dir, &record)?;
        // Only superseded, owned committed generations are pruned, after the new
        // payload + manifest have been synced. Unknown partial files are retained.
        if let Some(previous) = old.and_then(|r| r.previous) {
            if snapshot_name(&previous) {
                let _ = fs::remove_file(dir.join(previous));
            }
        }
        Ok(record)
    }
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RecoveryList {
    records: Vec<Record>,
    warnings: Vec<String>,
    storage: Option<StorageStatus>,
}
#[tauri::command]
pub(crate) async fn list_recovery_records(
    store: State<'_, RecoveryStore>,
    include_archived: bool,
) -> Result<RecoveryList, String> {
    let _guard = store.gate.lock().map_err(err)?;
    let mut records = Vec::new();
    let mut warnings = Vec::new();
    let storage = match StorageGuard::acquire(&store.root).and_then(|guard| guard.status()) {
        Ok(status) => Some(status),
        Err(e) => {
            warnings.push(format!("存储统计失败；已有记录保留：{e}"));
            None
        }
    };
    let entries = match fs::read_dir(&store.root) {
        Ok(e) => e,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Ok(RecoveryList {
                records,
                warnings,
                storage,
            })
        }
        Err(e) => return Err(err(e)),
    };
    for (index, entry) in entries.enumerate() {
        if index >= 20_000 {
            warnings.push("恢复目录条目超过扫描上限；其余记录仍保留，请备份后整理目录".into());
            break;
        }
        let entry = entry.map_err(err)?;
        if !entry.file_type().map_err(err)?.is_dir() {
            continue;
        }
        let id = entry.file_name().to_string_lossy().into_owned();
        if id == "copies" {
            continue;
        }
        match store.read(&id) {
            Ok(record) => {
                if !owner_active(record.owner_pid, &record.owner_birth)
                    && (include_archived || record.disposition == "pending")
                {
                    records.push(record)
                }
            }
            Err(e) => warnings.push(format!("保留未完成或损坏的记录 {id}：{e}")),
        }
    }
    records.sort_by_key(|r| std::cmp::Reverse(r.created_at));
    Ok(RecoveryList {
        records,
        warnings,
        storage,
    })
}
#[tauri::command]
pub(crate) async fn checkpoint_recovery(
    store: State<'_, RecoveryStore>,
    files: State<'_, LargeFileRegistry>,
    input: Checkpoint,
) -> Result<Record, String> {
    if let Some(native_version) = input.native_version {
        let stores = files.0.lock().map_err(err)?;
        let source = stores
            .get(&input.document_id)
            .ok_or("Document no longer open")?;
        if source.version != native_version {
            return Err("Document changed before recovery checkpoint".into());
        }
        if source.piece_tree.saved_byte_len() > MAX_BYTES {
            return Err("恢复副本超过 256 MiB 预算".into());
        }
        store.checkpoint(input, source.piece_tree.saved_byte_len(), |path| {
            // Reserve the generation name; never truncate an existing checkpoint.
            OpenOptions::new()
                .create_new(true)
                .write(true)
                .open(path)
                .map_err(err)?;
            source.piece_tree.write_to(path)
        })
    } else {
        let text = input.text.clone().ok_or("Missing recovery text")?;
        if text.len() as u64 > MAX_BYTES {
            return Err("恢复副本超过 256 MiB 预算".into());
        }
        store.checkpoint(input, text.len() as u64, |path| {
            let mut file = OpenOptions::new()
                .create_new(true)
                .write(true)
                .open(path)
                .map_err(err)?;
            file.write_all(text.as_bytes()).map_err(err)?;
            file.sync_all().map_err(err)
        })
    }
}
#[tauri::command]
pub(crate) async fn settle_recovery(
    store: State<'_, RecoveryStore>,
    key: String,
    disposition: String,
) -> Result<(), String> {
    let _guard = store.gate.lock().map_err(err)?;
    let _storage = StorageGuard::acquire(&store.root)?;
    if !safe(&key) || !["saved", "closed"].contains(&disposition.as_str()) {
        return Err("Invalid recovery disposition".into());
    }
    let id = format!("{}-{key}", store.owner);
    let dir = store.directory(&id)?;
    if !dir.join("manifest.json").exists() {
        return Ok(());
    }
    let mut record = store.read(&id)?;
    record.disposition = disposition;
    store.commit(&dir, &record)
}
#[tauri::command]
pub(crate) async fn materialize_recovery(
    store: State<'_, RecoveryStore>,
    id: String,
    destination: Option<String>,
) -> Result<String, String> {
    materialize(&store, &id, destination)
}
fn materialize(
    store: &RecoveryStore,
    id: &str,
    destination: Option<String>,
) -> Result<String, String> {
    let _guard = store.gate.lock().map_err(err)?;
    let storage = StorageGuard::acquire(&store.root)?;
    let record = store.read(id)?;
    if owner_active(record.owner_pid, &record.owner_birth) {
        return Err("该恢复记录仍属于活跃会话".into());
    }
    let source = store.directory(id)?.join(&record.payload);
    if fs::symlink_metadata(&source)
        .map_err(err)?
        .file_type()
        .is_symlink()
    {
        return Err("Invalid recovery payload".into());
    }
    let (bytes, hash) = digest(&source)?;
    if bytes != record.bytes || hash != record.sha256 {
        return Err("恢复副本校验失败；文件已保留，未覆盖原文件".into());
    }
    let output = if let Some(destination) = destination {
        let target = PathBuf::from(destination);
        let name = target.file_name().ok_or("请选择新的副本文件名")?;
        let parent = target
            .parent()
            .ok_or("请选择完整导出路径")?
            .canonicalize()
            .map_err(err)?;
        if parent.starts_with(store.root.canonicalize().map_err(err)?) {
            return Err("导出副本请选择恢复目录以外的位置".into());
        }
        admit_export(&parent, bytes)?;
        parent.join(name)
    } else {
        // Reserve the copy plus worst-case UTF-16 normalization/base work files.
        storage.admit(bytes.saturating_mul(4))?;
        let copies = store.root.join("copies");
        private_dir(&copies)?;
        copies.join(format!("recovered-{}.md", now()))
    };
    let mut from = File::open(source).map_err(err)?;
    let mut to = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&output)
        .map_err(err)?;
    std::io::copy(&mut from, &mut to).map_err(err)?;
    to.sync_all().map_err(err)?;
    drop(to);
    sync_dir(output.parent().ok_or("Invalid recovery output parent")?)?;
    let (size, actual) = digest(&output)?;
    if size != bytes || actual != hash {
        return Err("恢复复制校验失败，保留记录".into());
    }
    Ok(output.to_string_lossy().into_owned())
}
#[tauri::command]
pub(crate) async fn archive_recovery(
    store: State<'_, RecoveryStore>,
    id: String,
    disposition: String,
) -> Result<(), String> {
    let _guard = store.gate.lock().map_err(err)?;
    let _storage = StorageGuard::acquire(&store.root)?;
    if !["restored", "dismissed"].contains(&disposition.as_str()) {
        return Err("Invalid recovery disposition".into());
    }
    let mut record = store.read(&id)?;
    if owner_active(record.owner_pid, &record.owner_birth) {
        return Err("该恢复记录仍属于活跃会话".into());
    }
    record.disposition = disposition;
    store.commit(&store.directory(&id)?, &record)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn store() -> RecoveryStore {
        RecoveryStore::new(std::env::temp_dir().join(format!("milkup-recovery-test-{}", now())))
    }
    fn input(version: usize) -> Checkpoint {
        Checkpoint {
            key: "draft".into(),
            document_id: "doc".into(),
            original_path: Some("/must-not-write-original.md".into()),
            version,
            native_version: None,
            text: None,
        }
    }
    fn write(path: &Path, text: &str) -> Result<(), String> {
        let mut f = File::create(path).map_err(err)?;
        f.write_all(text.as_bytes()).map_err(err)?;
        f.sync_all().map_err(err)
    }
    #[test]
    fn quota_does_not_block_verified_export_or_overwrite_an_existing_target() {
        let store = store();
        let mut record = store
            .checkpoint(input(1), 32, |p| write(p, "unique draft"))
            .unwrap();
        record.owner_pid = 2147483647;
        record.owner_birth = None;
        store
            .commit(&store.directory(&record.id).unwrap(), &record)
            .unwrap();
        File::create(store.root.join("quota"))
            .unwrap()
            .set_len(crate::recovery_storage::LIMIT_BYTES)
            .unwrap();
        assert!(materialize(&store, &record.id, None)
            .unwrap_err()
            .contains("容量上限"));
        let target = store.root.with_extension("export.md");
        let output = materialize(
            &store,
            &record.id,
            Some(target.to_string_lossy().into_owned()),
        )
        .unwrap();
        assert_eq!(fs::read(&output).unwrap(), b"unique draft");
        fs::write(&target, b"external replacement").unwrap();
        assert!(materialize(&store, &record.id, Some(output)).is_err());
        assert_eq!(fs::read(&target).unwrap(), b"external replacement");
        assert_eq!(store.read(&record.id).unwrap().disposition, "pending");
        fs::remove_file(target).unwrap();
        fs::remove_dir_all(store.root).unwrap();
    }

    #[test]
    fn full_directory_refuses_new_checkpoint_without_eviction() {
        let store = store();
        let first = store
            .checkpoint(input(1), 32, |p| write(p, "unique draft"))
            .unwrap();
        let filler = File::create(store.root.join("retained-unknown-file")).unwrap();
        filler
            .set_len(crate::recovery_storage::LIMIT_BYTES)
            .unwrap();
        let error = store
            .checkpoint(input(2), 32, |p| write(p, "new draft"))
            .unwrap_err();
        assert!(error.contains("容量上限"));
        assert_eq!(store.read(&first.id).unwrap().version, 1);
        assert_eq!(
            fs::read(store.directory(&first.id).unwrap().join(first.payload)).unwrap(),
            b"unique draft"
        );
        assert!(store.root.join("retained-unknown-file").exists());
        fs::remove_dir_all(store.root).unwrap();
    }
    #[cfg(target_os = "linux")]
    #[test]
    fn kernel_disk_full_error_leaves_published_checkpoint_intact() {
        let store = store();
        let first = store
            .checkpoint(input(1), 32, |p| write(p, "unique draft"))
            .unwrap();
        let error = store
            .checkpoint(input(2), 32, |_| {
                let mut full = OpenOptions::new()
                    .write(true)
                    .open("/dev/full")
                    .map_err(err)?;
                full.write_all(b"new draft").map_err(err)
            })
            .unwrap_err();
        assert!(error.contains("os error 28"), "{error}");
        assert_eq!(store.read(&first.id).unwrap().version, 1);
        assert_eq!(
            fs::read(store.directory(&first.id).unwrap().join(first.payload)).unwrap(),
            b"unique draft"
        );
        fs::remove_dir_all(store.root).unwrap();
    }

    #[test]
    fn checkpoints_are_complete_hashed_and_keep_previous_committed_generation() {
        let store = store();
        let first = store
            .checkpoint(input(1), 32, |p| write(p, "中文😀\r\n"))
            .unwrap();
        let second = store.checkpoint(input(2), 32, |p| write(p, "two")).unwrap();
        assert_eq!(second.previous, Some(first.payload.clone()));
        let third = store
            .checkpoint(input(3), 32, |p| write(p, "three"))
            .unwrap();
        let dir = store.directory(&third.id).unwrap();
        assert!(!dir.join(first.payload).exists());
        assert!(dir.join(second.payload).exists());
        assert_eq!(store.read(&third.id).unwrap().version, 3);
        assert_eq!(digest(&dir.join(third.payload)).unwrap(), (5, third.sha256));
        fs::remove_dir_all(store.root).unwrap();
    }
    #[test]
    fn partial_write_and_failed_publish_preserve_last_valid_manifest() {
        let store = store();
        let first = store
            .checkpoint(input(1), 32, |p| write(p, "safe"))
            .unwrap();
        assert!(store
            .checkpoint(input(2), 32, |p| {
                write(p, "partial")?;
                Err("interrupted write".into())
            })
            .is_err());
        let record = store.read(&first.id).unwrap();
        assert_eq!(record.version, 1);
        assert_eq!(
            fs::read(store.directory(&first.id).unwrap().join(record.payload)).unwrap(),
            b"safe"
        );
        assert!(store
            .checkpoint(input(0), 32, |p| write(p, "stale"))
            .is_err());
        fs::remove_dir_all(store.root).unwrap();
    }
    #[test]
    fn identifiers_cannot_escape_recovery_root_and_live_owner_is_retained() {
        let store = store();
        assert!(store.directory("../original").is_err());
        assert!(store.directory("/original").is_err());
        assert!(owner_active(std::process::id(), &birth(std::process::id())));
        #[cfg(target_os = "linux")]
        assert!(!owner_active(
            std::process::id(),
            &Some("different-birth".into())
        ));
        let record = store
            .checkpoint(input(1), 32, |p| write(p, "saved"))
            .unwrap();
        assert!(owner_active(record.owner_pid, &record.owner_birth));
        fs::remove_dir_all(store.root).unwrap();
    }
    #[test]
    fn corruption_is_detected_without_modifying_payload_or_original() {
        let store = store();
        let record = store
            .checkpoint(input(1), 32, |p| write(p, "saved"))
            .unwrap();
        let payload = store.directory(&record.id).unwrap().join(&record.payload);
        fs::write(&payload, "other").unwrap();
        assert_ne!(digest(&payload).unwrap().1, record.sha256);
        assert_eq!(store.read(&record.id).unwrap().sha256, record.sha256);
        assert_eq!(fs::read(&payload).unwrap(), b"other");
        fs::remove_dir_all(store.root).unwrap();
    }
}
