//! Fixed official code only; no Tauri, plugin loader, CDP or native command dispatcher.
use crate::{
    stream::{BoundedStream, Buffer},
    Result, MAX_OUTPUT,
};
use serde_json::{json, Value};
use std::{
    cell::RefCell,
    ffi::OsStr,
    io::{Read, Write},
    os::windows::ffi::OsStrExt,
    path::Path,
    rc::Rc,
    sync::{mpsc, Arc, Mutex},
    time::{Duration, Instant},
};
use webview2_com::{Microsoft::Web::WebView2::Win32::*, *};
use windows::{
    core::{w, Interface, PCWSTR, PWSTR},
    Win32::{
        Foundation::{E_FAIL, RECT},
        System::Com::{CoInitializeEx, CoTaskMemFree, IStream, COINIT_APARTMENTTHREADED},
        UI::{
            Shell::SHCreateMemStream,
            WindowsAndMessaging::{
                CreateWindowExW, DestroyWindow, DispatchMessageW, PeekMessageW, TranslateMessage,
                MSG, PM_REMOVE, WS_POPUP,
            },
        },
    },
};

fn wide(value: impl AsRef<OsStr>) -> Vec<u16> {
    value.as_ref().encode_wide().chain(Some(0)).collect()
}
unsafe fn bounded_string(ptr: PWSTR, max: usize) -> windows::core::Result<String> {
    if ptr.is_null() {
        return Err(E_FAIL.into());
    }
    let answer = (0..=max)
        .find(|i| *ptr.0.add(*i) == 0)
        .and_then(|length| String::from_utf16(std::slice::from_raw_parts(ptr.0, length)).ok());
    CoTaskMemFree(Some(ptr.0.cast()));
    answer.ok_or_else(|| E_FAIL.into())
}
fn pump<T>(rx: &mpsc::Receiver<T>, deadline: Instant) -> Result<T> {
    loop {
        match rx.try_recv() {
            Ok(result) => return Ok(result),
            Err(mpsc::TryRecvError::Disconnected) => return Err("Callback channel closed".into()),
            _ => {}
        }
        if Instant::now() >= deadline {
            return Err("Native helper deadline reached".into());
        }
        unsafe {
            let mut message = MSG::default();
            while PeekMessageW(&mut message, None, 0, 0, PM_REMOVE).as_bool() {
                let _ = TranslateMessage(&message);
                DispatchMessageW(&message);
            }
        }
        std::thread::sleep(Duration::from_millis(1));
    }
}
fn frame(value: &Value) -> Result<usize> {
    let body = serde_json::to_vec(value)?;
    if body.len() > 8192 {
        return Err("Oversized status frame".into());
    }
    let mut out = std::io::stdout().lock();
    out.write_all(&(body.len() as u32).to_le_bytes())?;
    out.write_all(&body)?;
    out.flush()?;
    Ok(4 + body.len())
}
fn fatal_control(message: &'static str) -> ! {
    // Both protocol stages accept this as immediate failure. Parent receives a
    // complete bounded failure frame and kills the entire owner Job; never rely
    // on returning an event-handler HRESULT to cancel a browser operation.
    let _ = frame(&json!({"phase":"fatal","status":"error","pngBytes":0,"message":message}));
    std::process::exit(23);
}
fn input() -> Result<Value> {
    let mut input = std::io::stdin().lock();
    let mut size = [0u8; 4];
    input.read_exact(&mut size)?;
    let size = u32::from_le_bytes(size) as usize;
    if size > 65536 {
        return Err("Input exceeds 64 KiB".into());
    }
    let mut bytes = vec![0; size];
    input.read_exact(&mut bytes)?;
    let value: Value = serde_json::from_slice(&bytes)?;
    crate::validate_input(&value)?;
    Ok(value)
}

