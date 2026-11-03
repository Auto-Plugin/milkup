//! Fixed Mermaid renderer, isolated from the editor and generic plugin runtimes.
//! Reuses the existing native resource guard and single-tree cleanup guardian.
use gtk::{cairo, gio, glib, prelude::*};
use image::ImageEncoder;
use javascriptcore::ValueExt;
use milkup_mermaid_engine::{Control, Rendered};
use serde_json::{json, Value};
use std::{
    cell::{Cell, RefCell},
    fs::{self, File},
    io::{Read, Write},
    os::{
        fd::{AsRawFd, FromRawFd},
        unix::{
            fs::{DirBuilderExt, OpenOptionsExt},
            process::CommandExt,
        },
    },
    path::PathBuf,
    process::{Command, Stdio},
    rc::Rc,
    sync::mpsc,
    time::{Duration, Instant},
};
use webkit2gtk::{
    DownloadExt, FileChooserRequestExt, NavigationPolicyDecisionExt, PermissionRequestExt,
    PolicyDecisionExt, SecurityManagerExt, SettingsExt, URIRequestExt, URISchemeRequestExt,
    URISchemeResponseExt, UserMessageExt, WebContextExt, WebViewExt,
};

type Result<T> = std::result::Result<T, String>;
const URL: &str = "milkup-dom://job/index.html";
const CSP: &str = "default-src 'none'; script-src milkup-dom://job/module.js milkup-dom://job/bootstrap.js; style-src 'unsafe-inline'; img-src 'none'; font-src 'none'; connect-src 'none'; frame-src 'none'; child-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
const MAX_PNG: usize = milkup_mermaid_engine::MAX_OUTPUT;
const MAX_INPUT: usize = 65_536;
const MAX_PIXELS: u64 = 16_777_216;
const GUARD: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/libmilkup_dom_guard.so"));
const MERMAID: &[u8] = include_bytes!("../mermaid-engine/assets/mermaid-12.2.0.min.js");
const BOOTSTRAP: &str = include_str!("../mermaid-engine/assets/bootstrap.js");
const HTML: &[u8] = b"<!doctype html><html><head><meta charset=\"utf-8\"><style>html,body{margin:0;padding:0;background:transparent}#target{display:block;width:max-content;min-width:0}svg{display:block}</style><script src=\"milkup-dom://job/module.js\" defer></script><script src=\"milkup-dom://job/bootstrap.js\" defer></script></head><body><div id=\"target\"></div></body></html>";
// This is a JS-only data queue, not a native bridge. Neither document data nor
// plugin code can select executable assets, paths, commands or native methods.
const ADAPTER: &str = r#"(() => {
  const queue = []; let receive;
  globalThis.addEventListener('error', () => { if(queue.length < 8) queue.push({phase:'error',message:'Fixed bootstrap script failed'}); });
  globalThis.addEventListener('unhandledrejection', () => { if(queue.length < 8) queue.push({phase:'error',message:'Fixed bootstrap rejected initialization'}); });
  Object.defineProperty(globalThis, 'chrome', {value: Object.freeze({webview: Object.freeze({
    addEventListener(type, callback) { if(type === 'message' && !receive) receive = callback; },
    postMessage(value) { if(queue.length < 8) queue.push(value); }
  })})});
  Object.defineProperty(globalThis, '__milkupFixedTake', {value: () => JSON.stringify(queue.splice(0))});
  Object.defineProperty(globalThis, '__milkupFixedReceive', {value: data => receive?.({data})});
})();
"#;

fn error(e: impl std::fmt::Display) -> String {
    e.to_string()
}
fn trace(phase: &'static str) {
    if std::env::var_os("MILKUP_MERMAID_DIAGNOSTICS").as_deref() == Some(std::ffi::OsStr::new("1"))
    {
        eprintln!("MILKUP_FIXED_MERMAID {phase}");
    }
}
fn checked_cleanup_with(
    path: &std::path::Path,
    remove: impl FnOnce(&std::path::Path) -> std::io::Result<()>,
) -> Result<()> {
    match remove(path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!(
            "Mermaid owned directory cleanup failed at {}: {e}",
            path.display()
        )),
    }
}
fn checked_cleanup(path: &std::path::Path) -> Result<()> {
    checked_cleanup_with(path, |path| fs::remove_dir_all(path))
}
struct Private(PathBuf);
impl Private {
    fn new() -> Result<Self> {
        let path = std::env::temp_dir().join(crate::workspace::id("milkup-mermaid")?);
        fs::DirBuilder::new()
            .mode(0o700)
            .create(&path)
            .map_err(error)?;
        let private = Self(path);
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(private.0.join("libmilkup_dom_guard.so"))
            .map_err(error)?;
        file.write_all(GUARD).map_err(error)?;
        Ok(private)
    }
}
impl Drop for Private {
    fn drop(&mut self) {
        // Early-return fallback is observable. Successful renders additionally
        // require explicit checked cleanup before they may publish a PNG.
        if let Err(e) = checked_cleanup(&self.0) {
            eprintln!("{e}");
        }
    }
}

