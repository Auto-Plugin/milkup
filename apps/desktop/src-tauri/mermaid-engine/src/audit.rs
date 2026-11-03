//! Explicit opt-in diagnostic evidence, never a plugin command or event.
//! Only fixed ownership/cleanup fields leave the native report. No source text,
//! renderer error, private path, credentials or browser request URI is logged.
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use std::io::Write;
use std::sync::{
    atomic::{AtomicU8, Ordering},
    mpsc::{self, RecvTimeoutError, SyncSender, TrySendError},
    Arc,
};
use std::time::{Duration, Instant};

const RECORD_DROPPED: u8 = 1;
const WRITER_FAILED: u8 = 2;
const MAX_LINE_BYTES: usize = 8192;

enum Message {
    Line(String),
    Barrier(SyncSender<Result<(), String>>),
}

struct AuditWriter {
    sender: SyncSender<Message>,
    failures: Arc<AtomicU8>,
}

fn evidence_status(failures: &AtomicU8) -> Result<(), String> {
    match failures.load(Ordering::Acquire) {
        0 => Ok(()),
        RECORD_DROPPED => Err("Mermaid audit record was not queued; evidence is incomplete".into()),
        _ => Err("Mermaid audit writer failed; evidence is incomplete".into()),
    }
}

impl AuditWriter {
    fn start<W: Write + Send + 'static>(mut output: W) -> Result<Self, String> {
        let (sender, receiver) = mpsc::sync_channel(16);
        let failures = Arc::new(AtomicU8::new(0));
        let worker_failures = failures.clone();
        std::thread::Builder::new()
            .name("mermaid-audit".into())
            .spawn(move || {
                for message in receiver {
                    match message {
                        Message::Line(line) => {
                            if writeln!(output, "MILKUP_MERMAID_NATIVE_AUDIT {line}").is_err() {
                                worker_failures.fetch_or(WRITER_FAILED, Ordering::AcqRel);
                            }
                        }
                        Message::Barrier(reply) => {
                            if output.flush().is_err() {
                                worker_failures.fetch_or(WRITER_FAILED, Ordering::AcqRel);
                            }
                            // A caller may have timed out. Never stall the writer
                            // or poison later retries merely because its ACK expired.
                            let _ = reply.try_send(evidence_status(&worker_failures));
                        }
                    }
                }
            })
            .map_err(|_| "Mermaid audit worker could not start".to_string())?;
        Ok(Self { sender, failures })
    }

    fn emit_line(&self, line: String) {
        // Diagnostics never extend the render deadline. Lost evidence remains
        // uncertain even if a later barrier can drain the queue successfully.
        if line.len() > MAX_LINE_BYTES || self.sender.try_send(Message::Line(line)).is_err() {
            self.failures.fetch_or(RECORD_DROPPED, Ordering::AcqRel);
        }
    }

    fn flush_until(&self, deadline: Instant) -> Result<(), String> {
        let (reply, acknowledgement) = mpsc::sync_channel(1);
        let mut barrier = Message::Barrier(reply);
        loop {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return Err("Mermaid audit flush deadline expired before enqueue".into());
            }
            match self.sender.try_send(barrier) {
                Ok(()) => break,
                Err(TrySendError::Full(message)) => {
                    // The barrier has not been lost: retain and retry it within
                    // the same deadline used for its eventual acknowledgement.
                    barrier = message;
                    std::thread::sleep(remaining.min(Duration::from_millis(1)));
                }
                Err(TrySendError::Disconnected(_)) => {
                    self.failures.fetch_or(WRITER_FAILED, Ordering::AcqRel);
                    return evidence_status(&self.failures);
                }
            }
        }
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Err("Mermaid audit flush deadline expired before acknowledgement".into());
        }
        match acknowledgement.recv_timeout(remaining) {
            Ok(result) => {
                result?;
                if Instant::now() >= deadline {
                    return Err("Mermaid audit flush acknowledgement exceeded deadline".into());
                }
                evidence_status(&self.failures)
            }
            Err(RecvTimeoutError::Timeout) => Err("Mermaid audit flush deadline expired".into()),
            Err(RecvTimeoutError::Disconnected) => {
                self.failures.fetch_or(WRITER_FAILED, Ordering::AcqRel);
                evidence_status(&self.failures)
            }
        }
    }
}

#[cfg(windows)]
static WRITER: std::sync::OnceLock<Result<AuditWriter, String>> = std::sync::OnceLock::new();

