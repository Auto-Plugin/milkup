//! Admission control, not a filesystem quota. Never evicts recovery data.
use fs2::FileExt;
use serde::Serialize;
use std::fs::{self, File, OpenOptions};
use std::path::{Path, PathBuf};

pub(crate) const LIMIT_BYTES: u64 = 2 * 1024 * 1024 * 1024;
pub(crate) const MIN_FREE_BYTES: u64 = 64 * 1024 * 1024;
const METADATA_BYTES: u64 = 64 * 1024;
const MAX_ENTRIES: usize = 20_000;
const MAX_DEPTH: usize = 8;

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StorageStatus {
    pub(crate) used_bytes: u64,
    pub(crate) limit_bytes: u64,
    pub(crate) available_bytes: u64,
    pub(crate) min_free_bytes: u64,
    entries: usize,
    path: String,
}

pub(crate) struct StorageGuard {
    // Closing the file releases the OS lock, also after process death.
    _file: File,
    root: PathBuf,
}
impl StorageGuard {
    pub(crate) fn acquire(root: &Path) -> Result<Self, String> {
        super::recovery::private_dir(root)?;
        if fs::symlink_metadata(root)
            .map_err(|e| e.to_string())?
            .file_type()
            .is_symlink()
        {
            return Err("恢复目录是符号链接，未写入或删除数据".into());
        }
        let lock = root.join(".storage.lock");
        if lock
            .symlink_metadata()
            .map(|m| !m.is_file() || m.file_type().is_symlink())
            .unwrap_or(false)
        {
            return Err("恢复目录锁文件无效，未写入或删除数据".into());
        }
        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(lock)
            .map_err(|e| e.to_string())?;
        file.try_lock_exclusive().map_err(|e| {
            if e.kind() == std::io::ErrorKind::WouldBlock {
                "另一恢复操作正在使用目录，本次恢复点未更新；已有记录保留，请稍后重试".to_owned()
            } else {
                format!("无法锁定恢复目录：{e}")
            }
        })?;
        Ok(Self {
            _file: file,
            root: root.to_owned(),
        })
    }
    pub(crate) fn status(&self) -> Result<StorageStatus, String> {
        let (used_bytes, entries) = measure(&self.root)?;
        Ok(StorageStatus {
            used_bytes,
            entries,
            limit_bytes: LIMIT_BYTES,
            available_bytes: fs2::available_space(&self.root).map_err(|e| e.to_string())?,
            min_free_bytes: MIN_FREE_BYTES,
            path: self.root.to_string_lossy().into_owned(),
        })
    }
    pub(crate) fn admit(&self, bytes: u64) -> Result<(), String> {
        let status = self.status()?;
        check_capacity(
            status.used_bytes,
            LIMIT_BYTES,
            status.available_bytes,
            bytes,
        )
    }
}
fn check_capacity(used: u64, limit: u64, available: u64, bytes: u64) -> Result<(), String> {
    let needed = bytes
        .checked_add(METADATA_BYTES)
        .ok_or("恢复写入预算溢出")?;
    if used.saturating_add(needed) > limit {
        return Err("恢复目录已达容量上限；已有恢复点未删除。请先导出所需副本，再备份并整理目录；也可手动保存当前文档。".into());
    }
    if available < needed.saturating_add(MIN_FREE_BYTES) {
        return Err("磁盘可用空间不足，无法安全更新恢复点；已有恢复点保留。请释放磁盘空间，或导出／另存为到其他磁盘。".into());
    }
    Ok(())
}
pub(crate) fn admit_export(parent: &Path, bytes: u64) -> Result<(), String> {
    check_capacity(
        0,
        u64::MAX,
        fs2::available_space(parent).map_err(|e| e.to_string())?,
        bytes,
    )
}
fn measure(root: &Path) -> Result<(u64, usize), String> {
    let mut pending = vec![(root.to_owned(), 0)];
    let mut bytes = 0u64;
    let mut entries = 0;
    while let Some((dir, depth)) = pending.pop() {
        if depth > MAX_DEPTH {
            return Err("恢复目录层级过深，无法安全统计配额；已有数据保留".into());
        }
        for entry in fs::read_dir(dir).map_err(|e| format!("无法统计恢复目录：{e}"))? {
            let entry = entry.map_err(|e| e.to_string())?;
            entries += 1;
            if entries > MAX_ENTRIES {
                return Err(
                    "恢复目录条目过多，暂停新增恢复写入；已有数据保留，请备份后整理".into(),
                );
            }
            let metadata = fs::symlink_metadata(entry.path()).map_err(|e| e.to_string())?;
            if metadata.file_type().is_symlink() || (!metadata.is_dir() && !metadata.is_file()) {
                return Err("恢复目录含无法安全统计的链接或特殊文件；已有数据保留".into());
            }
            if metadata.is_dir() {
                pending.push((entry.path(), depth + 1));
            } else {
                bytes = bytes
                    .checked_add(metadata.len())
                    .ok_or("恢复目录用量溢出")?;
            }
        }
    }
    Ok((bytes, entries))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};
    fn root() -> PathBuf {
        std::env::temp_dir().join(format!(
            "milkup-storage-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }
    #[test]
    fn capacity_keeps_write_peak_and_free_space_reserve_without_eviction() {
        assert!(check_capacity(100, 200, u64::MAX, 100)
            .unwrap_err()
            .contains("容量上限"));
        assert!(check_capacity(0, u64::MAX, MIN_FREE_BYTES, 1)
            .unwrap_err()
            .contains("空间不足"));
        assert!(check_capacity(0, 100000, MIN_FREE_BYTES + METADATA_BYTES + 100, 100).is_ok());
    }
    #[test]
    fn counts_archived_partial_and_unknown_files_and_serializes_independent_handles() {
        let root = root();
        let guard = StorageGuard::acquire(&root).unwrap();
        fs::create_dir(root.join("archived")).unwrap();
        fs::write(root.join("archived/snapshot"), b"old checkpoint").unwrap();
        fs::write(root.join("partial"), b"partial").unwrap();
        let status = guard.status().unwrap();
        assert_eq!(status.used_bytes, 21);
        let other = OpenOptions::new()
            .read(true)
            .write(true)
            .open(root.join(".storage.lock"))
            .unwrap();
        assert!(other.try_lock_exclusive().is_err());
        assert!(StorageGuard::acquire(&root).is_err());
        drop(guard);
        other.try_lock_exclusive().unwrap();
        drop(other);
        assert_eq!(
            fs::read(root.join("archived/snapshot")).unwrap(),
            b"old checkpoint"
        );
        fs::remove_dir_all(root).unwrap();
    }
    #[cfg(unix)]
    #[test]
    fn does_not_follow_links_or_accept_unbounded_nested_directories() {
        let root = root();
        let guard = StorageGuard::acquire(&root).unwrap();
        std::os::unix::fs::symlink("/dev/null", root.join("foreign")).unwrap();
        assert!(guard.status().is_err());
        assert!(root.join("foreign").symlink_metadata().is_ok());
        fs::remove_file(root.join("foreign")).unwrap();
        let mut nested = root.clone();
        for _ in 0..10 {
            nested = nested.join("deep");
            fs::create_dir(&nested).unwrap();
        }
        assert!(guard.status().unwrap_err().contains("层级"));
        drop(guard);
        fs::remove_dir_all(root).unwrap();
    }
}
