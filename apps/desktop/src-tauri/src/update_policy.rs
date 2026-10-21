//! Host-owned update trust state. No plugin receives a path, reset, rollback flag,
//! clock override or signing setting. Wall-clock expiry is a bounded freeze gate,
//! not a trusted clock or protection against deletion by the OS account owner.
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use fs2::FileExt;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri_plugin_updater::Update;

const MAX_STATE_BYTES: u64 = 8192;
const MAX_VALIDITY: u64 = 7 * 24 * 60 * 60;
const CLOCK_SKEW: u64 = 300;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Freshness {
    sequence: u64,
    issued_at: u64,
    expires_at: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    rollback_from: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Observation {
    version: String,
    freshness: Freshness,
    statement_hash: String,
}

impl Observation {
    pub(super) fn from_update(update: &Update) -> Result<Self, String> {
        let release = update.verified_release().ok_or("更新元数据签名绑定失效")?;
        let freshness: Freshness = serde_json::from_value(release["milkup"].clone())
            .map_err(|_| "签名更新清单缺少有效期或序号，请等待发布方更新清单")?;
        let statement = serde_json::to_vec(release).map_err(|error| error.to_string())?;
        Ok(Self {
            version: update.version.clone(),
            freshness,
            statement_hash: format!("{:x}", Sha256::digest(statement)),
        })
    }

    fn validate(&self, now: u64) -> Result<semver::Version, String> {
        let version = version(&self.version)?;
        if self.statement_hash.len() != 64
            || !self
                .statement_hash
                .bytes()
                .all(|byte| byte.is_ascii_hexdigit())
        {
            return Err("更新信任记录摘要无效".into());
        }
        let f = &self.freshness;
        if f.sequence == 0
            || f.expires_at <= f.issued_at
            || f.expires_at - f.issued_at > MAX_VALIDITY
        {
            return Err("签名更新清单的序号或有效期无效（最长 7 天）".into());
        }
        if f.issued_at > now.saturating_add(CLOCK_SKEW) {
            return Err("更新清单尚未生效，请检查系统时间或稍后重试".into());
        }
        if f.expires_at <= now {
            return Err("签名更新清单已过期，无法确认更新渠道是否冻结；请重试检查".into());
        }
        if let Some(from) = &f.rollback_from {
            if !version.cmp_precedence(&self::version(from)?).is_lt() {
                return Err("签名候选撤回授权的版本范围无效".into());
            }
        }
        Ok(version)
    }
}

fn version(text: &str) -> Result<semver::Version, String> {
    if text.len() > 128 {
        return Err("更新版本长度超过上限".into());
    }
    let parsed = semver::Version::parse(text).map_err(|_| "更新版本无效")?;
    if parsed.to_string() != text {
        return Err("更新版本不是规范 SemVer".into());
    }
    Ok(parsed)
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Record {
    schema: u32,
    scope: String,
    highest_version: String,
    latest: Observation,
}

fn observe(
    previous: Option<&Record>,
    incoming: &Observation,
    scope: &str,
    installed: &str,
    now: u64,
) -> Result<Record, String> {
    let next = incoming.validate(now)?;
    let mut highest = version(installed)?;
    if let Some(old) = previous {
        if old.schema != 1 || old.scope != scope {
            return Err("更新信任记录范围无效；记录已保留".into());
        }
        let recorded_highest = version(&old.highest_version)?;
        // Validate persisted shape at a time inside its original validity; an
        // expired record must remain usable to accept a fresh signed renewal.
        let old_version = old.latest.validate(old.latest.freshness.issued_at)?;
        if old_version.cmp_precedence(&recorded_highest).is_gt() {
            return Err("更新信任记录不一致；记录已保留".into());
        }
        if recorded_highest.cmp_precedence(&highest).is_gt() {
            highest = recorded_highest;
        }
        if now.saturating_add(CLOCK_SKEW) < old.latest.freshness.issued_at {
            return Err("系统时间早于已验证清单，请校正时间后重试".into());
        }
        if incoming.freshness.sequence < old.latest.freshness.sequence {
            return Err("更新清单序号倒退，已拒绝回放；请重试检查".into());
        }
        if incoming.freshness.sequence == old.latest.freshness.sequence {
            if incoming != &old.latest {
                return Err("同一更新清单序号出现冲突内容".into());
            }
            // Repeated checks and failed/cancelled downloads are retryable. A
            // previously authorized withdrawal need not authorize itself again.
            return Ok(Record {
                highest_version: highest.to_string(),
                ..old.clone()
            });
        }
        if incoming.freshness.issued_at < old.latest.freshness.issued_at {
            return Err("签名更新清单发布时间倒退".into());
        }
        if next.cmp_precedence(&highest).is_lt()
            && incoming.version != old.latest.version
            && incoming.freshness.rollback_from.as_deref() != Some(highest.to_string().as_str())
        {
            return Err("更新候选低于最高已见版本，缺少签名撤回授权".into());
        }
    }
    // First observation of an older installed release is an authenticated
    // no-update statement, not an instruction to downgrade the application.
    if next.cmp_precedence(&highest).is_gt() {
        highest = next;
    }
    Ok(Record {
        schema: 1,
        scope: scope.to_owned(),
        highest_version: highest.to_string(),
        latest: incoming.clone(),
    })
}

pub(super) fn now() -> Result<u64, String> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|time| time.as_secs())
        .map_err(|_| "系统时间早于 Unix 起点".into())
}

