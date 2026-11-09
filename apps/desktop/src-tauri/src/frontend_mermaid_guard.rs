//! Boundary enforcement for the fixed renderer in the existing application WebView.
//! No renderer process, browser environment, shell, or filesystem resource is created.
use crate::frontend_mermaid_audit::Writer;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

#[derive(Default)]
struct Status {
    ready: bool,
    failed: bool,
    blocked_messages: u64,
    blocked_navigations: u64,
    dispatched_probes: u64,
    last_blocked_nonce: Option<String>,
    requests: HashMap<String, Value>,
    frames: HashMap<String, bool>,
    frame_proofs: HashMap<String, (u64, u64)>,
    navigation_proofs: HashMap<String, u64>,
    connection_records: usize,
    frame_serial: u64,
    lifecycle_records: usize,
    console_records: usize,
    document_protocol_records: usize,
}

pub enum DocumentProtocolStage { Received, ResponseBuilt }

#[derive(Clone)]
pub struct Registry(Arc<Mutex<Status>>, Arc<Option<Writer>>);
impl Default for Registry {
    fn default() -> Self {
        let enabled = std::env::var("MILKUP_MERMAID_NATIVE_AUDIT").as_deref() == Ok("1");
        let writer = if enabled { Writer::start().ok() } else { None };
        let mut state = Status::default();
        state.failed = enabled && writer.is_none();
        Self(Arc::new(Mutex::new(state)), Arc::new(writer))
    }
}

impl Registry {
    // Native-only diagnostic; never accepts URL/source text or provides an owner,
    // renderer, navigation, or release proof. Existing failure gates are unchanged.
    pub fn document_protocol(&self, stage: DocumentProtocolStage, allowed: bool, bytes: usize) {
        let Some(writer) = self.1.as_ref().as_ref() else { return; };
        let stage = match stage {
            DocumentProtocolStage::Received => "received",
            DocumentProtocolStage::ResponseBuilt => "response-built",
        };
        let mut state = self.0.lock().unwrap();
        state.document_protocol_records += 1;
        if state.document_protocol_records > 128 || writer.emit(&json!({
            "kind":"fixed-document-protocol", "stage":stage, "allowed":allowed,
            "bodyBytes":bytes
        })).is_err() { state.failed = true; }
    }
    #[cfg(windows)]
    fn lifecycle(&self, frame_id: u64, owner: &Option<String>, phase: &str, detail: Value) {
        let Some(writer) = self.1.as_ref().as_ref() else { return; };
        let mut state = self.0.lock().unwrap();
        state.lifecycle_records += 1;
        if state.lifecycle_records > 256 || writer.emit(&json!({
            "kind":"frame-lifecycle", "frameId":frame_id, "ownerId":owner,
            "stage":phase, "detail":detail
        })).is_err() { state.failed = true; }
    }

    pub fn status(&self) -> Value {
        let state = self.0.lock().unwrap();
        json!({"ready":state.ready && !state.failed,"failed":state.failed,
            "frameProofs":state.frame_proofs,"navigationProofs":state.navigation_proofs,"frames":state.frames,"auditEnabled":self.1.is_some(),"blockedMessages":state.blocked_messages,"blockedNavigations":state.blocked_navigations,
            "dispatchedProbes":state.dispatched_probes,"lastBlockedNonce":state.last_blocked_nonce})
    }

    pub fn prepare_exit(&self) -> Result<(), String> {
        let state = self.0.lock().map_err(|_| "Frontend state unavailable")?;
        if !state.requests.is_empty() || state.frames.values().any(|live| *live) {
            return Err("Frontend owners are still active".into());
        }
        if let Some(writer) = self.1.as_ref().as_ref() {
            writer.flush()?;
        }
        Ok(())
    }