fn frame_write(writer: &mut impl Write, value: &Value) -> Result<()> {
    let bytes = serde_json::to_vec(value).map_err(error)?;
    writer
        .write_all(&(bytes.len() as u32).to_le_bytes())
        .and_then(|_| writer.write_all(&bytes))
        .and_then(|_| writer.flush())
        .map_err(error)
}
fn frame_read(reader: &mut impl Read, limit: usize) -> Result<Value> {
    let mut size = [0; 4];
    reader.read_exact(&mut size).map_err(error)?;
    let size = u32::from_le_bytes(size) as usize;
    if size > limit {
        return Err("Fixed Mermaid frame exceeds its budget".into());
    }
    let mut bytes = vec![0; size];
    reader.read_exact(&mut bytes).map_err(error)?;
    serde_json::from_slice(&bytes).map_err(error)
}
fn pipe(flags: i32) -> Result<(File, File)> {
    let mut fds = [-1; 2];
    if unsafe { libc::pipe2(fds.as_mut_ptr(), flags | libc::O_CLOEXEC) } != 0 {
        return Err(error(std::io::Error::last_os_error()));
    }
    Ok(unsafe { (File::from_raw_fd(fds[0]), File::from_raw_fd(fds[1])) })
}

pub fn render(input: &Value, control: &Control) -> Result<Rendered> {
    control.checkpoint()?;
    let private = Private::new()?;
    let (reader, writer) = pipe(0)?;
    let (stop_reader, stop_writer) = pipe(libc::O_NONBLOCK)?;
    let result_fd = writer.as_raw_fd();
    let stop_fd = stop_reader.as_raw_fd();
    let parent = unsafe { libc::getpid() };
    let mut command = Command::new(std::env::current_exe().map_err(error)?);
    #[cfg(not(test))]
    command.arg("--milkup-internal-fixed-mermaid-linux");
    #[cfg(test)]
    command.args([
        "private_mermaid_linux::tests::fixed_helper_fixture",
        "--exact",
        "--ignored",
        "--test-threads=1",
        "--nocapture",
    ]);
    command
        .env("MILKUP_INTERNAL_MERMAID_DIRECTORY", &private.0)
        .env(
            "MILKUP_INTERNAL_DOM_INSTANCE_ID",
            input["requestId"].as_str().unwrap_or("fixed-mermaid"),
        )
        // Do not let inherited developer switches disable this helper's sandbox
        // or open a remote inspector. Keep the installed runtime/library lookup.
        .env_remove("WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS")
        .env_remove("WEBKIT_INSPECTOR_SERVER")
        .env_remove("WEBKIT_INSPECTOR_HTTP_SERVER")
        .env_remove("LD_PRELOAD")
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::inherit());
    unsafe {
        command.pre_exec(move || {
            if libc::setsid() < 0 || libc::getppid() != parent {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::BrokenPipe,
                    "Mermaid owner exited",
                ));
            }
            // Sources can occupy FD3/FD4; duplicate both above the reserved pair.
            let a = libc::fcntl(result_fd, libc::F_DUPFD_CLOEXEC, 5);
            let b = libc::fcntl(stop_fd, libc::F_DUPFD_CLOEXEC, 5);
            if a < 0 || b < 0 || libc::dup2(a, 3) < 0 || libc::dup2(b, 4) < 0 {
                return Err(std::io::Error::last_os_error());
            }
            libc::close(a);
            libc::close(b);
            Ok(())
        });
    }
    let mut child = command.spawn().map_err(error)?;
    drop(writer);
    drop(stop_reader);
    let mut stdin = child.stdin.take().ok_or("Mermaid input pipe unavailable")?;
    let data = input.clone();
    // No pipe write/read runs on the deadline authority's thread.
    std::thread::spawn(move || {
        let _ = frame_write(&mut stdin, &data);
    });
    let (send, receive) = mpsc::sync_channel(1);
    std::thread::spawn(move || {
        let result = (|| {
            let mut reader = reader;
            let header = frame_read(&mut reader, 4096)?;
            if header["ok"] != true {
                return Err(header["error"]
                    .as_str()
                    .unwrap_or("Mermaid helper failed")
                    .to_string());
            }
            let width = header["width"].as_u64().ok_or("Missing PNG width")?;
            let height = header["height"].as_u64().ok_or("Missing PNG height")?;
            let size = header["bytes"].as_u64().ok_or("Missing PNG length")?;
            if width == 0
                || height == 0
                || width > 8192
                || height > 8192
                || width * height > MAX_PIXELS
                || size > MAX_PNG as u64
            {
                return Err("Fixed Mermaid PNG exceeds its budget".into());
            }
            let mut png = vec![0; size as usize];
            reader.read_exact(&mut png).map_err(error)?;
            Ok(Rendered {
                png,
                width: width as u32,
                height: height as u32,
            })
        })();
        let _ = send.send(result);
    });
    let result = (|| loop {
        control.checkpoint()?;
        match receive.recv_timeout(Duration::from_millis(10).min(control.remaining())) {
            Ok(value) => {
                control.checkpoint()?;
                break value;
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(e) => break Err(error(e)),
        }
    })();
    // EOF retires exactly this guardian's descendants, including escaped groups.
    drop(stop_writer);
    let cleanup_deadline = Instant::now() + Duration::from_secs(5);
    loop {
        match child.try_wait() {
            Err(e) => {
                control.mark_cleanup_uncertain();
                std::mem::forget(private);
                return Err(format!("Mermaid cleanup could not be observed: {e}"));
            }
            Ok(Some(status)) => {
                if !status.success() {
                    control.mark_cleanup_uncertain();
                    let message = format!("Mermaid guardian cleanup failed; owned directory retained for inspection: {}",private.0.display());
                    std::mem::forget(private);
                    return Err(message);
                }
                trace("guardian-exited-clean");
                break;
            }
            Ok(None) if Instant::now() >= cleanup_deadline => {
                // Leave the guardian and private extension alive until its owned
                // descendants are reaped. Never kill it ahead of cleanup.
                std::mem::forget(private);
                control.mark_cleanup_uncertain();
                return Err("Mermaid cleanup pending; owned private directory retained".into());
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(10)),
        }
    }
    // Cleanup is part of successful publication, not a best-effort Drop side
    // effect. The guardian may already have removed its owned extension folder.
    if let Err(e) = checked_cleanup(&private.0) {
        control.mark_cleanup_uncertain();
        // Keep the evidence target intact for review/retry, rather than make a
        // best-effort second attempt from Drop after reporting a cleanup failure.
        std::mem::forget(private);
        return Err(e);
    }
    trace("private-directory-clean");
    result
}

