use super::Result;
use super::*;
use std::sync::mpsc;
use webview2_com::{Microsoft::Web::WebView2::Win32::*, *};
use windows::{
    core::{w, Interface, PCWSTR},
    Win32::{
        Foundation::RECT,
        System::Com::{CoInitializeEx, COINIT_APARTMENTTHREADED},
        UI::WindowsAndMessaging::{CreateWindowExW, WS_OVERLAPPEDWINDOW},
    },
};

fn evaluate(view: &ICoreWebView2, expression: &str, gesture: bool) -> Result<Value> {
    let params = wide(OsStr::new(&serde_json::to_string(
        &json!({"expression":expression,"awaitPromise":true,"returnByValue":true,"userGesture":gesture}),
    )?));
    let view = view.clone();
    let (tx, rx) = mpsc::channel();
    CallDevToolsProtocolMethodCompletedHandler::wait_for_async_operation(
        Box::new(move |handler| unsafe {
            view.CallDevToolsProtocolMethod(
                w!("Runtime.evaluate"),
                PCWSTR(params.as_ptr()),
                &handler,
            )
            .map_err(webview2_com::Error::WindowsError)
        }),
        Box::new(move |hr, value| {
            let _ = tx.send(hr.map(|_| value));
            Ok(())
        }),
    )?;
    Ok(serde_json::from_str(&rx.recv()??)?)
}
fn navigate(view: &ICoreWebView2, destination: &str, html: bool) -> Result<Value> {
    let (tx, rx) = mpsc::channel();
    let handler = NavigationCompletedEventHandler::create(Box::new(move |_, args| {
        let mut success = windows::core::BOOL(0);
        let mut error = COREWEBVIEW2_WEB_ERROR_STATUS_UNKNOWN;
        if let Some(args) = args {
            unsafe {
                args.IsSuccess(&mut success)?;
                args.WebErrorStatus(&mut error)?;
            }
        }
        let _ = tx.send(json!({"success":success.as_bool(),"webErrorStatus":error.0}));
        Ok(())
    }));
    let mut token = 0;
    let destination = wide(OsStr::new(destination));
    unsafe {
        view.add_NavigationCompleted(&handler, &mut token)?;
        if html {
            view.NavigateToString(PCWSTR(destination.as_ptr()))?;
        } else {
            view.Navigate(PCWSTR(destination.as_ptr()))?;
        }
    }
    let result = wait_with_pump(rx)?;
    unsafe {
        view.remove_NavigationCompleted(token)?;
    }
    Ok(result)
}
fn file_url(path: &Path) -> Result<String> {
    // These are exclusively newly created ASCII CI temp paths, not arbitrary documents.
    let text = path
        .to_str()
        .ok_or("Non-UTF8 fixture path")?
        .replace('\\', "/");
    let mut encoded = String::new();
    for b in text.bytes() {
        if b.is_ascii_alphanumeric() || b"/-_.:".contains(&b) {
            encoded.push(b as char);
        } else {
            encoded.push_str(&format!("%{b:02X}"));
        }
    }
    Ok(format!("file:///{encoded}"))
}
fn processes(environment: &ICoreWebView2Environment) -> Result<Value> {
    let env = environment.cast::<ICoreWebView2Environment8>()?;
    let collection = unsafe { env.GetProcessInfos()? };
    let mut count = 0;
    unsafe {
        collection.Count(&mut count)?;
    }
    let mut result = Vec::new();
    for index in 0..count {
        let item = unsafe { collection.GetValueAtIndex(index)? };
        let mut pid = 0;
        let mut kind = COREWEBVIEW2_PROCESS_KIND_BROWSER;
        unsafe {
            item.ProcessId(&mut pid)?;
            item.Kind(&mut kind)?;
        }
        result.push(json!({"pid":pid,"kind":kind.0}));
    }
    Ok(
        json!({"processes":result,"boundary":"WebView2 API excludes crashpad; cross-check owner Job separately"}),
    )
}

