#[cfg(windows)]
#[path = "startup_process_timing.rs"]
mod process_timing;
// Read-only, opt-in startup observations; never used as security evidence.
use serde_json::json;
use std::io::Write;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::OnceLock;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

const LIMIT: u64 = 64;
static ENABLED: OnceLock<bool> = OnceLock::new();
static START: OnceLock<Instant> = OnceLock::new();
static COUNT: AtomicU64 = AtomicU64::new(0);
fn enabled() -> bool {
    *ENABLED.get_or_init(|| std::env::var("MILKUP_MERMAID_NATIVE_AUDIT").as_deref() == Ok("1"))
}
pub(crate) fn mark(stage: &'static str) {
    if !enabled() {
        return;
    }
    let start = START.get_or_init(Instant::now);
    let seq = COUNT.fetch_add(1, Ordering::Relaxed);
    if seq > LIMIT {
        return;
    }
    let record = if seq == LIMIT {
        json!({"schema":1,"pid":std::process::id(),"limitReached":true,"limit":LIMIT})
    } else {
        json!({"schema":1,"pid":std::process::id(),"seq":seq,"stage":stage,
            "elapsedUs":start.elapsed().as_micros(),"unixMs":SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis()})
    };
    let _ = writeln!(std::io::stderr().lock(), "MILKUP_STARTUP_TIMING {}", record);
}
#[cfg(any(windows, test))]
fn main_document(uri: &str) -> bool {
    matches!(
        uri,
        "http://tauri.localhost/"
            | "http://tauri.localhost/index.html"
            | "https://tauri.localhost/"
            | "https://tauri.localhost/index.html"
    )
}

#[cfg(windows)]
pub(crate) fn install(
    view: &webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2,
    app: tauri::AppHandle,
) -> windows::core::Result<()> {
    use webview2_com::{Microsoft::Web::WebView2::Win32::*, *};
    use windows::core::{Interface, PWSTR};
    use windows::Win32::System::Com::CoTaskMemFree;
    if !enabled() {
        return Ok(());
    }
    let environment = unsafe {
        view.cast::<ICoreWebView2_2>()
            .and_then(|view| view.Environment())
            .and_then(|environment| environment.cast::<ICoreWebView2Environment8>())
    }
    .ok();
    if let Some(environment) = &environment {
        process_timing::snapshot(environment, "observers-installing");
    } else {
        mark("webview-process-observer-unavailable");
    }
    let navigation_environment = environment.clone();
    let content_environment = environment.clone();
    let loaded = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let navigation_loaded = loaded.clone();
    let loaded_for_process_events = loaded.clone();
    let started = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    // No added resource filters, deferrals, responses, cancellation or script injection.
    // Observe the existing Wry document resource subscription only.
    unsafe fn take(value: PWSTR) -> String {
        let text = value.to_string().unwrap_or_default();
        CoTaskMemFree(Some(value.0.cast()));
        text
    }
    unsafe {
        let mut token = 0;
        view.add_NavigationStarting(
            &NavigationStartingEventHandler::create(Box::new(move |_, args| {
                if let Some(args) = args {
                    let mut uri = PWSTR::null();
                    args.Uri(&mut uri)?;
                    if main_document(&take(uri)) {
                        mark("main-navigation-started");
                        if let Some(environment) = &navigation_environment {
                            process_timing::snapshot(environment, "navigation-started");
                        }
                        if !started.swap(true, Ordering::Relaxed) {
                            observe_main_loop(app.clone(), navigation_loaded.clone());
                        }
                    }
                }
                Ok(())
            })),
            &mut token,
        )?;
        view.add_WebResourceRequested(
            &WebResourceRequestedEventHandler::create(Box::new(|_, args| {
                if let Some(args) = args {
                    let request = args.Request()?;
                    let mut uri = PWSTR::null();
                    request.Uri(&mut uri)?;
                    if main_document(&take(uri)) {
                        mark("main-document-resource-requested");
                    }
                }
                Ok(())
            })),
            &mut token,
        )?;
        view.cast::<ICoreWebView2_2>()?
            .add_WebResourceResponseReceived(
                &WebResourceResponseReceivedEventHandler::create(Box::new(|_, args| {
                    if let Some(args) = args {
                        let request = args.Request()?;
                        let mut uri = PWSTR::null();
                        request.Uri(&mut uri)?;
                        if main_document(&take(uri)) {
                            mark("main-document-response-received");
                        }
                    }
                    Ok(())
                })),
                &mut token,
            )?;
        view.add_ContentLoading(
            &ContentLoadingEventHandler::create(Box::new(move |view, _| {
                if let Some(view) = view {
                    let mut uri = PWSTR::null();
                    view.Source(&mut uri)?;
                    if main_document(&take(uri)) {
                        mark("main-content-loading");
                        loaded.store(true, Ordering::Release);
                        if let Some(environment) = &content_environment {
                            process_timing::snapshot(environment, "content-loading");
                        }
                    }
                }
                Ok(())
            })),
            &mut token,
        )?;
    }
    if let Some(environment) = environment {
        let callback_loaded = loaded_for_process_events;
        let mut token = 0;
        unsafe {
            environment.add_ProcessInfosChanged(
                &ProcessInfosChangedEventHandler::create(Box::new(move |sender, _| {
                    if !callback_loaded.load(Ordering::Acquire) {
                        if let Some(sender) = sender {
                            process_timing::snapshot(
                                &sender.cast::<ICoreWebView2Environment8>()?,
                                "process-infos-changed",
                            );
                        }
                    }
                    Ok(())
                })),
                &mut token,
            )?;
        }
    }
    mark("main-resource-observers-installed");
    Ok(())
}