pub fn run(runtime: &Path, private: &Path) -> Result<()> {
    let token = crate::launcher::child_token_report()?;
    if token["isAppContainer"] != true
        || token["capabilityCount"] != 0
        || token["elevated"] != false
        || token["seDebugPrivilege"]["present"] != false
    {
        return Err("Only the zero-capability AppContainer child may render".into());
    }
    unsafe {
        CoInitializeEx(None, COINIT_APARTMENTTHREADED).ok()?;
    }
    let init_deadline = Instant::now() + Duration::from_secs(10);
    let origin = format!("milkup-render://job-{}", std::process::id());
    let index_url = format!("{origin}/index.html");
    let bundle_url = format!("{origin}/bundle.js");
    let scheme = CoreWebView2CustomSchemeRegistration::new("milkup-render".into());
    let options = CoreWebView2EnvironmentOptions::default();
    unsafe {
        scheme.set_has_authority_component(true);
        scheme.set_treat_as_secure(false);
        scheme.set_allowed_origins(Vec::new());
        options.set_scheme_registrations(vec![Some(scheme.into())]);
        options.set_exclusive_user_data_folder_access(true);
        options.set_allow_single_sign_on_using_os_primary_account(false);
        options.set_are_browser_extensions_enabled(false);
    }
    let options: ICoreWebView2EnvironmentOptions = options.into();
    let runtime = wide(runtime);
    let udf = wide(private.join("udf"));
    let (tx, rx) = mpsc::channel();
    let handler =
        CreateCoreWebView2EnvironmentCompletedHandler::create(Box::new(move |hr, env| {
            let _ = tx.send(hr.and_then(|_| env.ok_or_else(|| E_FAIL.into())));
            Ok(())
        }));
    unsafe {
        CreateCoreWebView2EnvironmentWithOptions(
            PCWSTR(runtime.as_ptr()),
            PCWSTR(udf.as_ptr()),
            &options,
            &handler,
        )?;
    }
    let environment = pump(&rx, init_deadline)??;
    let window = unsafe {
        CreateWindowExW(
            Default::default(),
            w!("STATIC"),
            w!("Milk up fixed-render prototype"),
            WS_POPUP,
            0,
            0,
            1280,
            720,
            None,
            None,
            None,
            None,
        )?
    };
    // No ShowWindow: visibility/capture correctness is an explicit Windows go/no-go test.
    let (tx, rx) = mpsc::channel();
    let handler =
        CreateCoreWebView2ControllerCompletedHandler::create(Box::new(move |hr, controller| {
            let _ = tx.send(hr.and_then(|_| controller.ok_or_else(|| E_FAIL.into())));
            Ok(())
        }));
    unsafe {
        environment.CreateCoreWebView2Controller(window, &handler)?;
    }
    let controller = pump(&rx, init_deadline)??;
    let view = unsafe { controller.CoreWebView2()? };
    unsafe {
        controller.SetBounds(RECT {
            left: 0,
            top: 0,
            right: 1280,
            bottom: 720,
        })?;
        controller.SetIsVisible(true)?;
        let scale = controller.cast::<ICoreWebView2Controller3>()?;
        scale.SetShouldDetectMonitorScaleChanges(false)?;
        scale.SetRasterizationScale(1.0)?;
        scale.SetBoundsMode(COREWEBVIEW2_BOUNDS_MODE_USE_RAW_PIXELS)?;
        controller
            .cast::<ICoreWebView2Controller4>()?
            .SetAllowExternalDrop(false)?;
        let settings = view.Settings()?;
        settings.SetAreHostObjectsAllowed(false)?;
        settings.SetIsWebMessageEnabled(true)?;
        settings.SetAreDefaultScriptDialogsEnabled(false)?;
        settings.SetAreDefaultContextMenusEnabled(false)?;
        settings.SetAreDevToolsEnabled(false)?;
        settings.SetIsStatusBarEnabled(false)?;
        settings.SetIsZoomControlEnabled(false)?;
        let settings = settings.cast::<ICoreWebView2Settings4>()?;
        settings.SetIsPasswordAutosaveEnabled(false)?;
        settings.SetIsGeneralAutofillEnabled(false)?;
        settings.SetAreBrowserAcceleratorKeysEnabled(false)?;
    }
    let events = Rc::new(RefCell::new(
        json!({"deniedRequests":0,"deniedNavigations":0,"deniedPermissions":0,"downloads":0,"externalSchemes":0,"newWindows":0}),
    ));
    let csp = format!("default-src 'none'; script-src {bundle_url}; style-src 'unsafe-inline'; connect-src 'none'; img-src 'none'; font-src 'none'; frame-src 'none'; child-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'");
    let index = format!("<!doctype html><meta charset=utf-8><style>html,body{{margin:0;background:white;overflow:hidden}}#target{{width:1280px;display:flow-root}}</style><div id=target></div><script src=\"{bundle_url}\" defer></script>");
    let mut bundle = include_bytes!("../assets/mermaid-12.2.0.min.js").to_vec();
    bundle.extend_from_slice(b"\n;");
    bundle.extend_from_slice(include_bytes!("../assets/bootstrap.js"));
    let env = environment.clone();
    let allowed_index = index_url.clone();
    let allowed_bundle = bundle_url.clone();
    let log = events.clone();
    let handler = WebResourceRequestedEventHandler::create(Box::new(move |_, args| {
        let args =
            args.unwrap_or_else(|| fatal_control("Missing required browser event arguments"));
        unsafe {
            // Deny before parsing any untrusted request fields; callback failure
            // must not leave a long/malformed URL without a local response.
            let blocked_stream = SHCreateMemStream(Some(b"Blocked"))
                .unwrap_or_else(|| fatal_control("Cannot allocate default denial stream"));
            let blocked = env
                .CreateWebResourceResponse(
                    &blocked_stream,
                    403,
                    w!("Forbidden"),
                    w!("Content-Type: text/plain\r\nCache-Control: no-store\r\n"),
                )
                .unwrap_or_else(|_| fatal_control("Cannot create default denial response"));
            args.SetResponse(&blocked)
                .unwrap_or_else(|_| fatal_control("Cannot install default resource denial"));
            let request = args.Request()?;
            let mut raw = PWSTR::null();
            request.Uri(&mut raw)?;
            let uri = bounded_string(raw, 4096)?;
            let mut raw = PWSTR::null();
            request.Method(&mut raw)?;
            let method = bounded_string(raw, 32)?;
            let (body, mime, status) = if method == "GET" && uri == allowed_index {
                (index.as_bytes(), "text/html; charset=utf-8", 200)
            } else if method == "GET" && uri == allowed_bundle {
                (bundle.as_slice(), "text/javascript; charset=utf-8", 200)
            } else {
                let n = log.borrow()["deniedRequests"].as_u64().unwrap_or(0);
                log.borrow_mut()["deniedRequests"] = json!(n + 1);
                (b"Blocked".as_slice(), "text/plain", 403)
            };
            let stream =
                SHCreateMemStream(Some(body)).ok_or_else(|| windows::core::Error::from(E_FAIL))?;
            let headers = wide(format!("Content-Type: {mime}\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nContent-Security-Policy: {csp}\r\n"));
            let response = env.CreateWebResourceResponse(
                &stream,
                status,
                if status == 200 {
                    w!("OK")
                } else {
                    w!("Forbidden")
                },
                PCWSTR(headers.as_ptr()),
            )?;
            args.SetResponse(&response)
                .unwrap_or_else(|_| fatal_control("Cannot install fixed resource response"));
        }
        Ok(())
    }));
    let mut token_id = 0;
    unsafe {
        view.add_WebResourceRequested(&handler, &mut token_id)?;
        view.cast::<ICoreWebView2_22>()?
            .AddWebResourceRequestedFilterWithRequestSourceKinds(
                w!("*"),
                COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL,
                COREWEBVIEW2_WEB_RESOURCE_REQUEST_SOURCE_KINDS_ALL,
            )?;
    }
    let mut navigation_used = false;
    let allowed_index = index_url.clone();
    let log = events.clone();
    let handler = NavigationStartingEventHandler::create(Box::new(move |_, args| {
        let args =
            args.unwrap_or_else(|| fatal_control("Missing required browser event arguments"));
        unsafe {
            args.SetCancel(true)
                .unwrap_or_else(|_| fatal_control("Cannot cancel browser action"));
            let mut raw = PWSTR::null();
            args.Uri(&mut raw)?;
            let uri = bounded_string(raw, 4096)?;
            let allowed = !navigation_used && uri == allowed_index;
            navigation_used = true;
            args.SetCancel(!allowed)
                .unwrap_or_else(|_| fatal_control("Cannot apply navigation policy"));
            if !allowed {
                let n = log.borrow()["deniedNavigations"].as_u64().unwrap_or(0);
                log.borrow_mut()["deniedNavigations"] = json!(n + 1);
            }
        }
        Ok(())
    }));
    unsafe {
        view.add_NavigationStarting(&handler, &mut token_id)?;
    }
    let handler = NavigationStartingEventHandler::create(Box::new(|_, args| {
        if let Some(args) = args {
            unsafe {
                args.SetCancel(true)
                    .unwrap_or_else(|_| fatal_control("Cannot cancel browser action"));
            }
        }
        Ok(())
    }));
    unsafe {
        view.add_FrameNavigationStarting(&handler, &mut token_id)?;
    }
    let log = events.clone();
    let handler = PermissionRequestedEventHandler::create(Box::new(move |_, args| {
        if let Some(args) = args {
            unsafe {
                args.SetState(COREWEBVIEW2_PERMISSION_STATE_DENY)
                    .unwrap_or_else(|_| fatal_control("Cannot deny browser permission"));
            }
            let n = log.borrow()["deniedPermissions"].as_u64().unwrap_or(0);
            log.borrow_mut()["deniedPermissions"] = json!(n + 1);
        }
        Ok(())
    }));
    unsafe {
        view.add_PermissionRequested(&handler, &mut token_id)?;
    }
    let log = events.clone();
    let handler = NewWindowRequestedEventHandler::create(Box::new(move |_, args| {
        if let Some(args) = args {
            unsafe {
                args.SetHandled(true)
                    .unwrap_or_else(|_| fatal_control("Cannot deny new window"));
            }
            let n = log.borrow()["newWindows"].as_u64().unwrap_or(0);
            log.borrow_mut()["newWindows"] = json!(n + 1);
        }
        Ok(())
    }));
    unsafe {
        view.add_NewWindowRequested(&handler, &mut token_id)?;
    }
    let log = events.clone();
    let handler = DownloadStartingEventHandler::create(Box::new(move |_, args| {
        if let Some(args) = args {
            unsafe {
                args.SetCancel(true)
                    .unwrap_or_else(|_| fatal_control("Cannot cancel browser action"));
            }
            let n = log.borrow()["downloads"].as_u64().unwrap_or(0);
            log.borrow_mut()["downloads"] = json!(n + 1);
        }
        Ok(())
    }));
    unsafe {
        view.cast::<ICoreWebView2_4>()?
            .add_DownloadStarting(&handler, &mut token_id)?;
    }
    let log = events.clone();
    let handler = LaunchingExternalUriSchemeEventHandler::create(Box::new(move |_, args| {
        if let Some(args) = args {
            unsafe {
                args.SetCancel(true)
                    .unwrap_or_else(|_| fatal_control("Cannot cancel browser action"));
            }
            let n = log.borrow()["externalSchemes"].as_u64().unwrap_or(0);
            log.borrow_mut()["externalSchemes"] = json!(n + 1);
        }
        Ok(())
    }));
    unsafe {
        view.cast::<ICoreWebView2_18>()?
            .add_LaunchingExternalUriScheme(&handler, &mut token_id)?;
    }
    let expected = index_url.clone();
    let handler = SourceChangedEventHandler::create(Box::new(move |sender, _| {
        let Some(sender) = sender else {
            fatal_control("Missing source-change sender");
        };
        unsafe {
            let mut raw = PWSTR::null();
            sender
                .Source(&mut raw)
                .unwrap_or_else(|_| fatal_control("Cannot inspect changed source"));
            let source = bounded_string(raw, 4096)
                .unwrap_or_else(|_| fatal_control("Invalid changed source"));
            if source != expected {
                fatal_control("Source escaped fixed origin/page");
            }
        }
        Ok(())
    }));
    unsafe {
        view.add_SourceChanged(&handler, &mut token_id)?;
    }
    let (tx, rx) = mpsc::sync_channel(4);
    let expected_source = index_url.clone();
    let handler = WebMessageReceivedEventHandler::create(Box::new(move |_, args| {
        let args =
            args.unwrap_or_else(|| fatal_control("Missing required browser event arguments"));
        unsafe {
            let mut raw = PWSTR::null();
            args.Source(&mut raw)?;
            if bounded_string(raw, 4096)? != expected_source {
                return Err(E_FAIL.into());
            }
            let mut raw = PWSTR::null();
            args.WebMessageAsJson(&mut raw)?;
            let message = bounded_string(raw, 8192)?;
            let value: Value =
                serde_json::from_str(&message).map_err(|_| windows::core::Error::from(E_FAIL))?;
            tx.try_send(value)
                .map_err(|_| windows::core::Error::from(E_FAIL))?;
        }
        Ok(())
    }));
    unsafe {
        view.add_WebMessageReceived(&handler, &mut token_id)?;
        view.Navigate(PCWSTR(wide(&index_url).as_ptr()))?;
    }
    let ready = pump(&rx, init_deadline)?;
    if ready != json!({"phase":"ready","engine":"12.2.0"}) {
        return Err("Unexpected bootstrap ready".into());
    }
    let mut browser_process_id = 0;
    unsafe {
        view.BrowserProcessId(&mut browser_process_id)?;
    }
    let ready_bytes =
        frame(&json!({"phase":"ready","engine":"12.2.0","browserProcessId":browser_process_id}))?;
    let input = input()?;
    let deadline = Instant::now() + Duration::from_secs(2);
    let json_input = wide(serde_json::to_string(&input)?);
    unsafe {
        view.PostWebMessageAsJson(PCWSTR(json_input.as_ptr()))?;
    }
    let rendered = pump(&rx, deadline)?;
    if rendered["phase"] != "rendered" || rendered["requestId"] != input["requestId"] {
        frame(&json!({"status":"error","pngBytes":0,"engineMessage":rendered}))?;
        return Ok(());
    }
    let width = rendered["width"].as_u64().ok_or("Invalid width")?;
    let height = rendered["height"].as_u64().ok_or("Invalid height")?;
    if width == 0 || height == 0 || width > 8192 || height > 8192 || width * height > 16_777_216 {
        return Err("Invalid pixel budget".into());
    }
    unsafe {
        controller.SetBounds(RECT {
            left: 0,
            top: 0,
            right: width as i32,
            bottom: height as i32,
        })?;
        view.PostWebMessageAsJson(w!("{\"phase\":\"capture\"}"))?;
    }
    let capture_observation = pump(&rx, deadline)?;
    if capture_observation["phase"] != "capture-ready" {
        return Err("Unexpected capture readiness".into());
    }
    let buffer = Arc::new(Mutex::new(Buffer::default()));
    let stream: IStream = BoundedStream {
        buffer: buffer.clone(),
        limit: MAX_OUTPUT - 16_384,
    }
    .into();
    let (tx, rx) = mpsc::channel();
    let handler = CapturePreviewCompletedHandler::create(Box::new(move |hr| {
        let _ = tx.send(hr);
        Ok(())
    }));
    unsafe {
        view.CapturePreview(
            COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_PNG,
            &stream,
            &handler,
        )?;
    }
    pump(&rx, deadline)??;
    let png = buffer
        .lock()
        .map_err(|_| "Capture buffer poisoned")?
        .bytes
        .clone();
    let metadata = json!({"status":"ok","pngBytes":png.len(),"width":width,"height":height,
        "engine":"12.2.0","requestId":input["requestId"],"rendered":rendered,
        "captureObservation":capture_observation,"controls":events.borrow().clone(),"osAllNetworkDenied":false,"hiddenCaptureVisuallyVerified":false});
    if ready_bytes + 4 + serde_json::to_vec(&metadata)?.len() + png.len() > MAX_OUTPUT {
        return Err("Total output budget exceeded".into());
    }
    frame(&metadata)?;
    std::io::stdout().lock().write_all(&png)?;
    std::io::stdout().lock().flush()?;
    unsafe {
        controller.Close()?;
        DestroyWindow(window)?;
    }
    Ok(())
}
