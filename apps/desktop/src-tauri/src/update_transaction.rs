//! Native, internal observation transactions. No installer or health authority.
//! A Store owns an exclusive OS lease until dropped. Every mutation rereads the
//! bounded canonical record and compares transaction + revision under that lease.
//! Missing/corrupt records and staging files are never promoted or reset.
use super::policy::{check_private_directory, open_regular, open_regular_for_sync};
use fs2::FileExt;
use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

const LIMIT: usize = 4096;
const FORMAT: &str = "milkup-update-observation";

#[derive(Debug, PartialEq, Eq)]
pub(super) enum Error {
    Busy,
    Conflict,
    Invalid(&'static str),
    Corrupt(String),
    Io(String),
    // The canonical name may already contain the proposed revision. No more
    // mutation is allowed on this handle until snapshot() rereads and syncs it.
    ReloadRequired(String),
}
type Result<T> = std::result::Result<T, Error>;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Intent {
    pub transaction: String,
    pub previous_version: String,
    pub expected_version: String,
    pub installer_sha256: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub(super) enum Phase {
    Prepared,
    HandoffPending,
    AwaitingCompletion,
    LaunchRejected,
    Cancelled,
    NeedsReview,
}
impl Phase {
    fn pending(self) -> bool {
        matches!(
            self,
            Self::Prepared | Self::HandoffPending | Self::AwaitingCompletion
        )
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct Token {
    pub transaction: String,
    pub revision: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Record {
    format: String,
    schema: u32,
    intent: Intent,
    revision: u64,
    created_at: u64,
    updated_at: u64,
    phase: Phase,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Verification {
    Unverified,
}

#[derive(Clone, Copy, Debug)]
pub(super) enum Event {
    BeginHandoff,
    LaunchAccepted,
    LaunchRejected,
    Cancel,
    Retry,
    RequireReview,
}

impl Record {
    pub(super) fn intent(&self) -> &Intent {
        &self.intent
    }

    pub(super) fn token(&self) -> Token {
        Token {
            transaction: self.intent.transaction.clone(),
            revision: self.revision,
        }
    }
    pub(super) fn phase(&self) -> Phase {
        self.phase
    }
    pub(super) fn verification(&self) -> Verification {
        Verification::Unverified
    }

    fn validate(&self) -> Result<()> {
        let hex = |s: &str, len| {
            s.len() == len
                && s.bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        };
        let version = |s: &str| -> Result<semver::Version> {
            if s.len() > 128 {
                return Err(Error::Invalid("version length"));
            }
            let v = semver::Version::parse(s).map_err(|_| Error::Invalid("version"))?;
            if v.to_string() != s {
                return Err(Error::Invalid("canonical version"));
            }
            Ok(v)
        };
        if self.format != FORMAT
            || self.schema != 1
            || !hex(&self.intent.transaction, 32)
            || !hex(&self.intent.installer_sha256, 64)
            || !version(&self.intent.expected_version)?
                .cmp_precedence(&version(&self.intent.previous_version)?)
                .is_gt()
            || self.updated_at < self.created_at
            || (self.revision == 0
                && (self.phase != Phase::Prepared || self.updated_at != self.created_at))
            || (matches!(
                self.phase,
                Phase::AwaitingCompletion | Phase::LaunchRejected
            ) && self.revision < 2)
        {
            return Err(Error::Invalid("transaction shape"));
        }
        Ok(())
    }

    fn next(&self, event: Event, now: u64) -> Result<Self> {
        self.validate()?;
        if now < self.updated_at {
            return Err(Error::Invalid("clock moved backwards"));
        }
        let phase = match (self.phase, event) {
            (Phase::Prepared, Event::BeginHandoff) => Phase::HandoffPending,
            (Phase::Prepared, Event::Cancel) => Phase::Cancelled,
            (Phase::HandoffPending, Event::LaunchAccepted) => Phase::AwaitingCompletion,
            (Phase::HandoffPending, Event::LaunchRejected) => Phase::LaunchRejected,
            (Phase::LaunchRejected | Phase::Cancelled, Event::Retry) => Phase::Prepared,
            (phase, Event::RequireReview) if phase.pending() => Phase::NeedsReview,
            _ => return Err(Error::Invalid("transition")),
        };
        let next = Self {
            phase,
            revision: self
                .revision
                .checked_add(1)
                .ok_or(Error::Invalid("revision overflow"))?,
            updated_at: now,
            ..self.clone()
        };
        next.validate()?;
        Ok(next)
    }
}

pub(super) struct Store {
    directory: PathBuf,
    _lease: File,
    transaction: String,
    reload_required: bool,
}

impl Store {
    // The caller supplies a NEW host-owned transaction directory beneath an
    // existing private parent. Existing directories, even empty ones, are never
    // reused. Partial initialization is retained and requires investigation.
    pub(super) fn create(directory: PathBuf, intent: Intent, now: u64) -> Result<Self> {
        let record = Record {
            format: FORMAT.into(),
            schema: 1,
            intent,
            revision: 0,
            created_at: now,
            updated_at: now,
            phase: Phase::Prepared,
        };
        record.validate()?;
        let mut builder = fs::DirBuilder::new();
        #[cfg(unix)]
        {
            use std::os::unix::fs::DirBuilderExt;
            builder.mode(0o700);
        }
        builder
            .create(&directory)
            .map_err(|e| Error::Io(e.to_string()))?;
        let lease = Self::lease(&directory)?;
        sync_directory(directory.parent().ok_or(Error::Invalid("parent"))?).map_err(Error::Io)?;
        let mut store = Self {
            directory,
            _lease: lease,
            transaction: record.intent.transaction.clone(),
            reload_required: false,
        };
        store.persist(&record)?;
        Ok(store)
    }

    // Opening a previous lease is an explicit coordinator restart. Pending
    // work is durably marked NeedsReview; it can never silently resume or become
    // healthy. Holding the lease prevents concurrent opens disrupting live work.
    pub(super) fn open(directory: PathBuf, now: u64) -> Result<Self> {
        let lease = Self::lease(&directory)?;
        let mut store = Self {
            directory,
            _lease: lease,
            transaction: String::new(),
            reload_required: true,
        };
        let record = store.read()?;
        store.transaction = record.intent.transaction.clone();
        let record = store.snapshot()?;
        if record.phase.pending() {
            let next = record.next(Event::RequireReview, now.max(record.updated_at))?;
            store.persist(&next)?;
        }
        Ok(store)
    }

    fn lease(directory: &Path) -> Result<File> {
        check_private_directory(directory).map_err(Error::Io)?;
        let file =
            open_regular(&directory.join("transaction.lock"), true, false).map_err(Error::Io)?;
        file.try_lock_exclusive().map_err(|_| Error::Busy)?;
        file.sync_all().map_err(|e| Error::Io(e.to_string()))?;
        sync_directory(directory).map_err(Error::Io)?;
        Ok(file)
    }

    fn read(&self) -> Result<Record> {
        check_private_directory(&self.directory).map_err(Error::Io)?;
        let mut bytes = Vec::new();
        open_regular(&self.directory.join("transaction.json"), false, false)
            .map_err(Error::Corrupt)?
            .take((LIMIT + 1) as u64)
            .read_to_end(&mut bytes)
            .map_err(|e| Error::Io(e.to_string()))?;
        if bytes.len() > LIMIT {
            return Err(Error::Corrupt("record exceeds limit; preserved".into()));
        }
        let record: Record =
            serde_json::from_slice(&bytes).map_err(|e| Error::Corrupt(e.to_string()))?;
        record
            .validate()
            .map_err(|e| Error::Corrupt(format!("{e:?}; preserved")))?;
        if !self.transaction.is_empty() && record.intent.transaction != self.transaction {
            return Err(Error::Conflict);
        }
        Ok(record)
    }

    pub(super) fn snapshot(&mut self) -> Result<Record> {
        let record = self.read()?;
        if self.reload_required {
            open_regular_for_sync(&self.directory.join("transaction.json"))
                .map_err(Error::Io)?
                .sync_all()
                .map_err(|e| Error::Io(e.to_string()))?;
            sync_directory(&self.directory).map_err(Error::Io)?;
            self.reload_required = false;
        }
        Ok(record)
    }

    pub(super) fn apply(&mut self, expected: &Token, event: Event, now: u64) -> Result<Record> {
        if self.reload_required {
            return Err(Error::ReloadRequired("reread before any retry".into()));
        }
        let old = self.read()?;
        if old.token() != *expected {
            return Err(Error::Conflict);
        }
        let next = old.next(event, now)?;
        self.persist(&next)?;
        Ok(next)
    }

    fn persist(&mut self, record: &Record) -> Result<()> {
        record.validate()?;
        let bytes = serde_json::to_vec(record).map_err(|e| Error::Io(e.to_string()))?;
        if bytes.len() > LIMIT {
            return Err(Error::Invalid("record size"));
        }
        static SERIAL: AtomicU64 = AtomicU64::new(0);
        let serial = SERIAL.fetch_add(1, Ordering::Relaxed);
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|e| Error::Io(e.to_string()))?
            .as_nanos();
        let temp = self.directory.join(format!(
            ".transaction-{}-{nanos}-{serial}.tmp",
            std::process::id()
        ));
        self.reload_required = true;
        let mut created = false;
        let result: std::result::Result<(), String> = (|| {
            #[cfg(test)]
            tests::before_create(&temp)?;
            let mut file = open_regular(&temp, true, true)?;
            created = true;
            file.write_all(&bytes)
                .and_then(|_| file.sync_all())
                .map_err(|e| e.to_string())?;
            drop(file);
            #[cfg(test)]
            tests::checkpoint(tests::Point::BeforeReplace)?;
            crate::replace_file_atomically(&temp, &self.directory.join("transaction.json"))?;
            #[cfg(test)]
            tests::checkpoint(tests::Point::AfterReplace)?;
            sync_directory(&self.directory)?;
            Ok(())
        })();
        if let Err(error) = result {
            if created {
                let _ = fs::remove_file(&temp);
            }
            return Err(Error::ReloadRequired(error));
        }
        self.reload_required = false;
        Ok(())
    }
}

fn sync_directory(path: &Path) -> std::result::Result<(), String> {
    #[cfg(unix)]
    File::open(path)
        .and_then(|file| file.sync_all())
        .map_err(|e| e.to_string())?;
    // Windows replacement uses the existing MOVEFILE_WRITE_THROUGH primitive;
    // candidate bytes are separately FlushFileBuffers'd by File::sync_all.
    // No claim of tested Windows directory/power-loss durability is made here.
    #[cfg(not(unix))]
    let _ = path;
    Ok(())
}

#[cfg(test)]
#[path = "update_transaction_tests.rs"]
mod tests;