// A diagnostic queue probe, not a watchdog or a security decision. At most one
// callback is outstanding; no browser API, navigation or script is touched.
#[cfg(windows)]
fn observe_main_loop(app: tauri::AppHandle, loaded: std::sync::Arc<std::sync::atomic::AtomicBool>) {
    use std::sync::{atomic::AtomicBool, Arc, Mutex};
    use std::time::Duration;
    let spawned = std::thread::Builder::new()
        .name("startup-queue-probe".into())
        .spawn(move || {
            let start = Instant::now();
            let unix_ms = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis();
            let pending = Arc::new(AtomicBool::new(false));
            let samples = Arc::new(Mutex::new(Vec::new()));
            let mut attempts = 0usize;
            let mut dispatch_failed = false;
            while !loaded.load(Ordering::Acquire)
                && start.elapsed() < Duration::from_secs(25)
                && attempts < 100
            {
                if !pending.swap(true, Ordering::AcqRel) {
                    attempts += 1;
                    let queued_us = start.elapsed().as_micros();
                    let pending_callback = pending.clone();
                    let callback_samples = samples.clone();
                    if app
                        .run_on_main_thread(move || {
                            let received_us = start.elapsed().as_micros();
                            if let Ok(mut values) = callback_samples.lock() {
                                if values.len() < 100 {
                                    values.push((queued_us, received_us));
                                }
                            }
                            pending_callback.store(false, Ordering::Release);
                        })
                        .is_err()
                    {
                        pending.store(false, Ordering::Release);
                        dispatch_failed = true;
                        break;
                    }
                }
                std::thread::sleep(Duration::from_millis(250));
            }
            // A queued callback that did not complete stays explicitly unresolved.
            let values = samples.lock().ok().map(|v| v.clone());
            let record = json!({"schema":1,"pid":std::process::id(),"startedUnixMs":unix_ms,
            "durationUs":start.elapsed().as_micros(),"attempts":attempts,
            "contentLoadingObserved":loaded.load(Ordering::Acquire),
            "pending":pending.load(Ordering::Acquire),"dispatchFailed":dispatch_failed,
            "limitReached":attempts==100,"deadlineReached":start.elapsed()>=Duration::from_secs(25),
            "collectionFailed":values.is_none(),"samples":values.unwrap_or_default()});
            let _ = writeln!(
                std::io::stderr().lock(),
                "MILKUP_MAIN_LOOP_TIMING {}",
                record
            );
        });
    if spawned.is_err() {
        mark("main-loop-probe-unavailable");
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn classifies_only_exact_main_documents_without_recording_urls() {
        for uri in [
            "http://tauri.localhost/",
            "https://tauri.localhost/index.html",
        ] {
            assert!(main_document(uri));
        }
        for uri in [
            "http://tauri.localhost.evil/",
            "http://tauri.localhost/?secret=1",
            "http://tauri.localhost/assets/main.js",
            "http://milkup-mermaid.localhost/renderer.html",
            "file:///private/document.md",
            "about:blank",
        ] {
            assert!(!main_document(uri));
        }
    }
}