#[cfg(windows)]
fn writer() -> &'static Result<AuditWriter, String> {
    WRITER.get_or_init(|| AuditWriter::start(std::io::stderr()))
}

#[cfg(windows)]
pub(crate) fn enabled() -> bool {
    std::env::var("MILKUP_MERMAID_NATIVE_AUDIT").as_deref() == Ok("1")
}
#[cfg(windows)]
pub(crate) fn emit(record: &Value) {
    if !enabled() {
        return;
    }
    let Ok(writer) = writer() else { return };
    let mut record = record.clone();
    record["timestampUnixMs"] = json!(std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default());
    match serde_json::to_string(&record) {
        Ok(line) => writer.emit_line(line),
        Err(_) => {
            writer.failures.fetch_or(RECORD_DROPPED, Ordering::AcqRel);
        }
    }
}

#[cfg(windows)]
pub(crate) fn flush(timeout: Duration) -> Result<(), String> {
    if !enabled() && WRITER.get().is_none() {
        return Ok(());
    }
    let deadline = Instant::now()
        .checked_add(timeout)
        .ok_or_else(|| "Mermaid audit flush deadline is invalid".to_string())?;
    writer()
        .as_ref()
        .map_err(Clone::clone)?
        .flush_until(deadline)
}
pub(crate) fn started(request_id: &str, report: &Value) -> Value {
    with_token_evidence(
        report,
        json!({
            "phase":"started","requestId":request_id,"productPid":std::process::id(),
            "hostSid":report["hostToken"]["userSid"],
            "childSid":report["suspendedToken"]["userSid"],
            "browserSid":report["browserToken"]["userSid"],
            "hostPureStandard":report["hostToken"]["standardUserTokenEvidence"]==true,
            "appContainer":report["suspendedToken"]["isAppContainer"]==true,
            "zeroCapabilities":report["suspendedToken"]["capabilityCount"]==0,
            "browserAppContainer":report["browserToken"]["isAppContainer"]==true,
            "browserZeroCapabilities":report["browserToken"]["capabilityCount"]==0,
            "browserPid":report["ready"]["browserProcessId"],
            "browserInOwnedJob":report["browserProcessInOwnedJob"]==true
        }),
    )
}
pub(crate) fn finished(
    request_id: &str,
    report: &Value,
    png: &[u8],
    cancelled: bool,
    deadline_expired: bool,
) -> Value {
    let members: Vec<_> = report["preStopJob"]["members"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|member| member["pid"].as_u64())
        .take(16)
        .collect();
    with_token_evidence(
        report,
        json!({
            "phase":"finished", "requestId":request_id,"productPid":std::process::id(),
            "successful":report["success"]==true && !cancelled && !deadline_expired,
            "rendererErrorKind":renderer_error_kind(&report["rendererMetadata"]),
            "rendererStatus":match report["rendererMetadata"]["status"].as_str() {
                Some("ok") => "ok", Some("error") => "error", _ => "unknown"
            },
            "capturedPngBytes":report["capturedPngBytes"].as_u64().filter(|bytes| *bytes <= crate::MAX_OUTPUT as u64),
            "cleanupFailureKinds":cleanup_failure_kinds(&report["cleanupFailureKinds"]),
            "ipcThreadCleanup":ipc_thread_cleanup(&report["ipcThreadCleanup"]),
            "stdoutFailure":stdout_failure(&report["stdoutFailure"]),
            "stderrFailure":stderr_failure(&report["stderrFailure"]),
            "hostSid":report["hostToken"]["userSid"],
            "childSid":report["suspendedToken"]["userSid"],
            "browserSid":report["browserToken"]["userSid"],
            "hostPureStandard":report["hostToken"]["standardUserTokenEvidence"]==true,
            "appContainer":report["suspendedToken"]["isAppContainer"]==true,
            "zeroCapabilities":report["suspendedToken"]["capabilityCount"]==0,
            "browserAppContainer":report["browserToken"]["isAppContainer"]==true,
            "browserZeroCapabilities":report["browserToken"]["capabilityCount"]==0,
            "browserPid":report["ready"]["browserProcessId"],
            "browserInOwnedJob":report["browserProcessInOwnedJob"]==true,
            "ownedPidsBeforeStop":members,
            "ownedJobCreated":!report["preStopJob"].is_null(),
            "jobActiveAfterStop":report["jobActiveAfterStop"],
            "ipcThreadsCompleted":report["ipcThreadsCompleted"]==true,
            "profileCreated":report["profileCreated"]==true,
            "profileDeleted":report["profileDeletedAndFolderAbsent"]==true,
            "privateTreeRemoved":report["privateTreeRemoved"]==true,
            "cleanupUncertain":report["stopMatrixAfterThisCase"]==true,
            "cancelled":cancelled,"deadlineExpired":deadline_expired,
            "pngBytes":png.len(),
            "pngSha256":if png.is_empty(){None}else{Some(format!("{:x}",Sha256::digest(png)))},
            "osAllNetworkDenied":false
        }),
    )
}
fn host_token_class(report: &Value) -> Value {
    match report["hostTokenClass"].as_str() {
        Some("pure-standard") => json!("pure-standard"),
        Some("filtered-admin") => json!("filtered-admin"),
        _ => Value::Null,
    }
}
fn with_token_evidence(report: &Value, mut record: Value) -> Value {
    let evidence = json!({
        "hostTokenClass":host_token_class(report),
        "hostNonElevatedVerified":report["hostNonElevatedVerified"]==true,
        "hostTokenEvidence":crate::token_policy::audit_evidence(&report["hostToken"]),
        "childTokenEvidence":crate::token_policy::audit_evidence(&report["suspendedToken"]),
        "browserTokenEvidence":crate::token_policy::audit_evidence(&report["browserToken"]),
        "appContainerSid":crate::token_policy::audit_app_sid(&report["appContainerSid"]),
        "childAppContainerSid":crate::token_policy::audit_app_sid(&report["suspendedToken"]["appContainerSid"]),
        "browserAppContainerSid":crate::token_policy::audit_app_sid(&report["browserToken"]["appContainerSid"]),
    });
    record
        .as_object_mut()
        .expect("closed audit record")
        .extend(evidence.as_object().expect("closed token evidence").clone());
    record
}
// These diagnostics explain an existing cleanup failure; they never override
// its gates or accept arbitrary launcher text, private paths or error messages.
fn cleanup_failure_kinds(value: &Value) -> Vec<&'static str> {
    value
        .as_array()
        .into_iter()
        .flatten()
        .take(16)
        .filter_map(|kind| match kind.as_str()? {
            "job-stop" => Some("job-stop"),
            "stdout-protocol" => Some("stdout-protocol"),
            "stdout-join" => Some("stdout-join"),
            "stdin-join" => Some("stdin-join"),
            "stderr-join" => Some("stderr-join"),
            "stderr-budget-or-read" => Some("stderr-budget-or-read"),
            "profile-delete" => Some("profile-delete"),
            "private-tree-delete" => Some("private-tree-delete"),
            "job-not-empty" => Some("job-not-empty"),
            _ => None,
        })
        .collect()
}

