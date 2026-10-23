//! Bounded teardown of a newly owned private test tree, after its Job is empty.
use serde_json::{json, Value};
use std::{
    fs, io,
    path::Path,
    thread,
    time::{Duration, Instant},
};

const ATTEMPTS: usize = 31;
const INTERVAL: Duration = Duration::from_millis(100);
const RETRY_DEADLINE: Duration = Duration::from_secs(3);

fn remove_with_retry(
    mut remove: impl FnMut() -> io::Result<()>,
    mut pause: impl FnMut(),
    observations: &mut Vec<Value>,
) -> io::Result<()> {
    let started = Instant::now();
    for attempt in 1..=ATTEMPTS {
        match remove() {
            Ok(()) => return Ok(()),
            // A partially completed remove can leave the root already absent.
            // The caller must still independently verify its absence.
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
            Err(error) => {
                let retryable = matches!(error.raw_os_error(), Some(32 | 33));
                observations.push(json!({
                    "attempt":attempt,"osError":error.raw_os_error(),
                    "retryableSharingOrLockViolation":retryable
                }));
                if !retryable || attempt == ATTEMPTS || started.elapsed() >= RETRY_DEADLINE {
                    return Err(error);
                }
                pause();
                if started.elapsed() >= RETRY_DEADLINE {
                    return Err(error);
                }
            }
        }
    }
    unreachable!()
}

pub fn remove_owned_tree(path: &Path, observations: &mut Vec<Value>) -> io::Result<()> {
    remove_with_retry(
        || fs::remove_dir_all(path),
        || thread::sleep(INTERVAL),
        observations,
    )?;
    match fs::symlink_metadata(path) {
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error),
        Ok(_) => Err(io::Error::other("Private tree still exists after deletion")),
    }
}

/// Only a canonical, concrete local/domain user SID may receive cleanup access.
/// Broad built-in group, Everyone and AppContainer SIDs are not accepted.
pub fn concrete_user_sid(value: &str) -> bool {
    let Some(parts) = value.strip_prefix("S-1-5-21-") else {
        return false;
    };
    let parts: Vec<_> = parts.split('-').collect();
    parts.len() == 4
        && parts.iter().all(|part| {
            !part.is_empty()
                && part.bytes().all(|byte| byte.is_ascii_digit())
                && part
                    .parse::<u32>()
                    .is_ok_and(|number| number > 0 && number.to_string() == *part)
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn retry_only_transient_windows_sharing_errors_with_a_bound() {
        let mut observations = Vec::new();
        let mut calls = 0;
        let mut pauses = 0;
        remove_with_retry(
            || {
                calls += 1;
                if calls < 3 {
                    Err(io::Error::from_raw_os_error(32 + calls - 1))
                } else {
                    Ok(())
                }
            },
            || pauses += 1,
            &mut observations,
        )
        .unwrap();
        assert_eq!((calls, pauses, observations.len()), (3, 2, 2));
        let mut calls = 0;
        let mut pauses = 0;
        assert!(remove_with_retry(
            || {
                calls += 1;
                Err(io::Error::from_raw_os_error(32))
            },
            || pauses += 1,
            &mut Vec::new()
        )
        .is_err());
        assert_eq!((calls, pauses), (ATTEMPTS, ATTEMPTS - 1));
        let mut calls = 0;
        assert!(remove_with_retry(
            || {
                calls += 1;
                Err(io::Error::from_raw_os_error(5))
            },
            || panic!("Access denial must not be retried"),
            &mut Vec::new()
        )
        .is_err());
        assert_eq!(calls, 1);
    }

    #[test]
    fn cleanup_sid_cannot_name_groups_or_inject_acl_arguments() {
        assert!(concrete_user_sid(
            "S-1-5-21-3776380004-1005456608-3524014338-1001"
        ));
        for sid in [
            "S-1-5-32-544",
            "S-1-1-0",
            "S-1-15-2-1",
            "S-1-5-21-1-2-3-0",
            "S-1-5-21-1-2-3-01",
            "S-1-5-21-1-2-3-4294967296",
            "S-1-5-21-1-2-3-4:(OI)(CI)F",
            "S-1-5-21-1-2-3-4\0",
        ] {
            assert!(!concrete_user_sid(sid), "{sid:?}");
        }
    }

    #[test]
    fn actual_owned_tree_is_absent_after_success() {
        let root = std::env::temp_dir().join(format!(
            "milkup-owned-tree-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir(&root).unwrap();
        fs::write(root.join("synthetic"), b"owned test data").unwrap();
        remove_owned_tree(&root, &mut Vec::new()).unwrap();
        assert_eq!(
            fs::symlink_metadata(root).unwrap_err().kind(),
            io::ErrorKind::NotFound
        );
    }

    #[cfg(windows)]
    #[test]
    fn real_windows_file_handle_release_allows_owned_tree_cleanup() {
        use std::{fs::OpenOptions, os::windows::fs::OpenOptionsExt, time::SystemTime};
        let root = std::env::temp_dir().join(format!(
            "milkup-owned-cleanup-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(SystemTime::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir(&root).unwrap();
        let pin = OpenOptions::new()
            .write(true)
            .create_new(true)
            .share_mode(0)
            .open(root.join("pinned"))
            .unwrap();
        // The first actual remove must encounter the held Windows file handle.
        let mut observations = Vec::new();
        let mut pin = Some(pin);
        remove_with_retry(
            || fs::remove_dir_all(&root),
            || {
                drop(pin.take());
                thread::sleep(INTERVAL);
            },
            &mut observations,
        )
        .unwrap();
        assert!(!root.exists());
        assert!(!observations.is_empty());
        // The public path also verifies absence rather than treating NotFound alone as proof.
        remove_owned_tree(&root, &mut Vec::new()).unwrap();
    }
}
