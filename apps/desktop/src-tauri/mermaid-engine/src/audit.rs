//! Explicit opt-in diagnostic evidence, never a plugin command or event.
//! Only fixed ownership/cleanup fields leave the native report. No source text,
//! renderer error, private path, credentials or browser request URI is logged.
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

#[cfg(windows)]
pub(crate) fn enabled() -> bool {
    std::env::var("MILKUP_MERMAID_NATIVE_AUDIT").as_deref() == Ok("1")
}
#[cfg(windows)]
pub(crate) fn emit(record: &Value) {
    if !enabled() {
        return;
    }
    let mut record = record.clone();
    record["timestampUnixMs"] = json!(std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default());
    if let Ok(line) = serde_json::to_string(&record) {
        // A bounded, nonblocking producer keeps diagnostics off the render
        // deadline. If stderr stops draining, evidence is incomplete and its
        // acceptance check fails; the renderer still retains its own result.
        if line.len() <= 8192 {
            use std::sync::{mpsc::SyncSender, OnceLock};
            static SENDER: OnceLock<Option<SyncSender<String>>> = OnceLock::new();
            if let Some(sender) = SENDER.get_or_init(|| {
                let (sender, receiver) = std::sync::mpsc::sync_channel::<String>(16);
                std::thread::Builder::new()
                    .name("mermaid-audit".into())
                    .spawn(move || {
                        use std::io::Write;
                        for line in receiver {
                            let _ = writeln!(
                                std::io::stderr().lock(),
                                "MILKUP_MERMAID_NATIVE_AUDIT {line}"
                            );
                        }
                    })
                    .ok()
                    .map(|_| sender)
            }) {
                let _ = sender.try_send(line);
            }
        }
    }
}
pub(crate) fn started(request_id: &str, report: &Value) -> Value {
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
    })
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
    json!({
        "phase":"finished", "requestId":request_id,"productPid":std::process::id(),
        "successful":report["success"]==true,
        "rendererErrorKind":renderer_error_kind(&report["rendererMetadata"]),
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
    })
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
            "stderr",
            "requestUri",
        ] {
            assert!(!serialized.contains(excluded), "{excluded}");
        }
        assert_eq!(output["ownedPidsBeforeStop"], json!([42]));
        assert_eq!(output["hostSid"], "S-1-5-21-1-2-3-4");
        assert_eq!(output["pngBytes"], 8);
        assert_eq!(output["pngSha256"].as_str().unwrap().len(), 64);
    }
}