fn ipc_thread_cleanup(value: &Value) -> Vec<Value> {
    value
        .as_array()
        .into_iter()
        .flatten()
        .take(3)
        .filter_map(|entry| {
            let stream = match entry["stream"].as_str()? {
                "stdout" => "stdout",
                "stdin" => "stdin",
                "stderr" => "stderr",
                _ => return None,
            };
            let elapsed_ms = entry["elapsedMs"].as_u64()?;
            let cancel_requested = entry["cancelRequested"].as_bool()?;
            let finished = entry["finished"].as_bool()?;
            let panicked = entry["panicked"].as_bool()?;
            let cancel_succeeded = match entry.get("cancelCallSucceeded") {
                None | Some(Value::Null) => None,
                Some(value) => Some(value.as_bool()?),
            };
            let cancel_error = match entry.get("cancelWin32Error") {
                None | Some(Value::Null) => None,
                Some(value) => Some(u32::try_from(value.as_u64()?).ok()?),
            };
            Some(json!({
                "stream":stream, "elapsedMs":elapsed_ms, "cancelRequested":cancel_requested,
                "cancelCallSucceeded":cancel_succeeded, "cancelWin32Error":cancel_error,
                "finished":finished, "panicked":panicked
            }))
        })
        .collect()
}

fn stdout_failure(value: &Value) -> Option<Value> {
    let phase = match value["phase"].as_str()? {
        "ready-frame" => "ready-frame",
        "ready-event" => "ready-event",
        "result-frame" => "result-frame",
        "png-body" => "png-body",
        "result-event" => "result-event",
        "trailing-byte" => "trailing-byte",
        _ => return None,
    };
    let kind = match value["kind"].as_str()? {
        "read" => "read",
        "schema" => "schema",
        "channel" => "channel",
        "trailing-data" => "trailing-data",
        _ => return None,
    };
    let stop_observed = value["stopRequestedWhenObserved"].as_bool()?;
    let error = match value.get("win32Error") {
        None | Some(Value::Null) => None,
        Some(value) => Some(u32::try_from(value.as_u64()?).ok()?),
    };
    Some(
        json!({"phase":phase,"kind":kind,"stopRequestedWhenObserved":stop_observed,"win32Error":error}),
    )
}

