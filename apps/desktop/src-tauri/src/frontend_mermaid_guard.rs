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
}

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
                    "frame-load",
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
        view.cast::<ICoreWebView2_4>()?.add_FrameCreated(
            &FrameCreatedEventHandler::create(Box::new(move |_, args| {
                let Some(args) = args else { return Ok(()); };
                let register = || -> windows::core::Result<()> {
                    let created_frame = args.Frame()?;
                    let mut name = PWSTR::null();
                    created_frame.Name(&mut name)?;
                    let name = take_pwstr(name);
                    let created_nonce = name.strip_prefix("milkup-mermaid-").filter(|v| valid_nonce(v)).map(str::to_owned);
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
                    frame.add_NavigationStarting(&FrameNavigationStartingEventHandler::create(Box::new(move |_, args| {
                        let Some(args) = args else { return Ok(()); };
                        let mut uri = PWSTR::null();
                        args.Uri(&mut uri)?;
                        let uri = take_pwstr(uri);
                        if uri != "about:srcdoc" {
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
        let mut bad = event("admitted");
        bad["pngBytes"] = json!({"text":"not metadata"});
        assert!(registry.record(bad).is_err());
        registry.0.lock().unwrap().navigation_proofs.clear();
        assert!(registry.record(event("admitted")).is_err());
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
