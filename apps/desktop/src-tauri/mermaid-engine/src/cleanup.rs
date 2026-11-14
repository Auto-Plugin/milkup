//! Bounded teardown of a newly owned private test tree, after its Job is empty.
use serde::Serialize;
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

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum TreeRemovalPhase {
    Remove,
    AbsenceCheck,
    Complete,
}

/// Numeric observations of one removal and its independent absence check.
/// A null OS error does not imply success: callers must retain the returned
/// Result, including failures created without an underlying OS error.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TreeRemovalFacts {
    /// Every remove call, including the final successful or NotFound call.
    pub(crate) attempts: u32,
    /// The complete removal plus absence check; this does not extend retries.
    pub(crate) elapsed_ms: u64,
    /// Exactly the final returned io::Error::raw_os_error(), without guessing.
    pub(crate) final_os_error: Option<i32>,
    pub(crate) terminal_phase: TreeRemovalPhase,
    pub(crate) absence_checked: bool,
    /// None means absence was not established either way, not an absent tree.
    pub(crate) absent: Option<bool>,
    /// Existing failed-attempt records, at most ATTEMPTS entries per call.
    pub(crate) observations: Vec<Value>,
}

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
                // Retry these numeric Windows deletion errors within the same
                // budget, without inferring the cause of an access denial.
                let retryable = matches!(error.raw_os_error(), Some(5 | 32 | 33));
                observations.push(json!({
                    "attempt":attempt,"osError":error.raw_os_error(),
                    "retryableWindowsDeleteError":retryable
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
    remove_owned_tree_with(path, observations, || fs::remove_dir_all(path))
}

pub(crate) fn remove_owned_tree_observed(path: &Path) -> (io::Result<()>, TreeRemovalFacts) {
    remove_owned_tree_observed_with(
        || fs::remove_dir_all(path),
        || thread::sleep(INTERVAL),
        || fs::symlink_metadata(path).map(|_| ()),
    )
}

/// The diagnostic supplies one removal implementation; retry and absence checks stay here.
pub(crate) fn remove_owned_tree_with(
    path: &Path,
    observations: &mut Vec<Value>,
    remove: impl FnMut() -> io::Result<()>,
) -> io::Result<()> {
    let (result, facts) = remove_owned_tree_observed_with(
        remove,
        || thread::sleep(INTERVAL),
        || fs::symlink_metadata(path).map(|_| ()),
    );
    observations.extend(facts.observations);
    result
}

/// Keep the original retry loop and final absence semantics in one place. Tests
/// inject operations and pauses, without changing production retry timing.
fn remove_owned_tree_observed_with(
    mut remove: impl FnMut() -> io::Result<()>,
    pause: impl FnMut(),
    probe_presence: impl FnOnce() -> io::Result<()>,
) -> (io::Result<()>, TreeRemovalFacts) {
    let started = Instant::now();
    let mut attempts = 0;
    let mut observations = Vec::new();
    let mut terminal_phase = TreeRemovalPhase::Remove;
    let mut absence_checked = false;
    let mut absent = None;
    let result = remove_with_retry(
        || {
            attempts += 1;
            remove()
        },
        pause,
        &mut observations,
    )
    .and_then(|()| {
        absence_checked = true;
        terminal_phase = TreeRemovalPhase::AbsenceCheck;
        match probe_presence() {
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                absent = Some(true);
                terminal_phase = TreeRemovalPhase::Complete;
                Ok(())
            }
            Err(error) => Err(error),
            Ok(()) => {
                absent = Some(false);
                Err(io::Error::other("Private tree still exists after deletion"))
            }
        }
    });
    let facts = TreeRemovalFacts {
        attempts,
        elapsed_ms: u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX),
        final_os_error: result.as_ref().err().and_then(io::Error::raw_os_error),
        terminal_phase,
        absence_checked,
        absent,
        observations,
    };
    (result, facts)
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

    fn absent() -> io::Result<()> {
        Err(io::Error::new(io::ErrorKind::NotFound, "synthetic absence"))
    }

    #[test]
    fn observed_success_and_not_found_both_require_independent_absence() {
        for remove_was_not_found in [false, true] {
            let mut probes = 0;
            let (result, facts) = remove_owned_tree_observed_with(
                || {
                    if remove_was_not_found {
                        absent()
                    } else {
                        Ok(())
                    }
                },
                || panic!("Success and NotFound must not pause"),
                || {
                    probes += 1;
                    absent()
                },
            );
            result.unwrap();
            assert_eq!(probes, 1);
            assert_eq!(facts.attempts, 1);
            assert_eq!(facts.terminal_phase, TreeRemovalPhase::Complete);
            assert!(facts.absence_checked);
            assert_eq!(facts.absent, Some(true));
            assert_eq!(facts.final_os_error, None);
            assert!(facts.observations.is_empty());
        }
    }

    #[test]
    fn observed_nonretryable_error_is_preserved_without_pause_or_absence_probe() {
        let original = io::Error::from_raw_os_error(87);
        let original_kind = original.kind();
        let original_message = original.to_string();
        let mut original = Some(original);
        let (result, facts) = remove_owned_tree_observed_with(
            || Err(original.take().expect("Exactly one remove call")),
            || panic!("Error 87 must not pause"),
            || panic!("A failed remove must not probe absence"),
        );
        let error = result.unwrap_err();
        assert_eq!(error.raw_os_error(), Some(87));
        assert_eq!(error.kind(), original_kind);
        assert_eq!(error.to_string(), original_message);
        assert_eq!(facts.attempts, 1);
        assert_eq!(facts.final_os_error, Some(87));
        assert_eq!(facts.terminal_phase, TreeRemovalPhase::Remove);
        assert!(!facts.absence_checked);
        assert_eq!(facts.absent, None);
        assert_eq!(
            facts.observations,
            vec![json!({
                "attempt":1,"osError":87,"retryableWindowsDeleteError":false
            })]
        );
    }

    #[test]
    fn observed_retry_success_counts_the_successful_remove_call() {
        let mut calls = 0;
        let mut pauses = 0;
        let (result, facts) = remove_owned_tree_observed_with(
            || {
                calls += 1;
                match calls {
                    1 => Err(io::Error::from_raw_os_error(32)),
                    2 => Err(io::Error::from_raw_os_error(33)),
                    3 => Ok(()),
                    _ => panic!("No remove call after success"),
                }
            },
            || pauses += 1,
            absent,
        );
        result.unwrap();
        assert_eq!((calls, pauses, facts.attempts), (3, 2, 3));
        assert_eq!(facts.terminal_phase, TreeRemovalPhase::Complete);
        assert_eq!(facts.final_os_error, None);
        assert_eq!(facts.absent, Some(true));
        assert_eq!(
            facts.observations,
            vec![
                json!({"attempt":1,"osError":32,"retryableWindowsDeleteError":true}),
                json!({"attempt":2,"osError":33,"retryableWindowsDeleteError":true}),
            ]
        );
    }

    #[test]
    fn access_denied_retry_success_records_numeric_error_and_retry_eligibility() {
        let mut calls = 0;
        let mut pauses = 0;
        let mut probes = 0;
        let (result, facts) = remove_owned_tree_observed_with(
            || {
                calls += 1;
                match calls {
                    1 => Err(io::Error::from_raw_os_error(5)),
                    2 => Ok(()),
                    _ => panic!("No remove call after success"),
                }
            },
            || pauses += 1,
            || {
                probes += 1;
                absent()
            },
        );
        result.unwrap();
        assert_eq!((calls, pauses, probes, facts.attempts), (2, 1, 1, 2));
        assert_eq!(facts.terminal_phase, TreeRemovalPhase::Complete);
        assert!(facts.absence_checked);
        assert_eq!(facts.absent, Some(true));
        assert_eq!(facts.final_os_error, None);
        assert_eq!(
            facts.observations,
            vec![json!({
                "attempt":1,"osError":5,"retryableWindowsDeleteError":true
            })]
        );
    }

    #[test]
    fn persistent_access_denied_exhausts_the_same_attempt_bound_and_stays_failed() {
        let mut pauses = 0;
        let (result, facts) = remove_owned_tree_observed_with(
            || Err(io::Error::from_raw_os_error(5)),
            || pauses += 1,
            || panic!("Exhausted access denial must not probe absence"),
        );
        assert_eq!(result.unwrap_err().raw_os_error(), Some(5));
        assert_eq!(facts.attempts as usize, ATTEMPTS);
        assert_eq!(pauses, ATTEMPTS - 1);
        assert_eq!(facts.observations.len(), ATTEMPTS);
        assert_eq!(facts.final_os_error, Some(5));
        assert_eq!(facts.terminal_phase, TreeRemovalPhase::Remove);
        assert!(!facts.absence_checked);
        assert_eq!(facts.absent, None);
        for (index, observation) in facts.observations.iter().enumerate() {
            assert_eq!(
                observation,
                &json!({"attempt":index+1,"osError":5,
                    "retryableWindowsDeleteError":true})
            );
        }
    }

    #[test]
    fn other_error_after_access_denied_retry_returns_that_exact_error_immediately() {
        let mut calls = 0;
        let mut pauses = 0;
        let (result, facts) = remove_owned_tree_observed_with(
            || {
                calls += 1;
                match calls {
                    1 => Err(io::Error::from_raw_os_error(5)),
                    2 => Err(io::Error::from_raw_os_error(87)),
                    _ => panic!("Error 87 must stop retries"),
                }
            },
            || pauses += 1,
            || panic!("Failed removal must not probe absence"),
        );
        assert_eq!(result.unwrap_err().raw_os_error(), Some(87));
        assert_eq!((calls, pauses, facts.attempts), (2, 1, 2));
        assert_eq!(facts.final_os_error, Some(87));
        assert_eq!(facts.terminal_phase, TreeRemovalPhase::Remove);
        assert!(!facts.absence_checked);
        assert_eq!(facts.absent, None);
        assert_eq!(
            facts.observations,
            vec![
                json!({"attempt":1,"osError":5,"retryableWindowsDeleteError":true}),
                json!({"attempt":2,"osError":87,"retryableWindowsDeleteError":false}),
            ]
        );
    }

    #[test]
    fn observed_exhausted_retries_remain_bounded_and_do_not_probe_absence() {
        let mut pauses = 0;
        let (result, facts) = remove_owned_tree_observed_with(
            || Err(io::Error::from_raw_os_error(32)),
            || pauses += 1,
            || panic!("Exhausted removal must not probe absence"),
        );
        assert_eq!(result.unwrap_err().raw_os_error(), Some(32));
        assert_eq!(facts.attempts as usize, ATTEMPTS);
        assert_eq!(pauses, ATTEMPTS - 1);
        assert_eq!(facts.observations.len(), ATTEMPTS);
        assert_eq!(facts.final_os_error, Some(32));
        assert_eq!(facts.terminal_phase, TreeRemovalPhase::Remove);
        assert!(!facts.absence_checked);
        assert_eq!(facts.absent, None);
        for (index, entry) in facts.observations.iter().enumerate() {
            assert_eq!(
                entry,
                &json!({"attempt":index+1,"osError":32,
                "retryableWindowsDeleteError":true})
            );
        }
    }

    #[test]
    fn observed_absence_error_is_the_final_error_and_is_never_retried() {
        for remove_was_not_found in [false, true] {
            let mut probes = 0;
            let (result, facts) = remove_owned_tree_observed_with(
                || {
                    if remove_was_not_found {
                        absent()
                    } else {
                        Ok(())
                    }
                },
                || panic!("Absence errors must not retry removal"),
                || {
                    probes += 1;
                    Err(io::Error::from_raw_os_error(5))
                },
            );
            assert_eq!(result.unwrap_err().raw_os_error(), Some(5));
            assert_eq!((facts.attempts, probes), (1, 1));
            assert_eq!(facts.final_os_error, Some(5));
            assert_eq!(facts.terminal_phase, TreeRemovalPhase::AbsenceCheck);
            assert!(facts.absence_checked);
            assert_eq!(facts.absent, None);
            assert!(facts.observations.is_empty());
        }
    }

    #[test]
    fn observed_existing_tree_stays_an_error_even_after_remove_not_found() {
        for remove_was_not_found in [false, true] {
            let (result, facts) = remove_owned_tree_observed_with(
                || {
                    if remove_was_not_found {
                        absent()
                    } else {
                        Ok(())
                    }
                },
                || panic!("No retry after apparent removal"),
                || Ok(()),
            );
            let error = result.unwrap_err();
            assert_eq!(error.kind(), io::ErrorKind::Other);
            assert_eq!(
                error.to_string(),
                "Private tree still exists after deletion"
            );
            assert_eq!(facts.attempts, 1);
            assert_eq!(facts.final_os_error, None);
            assert_eq!(facts.terminal_phase, TreeRemovalPhase::AbsenceCheck);
            assert!(facts.absence_checked);
            assert_eq!(facts.absent, Some(false));
        }
    }

    #[test]
    fn observed_facts_are_closed_and_do_not_serialize_error_text_or_paths() {
        let (result, facts) = remove_owned_tree_observed_with(
            || Err(io::Error::other("private path or arbitrary error text")),
            || panic!("Non-OS error must not pause"),
            || panic!("Non-OS failure must not probe absence"),
        );
        assert_eq!(
            result.unwrap_err().to_string(),
            "private path or arbitrary error text"
        );
        let value = serde_json::to_value(&facts).unwrap();
        let mut keys: Vec<_> = value
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect();
        keys.sort_unstable();
        assert_eq!(
            keys,
            [
                "absenceChecked",
                "absent",
                "attempts",
                "elapsedMs",
                "finalOsError",
                "observations",
                "terminalPhase"
            ]
        );
        assert_eq!(value["terminalPhase"], "remove");
        assert_eq!(value["finalOsError"], Value::Null);
        assert_eq!(value["absent"], Value::Null);
        assert!(value["elapsedMs"].as_u64().is_some());
        assert_eq!(
            value["observations"],
            json!([
                {"attempt":1,"osError":null,"retryableWindowsDeleteError":false}
            ])
        );
        assert!(!value.to_string().contains("private path"));
        assert_eq!(
            serde_json::to_value(TreeRemovalPhase::AbsenceCheck).unwrap(),
            "absence-check"
        );
        assert_eq!(
            serde_json::to_value(TreeRemovalPhase::Complete).unwrap(),
            "complete"
        );
    }

    #[test]
    fn legacy_observation_prefix_and_original_error_are_retained() {
        let mut observations = vec![json!({"previousCall":true})];
        let error = remove_owned_tree_with(
            Path::new("unused because remove fails before metadata"),
            &mut observations,
            || Err(io::Error::from_raw_os_error(87)),
        )
        .unwrap_err();
        assert_eq!(error.raw_os_error(), Some(87));
        assert_eq!(
            observations,
            vec![
                json!({"previousCall":true}),
                json!({"attempt":1,"osError":87,"retryableWindowsDeleteError":false})
            ]
        );
    }

    #[test]
    fn retry_selected_windows_errors_with_a_bound() {
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
                Err(io::Error::from_raw_os_error(87))
            },
            || panic!("Error 87 must not be retried"),
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
            fs::symlink_metadata(&root).unwrap_err().kind(),
            io::ErrorKind::NotFound
        );
        let (result, facts) = remove_owned_tree_observed(&root);
        result.unwrap();
        assert_eq!(facts.attempts, 1);
        assert_eq!(facts.terminal_phase, TreeRemovalPhase::Complete);
        assert_eq!(facts.absent, Some(true));
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