fn stderr_failure(value: &Value) -> Option<Value> {
    let kind = match value["kind"].as_str()? {
        "read" => "read",
        "budget" => "budget",
        _ => return None,
    };
    let stop_observed = value["stopRequestedWhenObserved"].as_bool()?;
    let error = match value.get("win32Error") {
        None | Some(Value::Null) => None,
        Some(value) => Some(u32::try_from(value.as_u64()?).ok()?),
    };
    Some(json!({"kind":kind,"stopRequestedWhenObserved":stop_observed,"win32Error":error}))
}

fn renderer_error_kind(metadata: &Value) -> Option<&'static str> {
    if metadata["status"] != "error" {
        return None;
    }
    // The fixed engine wraps bootstrap's JSON result in engineMessage. Never
    // forward the source-bearing message or classify a generic IPC failure.
    let rendered = &metadata["engineMessage"];
    let message = if rendered["phase"] == "error" {
        rendered["message"].as_str()
    } else {
        None
    };
    Some(match message {
        Some(message)
            if message.starts_with(
                "UnknownDiagramError: No diagram type detected matching given configuration",
            ) =>
        {
            "unknown-diagram"
        }
        Some(message) if message.starts_with("Error: Parse error on line ") => "parse-error",
        _ => "other",
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    #[test]
    fn filtered_account_facts_are_closed_and_do_not_claim_pure_standard() {
        let token = json!({"userSid":"S-1-5-21-1-2-3-1001","ownerSid":"S-1-5-21-1-2-3-1001",
            "tokenType":1,"sessionId":2,"elevated":false,"elevationType":3,
            "integrityRid":8192,"uiAccess":false,"isAppContainer":false,
            "appContainerSid":null,"capabilityCount":0,
            "administratorsGroupPresentIncludingDenyOnly":true,"administratorsGroupAttributes":16,
            "privilegeCount":5,"hostDisallowedPrivilegeCount":0,"sandboxDisallowedPrivilegeCount":4,
            "seDebugPrivilege":{"present":false},"standardUserTokenEvidence":false,
            "source":"never export this source"});
        let mut report = json!({"hostToken":token,"hostTokenClass":"filtered-admin",
            "hostNonElevatedVerified":true,"appContainerSid":"S-1-15-2-1-2-3-4-5-6-7"});
        for record in [
            started("request", &report),
            finished("request", &report, &[], true, false),
        ] {
            assert_eq!(record["hostPureStandard"], false);
            assert_eq!(record["hostTokenClass"], "filtered-admin");
            assert_eq!(record["hostNonElevatedVerified"], true);
            assert_eq!(
                record["hostTokenEvidence"]["administratorsGroupAttributes"],
                16
            );
            assert!(record["childTokenEvidence"].is_null());
            assert!(record["browserAppContainerSid"].is_null());
            assert!(!record.to_string().contains("never export"));
            assert!(record.to_string().len() < MAX_LINE_BYTES);
        }
        report["hostTokenClass"] = json!("private unexpected text");
        assert!(started("request", &report)["hostTokenClass"].is_null());
    }

    #[derive(Default)]
    struct Captured {
        bytes: Vec<u8>,
        flushes: usize,
    }

    struct TestOutput {
        captured: Arc<Mutex<Captured>>,
        gate: Option<(mpsc::Sender<()>, mpsc::Receiver<()>)>,
        fail_write: bool,
        fail_flush: bool,
    }
    impl TestOutput {
        fn new() -> (Self, Arc<Mutex<Captured>>) {
            let captured = Arc::new(Mutex::new(Captured::default()));
            (
                Self {
                    captured: captured.clone(),
                    gate: None,
                    fail_write: false,
                    fail_flush: false,
                },
                captured,
            )
        }
    }
    impl Write for TestOutput {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
            if let Some((entered, release)) = self.gate.take() {
                entered.send(()).unwrap();
                release.recv_timeout(Duration::from_secs(2)).unwrap();
            }
            if std::mem::take(&mut self.fail_write) {
                return Err(std::io::Error::other("synthetic write failure"));
            }
            self.captured.lock().unwrap().bytes.extend_from_slice(bytes);
            Ok(bytes.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            self.captured.lock().unwrap().flushes += 1;
            if std::mem::take(&mut self.fail_flush) {
                return Err(std::io::Error::other("synthetic flush failure"));
            }
            Ok(())
        }
    }
    fn flush_writer(writer: &AuditWriter) -> Result<(), String> {
        writer.flush_until(Instant::now() + Duration::from_secs(1))
    }

    #[test]
    fn barrier_covers_all_prior_lines_and_writer_flush_without_stopping_worker() {
        let (output, captured) = TestOutput::new();
        let writer = AuditWriter::start(output).unwrap();
        writer.emit_line("first".into());
        writer.emit_line("second".into());
        flush_writer(&writer).unwrap();
        {
            let captured = captured.lock().unwrap();
            assert_eq!(captured.flushes, 1);
            assert_eq!(
                captured.bytes,
                b"MILKUP_MERMAID_NATIVE_AUDIT first\nMILKUP_MERMAID_NATIVE_AUDIT second\n"
            );
        }
        writer.emit_line("after barrier".into());
        flush_writer(&writer).unwrap();
        assert_eq!(captured.lock().unwrap().flushes, 2);
    }

    #[test]
    fn a_dropped_oversized_record_keeps_later_flushes_uncertain() {
        let (output, captured) = TestOutput::new();
        let writer = AuditWriter::start(output).unwrap();
        writer.emit_line("x".repeat(MAX_LINE_BYTES + 1));
        assert!(flush_writer(&writer).unwrap_err().contains("not queued"));
        assert!(flush_writer(&writer).is_err());
        assert!(captured.lock().unwrap().bytes.is_empty());
    }

    #[test]
    fn queue_overflow_is_nonblocking_and_stays_uncertain_after_drain() {
        let (mut output, _) = TestOutput::new();
        let (entered_tx, entered_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        output.gate = Some((entered_tx, release_rx));
        let writer = AuditWriter::start(output).unwrap();
        writer.emit_line("held by writer".into());
        entered_rx.recv_timeout(Duration::from_secs(1)).unwrap();
        for _ in 0..16 {
            writer.emit_line("queued".into());
        }
        writer.emit_line("overflow must not wait for writer".into());
        assert_eq!(writer.failures.load(Ordering::Acquire), RECORD_DROPPED);
        release_tx.send(()).unwrap();
        assert!(flush_writer(&writer).is_err());
        assert!(flush_writer(&writer).is_err());
    }

    #[test]
    fn write_and_flush_failures_remain_uncertain_after_output_recovers() {
        for fail_write in [true, false] {
            let (mut output, _) = TestOutput::new();
            output.fail_write = fail_write;
            output.fail_flush = !fail_write;
            let writer = AuditWriter::start(output).unwrap();
            writer.emit_line("first attempt".into());
            assert!(flush_writer(&writer).unwrap_err().contains("writer failed"));
            writer.emit_line("writer recovered but prior evidence is lost".into());
            assert!(flush_writer(&writer).unwrap_err().contains("writer failed"));
        }
    }

    #[test]
    fn a_timed_out_barrier_can_be_retried_without_destroying_the_worker() {
        let (mut output, captured) = TestOutput::new();
        let (entered_tx, entered_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        output.gate = Some((entered_tx, release_rx));
        let writer = AuditWriter::start(output).unwrap();
        writer.emit_line("pending".into());
        entered_rx.recv_timeout(Duration::from_secs(1)).unwrap();
        assert!(writer
            .flush_until(Instant::now() + Duration::from_millis(20))
            .unwrap_err()
            .contains("deadline"));
        release_tx.send(()).unwrap();
        flush_writer(&writer).unwrap();
        assert_eq!(writer.failures.load(Ordering::Acquire), 0);
        assert_eq!(captured.lock().unwrap().flushes, 2);
    }

    #[test]
    fn queue_admission_and_acknowledgement_share_one_deadline() {
        let (sender, receiver) = mpsc::sync_channel(1);
        assert!(sender.try_send(Message::Line("occupy slot".into())).is_ok());
        let writer = AuditWriter {
            sender,
            failures: Arc::new(AtomicU8::new(0)),
        };
        let (release_tx, release_rx) = mpsc::channel();
        let consumer = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(250));
            assert!(matches!(
                receiver.recv_timeout(Duration::from_secs(1)).unwrap(),
                Message::Line(_)
            ));
            let Message::Barrier(ack) = receiver.recv_timeout(Duration::from_secs(1)).unwrap()
            else {
                panic!("expected barrier")
            };
            release_rx.recv_timeout(Duration::from_secs(2)).unwrap();
            drop(ack);
        });
        let started = Instant::now();
        let result = writer.flush_until(started + Duration::from_millis(400));
        let elapsed = started.elapsed();
        release_tx.send(()).unwrap();
        consumer.join().unwrap();
        assert!(result.unwrap_err().contains("deadline"));
        // A fresh 400 ms ACK timeout after 250 ms admission would exceed this.
        assert!(elapsed < Duration::from_millis(600), "{elapsed:?}");
        assert_eq!(writer.failures.load(Ordering::Acquire), 0);
    }

    #[test]
    fn a_disconnected_writer_is_an_explicit_flush_failure() {
        let (sender, receiver) = mpsc::sync_channel(16);
        drop(receiver);
        let writer = AuditWriter {
            sender,
            failures: Arc::new(AtomicU8::new(0)),
        };
        assert!(flush_writer(&writer).unwrap_err().contains("writer failed"));
        assert_eq!(writer.failures.load(Ordering::Acquire), WRITER_FAILED);
    }

    #[test]
    fn cancelled_or_expired_render_keeps_png_evidence_without_claiming_publication() {
        let report = json!({"success":true});
        let completed = finished("opaque-id", &report, b"actual png", false, false);
        assert_eq!(completed["successful"], true);
        for (cancelled, expired) in [(true, false), (false, true), (true, true)] {
            let audit = finished("opaque-id", &report, b"actual png", cancelled, expired);
            assert_eq!(audit["successful"], false);
            assert_eq!(audit["pngBytes"], 10);
            assert_eq!(audit["pngSha256"], completed["pngSha256"]);
            assert_eq!(audit["cancelled"], cancelled);
            assert_eq!(audit["deadlineExpired"], expired);
        }
    }

    #[test]
    fn cleanup_failure_diagnostics_only_preserve_bounded_closed_kinds() {
        let allowed = [
            "job-stop",
            "stdout-protocol",
            "stdout-join",
            "stdin-join",
            "stderr-join",
            "stderr-budget-or-read",
            "profile-delete",
            "private-tree-delete",
            "job-not-empty",
        ];
        let mut supplied: Vec<Value> = allowed.iter().map(|kind| json!(kind)).collect();
        supplied.extend([
            json!("C:/private/source"),
            json!({"kind":"job-stop","source":"private"}),
            json!(true),
            Value::Null,
        ]);
        let output = cleanup_failure_kinds(&json!(supplied));
        assert_eq!(output, allowed);
        assert_eq!(
            cleanup_failure_kinds(&json!(vec!["job-stop"; 17])).len(),
            16
        );
        assert!(cleanup_failure_kinds(&json!({"kind":"job-stop"})).is_empty());
    }

    fn ipc_diagnostic(stream: &str) -> Value {
        json!({"stream":stream,"elapsedMs":27,"cancelRequested":true,
            "cancelCallSucceeded":false,"cancelWin32Error":1168,"finished":true,"panicked":false})
    }

    #[test]
    fn ipc_diagnostics_keep_only_seven_typed_fields_and_three_rows() {
        let mut stdout = ipc_diagnostic("stdout");
        stdout["privatePath"] = json!("C:/private-user-path");
        stdout["source"] = json!("private source");
        stdout["stderr"] = json!("secret stderr text");
        stdout["successful"] = json!(true);
        let mut stdin = ipc_diagnostic("stdin");
        stdin["elapsedMs"] = json!(u64::MAX);
        stdin["cancelWin32Error"] = json!(u32::MAX);
        let mut stderr = ipc_diagnostic("stderr");
        stderr["cancelRequested"] = json!(false);
        stderr["cancelCallSucceeded"] = Value::Null;
        stderr["cancelWin32Error"] = Value::Null;
        let output = ipc_thread_cleanup(&json!([stdout, stdin, stderr, ipc_diagnostic("stdout")]));
        assert_eq!(output.len(), 3);
        for row in &output {
            assert_eq!(row.as_object().unwrap().len(), 7);
        }
        assert_eq!(output[1]["elapsedMs"].as_u64(), Some(u64::MAX));
        assert_eq!(
            output[1]["cancelWin32Error"].as_u64(),
            Some(u32::MAX as u64)
        );
        assert!(output[2]["cancelCallSucceeded"].is_null());
        assert!(output[2]["cancelWin32Error"].is_null());
        let serialized = serde_json::to_string(&output).unwrap();
        for forbidden in ["private", "secret", "successful", "source", "C:/"] {
            assert!(!serialized.contains(forbidden), "{forbidden}");
        }
    }

    #[test]
    fn ipc_diagnostics_reject_unknown_streams_coercions_and_out_of_range_error_codes() {
        for (field, invalid) in [
            ("stream", json!("stdout:C:/private")),
            ("stream", json!("unknown")),
            ("elapsedMs", json!(-1)),
            ("elapsedMs", json!("27")),
            ("elapsedMs", json!(1.5)),
            ("cancelRequested", json!("true")),
            ("cancelCallSucceeded", json!(1)),
            ("cancelWin32Error", json!(u32::MAX as u64 + 1)),
            ("cancelWin32Error", json!(-1)),
            ("cancelWin32Error", json!("C:/private")),
            ("finished", Value::Null),
            ("panicked", json!("false")),
        ] {
            let mut row = ipc_diagnostic("stdout");
            row[field] = invalid;
            assert!(ipc_thread_cleanup(&json!([row])).is_empty(), "{field}");
        }
        assert!(ipc_thread_cleanup(&json!([null, "private source", 37])).is_empty());
    }

    #[test]
    fn renderer_status_and_captured_png_size_cannot_be_spoofed_by_other_fields() {
        for (status, expected) in [
            ("ok", "ok"),
            ("error", "error"),
            ("C:/private/source", "unknown"),
        ] {
            let report = json!({"success":false,"rendererMetadata":{"status":status},"rendererStatus":"ok",
                "capturedPngBytes":crate::MAX_OUTPUT,"cleanupFailureKinds":["private error"],
                "ipcThreadCleanup":[{"stream":"stdout","source":"private source"}]});
            let output = finished("opaque-id", &report, &[], false, false);
            assert_eq!(output["rendererStatus"], expected);
            assert_eq!(output["capturedPngBytes"], crate::MAX_OUTPUT);
            assert_eq!(output["pngBytes"], 0);
            assert_eq!(output["successful"], false);
            assert_eq!(output["cleanupFailureKinds"], json!([]));
            assert_eq!(output["ipcThreadCleanup"], json!([]));
            for excluded in ["C:/private/source", "private error", "private source"] {
                assert!(!output.to_string().contains(excluded));
            }
        }
        for value in [
            json!(crate::MAX_OUTPUT + 1),
            json!(-1),
            json!("100"),
            Value::Null,
        ] {
            let output = finished(
                "opaque-id",
                &json!({"capturedPngBytes":value}),
                &[],
                false,
                false,
            );
            assert!(output["capturedPngBytes"].is_null());
            assert_eq!(output["rendererStatus"], "unknown");
        }
    }

    #[test]
    fn stdout_failure_only_exposes_the_closed_observed_stage_and_stop_sample() {
        for phase in [
            "ready-frame",
            "ready-event",
            "result-frame",
            "png-body",
            "result-event",
            "trailing-byte",
        ] {
            for stopped in [true, false] {
                let input = json!({"phase":phase,"kind":"read","win32Error":995,"stopRequestedWhenObserved":stopped,
                    "path":"C:/private-user-path","message":"private source","causedByStop":true});
                let output = stdout_failure(&input).unwrap();
                assert_eq!(
                    output,
                    json!({"phase":phase,"kind":"read","win32Error":995,"stopRequestedWhenObserved":stopped})
                );
            }
        }
        for input in [
            Value::Null,
            json!({"phase":"unknown","kind":"read","stopRequestedWhenObserved":false}),
            json!({"phase":"ready-frame:C:/private","kind":"read","stopRequestedWhenObserved":true}),
            json!({"phase":"ready-event","kind":"read","stopRequestedWhenObserved":"false"}),
            json!({"phase":"ready-frame","kind":"read"}),
        ] {
            assert!(stdout_failure(&input).is_none());
        }
    }

    #[test]
    fn stdout_failure_never_infers_kind_or_win32_code_from_injected_text() {
        for kind in ["read", "schema", "channel", "trailing-data"] {
            let output = stdout_failure(&json!({"phase":"result-frame","kind":kind,
                "stopRequestedWhenObserved":false,"message":"ReadFile failed with Win32 995: private source",
                "raw_os_error":995})).unwrap();
            assert_eq!(output["kind"], kind);
            assert!(output["win32Error"].is_null());
            assert_eq!(output.as_object().unwrap().len(), 4);
            assert!(!output.to_string().contains("private"));
        }
        for kind in ["cancelled", "read:C:/private", "stderr"] {
            assert!(stdout_failure(&json!({"phase":"result-frame","kind":kind,
                "win32Error":995,"stopRequestedWhenObserved":true}))
            .is_none());
        }
        for code in [
            json!(-1),
            json!(u32::MAX as u64 + 1),
            json!("995"),
            json!("Win32 995: C:/private"),
            json!(true),
            json!({"code":995}),
        ] {
            assert!(stdout_failure(&json!({"phase":"result-frame","kind":"read",
                "win32Error":code,"stopRequestedWhenObserved":false}))
            .is_none());
        }
    }

    #[test]
    fn stderr_failure_only_exposes_closed_kind_boolean_and_nullable_u32() {
        for kind in ["read", "budget"] {
            let input = json!({"kind":kind,"stopRequestedWhenObserved":false,"win32Error":u32::MAX,
                "message":"private stderr","path":"C:/private-user-path","causedByStop":true});
            assert_eq!(
                stderr_failure(&input),
                Some(json!({"kind":kind,"stopRequestedWhenObserved":false,"win32Error":u32::MAX}))
            );
        }
        assert_eq!(
            stderr_failure(&json!({"kind":"budget","stopRequestedWhenObserved":true})),
            Some(json!({"kind":"budget","stopRequestedWhenObserved":true,"win32Error":null}))
        );
        for input in [
            Value::Null,
            json!({"kind":"C:/private","stopRequestedWhenObserved":true}),
            json!({"kind":"read","stopRequestedWhenObserved":0}),
            json!({"kind":"read","stopRequestedWhenObserved":false,"win32Error":u32::MAX as u64+1}),
            json!({"kind":"read","stopRequestedWhenObserved":false,"win32Error":-1}),
            json!({"kind":"read","stopRequestedWhenObserved":false,"win32Error":"private source"}),
        ] {
            assert!(stderr_failure(&input).is_none());
        }
    }

    #[test]
    fn renderer_error_kind_only_accepts_fixed_bootstrap_error_envelope() {
        for (metadata, expected) in [
            (
                json!({"status":"error","engineMessage":{"phase":"error","message":"UnknownDiagramError: No diagram type detected matching given configuration for text: private source"}}),
                Some("unknown-diagram"),
            ),
            (
                json!({"status":"error","engineMessage":{"phase":"error","message":"Error: Parse error on line 2: private source"}}),
                Some("parse-error"),
            ),
            (
                json!({"status":"error","engineMessage":{"phase":"rendered","message":"UnknownDiagramError: No diagram type detected matching given configuration"}}),
                Some("other"),
            ),
            (
                json!({"status":"error","message":"UnknownDiagramError: No diagram type detected matching given configuration"}),
                Some("other"),
            ),
            (json!({"status":"ok"}), None),
        ] {
            assert_eq!(renderer_error_kind(&metadata), expected);
        }
    }
    #[test]
    fn diagnostics_only_copy_closed_ownership_fields_never_source_paths_or_errors() {
        let input = json!({"success":true,"hostToken":{"userSid":"S-1-5-21-1-2-3-4","standardUserTokenEvidence":true},
            "rendererMetadata":{"source":"private document","engineMessage":"private error","requestUri":"https://private.invalid"},
            "privateRoot":"C:/private-user-path","stderr":"secret stderr","error":"private error",
            "preStopJob":{"members":[{"pid":42,"image":"C:/private-path","token":{"secret":"omitted"}}]},
            "jobActiveAfterStop":0,"ipcThreadsCompleted":true,"profileDeletedAndFolderAbsent":true,"privateTreeRemoved":true});
        let start = started("opaque-id", &input);
        assert_eq!(start["phase"], "started");
        assert_eq!(start["hostSid"], "S-1-5-21-1-2-3-4");
        let output = finished("opaque-id", &input, b"test png", false, false);
        let serialized = output.to_string();
        for excluded in [
            "private document",
            "private error",
            "private-user-path",
            "C:/private-path",
            "secret",
            "https://",
            "rendererMetadata",
            "requestUri",
        ] {
            assert!(!serialized.contains(excluded), "{excluded}");
        }
        assert!(output.get("stderr").is_none());
        assert_eq!(output["ownedPidsBeforeStop"], json!([42]));
        assert_eq!(output["hostSid"], "S-1-5-21-1-2-3-4");
        assert_eq!(output["pngBytes"], 8);
        assert_eq!(output["pngSha256"].as_str().unwrap().len(), 64);
    }
}