    pub fn record(&self, value: Value) -> Result<(), String> {
        let writer = self
            .1
            .as_ref()
            .as_ref()
            .ok_or("Frontend audit was not enabled")?;
        if value["kind"] == "connection" {
            let object = value.as_object().ok_or("Connection object required")?;
            let allowed = [
                "kind",
                "ownerId",
                "stage",
                "opaqueOrigin",
                "nonceMatches",
                "portAlreadyAssigned",
                "engineAvailable",
                "engineStartupError",
                "engineScriptUrlRevoked",
                "parentDomReadable",
                "tauriInternals",
                "tauriInvoke",
                "wryIpc",
                "chromeWebview",
                "failed",
            ];
            if value.to_string().len() > 512
                || object.keys().any(|k| !allowed.contains(&k.as_str()))
            {
                return Err("Invalid connection metadata".into());
            }
            let owner = value["ownerId"]
                .as_str()
                .filter(|v| valid_nonce(v))
                .ok_or("Invalid connection identity")?;
            if !value["stage"].as_str().is_some_and(|v| {
                [
                    "assets-read",
                    "engine-load",
                    "frame-load",
                    "port-transfer",
                    "frame-hello",
                    "bridge-inventory",
                    "main-probe",
                    "child-ipc",
                    "child-navigation",
                    "ready",
                ]
                .contains(&v)
            }) {
                return Err("Invalid connection stage".into());
            }
            for key in [
                "engineScriptUrlRevoked",                "engineAvailable",
                "engineStartupError",                "opaqueOrigin",
                "nonceMatches",
                "portAlreadyAssigned",
                "parentDomReadable",
                "tauriInternals",
                "tauriInvoke",
                "wryIpc",
                "chromeWebview",
                "failed",
            ] {
                if object.contains_key(key) && !value[key].is_boolean() {
                    return Err("Invalid connection boolean".into());
                }
            }
            let mut state = self.0.lock().map_err(|_| "Frontend state unavailable")?;
            state.connection_records += 1;
            if state.connection_records > 128 {
                state.failed = true;
                return Err("Connection audit budget".into());
            }
            let mut event = value.clone();
            event["nativeFrameLive"] = json!(state.frames.get(owner) == Some(&true));
            return writer.emit(&event);
        }
        let object = value.as_object().ok_or("Frontend audit object required")?;
        let allowed = [
            "phase",
            "ownerId",
            "requestId",
            "sourceSha256",
            "status",
            "errorCode",
            "errorStage",
            "pngSha256",
            "pngBytes",
            "width",
            "height",
            "consumerAborted",
        ];
        if value.to_string().len() > 1024 || object.keys().any(|k| !allowed.contains(&k.as_str())) {
            return Err("Invalid frontend audit fields".into());
        }
        let id = value["requestId"]
            .as_str()
            .filter(|v| valid_nonce(v))
            .ok_or("Invalid request identity")?;
        let owner = value["ownerId"]
            .as_str()
            .filter(|v| valid_nonce(v))
            .ok_or("Invalid owner identity")?;
        let digest = |v: &Value| {
            v.as_str()
                .is_some_and(|s| s.len() == 64 && s.bytes().all(|c| c.is_ascii_hexdigit()))
        };
        if !digest(&value["sourceSha256"]) {
            return Err("Source digest required".into());
        }
        for (key, allowed) in [
            ("errorCode", &["render-failed", "unknown-diagram"][..]),
            (
                "errorStage",
                &["input", "mermaid-render", "svg-output", "png-output"][..],
            ),
        ] {
            if object.contains_key(key)
                && !value[key].as_str().is_some_and(|v| allowed.contains(&v))
            {
                return Err("Invalid frontend error metadata".into());
            }
        }
        if object.contains_key("consumerAborted") && !value["consumerAborted"].is_boolean() {
            return Err("Invalid consumer state".into());
        }
        let phase = value["phase"].as_str().ok_or("Frontend phase required")?;
        let base_fields = ["phase", "ownerId", "requestId", "sourceSha256"];
        if phase != "finished" && object.keys().any(|k| !base_fields.contains(&k.as_str())) {
            return Err("Unexpected phase metadata".into());
        }
        if phase == "finished" {
            if !value["consumerAborted"].is_boolean() {
                return Err("Consumer state required".into());
            }
            let ready = value["status"] == "ready";
            for key in ["pngSha256", "pngBytes", "width", "height"] {
                if !ready && object.contains_key(key) {
                    return Err("Rejected work cannot claim PNG metadata".into());
                }
            }
            if ready && (object.contains_key("errorCode") || object.contains_key("errorStage")) {
                return Err("Ready work cannot claim an error".into());
            }
            if value["status"] != "error"
                && (object.contains_key("errorCode") || object.contains_key("errorStage"))
            {
                return Err("Only renderer errors have error metadata".into());
            }
        }
        let mut state = self.0.lock().map_err(|_| "Boundary state unavailable")?;
        if !state.ready || state.failed {
            return Err("Frame boundary not proven".into());
        }
        let mut event = value.clone();
        event["renderer"] = serde_json::json!("frontend-mermaid-12.2.0");
        event["productPid"] = serde_json::json!(std::process::id());
        match value["phase"].as_str() {
            Some("admitted") => {
                if state.requests.len() >= 8
                    || state.requests.contains_key(id)
                    || state.frames.get(owner) != Some(&true)
                    || !state.frame_proofs.contains_key(owner)
                    || !state.navigation_proofs.contains_key(owner)
                {
                    return Err("Exact bounded frontend owner required".into());
                }
                event["nativeBridgeRejected"] = serde_json::json!(true);
                event["blockedNavigations"] = serde_json::json!(state.navigation_proofs[owner]);
                let proof = state.frame_proofs[owner];
                event["blockedMessages"] = serde_json::json!(proof.0);
                event["dispatchedProbes"] = serde_json::json!(proof.1);
                state.requests.insert(id.into(), event.clone());
            }
            Some("started") | Some("finished") => {
                let admitted = state
                    .requests
                    .get_mut(id)
                    .ok_or("Frontend request was not admitted")?;
                if admitted["ownerId"] != value["ownerId"]
                    || admitted["sourceSha256"] != value["sourceSha256"]
                {
                    return Err("Frontend request identity changed".into());
                }
                if value["phase"] == "started" {
                    if admitted["started"] == true {
                        return Err("Duplicate frontend start".into());
                    }
                    admitted["started"] = serde_json::json!(true);
                } else {
                    let status = value["status"].as_str().ok_or("Missing frontend status")?;
                    if !["ready", "error", "cancelled", "timeout"].contains(&status) {
                        return Err("Invalid frontend status".into());
                    }
                    if status == "ready"
                        && (admitted["started"] != true
                            || !digest(&value["pngSha256"])
                            || !value["pngBytes"]
                                .as_u64()
                                .is_some_and(|n| n > 0 && n <= 16 * 1024 * 1024)
                            || !value["width"].as_u64().is_some_and(|n| n > 0 && n <= 8192)
                            || !value["height"].as_u64().is_some_and(|n| n > 0 && n <= 8192)
                            || value["width"]
                                .as_u64()
                                .unwrap_or(u64::MAX)
                                .saturating_mul(value["height"].as_u64().unwrap_or(u64::MAX))
                                > 16 * 1024 * 1024)
                    {
                        return Err("Invalid bounded frontend PNG record".into());
                    }
                    state.requests.remove(id);
                }
            }
            _ => return Err("Unknown frontend audit phase".into()),
        }
        writer.emit(&event)
    }
    pub fn flush(&self, owner: &str) -> Result<(), String> {
        if !valid_nonce(owner) {
            return Err("Invalid frontend owner".into());
        }
        let state = self.0.lock().map_err(|_| "Boundary state unavailable")?;
        if state.frames.get(owner) != Some(&false)
            || state.requests.values().any(|v| v["ownerId"] == owner)
        {
            return Err("Frontend frame retirement not proven".into());
        }
        if let Some(writer) = self.1.as_ref().as_ref() {
            writer.emit(&json!({"kind":"owner-released","nonce":owner,"frameDestroyed":true,"pendingRequests":0,"hardTerminationProven":false}))?;
            writer.flush()?;
        }
        Ok(())
    }