pub(super) struct Store {
    directory: PathBuf,
    scope: String,
    installed: String,
}

impl Store {
    pub(super) fn new(directory: PathBuf, channel: &str, target: &str, installed: &str) -> Self {
        // The parent directory comes only from Tauri app_data_dir. Scope is not
        // a path and survives public-key rotation without resetting high water.
        let scope = format!("milkup-desktop/{channel}/{target}");
        let name = format!("{:x}", Sha256::digest(scope.as_bytes()));
        Self {
            directory: directory.join("update-trust").join(name),
            scope,
            installed: installed.into(),
        }
    }

    fn locked(&self) -> Result<File, String> {
        fs::create_dir_all(&self.directory).map_err(|error| error.to_string())?;
        check_private_directory(&self.directory)?;
        let lock = open_regular(&self.directory.join("state.lock"), true, false)?;
        lock.try_lock_exclusive()
            .map_err(|_| "另一个应用实例正在检查更新，请重试")?;
        Ok(lock)
    }

    fn read(&self) -> Result<Option<Record>, String> {
        let path = self.directory.join("state.json");
        match fs::symlink_metadata(&path) {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(error.to_string()),
            Ok(_) => {}
        }
        let mut bytes = Vec::new();
        open_regular(&path, false, false)?
            .take(MAX_STATE_BYTES + 1)
            .read_to_end(&mut bytes)
            .map_err(|error| error.to_string())?;
        if bytes.len() as u64 > MAX_STATE_BYTES {
            return Err("更新信任记录过大；原文件已保留".into());
        }
        serde_json::from_slice(&bytes)
            .map(Some)
            .map_err(|_| "更新信任记录损坏；原文件已保留，未重置信任记录".into())
    }

    pub(super) fn accept(&self, observation: &Observation, now: u64) -> Result<(), String> {
        let _lock = self.locked()?;
        let old = self.read()?;
        let next = observe(old.as_ref(), observation, &self.scope, &self.installed, now)?;
        if old.as_ref() == Some(&next) {
            return Ok(());
        }
        let bytes = serde_json::to_vec(&next).map_err(|error| error.to_string())?;
        if bytes.len() as u64 > MAX_STATE_BYTES {
            return Err("更新信任记录超过上限".into());
        }
        static SERIAL: AtomicU64 = AtomicU64::new(0);
        let temp = self.directory.join(format!(
            ".state-{}-{}-{}.tmp",
            std::process::id(),
            now,
            SERIAL.fetch_add(1, Ordering::Relaxed)
        ));
        let mut created = false;
        let result = (|| {
            let mut file = open_regular(&temp, true, true)?;
            created = true;
            file.write_all(&bytes)
                .and_then(|_| file.sync_all())
                .map_err(|error| error.to_string())?;
            drop(file);
            crate::replace_file_atomically(&temp, &self.directory.join("state.json"))?;
            #[cfg(unix)]
            for directory in self.directory.ancestors().take(3) {
                File::open(directory)
                    .and_then(|dir| dir.sync_all())
                    .map_err(|e| e.to_string())?;
            }
            Ok(())
        })();
        // Only our exclusive, newly created leaf may be removed. A failed
        // creation never removes a colliding file owned by another operation.
        if result.is_err() && created {
            // Temp names are scoped under the held process lock; only this
            // process uses the serial. No trust-state reset or package cleanup.
            let _ = fs::remove_file(&temp);
        }
        result
    }

