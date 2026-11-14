use super::{save, Result};
use serde_json::{json, Value};
use std::{path::Path, sync::mpsc};
use webview2_com::{Microsoft::Web::WebView2::Win32::*, *};
use windows::{
    core::{w, PCWSTR},
    Win32::{
        Foundation::RECT,
        System::Com::{CoInitializeEx, COINIT_APARTMENTTHREADED},
        UI::WindowsAndMessaging::{CreateWindowExW, WS_OVERLAPPEDWINDOW},
    },
};

pub(super) fn run(runtime: &Path, private: &Path, report: &mut Value) -> Result<()> {
    unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED).ok()? };
    let runtime = super::wide(runtime.as_os_str());
    let udf = super::wide(private.join("udf").as_os_str());
    report["phase"] = json!("creating-environment");
    save(private, report)?;
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
    report["phase"] = json!("creating-controller");
    save(private, report)?;
    let window = unsafe {
        CreateWindowExW(
            Default::default(),
            w!("STATIC"),
            w!("milkup W0 temporary probe"),
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
    let (tx, rx) = mpsc::channel();
    CreateCoreWebView2ControllerCompletedHandler::wait_for_async_operation(
        Box::new(move |handler| unsafe {
            environment
                .CreateCoreWebView2Controller(window, &handler)
                .map_err(webview2_com::Error::WindowsError)
        }),
        Box::new(move |hr, controller| {
            let _ =
                tx.send(hr.and_then(|_| controller.ok_or_else(windows::core::Error::from_win32)));
            Ok(())
        }),
    )?;
    let controller = rx.recv()??;
    report["controllerCreated"] = json!(true);
    unsafe {
        controller.SetBounds(RECT {
            left: 0,
            top: 0,
            right: 640,
            bottom: 480,
        })?
    };
    let webview = unsafe { controller.CoreWebView2()? };
    let (tx, rx) = mpsc::channel();
    let handler = NavigationCompletedEventHandler::create(Box::new(move |_, args| {
        let mut success = windows::core::BOOL(0);
        if let Some(args) = args {
            unsafe {
                args.IsSuccess(&mut success)?;
            }
        }
        let _ = tx.send(success.as_bool());
        Ok(())
    }));
    let mut token = 0;
    unsafe {
        webview.add_NavigationCompleted(&handler, &mut token)?;
        // Static, trusted probe only; no plugin code, remote URLs or host objects.
        webview.NavigateToString(w!("<!doctype html><meta charset=utf-8><p id=p>中文 😀</p>"))?;
    }
    if !wait_with_pump(rx)? {
        return Err("Static probe navigation failed".into());
    }
    let (tx, rx) = mpsc::channel();
    ExecuteScriptCompletedHandler::wait_for_async_operation(
        Box::new(move |handler| unsafe {
            webview
                .ExecuteScript(w!("document.getElementById('p').textContent"), &handler)
                .map_err(webview2_com::Error::WindowsError)
        }),
        Box::new(move |hr, result| {
            let _ = tx.send(hr.map(|_| result));
            Ok(())
        }),
    )?;
    let result = rx.recv()??;
    report["domResult"] = json!(result);
    if serde_json::from_str::<String>(&result)? != "中文 😀" {
        return Err("DOM result mismatch".into());
    }
    unsafe {
        controller.Close()?;
    }
    report["phase"] = json!("dom-probe-complete");
    save(private, report)?;
    // Host observes all still-owned processes, then kills the entire Job.
    std::thread::sleep(std::time::Duration::from_secs(90));
    Ok(())
}