pub fn run_helper_if_requested() -> bool {
    if std::env::args().nth(1).as_deref() != Some("--milkup-internal-fixed-mermaid-linux") {
        return false;
    }
    run_guarded();
    true
}
fn run_guarded() {
    let result = crate::plugin_dom::supervise_native_output(helper);
    // Guardian owns this directory even when the editor dies or times out.
    let cleanup = if let Some(path) = std::env::var_os("MILKUP_INTERNAL_MERMAID_DIRECTORY") {
        let path = PathBuf::from(path);
        if path.parent() == Some(std::env::temp_dir().as_path())
            && path
                .file_name()
                .is_some_and(|p| p.to_string_lossy().starts_with("milkup-mermaid-"))
        {
            checked_cleanup(&path)
        } else {
            Err("Mermaid guardian refused an unowned cleanup path".into())
        }
    } else {
        Err("Mermaid guardian owned cleanup directory missing".into())
    };
    if let Err(e) = result.and(cleanup) {
        eprintln!("Fixed Mermaid guardian: {e}");
        std::process::exit(1);
    }
}
fn fail(output: &Rc<RefCell<File>>, message: impl std::fmt::Display) {
    let _ = frame_write(
        &mut *output.borrow_mut(),
        &json!({"ok":false,"error":message.to_string()}),
    );
    if gtk::main_level() > 0 {
        gtk::main_quit();
    }
}
fn helper() {
    for fd in [0, 3] {
        if unsafe { libc::fcntl(fd, libc::F_SETFD, libc::FD_CLOEXEC) } < 0 {
            return;
        }
    }
    let output = Rc::new(RefCell::new(unsafe { File::from_raw_fd(3) }));
    if let Err(e) = helper_inner(output.clone()) {
        fail(&output, e);
    }
}