    pub(super) fn authorize(&self, observation: &Observation, now: u64) -> Result<(), String> {
        let _lock = self.locked()?;
        self.authorize_locked(observation, now)
    }

    // Observation must not initialize a missing trust directory or lock file.
    // Reuse the same policy under a shared OS lease, with read-only file handles.
    pub(super) fn authorize_existing(
        &self,
        observation: &Observation,
        now: u64,
    ) -> Result<(), String> {
        check_private_directory(&self.directory)?;
        let lock = open_regular(&self.directory.join("state.lock"), false, false)?;
        FileExt::try_lock_shared(&lock).map_err(|_| "更新信任记录正在变更，请重试")?;
        self.authorize_locked(observation, now)
    }

    fn authorize_locked(&self, observation: &Observation, now: u64) -> Result<(), String> {
        let old = self.read()?.ok_or("请重新检查更新以建立信任记录")?;
        let next = observe(Some(&old), observation, &self.scope, &self.installed, now)?;
        if next.latest != old.latest {
            return Err("更新候选已失效，请重新检查更新".into());
        }
        Ok(())
    }
}

// Shared only inside the native update module. Account-owner replacement of
// parent directories remains outside the existing local trust model.
pub(super) fn check_private_directory(directory: &Path) -> Result<(), String> {
    let metadata = fs::symlink_metadata(directory).map_err(|e| e.to_string())?;
    if !metadata.is_dir() {
        return Err("更新信任目录不是普通目录".into());
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        use windows_sys::Win32::Storage::FileSystem::FILE_ATTRIBUTE_REPARSE_POINT;
        if metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            return Err("更新信任目录不能使用重解析点".into());
        }
    }
    Ok(())
}

pub(super) fn open_regular(path: &Path, create: bool, exclusive: bool) -> Result<File, String> {
    open_regular_access(path, create, exclusive, create)
}

// FlushFileBuffers on Windows needs write access, but rereading an uncertain
// commit must never create a missing canonical file.
pub(super) fn open_regular_for_sync(path: &Path) -> Result<File, String> {
    open_regular_access(path, false, false, true)
}

fn open_regular_access(
    path: &Path,
    create: bool,
    exclusive: bool,
    write: bool,
) -> Result<File, String> {
    let mut options = OpenOptions::new();
    options
        .read(true)
        .write(write)
        .create(create && !exclusive)
        .create_new(exclusive);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options
            .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC | libc::O_NONBLOCK)
            .mode(0o600);
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        use windows_sys::Win32::Storage::FileSystem::FILE_FLAG_OPEN_REPARSE_POINT;
        options.custom_flags(FILE_FLAG_OPEN_REPARSE_POINT);
    }
    let file = options.open(path).map_err(|error| error.to_string())?;
    let meta = file.metadata().map_err(|e| e.to_string())?;
    if !meta.is_file() {
        return Err("更新信任记录不是普通文件".into());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if meta.nlink() != 1 {
            return Err("更新信任记录不能使用硬链接".into());
        }
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        use windows_sys::Win32::Storage::FileSystem::FILE_ATTRIBUTE_REPARSE_POINT;
        if meta.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            return Err("更新信任记录不能使用重解析点".into());
        }
    }
    Ok(file)
}

