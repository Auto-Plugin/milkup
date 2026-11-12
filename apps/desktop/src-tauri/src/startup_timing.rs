//! Read-only, opt-in startup observations; never used as security evidence.
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
) -> windows::core::Result<()> {
    use webview2_com::{Microsoft::Web::WebView2::Win32::*, *};
    use windows::core::{Interface, PWSTR};
    use windows::Win32::System::Com::CoTaskMemFree;
    if !enabled() {
        return Ok(());
    }
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
            &NavigationStartingEventHandler::create(Box::new(|_, args| {
                if let Some(args) = args {
                    let mut uri = PWSTR::null();
                    args.Uri(&mut uri)?;
                    if main_document(&take(uri)) {
                        mark("main-navigation-started");
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
            &ContentLoadingEventHandler::create(Box::new(|view, _| {
                if let Some(view) = view {
                    let mut uri = PWSTR::null();
                    view.Source(&mut uri)?;
                    if main_document(&take(uri)) {
                        mark("main-content-loading");
                    }
                }
                Ok(())
            })),
            &mut token,
        )?;
    }
    mark("main-resource-observers-installed");
    Ok(())
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
