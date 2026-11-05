//! Boundary enforcement for the fixed renderer in the existing application WebView.
//! No renderer process, browser environment, shell, or filesystem resource is created.
use serde_json::{json, Value};
use std::sync::{Arc, Mutex};

#[derive(Default)]
struct Status {
    ready: bool,
    failed: bool,
    blocked_messages: u64,
    blocked_navigations: u64,
    dispatched_probes: u64,
    last_blocked_nonce: Option<String>,
}

#[derive(Clone, Default)]
pub struct Registry(Arc<Mutex<Status>>);

impl Registry {
    pub fn status(&self) -> Value {
        let state = self.0.lock().unwrap();
        json!({"ready":state.ready && !state.failed,"failed":state.failed,
            "blockedMessages":state.blocked_messages,"blockedNavigations":state.blocked_navigations,
            "dispatchedProbes":state.dispatched_probes,"lastBlockedNonce":state.last_blocked_nonce})
    }

    pub fn probe(&self, nonce: &str) -> Result<Value, String> {
        if !valid_nonce(nonce) {
            return Err("Invalid boundary probe nonce".into());
        }
        let mut state = self.0.lock().map_err(|_| "Boundary state unavailable")?;
        state.dispatched_probes += 1;
        let result = json!({"kind":"main-probe-dispatched","nonce":nonce,
            "dispatchedProbes":state.dispatched_probes});
        eprintln!("MILKUP_FRONTEND_BOUNDARY {result}");
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
                            // Bounded diagnostics; a flood invalidates acceptance.
                            if state.blocked_messages > 128 { state.failed = true; }
                            else { eprintln!("MILKUP_FRONTEND_BOUNDARY {}", json!({
                                "kind":"frame-ipc-rejected","nonce":nonce,"forwardedToTauri":false,"createdFrameNameMatched":name_matched,
                                "blockedMessages":state.blocked_messages,"dispatchedProbes":state.dispatched_probes})); }
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
        let navigation_registry = registry.clone();
        view.add_FrameNavigationStarting(
            &NavigationStartingEventHandler::create(Box::new(move |_, args| {
                let Some(args) = args else {
                    return Ok(());
                };
                let mut uri = PWSTR::null();
                args.Uri(&mut uri)?;
                let uri = take_pwstr(uri);
                if uri != "about:srcdoc" {
                    args.SetCancel(true)?;
                    navigation_registry.0.lock().unwrap().blocked_navigations += 1;
                }
                Ok(())
            })),
            &mut token,
        )?;
    }
    registry.0.lock().unwrap().ready = true;
    Ok(())
}