pub(super) fn run(runtime: &Path, private: &Path, input: &Value, report: &mut Value) -> Result<()> {
    unsafe {
        CoInitializeEx(None, COINIT_APARTMENTTHREADED).ok()?;
    }
    let runtime = wide(runtime.as_os_str());
    let udf = wide(private.join("udf").as_os_str());
    let (tx, rx) = mpsc::channel();
    CreateCoreWebView2EnvironmentCompletedHandler::wait_for_async_operation(
        Box::new(move |handler| unsafe {
            CreateCoreWebView2EnvironmentWithOptions(
                PCWSTR(runtime.as_ptr()),
                PCWSTR(udf.as_ptr()),
                None,
                &handler,
            )
            .map_err(webview2_com::Error::WindowsError)
        }),
        Box::new(move |hr, environment| {
            let _ =
                tx.send(hr.and_then(|_| environment.ok_or_else(windows::core::Error::from_win32)));
            Ok(())
        }),
    )?;
    let environment = rx.recv()??;
    report["environmentCreated"] = json!(true);
    save(private, report)?;
    let window = unsafe {
        CreateWindowExW(
            Default::default(),
            w!("STATIC"),
            w!("milkup W0 controlled matrix"),
            WS_OVERLAPPEDWINDOW,
            0,
            0,
            640,
            480,
            None,
            None,
            None,
            None,
        )?
    };
    let env = environment.clone();
    let (tx, rx) = mpsc::channel();
    CreateCoreWebView2ControllerCompletedHandler::wait_for_async_operation(
        Box::new(move |handler| unsafe {
            env.CreateCoreWebView2Controller(window, &handler)
                .map_err(webview2_com::Error::WindowsError)
        }),
        Box::new(move |hr, controller| {
            let _ =
                tx.send(hr.and_then(|_| controller.ok_or_else(windows::core::Error::from_win32)));
            Ok(())
        }),
    )?;
    let controller = rx.recv()??;
    unsafe {
        controller.SetBounds(RECT {
            left: 0,
            top: 0,
            right: 640,
            bottom: 480,
        })?;
    }
    let view = unsafe { controller.CoreWebView2()? };
    report["controllerCreated"] = json!(true);
    report["staticNavigation"] = navigate(
        &view,
        "<!doctype html><meta charset=utf-8><p id=canary>中文 😀</p><input id=picker type=file>",
        true,
    )?;
    report["staticDom"] = evaluate(
        &view,
        "document.getElementById('canary').textContent",
        false,
    )?;
    save(private, report)?;
    let config = serde_json::to_string(input)?;
    // Only literal loopback addresses are used. Relay-only TURN avoids STUN and mDNS
    // discovery against public servers; no camera, microphone, or new permissions.
    let js = include_str!("network.js").replace("__CONTROLLED_INPUT__", &config);
    report["networkApiResults"] = evaluate(&view, &js, false)?;
    report["webviewProcessInfosAfterNetwork"] = processes(&environment)?;
    save(private, report)?;
    let mut files = Vec::new();
    for (name, path) in [
        ("private", private.join("allowed.html")),
        (
            "outside",
            PathBuf::from(input["canary"].as_str().ok_or("Missing file canary")?),
        ),
    ] {
        let navigation = navigate(&view, &file_url(&path)?, false)?;
        let dom = evaluate(
            &view,
            "({url:location.href,marker:document.getElementById('canary')?.textContent??null})",
            false,
        )?;
        files.push(json!({"name":name,"navigation":navigation,"dom":dom}));
        report["fileNavigations"] = json!(files);
        save(private, report)?;
    }
    report["pickerNavigation"] =
        navigate(&view, "<!doctype html><input id=picker type=file>", true)?;
    report["phase"] = json!("picker-probe");
    save(private, report)?;
    report["pickerProbe"]=evaluate(&view,"(async()=>{const p=document.getElementById('picker');const before=navigator.userActivation.isActive;try{p.click();await new Promise(r=>setTimeout(r,3000));return {gestureBefore:before,files:p.files.length,returned:true};}catch(e){return {gestureBefore:before,error:String(e)};}})()",true)?;
    report["pickerBoundary"]=json!("CDP userGesture=true; owner records and closes only visible #32770 dialogs whose PID is verified in this Job. No file selected. No observed dialog is not proof about brokered pickers or file-system access APIs.");
    report["webviewProcessInfosBeforeStop"] = processes(&environment)?;
    save(private, report)?;
    // Retain COM objects until owner termination. Do not close the browser before
    // testing descendant cleanup; the trusted child is killed with its whole Job.
    std::mem::forget(view);
    std::mem::forget(controller);
    std::mem::forget(environment);
    Ok(())
}