    pub fn probe(&self, nonce: &str) -> Result<Value, String> {
        if !valid_nonce(nonce) {
            return Err("Invalid boundary probe nonce".into());
        }
        let mut state = self.0.lock().map_err(|_| "Boundary state unavailable")?;
        state.dispatched_probes += 1;
        let result = json!({"kind":"main-probe-dispatched","nonce":nonce,
            "dispatchedProbes":state.dispatched_probes});
        if let Some(writer) = self.1.as_ref().as_ref() {
            writer.emit(&result)?;
        }
        Ok(result)
    }
}

fn classify_load_console(entry: &Value) -> Option<Value> {
    let text=entry["text"].as_str()?;
    let csp=text.to_ascii_lowercase().contains("content security policy");
    let engine=text.contains("mermaid-12.2.0.min-");
    let bootstrap=text.contains("/assets/frame-");
    if !csp && !engine && !bootstrap { return None; }
    Some(json!({"kind":"frame-console-diagnostic", "cspViolation":csp,
        "engineAssetMentioned":engine,"bootstrapAssetMentioned":bootstrap,
        "error":entry["level"]=="error", "resourceLoadFailure":text.contains("Failed to load resource")}))
}

fn cancel_frame_navigation(owner: Option<&str>, uri: &str, already_started: bool) -> bool {
    // Unrelated application/automation frames are not Mermaid owners. They
    // receive no Mermaid port or source and cannot earn an owner proof.
    owner.is_some_and(|nonce| already_started || uri != format!("{}#{}", crate::frontend_mermaid_document::FRAME_URI, nonce))
}