#[cfg(test)]
mod tests {
    use super::*;
    const NOW: u64 = 1_800_000_100;
    const SCOPE: &str = "milkup-desktop/beta/windows-x86_64";
    fn statement(ver: &str, seq: u64) -> Observation {
        Observation {
            version: ver.into(),
            freshness: Freshness {
                sequence: seq,
                issued_at: NOW - 100,
                expires_at: NOW + 3500,
                rollback_from: None,
            },
            statement_hash: format!("{:x}", Sha256::digest(format!("{ver}:{seq}"))),
        }
    }
    fn accepted(old: Option<&Record>, next: &Observation, now: u64) -> Result<Record, String> {
        observe(old, next, SCOPE, "2.0.0-beta.1", now)
    }
    struct Temp(PathBuf);
    impl Temp {
        fn new() -> Self {
            static SERIAL: AtomicU64 = AtomicU64::new(0);
            let root = std::env::temp_dir().join(format!(
                "milkup-update-policy-{}-{}-{}",
                std::process::id(),
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap()
                    .as_nanos(),
                SERIAL.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir(&root).unwrap();
            Self(root)
        }
        fn store(&self) -> Store {
            Store::new(self.0.clone(), "beta", "windows-x86_64", "2.0.0-beta.1")
        }
    }
    impl Drop for Temp {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn replay_and_equivocation_fail_but_same_statement_and_renewal_retry() {
        let fresh = statement("2.0.0-beta.2", 4);
        let old = accepted(None, &fresh, NOW).unwrap();
        assert_eq!(accepted(Some(&old), &fresh, NOW + 1).unwrap(), old);
        assert!(accepted(Some(&old), &statement("2.0.0-beta.3", 3), NOW).is_err());
        assert!(accepted(Some(&old), &statement("2.0.0-beta.3", 4), NOW).is_err());
        let mut renewal = statement("2.0.0-beta.2", 5);
        renewal.freshness.issued_at = NOW + 4000;
        renewal.freshness.expires_at = NOW + 5000;
        assert_eq!(
            accepted(Some(&old), &renewal, NOW + 4000).unwrap().latest,
            renewal
        );
        assert!(accepted(Some(&old), &fresh, NOW + 4000).is_err());
    }

    #[test]
    fn signed_withdrawal_keeps_highest_seen_and_does_not_lock_retry() {
        let high = statement("2.0.0-beta.4", 4);
        let old = accepted(None, &high, NOW).unwrap();
        let mut lower = statement("2.0.0-beta.3", 5);
        assert!(accepted(Some(&old), &lower, NOW).is_err());
        lower.freshness.rollback_from = Some("2.0.0-beta.2".into());
        assert!(accepted(Some(&old), &lower, NOW).is_err());
        lower.freshness.rollback_from = Some("2.0.0-beta.4".into());
        let withdrawn = accepted(Some(&old), &lower, NOW).unwrap();
        assert_eq!(withdrawn.highest_version, "2.0.0-beta.4");
        assert_eq!(
            accepted(Some(&withdrawn), &lower, NOW + 1).unwrap(),
            withdrawn
        );
        assert!(accepted(Some(&withdrawn), &high, NOW).is_err());
        assert!(accepted(Some(&withdrawn), &statement("2.0.0-beta.3", 6), NOW).is_ok());
        assert!(accepted(Some(&withdrawn), &statement("2.0.0-beta.5", 6), NOW).is_ok());
    }

    #[test]
    fn first_no_update_is_authenticated_and_installed_floor_never_drops() {
        let older = statement("1.9.9", 1);
        let record = accepted(None, &older, NOW).unwrap();
        assert_eq!(record.highest_version, "2.0.0-beta.1");
        assert_eq!(accepted(Some(&record), &older, NOW).unwrap(), record);
        assert!(accepted(Some(&record), &statement("1.9.9", 2), NOW).is_ok());
        let same = statement("2.0.0-beta.1", 2);
        assert!(accepted(Some(&record), &same, NOW).is_ok());
        let upgraded = observe(Some(&record), &older, SCOPE, "2.0.0", NOW).unwrap();
        assert_eq!(upgraded.highest_version, "2.0.0");
    }

    #[test]
    fn expiry_future_clock_and_bounded_validity_are_checked_without_poisoning_state() {
        let good = statement("2.0.0-beta.2", 2);
        let old = accepted(None, &good, NOW).unwrap();
        for (issued, expires, seq) in [
            (NOW - 100, NOW, 2),
            (NOW + 301, NOW + 400, 3),
            (NOW - 100, NOW - 100 + MAX_VALIDITY + 1, 3),
            (NOW, NOW, 3),
            (NOW - 100, NOW + 10, 0),
        ] {
            let mut bad = good.clone();
            bad.freshness.issued_at = issued;
            bad.freshness.expires_at = expires;
            bad.freshness.sequence = seq;
            assert!(accepted(Some(&old), &bad, NOW).is_err());
        }
        assert!(accepted(Some(&old), &good, NOW - 401).is_err());
        assert!(accepted(Some(&old), &good, u64::MAX).is_err());
        assert_eq!(accepted(Some(&old), &good, NOW).unwrap(), old);
        let mut moved_back = statement("2.0.0-beta.3", 3);
        moved_back.freshness.issued_at -= 1;
        assert!(accepted(Some(&old), &moved_back, NOW).is_err());
    }

    #[test]
    fn malformed_versions_and_records_fail_closed() {
        for ver in ["v2.0.0", "2.0", "2.0.0-01", "", "2.0.0+雪"] {
            assert!(accepted(None, &statement(ver, 2), NOW).is_err());
        }
        let good = statement("2.0.0-beta.2", 2);
        let record = accepted(None, &good, NOW).unwrap();
        for index in 0..5 {
            let mut damaged = record.clone();
            match index {
                0 => damaged.schema = 2,
                1 => damaged.scope = "other".into(),
                2 => damaged.highest_version = "1.0.0".into(),
                3 => damaged.latest.statement_hash.clear(),
                _ => damaged.latest.freshness.sequence = 0,
            }
            assert!(accepted(Some(&damaged), &good, NOW).is_err());
        }
    }

    #[test]
    fn persistent_high_water_survives_reopen_failures_and_expired_record_renewal() {
        let temp = Temp::new();
        let good = statement("2.0.0-beta.2", 2);
        temp.store().accept(&good, NOW).unwrap();
        let store = temp.store();
        let original = fs::read(store.directory.join("state.json")).unwrap();
        for _ in 0..3 {
            store.authorize(&good, NOW).unwrap();
            store.accept(&good, NOW).unwrap();
        }
        assert_eq!(
            original,
            fs::read(store.directory.join("state.json")).unwrap()
        );
        assert!(store.accept(&statement("2.0.0-beta.1", 1), NOW).is_err());
        assert!(store.authorize(&good, NOW + 4000).is_err());
        assert_eq!(
            original,
            fs::read(store.directory.join("state.json")).unwrap()
        );
        let mut renewal = statement("2.0.0-beta.2", 3);
        renewal.freshness.issued_at = NOW + 4000;
        renewal.freshness.expires_at = NOW + 5000;
        store.accept(&renewal, NOW + 4000).unwrap();
        assert!(temp.store().authorize(&good, NOW).is_err());
        temp.store().authorize(&renewal, NOW + 4000).unwrap();
    }

    #[test]
    fn damaged_or_oversized_state_is_preserved_and_lock_contention_is_retryable() {
        let temp = Temp::new();
        let store = temp.store();
        let good = statement("2.0.0-beta.2", 2);
        let held = store.locked().unwrap();
        assert!(temp.store().accept(&good, NOW).is_err());
        drop(held);
        store.accept(&good, NOW).unwrap();
        let path = store.directory.join("state.json");
        for bad in [
            b"{truncated".to_vec(),
            vec![b'x'; MAX_STATE_BYTES as usize + 1],
        ] {
            fs::write(&path, &bad).unwrap();
            assert!(store.accept(&good, NOW).is_err());
            assert!(store.authorize(&good, NOW).is_err());
            assert_eq!(fs::read(&path).unwrap(), bad);
        }
    }

    #[test]
    fn state_is_scoped_and_authorization_never_creates_a_new_observation() {
        let temp = Temp::new();
        let good = statement("2.0.0-beta.2", 2);
        let store = temp.store();
        assert!(store.authorize(&good, NOW).is_err());
        store.accept(&good, NOW).unwrap();
        let higher = statement("2.0.0-beta.3", 3);
        assert!(store.authorize(&higher, NOW).is_err());
        store.authorize(&good, NOW).unwrap();
        let stable = Store::new(temp.0.clone(), "stable", "windows-x86_64", "2.0.0-beta.1");
        assert!(stable.authorize(&good, NOW).is_err());
        assert_ne!(store.directory, stable.directory);
    }

    #[cfg(unix)]
    #[test]
    fn alias_leaves_are_rejected_without_touching_external_content() {
        use std::os::unix::fs::symlink;
        let temp = Temp::new();
        let store = temp.store();
        let good = statement("2.0.0-beta.2", 2);
        let outside = temp.0.join("sentinel");
        fs::write(&outside, b"preserve").unwrap();
        fs::create_dir_all(&store.directory).unwrap();
        let path = store.directory.join("state.json");
        symlink(&outside, &path).unwrap();
        assert!(store.accept(&good, NOW).is_err());
        assert_eq!(fs::read(&outside).unwrap(), b"preserve");
        fs::remove_file(&path).unwrap();
        fs::hard_link(&outside, &path).unwrap();
        assert!(store.accept(&good, NOW).is_err());
        assert_eq!(fs::read(&outside).unwrap(), b"preserve");
    }
}