fn helper_inner(output: Rc<RefCell<File>>) -> Result<()> {
    let input = frame_read(&mut std::io::stdin(), MAX_INPUT)?;
    // The parent crate validated this closed text-only request. Repeat the
    // structural checks before any renderer process is initialized.
    let keys = input.as_object().ok_or("Expected fixed input object")?;
    let request_id = input["requestId"].as_str().ok_or("Missing request ID")?;
    if keys.len() != 7
        || !keys.keys().all(|k| {
            [
                "protocol",
                "requestId",
                "fixtureId",
                "source",
                "width",
                "theme",
                "look",
            ]
            .contains(&k.as_str())
        })
        || request_id.is_empty()
        || request_id.len() > 80
        || !request_id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
        || input["fixtureId"] != request_id
        || input["protocol"] != 1
        || !input["source"].is_string()
        || input["source"].as_str().unwrap().encode_utf16().count() > 50_000
        || input["source"].as_str().unwrap().split('\n').count() > 256
        || !matches!(input["theme"].as_str(), Some("default" | "dark"))
        || !matches!(input["look"].as_str(), Some("classic" | "neo"))
        || !input["width"]
            .as_u64()
            .is_some_and(|w| (160..=8192).contains(&w))
    {
        return Err("Fixed Mermaid helper input rejected".into());
    }
    let width = input["width"].as_u64().unwrap() as i32;
    gtk::init().map_err(error)?;
    trace("gtk-ready");
    let window = gtk::Window::new(gtk::WindowType::Toplevel);
    window.set_title("Milk up fixed diagram renderer");
    window.set_default_size(width, 768);
    window.set_accept_focus(false);
    window.set_skip_taskbar_hint(true);
    window.set_skip_pager_hint(true);
    window.move_(-20000, -20000);
    let context = webkit2gtk::WebContext::new_ephemeral();
    context.set_sandbox_enabled(true);
    if !context.is_sandbox_enabled() {
        return Err("Mermaid WebKit sandbox unavailable".into());
    }
    let directory = std::env::var("MILKUP_INTERNAL_MERMAID_DIRECTORY").map_err(error)?;
    context.set_web_extensions_directory(&directory);
    context.set_automation_allowed(false);
    context
        .security_manager()
        .ok_or("Missing WebKit security manager")?
        .register_uri_scheme_as_secure("milkup-dom");
    let bootstrap = format!("{ADAPTER}\n{BOOTSTRAP}").into_bytes();
    context.register_uri_scheme("milkup-dom", move |request| {
        let uri = request.uri().map(|u| u.to_string()).unwrap_or_default();
        let (mime, bytes) = match (request.http_method().as_deref(), uri.as_str()) {
            (Some("GET"), URL) => {
                trace("html-request");
                ("text/html; charset=utf-8", HTML)
            }
            (Some("GET"), "milkup-dom://job/module.js") => {
                trace("mermaid-request");
                ("text/javascript; charset=utf-8", MERMAID)
            }
            (Some("GET"), "milkup-dom://job/bootstrap.js") => {
                trace("bootstrap-request");
                ("text/javascript; charset=utf-8", bootstrap.as_slice())
            }
            _ => {
                request.finish_error(&mut glib::Error::new(
                    gio::IOErrorEnum::PermissionDenied,
                    "Fixed asset denied",
                ));
                return;
            }
        };
        let stream = gio::MemoryInputStream::from_bytes(&glib::Bytes::from(bytes));
        let response = webkit2gtk::URISchemeResponse::new(&stream, bytes.len() as i64);
        response.set_status(200, None);
        response.set_content_type(mime);
        let headers = soup::MessageHeaders::new(soup::MessageHeadersType::Response);
        for (key, value) in [
            ("Content-Type", mime),
            ("Content-Security-Policy", CSP),
            ("X-Content-Type-Options", "nosniff"),
            ("Cache-Control", "no-store"),
        ] {
            headers.append(key, value);
        }
        response.set_http_headers(headers);
        request.finish_with_response(&response);
    });
    context.connect_download_started(|_, d| d.cancel());
    let guard = Rc::new(Cell::new(false));
    let observed = guard.clone();
    context.connect_user_message_received(move |_, message| {
        if message.name().as_deref() == Some("milkup-dom-native-guard-ready-v1") {
            trace("guard-ready");
            observed.set(true);
            true
        } else {
            false
        }
    });
    let view = webkit2gtk::WebView::with_context(&context);
    if !view.is_ephemeral() {
        return Err("Mermaid renderer must be ephemeral".into());
    }
    let settings = WebViewExt::settings(&view).ok_or("Missing WebKit settings")?;
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
    settings.set_hardware_acceleration_policy(webkit2gtk::HardwareAccelerationPolicy::Never);
    view.connect_permission_request(|_, r| {
        r.deny();
        true
    });
    view.connect_run_file_chooser(|_, r| {
        r.cancel();
        true
    });
    view.connect_script_dialog(|_, d| {
        d.close();
        true
    });
    let navigated = Rc::new(Cell::new(false));
    view.connect_decide_policy(move |_, decision, kind| match kind {
        webkit2gtk::PolicyDecisionType::NavigationAction => {
            let allowed = decision
                .downcast_ref::<webkit2gtk::NavigationPolicyDecision>()
                .and_then(|d| d.navigation_action())
                .and_then(|a| a.request())
                .and_then(|r| r.uri())
                .is_some_and(|u| u == URL && !navigated.replace(true));
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
    let loaded = Rc::new(Cell::new(false));
    let observed = loaded.clone();
    view.connect_load_changed(move |_, event| {
        if event == webkit2gtk::LoadEvent::Finished {
            trace("html-loaded");
            observed.set(true);
        }
    });
    let failed = output.clone();
    view.connect_load_failed(move |_, _, _, e| {
        fail(&failed, e);
        true
    });
    window.add(&view);
    view.set_size_request(width, 768);
    window.show_all();
    let busy = Rc::new(Cell::new(false));
    let polled = Rc::new(Cell::new(false));
    let phase = Rc::new(Cell::new(0u8));
    let dimensions = Rc::new(Cell::new((0u32, 0u32)));
    let polling_view = view.clone();
    let polling_output = output.clone();
    glib::timeout_add_local(Duration::from_millis(10), move || {
        if !loaded.get() || !guard.get() || busy.replace(true) {
            return glib::ControlFlow::Continue;
        }
        if !polled.replace(true) {
            trace("first-poll");
        }
        let busy = busy.clone();
        let phase = phase.clone();
        let dimensions = dimensions.clone();
        let view = polling_view.clone();
        let output = polling_output.clone();
        let window = window.clone();
        let input = input.clone();
        polling_view.evaluate_javascript("typeof globalThis.__milkupFixedTake === 'function' ? globalThis.__milkupFixedTake() : JSON.stringify([{phase:'error',message:'Fixed bootstrap unavailable after load'}])",None,None,None::<&gio::Cancellable>,move |result| {
            busy.set(false);
            let events = match result.map_err(error).and_then(|v| serde_json::from_str::<Vec<Value>>(&v.to_str()).map_err(error)) {
                Ok(v) => v, Err(e) => { fail(&output,e); return; }
            };
            for event in events {
                match (phase.get(), event["phase"].as_str()) {
                    (0, Some("ready")) => {
                        trace("bootstrap-ready");
                        phase.set(1);
                        // WebKit's evaluation result bridge cannot transport a
                        // Promise. The fixed callback handles completion through
                        // its bounded JS data queue; return only an inert boolean.
                        let script = format!("globalThis.__milkupFixedReceive({input}); true");
                        let output = output.clone();
                        view.evaluate_javascript(&script,None,None,None::<&gio::Cancellable>,move |r| { if let Err(e)=r {fail(&output,e);} });
                    }
                    (1, Some("rendered")) => {
                        trace("rendered");
                        let w = event["width"].as_u64().unwrap_or(0); let h=event["height"].as_u64().unwrap_or(0);
                        if w==0 || h==0 || w>8192 || h>8192 || w*h>MAX_PIXELS {fail(&output,"Rendered image dimensions exceed budget");return;}
                        dimensions.set((w as u32,h as u32)); phase.set(2);
                        view.set_size_request(w as i32,h as i32); window.resize(w as i32,h as i32);
                        let output = output.clone();
                        view.evaluate_javascript("globalThis.__milkupFixedReceive({phase:'capture'}); true",None,None,None::<&gio::Cancellable>,move |r| { if let Err(e)=r {fail(&output,e);} });
                    }
                    (2, Some("capture-ready")) => {
                        trace("capture-ready");
                        phase.set(3);
                        if event["executableElements"].as_u64()!=Some(0) || event["activeLinkElements"].as_u64()!=Some(0) {fail(&output,"Active output rejected");return;}
                        let output = output.clone(); let (w,h)=dimensions.get();
                        view.snapshot(webkit2gtk::SnapshotRegion::Visible,webkit2gtk::SnapshotOptions::NONE,None::<&gio::Cancellable>,move |surface| {
                            match surface.map_err(error).and_then(|surface| encode_surface(surface,w,h)) {
                                Ok(png) => {
                                    let mut pipe=output.borrow_mut();
                                    let _ = frame_write(&mut *pipe,&json!({"ok":true,"width":w,"height":h,"bytes":png.len()}))
                                        .and_then(|_| pipe.write_all(&png).map_err(error)).and_then(|_|pipe.flush().map_err(error));
                                    gtk::main_quit();
                                }
                                Err(e) => fail(&output,e),
                            }
                        });
                    }
                    (_, Some("error")) => { fail(&output,event["message"].as_str().unwrap_or("Mermaid render failed")); return; },
                    _ => { fail(&output,"Unexpected fixed renderer phase"); return; },
                }
            }
        });
        glib::ControlFlow::Continue
    });
    view.load_uri(URL);
    gtk::main();
    Ok(())
}

fn encode_surface(surface: cairo::Surface, width: u32, height: u32) -> Result<Vec<u8>> {
    if width == 0
        || height == 0
        || width > 8192
        || height > 8192
        || u64::from(width) * u64::from(height) > MAX_PIXELS
    {
        return Err("Snapshot exceeds pixel budget".into());
    }
    let image =
        cairo::ImageSurface::try_from(surface).map_err(|_| "Snapshot is not a raster image")?;
    if image.width() != width as i32
        || image.height() != height as i32
        || !matches!(image.format(), cairo::Format::ARgb32 | cairo::Format::Rgb24)
    {
        return Err("Snapshot dimensions/format differ from measured image".into());
    }
    let stride = image.stride() as usize;
    let alpha = image.format() == cairo::Format::ARgb32;
    let mut rgba = vec![0; width as usize * height as usize * 4];
    image
        .with_data(|bytes| {
            for y in 0..height as usize {
                for x in 0..width as usize {
                    let from = y * stride + x * 4;
                    let to = (y * width as usize + x) * 4;
                    let word = u32::from_ne_bytes(bytes[from..from + 4].try_into().unwrap());
                    let a = if alpha { (word >> 24) as u8 } else { 255 };
                    let channel = |shift: u32| {
                        let v = (word >> shift) & 255u32;
                        if a == 0 {
                            0
                        } else {
                            ((v * 255 + u32::from(a) / 2) / u32::from(a)).min(255) as u8
                        }
                    };
                    rgba[to] = channel(16);
                    rgba[to + 1] = channel(8);
                    rgba[to + 2] = channel(0);
                    rgba[to + 3] = a;
                }
            }
        })
        .map_err(error)?;
    let mut png = Vec::new();
    image::codecs::png::PngEncoder::new(&mut png)
        .write_image(&rgba, width, height, image::ExtendedColorType::Rgba8)
        .map_err(error)?;
    if png.len() > MAX_PNG {
        return Err("Encoded PNG exceeds budget".into());
    }
    Ok(png)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn native_snapshot_converts_premultiplied_pixels_to_complete_png() {
        let surface = cairo::ImageSurface::create(cairo::Format::ARgb32, 2, 1).unwrap();
        let context = cairo::Context::new(&surface).unwrap();
        context.set_source_rgba(1., 0.5, 0., 0.5);
        context.paint().unwrap();
        drop(context);
        let png = encode_surface(surface.as_ref().clone(), 2, 1).unwrap();
        let decoded = image::load_from_memory_with_format(&png, image::ImageFormat::Png)
            .unwrap()
            .to_rgba8();
        assert_eq!(decoded.dimensions(), (2, 1));
        let pixel = decoded.get_pixel(0, 0).0;
        assert_eq!(pixel[0], 255);
        assert!((127..=129).contains(&pixel[1]));
        assert_eq!(pixel[2], 0);
        assert!((127..=129).contains(&pixel[3]));
    }
    #[test]
    fn snapshot_rejects_mismatched_size_and_over_budget_dimensions() {
        let surface = cairo::ImageSurface::create(cairo::Format::Rgb24, 1, 1).unwrap();
        assert!(encode_surface(surface.as_ref().clone(), 2, 1).is_err());
        assert!(encode_surface(surface.as_ref().clone(), 8192, 8192).is_err());
    }
    #[test]
    fn result_frame_rejects_large_length_before_allocating_payload() {
        let mut bytes = std::io::Cursor::new(100_000u32.to_le_bytes());
        assert!(frame_read(&mut bytes, 4096).is_err());
    }
    #[test]
    fn cleanup_denial_is_reported_with_owned_path_and_missing_is_success() {
        let path = std::path::Path::new("/tmp/milkup-mermaid-test-owned");
        let denied = checked_cleanup_with(path, |_| {
            Err(std::io::Error::from(std::io::ErrorKind::PermissionDenied))
        })
        .unwrap_err();
        assert!(denied.contains("milkup-mermaid-test-owned"));
        assert!(denied.contains("Permission denied") || denied.contains("permission denied"));
        assert!(checked_cleanup_with(path, |_| Err(std::io::Error::from(
            std::io::ErrorKind::NotFound
        )))
        .is_ok());
    }
    #[test]
    #[ignore = "private subprocess entry; not a standalone test"]
    fn fixed_helper_fixture() {
        assert!(std::env::var_os("MILKUP_INTERNAL_MERMAID_DIRECTORY").is_some());
        run_guarded();
    }
    #[test]
    #[ignore = "requires native WebKitGTK, X11 and session D-Bus"]
    fn fixed_engine_produces_decodable_nonblank_pixels_and_releases_lease() {
        use base64::Engine;
        let registry = milkup_mermaid_engine::Registry::default();
        let lease = registry
            .render_with(
                "native-test",
                milkup_mermaid_engine::Request {
                    request_id: "native_flow".into(),
                    owner_id: "native-test-owner".into(),
                    source: "flowchart LR\n  A[Start] --> B[Finish]".into(),
                    width: 640,
                    theme: "default".into(),
                    look: "classic".into(),
                    remaining_ms: 30_000,
                },
                render,
            )
            .unwrap();
        let png = base64::engine::general_purpose::STANDARD
            .decode(&lease.png_base64)
            .unwrap();
        let decoded = image::load_from_memory_with_format(&png, image::ImageFormat::Png)
            .unwrap()
            .to_rgba8();
        assert_eq!(decoded.dimensions(), (lease.width, lease.height));
        assert!(lease.width > 100 && lease.height > 40);
        let first = decoded.get_pixel(0, 0);
        assert!(
            decoded.pixels().filter(|pixel| *pixel != first).count() > 100,
            "Native snapshot is blank"
        );
        if let Some(path) = std::env::var_os("MILKUP_MERMAID_NATIVE_EVIDENCE") {
            let path = PathBuf::from(path);
            fs::create_dir_all(&path).unwrap();
            fs::write(path.join("native-flow.png"), &png).unwrap();
            fs::write(path.join("native-flow.json"), serde_json::to_vec_pretty(&json!({
                "kind":"native-helper-only","engine":lease.engine,"width":lease.width,"height":lease.height,"sha256":lease.sha256,
                "bytes":png.len(),"pixelDecode":"passed","source":"flowchart LR\n  A[Start] --> B[Finish]",
            })).unwrap()).unwrap();
        }
        assert!(registry
            .release("native-test", "native-test-owner", &lease.lease_id)
            .unwrap());
        assert!(!registry
            .release("native-test", "native-test-owner", &lease.lease_id)
            .unwrap());
    }
    #[test]
    #[ignore = "requires native WebKitGTK, X11 and session D-Bus"]
    fn cancellation_confirms_owned_process_cleanup_before_next_render() {
        let registry = std::sync::Arc::new(milkup_mermaid_engine::Registry::default());
        let worker = registry.clone();
        let started = Instant::now();
        let render_task = std::thread::spawn(move || {
            worker.render_with(
                "native-test",
                milkup_mermaid_engine::Request {
                    request_id: "cancel_flow".into(),
                    owner_id: "cancel-owner".into(),
                    source: "flowchart LR\n  A --> B".into(),
                    width: 640,
                    theme: "default".into(),
                    look: "classic".into(),
                    remaining_ms: 30_000,
                },
                render,
            )
        });
        std::thread::sleep(Duration::from_millis(100));
        registry
            .cancel("native-test", "cancel-owner", "cancel_flow")
            .unwrap();
        assert!(render_task.join().unwrap().is_err());
        assert!(started.elapsed() < Duration::from_secs(8));
        let lease = registry
            .render_with(
                "native-test",
                milkup_mermaid_engine::Request {
                    request_id: "after_cancel".into(),
                    owner_id: "new-owner".into(),
                    source: "flowchart LR\n  A --> B".into(),
                    width: 640,
                    theme: "default".into(),
                    look: "classic".into(),
                    remaining_ms: 30_000,
                },
                render,
            )
            .unwrap();
        assert!(registry
            .release("native-test", "new-owner", &lease.lease_id)
            .unwrap());
    }
    #[test]
    #[ignore = "requires real WebKitGTK and explicit corpus/evidence directories"]
    fn fixed_engine_retains_native_corpus_pixels() {
        use base64::Engine;
        let corpus = PathBuf::from(
            std::env::var_os("MILKUP_MERMAID_CORPUS").expect("explicit corpus directory"),
        );
        let evidence = PathBuf::from(
            std::env::var_os("MILKUP_MERMAID_NATIVE_EVIDENCE")
                .expect("explicit evidence directory"),
        );
        fs::create_dir_all(&evidence).unwrap();
        let mut paths = fs::read_dir(corpus)
            .unwrap()
            .map(|p| p.unwrap().path())
            .filter(|p| p.extension().is_some_and(|s| s == "mmd"))
            .collect::<Vec<_>>();
        paths.sort();
        assert_eq!(
            paths.len(),
            50,
            "Pinned official syntax corpus has 50 fixtures"
        );
        let registry = milkup_mermaid_engine::Registry::default();
        let mut outcomes = Vec::new();
        for (i, path) in paths.iter().enumerate() {
            let name = path.file_stem().unwrap().to_string_lossy().into_owned();
            assert!(fs::metadata(path).unwrap().len() <= 65_536);
            let result = registry.render_with(
                "native-corpus",
                milkup_mermaid_engine::Request {
                    request_id: format!("native-corpus-{i}"),
                    owner_id: "native-corpus-owner".into(),
                    source: fs::read_to_string(path).unwrap(),
                    width: 1280,
                    theme: "default".into(),
                    look: "classic".into(),
                    remaining_ms: 30_000,
                },
                render,
            );
            let outcome = match result {
                Ok(lease) => {
                    let png = base64::engine::general_purpose::STANDARD
                        .decode(&lease.png_base64)
                        .unwrap();
                    let decoded =
                        image::load_from_memory_with_format(&png, image::ImageFormat::Png).unwrap();
                    assert_eq!(
                        (decoded.width(), decoded.height()),
                        (lease.width, lease.height)
                    );
                    fs::write(evidence.join(format!("{name}.png")), &png).unwrap();
                    registry
                        .release("native-corpus", "native-corpus-owner", &lease.lease_id)
                        .unwrap();
                    json!({"fixture":name,"status":"rendered-decoded-retained","width":lease.width,"height":lease.height,"bytes":png.len(),"sha256":lease.sha256})
                }
                Err(e) => json!({"fixture":name,"status":"failed","error":e}),
            };
            eprintln!("NATIVE_MERMAID_CORPUS {} {}", name, outcome["status"]);
            outcomes.push(outcome);
            fs::write(evidence.join("native-corpus-results.json"),serde_json::to_vec_pretty(&json!({
                "kind":"native-helper-only","engine":"12.2.0","theme":"default","width":1280,"visualReview":"pending","cases":outcomes,
            })).unwrap()).unwrap();
        }
        assert!(
            outcomes
                .iter()
                .all(|o| o["status"] == "rendered-decoded-retained"),
            "See retained native-corpus-results.json for actual failures"
        );
    }
}