fn valid_nonce(value: &str) -> bool {
    value.len() == 32 && value.bytes().all(|c| c.is_ascii_hexdigit())
}

#[cfg(windows)]
pub fn install(
    view: &webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2,
    registry: Registry,
) -> windows::core::Result<()> {
    use webview2_com::{Microsoft::Web::WebView2::Win32::*, *};
    use windows::core::{Interface, PWSTR};
    // Never forward frame IPC to Tauri. Recording a received-and-rejected frame
    // request is independent of a JS timeout or an absent application callback.
    let created_registry = registry.clone();
    let mut token = 0;
    unsafe {
        if registry.1.is_some() {
            // Read-only, opt-in browser load diagnostics. Retain only fixed
            // classifications, never console text, source, URLs or stack traces.
            let receiver=view.GetDevToolsProtocolEventReceiver(&windows::core::HSTRING::from("Log.entryAdded"))?;
            let log_registry=registry.clone();
            let mut log_token=0;
            receiver.add_DevToolsProtocolEventReceived(&DevToolsProtocolEventReceivedEventHandler::create(Box::new(move |_, args| {
                let Some(args)=args else { return Ok(()); };
                let mut raw=PWSTR::null(); args.ParameterObjectAsJson(&mut raw)?;
                let raw=take_pwstr(raw);
                if raw.len()>16384 { return Ok(()); }
                let Ok(value)=serde_json::from_str::<Value>(&raw) else { return Ok(()); };
                if let Some(detail)=classify_load_console(&value["entry"]) {
                    let mut state=log_registry.0.lock().unwrap();
                    state.console_records+=1;
                    if state.console_records>64 || log_registry.1.as_ref().as_ref().unwrap().emit(&detail).is_err() { state.failed=true; }
                }
                Ok(())
            })), &mut log_token)?;
            let enabled_registry=registry.clone();
            view.CallDevToolsProtocolMethod(&windows::core::HSTRING::from("Log.enable"), &windows::core::HSTRING::from("{}"),
                &CallDevToolsProtocolMethodCompletedHandler::create(Box::new(move |result, _| {
                    if result.is_err() { enabled_registry.0.lock().unwrap().failed=true; }
                    Ok(())
                })))?;
        }
        view.cast::<ICoreWebView2_4>()?.add_FrameCreated(
            &FrameCreatedEventHandler::create(Box::new(move |_, args| {
                let Some(args) = args else { return Ok(()); };
                let register = || -> windows::core::Result<()> {
                    let created_frame = args.Frame()?;
                    let mut name = PWSTR::null();
                    created_frame.Name(&mut name)?;
                    let name = take_pwstr(name);
                    let created_nonce = name.strip_prefix("milkup-mermaid-").filter(|v| valid_nonce(v)).map(str::to_owned);
                    let frame_id = { let mut state=created_registry.0.lock().unwrap(); state.frame_serial += 1; state.frame_serial };
                    created_registry.lifecycle(frame_id, &created_nonce, "created", json!({"nameMatched":created_nonce.is_some()}));
                    let frame = created_frame.cast::<ICoreWebView2Frame2>()?;
                    if let Some(nonce) = &created_nonce {
                        let mut state = created_registry.0.lock().unwrap();
                        if state.frames.len() >= 128 {
                            if let Some(old) = state.frames.iter().find_map(|(k, live)| (!*live).then(|| k.clone())) { state.frames.remove(&old); }
                        }
                        if state.frames.len() >= 128 || state.frames.contains_key(nonce) { state.failed = true; }
                        else { state.frames.insert(nonce.clone(), true); }
                    }
                    let destroyed_registry = created_registry.clone();
                    let destroyed_nonce = created_nonce.clone();
                    let mut destroyed_token = 0;
                    frame.add_Destroyed(&FrameDestroyedEventHandler::create(Box::new(move |_, _| {
                        destroyed_registry.lifecycle(frame_id, &destroyed_nonce, "destroyed", json!({}));
                        if let Some(nonce) = &destroyed_nonce {
                            let mut state = destroyed_registry.0.lock().unwrap();
                            state.frames.insert(nonce.clone(),false);
                            state.frame_proofs.remove(nonce);
                            state.navigation_proofs.remove(nonce);
                        }
                        Ok(())
                    })), &mut destroyed_token)?;
                    let navigation_registry = created_registry.clone();
                    let navigation_nonce = created_nonce.clone();
                    let mut navigation_token = 0;
                    let initial_navigation_started = std::cell::Cell::new(false);
                    frame.add_NavigationStarting(&FrameNavigationStartingEventHandler::create(Box::new(move |_, args| {
                        let Some(args) = args else { return Ok(()); };
                        let mut uri = PWSTR::null();
                        args.Uri(&mut uri)?;
                        let uri = take_pwstr(uri);
                        let cancelled = cancel_frame_navigation(navigation_nonce.as_deref(), &uri, initial_navigation_started.get());
                        if navigation_nonce.is_some() && !cancelled { initial_navigation_started.set(true); }
                        navigation_registry.lifecycle(frame_id, &navigation_nonce, "navigation-start", json!({
                            "uriKind": if uri.starts_with(crate::frontend_mermaid_document::FRAME_URI) {"fixed-document"} else if uri=="about:blank" {"blank"} else {"other"},
                            "cancelled":cancelled
                        }));
                        if cancelled {
                            args.SetCancel(true)?;
                            let mut state = navigation_registry.0.lock().unwrap();
                            state.blocked_navigations += 1;
                            if let Some(nonce) = &navigation_nonce {
                                if !state.frame_proofs.contains_key(nonce) { return Ok(()); }
                                let count = state.blocked_navigations;
                                state.navigation_proofs.insert(nonce.clone(), count);
                                if let Some(writer) = navigation_registry.1.as_ref().as_ref() {
                                    if writer.emit(&json!({"kind":"frame-navigation-rejected","nonce":nonce,
                                        "cancelled":true,"blockedNavigations":count,"aboutBlank":uri=="about:blank"})).is_err() { state.failed=true; }
                                }
                            }
                        }
                        Ok(())
                    })), &mut navigation_token)?;
                    let dom_registry = created_registry.clone();
                    let dom_nonce = created_nonce.clone();
                    let mut dom_token=0;
                    frame.add_DOMContentLoaded(&FrameDOMContentLoadedEventHandler::create(Box::new(move |sender, _| {
                        dom_registry.lifecycle(frame_id, &dom_nonce, "dom-content-loaded", json!({}));
                        // Opt-in, fixed read-only snapshot. This never installs scripts,
                        // starts Mermaid, reads source text, or supplies rendering data.
                        if dom_nonce.is_some() && dom_registry.1.is_some() {
                            if let Some(sender)=sender {
                                let script=windows::core::HSTRING::from(r#"({readyState:document.readyState,scriptCount:document.scripts.length,enginePresent:typeof globalThis.mermaid==='object',bootstrapStarted:document.documentElement.dataset.milkupMermaidBootstrap==='started',readySent:document.documentElement.dataset.milkupMermaidReadySent==='true',opaqueOrigin:globalThis.origin==='null'})"#);
                                let snapshot_registry=dom_registry.clone();
                                let snapshot_nonce=dom_nonce.clone();
                                sender.cast::<ICoreWebView2Frame2>()?.ExecuteScript(&script, &ExecuteScriptCompletedHandler::create(Box::new(move |result, raw| {
                                    let detail = if result.is_ok() && raw.len()<=512 { serde_json::from_str::<Value>(&raw).ok().filter(|v| v.is_object()) } else { None };
                                    snapshot_registry.lifecycle(frame_id, &snapshot_nonce, "script-state", detail.unwrap_or(json!({"snapshotFailed":true})));
                                    Ok(())
                                })))?;
                            }
                        }
                        Ok(())
                    })), &mut dom_token)?;
                    let complete_registry = created_registry.clone();
                    let complete_nonce = created_nonce.clone();
                    let mut complete_token=0;
                    frame.add_NavigationCompleted(&FrameNavigationCompletedEventHandler::create(Box::new(move |_, args| {
                        let Some(args)=args else { return Ok(()); };
                        let mut success=windows::core::BOOL::default();
                        let mut error=COREWEBVIEW2_WEB_ERROR_STATUS::default();
                        args.IsSuccess(&mut success)?;
                        args.WebErrorStatus(&mut error)?;
                        complete_registry.lifecycle(frame_id, &complete_nonce, "navigation-completed", json!({"success":success.as_bool(),"webErrorStatus":error.0}));
                        Ok(())
                    })), &mut complete_token)?;
                    let message_registry = created_registry.clone();
                    let mut frame_token = 0;
                    frame.add_WebMessageReceived(
                        &FrameWebMessageReceivedEventHandler::create(Box::new(move |_, message| {
                            let Some(message) = message else { return Ok(()); };
                            let mut raw = PWSTR::null();
                            message.TryGetWebMessageAsString(&mut raw)?;
                            let raw = take_pwstr(raw);
                            let nonce = if raw.len() <= 1024 {
                                serde_json::from_str::<Value>(&raw).ok().and_then(|v|
                                    v["payload"]["nonce"].as_str().filter(|s| valid_nonce(s)).map(str::to_owned))
                            } else { None };
                            let mut state = message_registry.0.lock().unwrap();
                            state.blocked_messages += 1;
                            let name_matched = nonce.is_some() && nonce == created_nonce;
                            state.last_blocked_nonce = if name_matched { nonce.clone() } else { None };
                            if name_matched {
                                let proof = (state.blocked_messages,state.dispatched_probes);
                                state.frame_proofs.insert(nonce.clone().unwrap(),proof);
                            }
                            if let Some(writer) = message_registry.1.as_ref().as_ref() {
                                if state.blocked_messages > 128 || writer.emit(&json!({
                                    "kind":"frame-ipc-rejected","nonce":nonce,"forwardedToTauri":false,
                                    "createdFrameNameMatched":name_matched,"blockedMessages":state.blocked_messages,
                                    "dispatchedProbes":state.dispatched_probes})).is_err() { state.failed = true; }
                            }
                            Ok(())
                        })), &mut frame_token)?;
                    Ok(())
                };
                if let Err(error) = register() {
                    created_registry.0.lock().unwrap().failed = true;
                    eprintln!("MILKUP_FRONTEND_BOUNDARY {{\"kind\":\"frame-guard-install-failed\"}}");
                    return Err(error);
                }
                Ok(())
            })), &mut token)?;
    }
    registry.0.lock().unwrap().ready = true;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn ready() -> Registry {
        let owner = "a".repeat(32);
        let mut state = Status::default();
        state.ready = true;
        state.frames.insert(owner.clone(), true);
        state.frame_proofs.insert(owner.clone(), (1, 1));
        state.navigation_proofs.insert(owner, 1);
        Registry(
            Arc::new(Mutex::new(state)),
            Arc::new(Some(Writer::start().unwrap())),
        )
    }
    fn event(phase: &str) -> Value {
        json!({"phase":phase,"ownerId":"a".repeat(32),"requestId":"b".repeat(32),"sourceSha256":"c".repeat(64)})
    }
    #[test]
    fn load_diagnostics_never_retain_console_content_or_urls() {
        let value=classify_load_console(&json!({"level":"error", "text":"Refused http://tauri.localhost/assets/frame-secret.js because of Content Security Policy: private document text"})).unwrap();
        assert_eq!(value["cspViolation"], true);
        assert_eq!(value["bootstrapAssetMentioned"], true);
        assert!(!value.to_string().contains("private"));
        assert!(!value.to_string().contains("http"));
        assert!(classify_load_console(&json!({"text":"other private output"})).is_none());
    }
    #[test]
    fn navigation_policy_only_applies_to_exact_owned_frames() {
        let nonce = "a".repeat(32);
        let uri = format!("{}#{}", crate::frontend_mermaid_document::FRAME_URI, nonce);
        assert!(!cancel_frame_navigation(None, "about:blank", false));
        assert!(!cancel_frame_navigation(None, "https://example.invalid", false));
        assert!(!cancel_frame_navigation(Some(&nonce), &uri, false));
        assert!(cancel_frame_navigation(Some(&nonce), &uri, true));
        assert!(cancel_frame_navigation(Some(&nonce), crate::frontend_mermaid_document::FRAME_URI, false));
        assert!(cancel_frame_navigation(Some("wrong"), &uri, false));
        assert!(cancel_frame_navigation(Some(&nonce), "about:srcdoc", false));
        assert!(cancel_frame_navigation(Some(&nonce), "about:blank", false));
        assert!(cancel_frame_navigation(Some(&nonce), "https://example.invalid", false));
    }
    #[test]
    fn exit_requires_retired_frontend_frames_without_a_legacy_registry() {
        let registry = ready();
        assert!(registry.prepare_exit().is_err());
        registry
            .0
            .lock()
            .unwrap()
            .frames
            .insert("a".repeat(32), false);
        registry.prepare_exit().unwrap();
    }
    #[test]
    fn audit_rejects_unproven_boundary_and_irrelevant_or_nested_metadata() {
        let registry = ready();
        assert!(registry.record(json!({"kind":"fixed-document-protocol", "stage":"response-built", "allowed":true, "bodyBytes":42})).is_err());
        let mut bad = event("admitted");
        bad["pngBytes"] = json!({"text":"not metadata"});
        assert!(registry.record(bad).is_err());
        registry.0.lock().unwrap().navigation_proofs.clear();
        assert!(registry.record(event("admitted")).is_err());
        assert!(registry.0.lock().unwrap().requests.is_empty());
    }
    #[test]
    fn native_protocol_diagnostics_are_bounded_and_do_not_establish_owner_proofs() {
        let registry = ready();
        registry.0.lock().unwrap().document_protocol_records = 127;
        registry.document_protocol(DocumentProtocolStage::Received, true, 0);
        assert!(!registry.0.lock().unwrap().failed);
        registry.document_protocol(DocumentProtocolStage::ResponseBuilt, true, 42);
        assert!(registry.0.lock().unwrap().failed);
        assert!(registry.0.lock().unwrap().requests.is_empty());
    }
    #[test]
    fn bounded_png_requires_start_and_release_requires_destroyed_native_frame() {
        let registry = ready();
        registry.record(event("admitted")).unwrap();
        let mut done = event("finished");
        done["status"] = json!("ready");
        done["consumerAborted"] = json!(false);
        done["pngSha256"] = json!("d".repeat(64));
        done["pngBytes"] = json!(120);
        done["width"] = json!(20);
        done["height"] = json!(20);
        assert!(registry.record(done.clone()).is_err());
        registry.record(event("started")).unwrap();
        registry.record(done).unwrap();
        assert!(registry.flush(&"a".repeat(32)).is_err());
        registry
            .0
            .lock()
            .unwrap()
            .frames
            .insert("a".repeat(32), false);
        registry.flush(&"a".repeat(32)).unwrap();
    }
}
