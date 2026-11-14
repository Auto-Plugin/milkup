//! Internal Linux-only WebKit helper. It does not initialize Tauri or any bridge.
use super::*;
use gtk::{gio, glib, prelude::*};
use javascriptcore::ValueExt;
use std::{
    cell::Cell,
    fs::{self, File},
    io::{self, BufReader, Read, Write},
    os::{
        fd::FromRawFd,
        unix::fs::{OpenOptionsExt, PermissionsExt},
    },
    path::PathBuf,
    rc::Rc,
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc,
    },
};
use webkit2gtk::{
    DownloadExt, FileChooserRequestExt, NavigationPolicyDecisionExt, PermissionRequestExt,
    PolicyDecisionExt, SecurityManagerExt, SettingsExt, URIRequestExt, URISchemeRequestExt,
    URISchemeResponseExt, UserMessageExt, WebContextExt, WebViewExt,
};
const URL: &str = "milkup-dom://job/index.html";
const CSP: &str = "default-src 'none'; script-src milkup-dom://job/bootstrap.js milkup-dom://job/module.js; style-src 'unsafe-inline'; connect-src 'none'; img-src 'none'; font-src 'none'; frame-src 'none'; child-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
const HTML: &[u8] = b"<!doctype html><html><head><meta charset=\"utf-8\"><script src=\"milkup-dom://job/bootstrap.js\" defer></script></head><body></body></html>";
const BOOTSTRAP: &[u8] = include_bytes!("plugin_dom_bootstrap.js");
const EXTENSION: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/libmilkup_dom_guard.so"));
pub(super) struct PrivateDirectory(pub(super) PathBuf);
impl PrivateDirectory {
    pub(super) fn cleanup(&self) {
        let _ = fs::set_permissions(&self.0, fs::Permissions::from_mode(0o700));
        let _ = fs::remove_dir_all(&self.0);
    }
}
impl Drop for PrivateDirectory {
    fn drop(&mut self) {
        self.cleanup();
    }
}
pub(super) fn private_extension() -> Result<PrivateDirectory, String> {
    let path = std::env::temp_dir().join(format!("milkup-dom-{}", opaque_id()?));
    // mkdir is atomic, and the random name must not already exist.
    use std::os::unix::fs::DirBuilderExt;
    fs::DirBuilder::new()
        .mode(0o700)
        .create(&path)
        .map_err(|e| e.to_string())?;
    let private = PrivateDirectory(path);
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(private.0.join("libmilkup_dom_guard.so"))
        .map_err(|e| e.to_string())?;
    file.write_all(EXTENSION).map_err(|e| e.to_string())?;
    fs::set_permissions(&private.0, fs::Permissions::from_mode(0o500))
        .map_err(|e| e.to_string())?;
    Ok(private)
}
pub(super) fn run() {
    if let Err(error) = run_inner() {
        eprintln!("Independent DOM helper failed: {error}");
    }
}
fn run_inner() -> Result<(), String> {
    // This result pipe is never stdout and is closed in every WebKit exec child.
    let flags = unsafe { libc::fcntl(3, libc::F_GETFD) };
    if flags < 0 || unsafe { libc::fcntl(3, libc::F_SETFD, flags | libc::FD_CLOEXEC) } < 0 {
        return Err("Missing dedicated DOM result pipe".into());
    }
    let input_flags = unsafe { libc::fcntl(0, libc::F_GETFD) };
    if input_flags < 0
        || unsafe { libc::fcntl(0, libc::F_SETFD, input_flags | libc::FD_CLOEXEC) } < 0
    {
        return Err("Cannot confine the DOM input pipe".into());
    }
    let output = Rc::new(std::cell::RefCell::new(unsafe { File::from_raw_fd(3) }));
    let mut input = BufReader::new(io::stdin());
    let mut length = [0u8; 4];
    input.read_exact(&mut length).map_err(|e| e.to_string())?;
    let length = u32::from_le_bytes(length) as usize;
    // serde JSON escaping can expand snapshot text sixfold.
    if length > (MAX_MODULE + MAX_MANIFEST) * 6 + 4096 {
        return Err("DOM snapshot exceeds preparation budget".into());
    }
    let mut bytes = vec![0; length];
    input.read_exact(&mut bytes).map_err(|e| e.to_string())?;
    let snapshot: Snapshot = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
    drop(bytes);
    let plugin_id = snapshot.manifest["id"]
        .as_str()
        .ok_or("Missing snapshot identity")?;
    validate_profile(&snapshot.manifest, plugin_id)?;
    if snapshot.module.len() > MAX_MODULE
        || format!("{:x}", Sha256::digest(snapshot.module.as_bytes())) != snapshot.sha256
    {
        return Err("DOM snapshot digest mismatch".into());
    }
    let token = opaque_id()?;
    let extension = PathBuf::from(
        std::env::var_os("MILKUP_INTERNAL_DOM_GUARD_DIR")
            .ok_or("Missing owned native extension directory")?,
    );
    gtk::init().map_err(|e| e.to_string())?;
    let window = gtk::Window::new(gtk::WindowType::Toplevel);
    window.set_title("Independent plugin document renderer");
    window.set_default_size(1024, 768);
    let context = webkit2gtk::WebContext::new_ephemeral();
    // Wry's temporary context defaults differ. This must precede WebView creation.
    context.set_sandbox_enabled(true);
    if !context.is_sandbox_enabled() {
        return Err("WebKit sandbox is unavailable".into());
    }
    context.set_web_extensions_directory(
        extension
            .to_str()
            .ok_or("Invalid private extension directory")?,
    );
    context.set_automation_allowed(false);
    context
        .security_manager()
        .ok_or("WebKit security manager unavailable")?
        .register_uri_scheme_as_secure("milkup-dom");
    let module = snapshot.module.into_bytes();
    context.register_uri_scheme("milkup-dom", move |request| {
        let uri = request.uri().map(|s| s.to_string()).unwrap_or_default();
        let method = request
            .http_method()
            .map(|s| s.to_string())
            .unwrap_or_default();
        let (status, mime, body) = match (method.as_str(), uri.as_str()) {
            ("GET", URL) => (200, "text/html; charset=utf-8", HTML),
            ("GET", "milkup-dom://job/bootstrap.js") => {
                (200, "text/javascript; charset=utf-8", BOOTSTRAP)
            }
            ("GET", "milkup-dom://job/module.js") => {
                (200, "text/javascript; charset=utf-8", module.as_slice())
            }
            _ => (403, "text/plain; charset=utf-8", b"denied".as_slice()),
        };
        let bytes = glib::Bytes::from(body);
        let stream = gio::MemoryInputStream::from_bytes(&bytes);
        let response = webkit2gtk::URISchemeResponse::new(&stream, body.len() as i64);
        response.set_status(status, None);
        response.set_content_type(mime);
        let headers = soup::MessageHeaders::new(soup::MessageHeadersType::Response);
        for (name, value) in [
            ("Content-Type", mime),
            ("Content-Security-Policy", CSP),
            ("X-Content-Type-Options", "nosniff"),
            ("Cache-Control", "no-store"),
        ] {
            headers.append(name, value);
        }
        response.set_http_headers(headers);
        request.finish_with_response(&response);
    });
    context.connect_download_started(|_, download| download.cancel());
    let guard_ready = Rc::new(Cell::new(false));
    let guard_observed = guard_ready.clone();
    context.connect_user_message_received(move |_, message| match message.name().as_deref() {
        Some("milkup-dom-native-guard-ready-v1") => {
            guard_observed.set(true);
            true
        }
        Some("milkup-dom-native-guard-deny-v1") => {
            eprintln!("DOM_NATIVE_GUARD_DENY");
            true
        }
        _ => false,
    });
    let view = webkit2gtk::WebView::with_context(&context);
    if !view.is_ephemeral() {
        return Err("WebKit private context is unavailable".into());
    }
    let settings = WebViewExt::settings(&view).ok_or("WebKit settings unavailable")?;
    settings.set_allow_file_access_from_file_urls(false);
    settings.set_allow_universal_access_from_file_urls(false);
    settings.set_enable_webrtc(false);
    settings.set_enable_media_stream(false);
    settings.set_enable_webgl(false);
    settings.set_enable_html5_database(false);
    settings.set_enable_html5_local_storage(false);
    settings.set_enable_dns_prefetching(false);
    settings.set_javascript_can_open_windows_automatically(false);
    settings.set_enable_developer_extras(false);
    view.connect_permission_request(|_, request| {
        request.deny();
        true
    });
    view.connect_run_file_chooser(|_, request| {
        request.cancel();
        true
    });
    view.connect_script_dialog(|_, dialog| {
        dialog.close();
        true
    });
    let navigation = Arc::new(AtomicBool::new(false));
    view.connect_decide_policy(move |_, decision, kind| match kind {
        webkit2gtk::PolicyDecisionType::NavigationAction => {
            let allowed = decision
                .downcast_ref::<webkit2gtk::NavigationPolicyDecision>()
                .and_then(|d| d.navigation_action())
                .and_then(|a| a.request())
                .and_then(|r| r.uri())
                .is_some_and(|u| u == URL && !navigation.swap(true, Ordering::SeqCst));
            if allowed {
                decision.use_();
            } else {
                decision.ignore();
            }
            true
        }
        webkit2gtk::PolicyDecisionType::NewWindowAction => {
            decision.ignore();
            true
        }
        _ => false,
    });
    let ready = Rc::new(Cell::new(false));
    let loaded = Rc::new(Cell::new(false));
    let load_observed = loaded.clone();
    let init_started = Rc::new(Cell::new(false));
    let init_script = format!(
        "this.__milkupDomInit({}, {})",
        serde_json::to_string(&token).map_err(|e| e.to_string())?,
        snapshot.manifest
    );
    view.connect_load_changed(move |view, event| {
        if event == webkit2gtk::LoadEvent::Finished && view.uri().as_deref() == Some(URL) {
            load_observed.set(true);
        }
    });
    window.add(&view);
    window.realize();
    view.set_size_request(1024, 768);
    view.show();
    let (sender, receiver) = mpsc::sync_channel(2);
    std::thread::spawn(move || loop {
        match process::read_frame(&mut input, INPUT_WIRE_LIMIT) {
            Ok(Some(bytes)) => {
                if sender.send(Some(bytes)).is_err() {
                    break;
                }
            }
            _ => {
                let _ = sender.send(None);
                break;
            }
        }
    });
    let busy = Rc::new(Cell::new(false));
    let native = view.clone();
    let dispatch_token = serde_json::to_string(&token).map_err(|e| e.to_string())?;
    glib::timeout_add_local(Duration::from_millis(5), move || {
        if !ready.get() {
            if loaded.get() && guard_ready.get() && !init_started.replace(true) {
                let ready = ready.clone();
                // Inject before plugin import; no token enters a resource or DOM.
                native.evaluate_javascript(
                    &init_script,
                    None,
                    None,
                    None::<&gio::Cancellable>,
                    move |result| {
                        if result.is_ok() {
                            ready.set(true);
                        } else {
                            gtk::main_quit();
                        }
                    },
                );
            }
            return glib::ControlFlow::Continue;
        }
        if busy.get() {
            return glib::ControlFlow::Continue;
        }
        let script = match receiver.try_recv() {
            Ok(Some(bytes)) => {
                let Ok(message) = std::str::from_utf8(&bytes) else {
                    gtk::main_quit();
                    return glib::ControlFlow::Break;
                };
                format!("this.__milkupDom({dispatch_token},{message})")
            }
            Ok(None) => {
                gtk::main_quit();
                return glib::ControlFlow::Break;
            }
            Err(mpsc::TryRecvError::Disconnected) => {
                gtk::main_quit();
                return glib::ControlFlow::Break;
            }
            Err(mpsc::TryRecvError::Empty) => format!("this.__milkupDom({dispatch_token},null)"),
        };
        busy.set(true);
        let busy = busy.clone();
        let output = output.clone();
        native.evaluate_javascript(
            &script,
            None,
            None,
            None::<&gio::Cancellable>,
            move |result| {
                busy.set(false);
                let result = result
                    .ok()
                    .and_then(|v| v.to_json(0))
                    .and_then(|s| serde_json::from_str::<Value>(&s).ok());
                match result {
                    Some(Value::Null) => {}
                    Some(Value::String(message)) if message.len() <= OUTPUT_WIRE_LIMIT => {
                        let mut output = output.borrow_mut();
                        if output
                            .write_all(message.as_bytes())
                            .and_then(|_| output.write_all(b"\n"))
                            .and_then(|_| output.flush())
                            .is_err()
                        {
                            gtk::main_quit();
                        }
                    }
                    _ => gtk::main_quit(),
                }
            },
        );
        glib::ControlFlow::Continue
    });
    view.load_uri(URL);
    gtk::main();
    Ok(())
}
