//! Host-private fixed engine adapter. Commands are deliberately absent from the
//! public plugin SDK and restricted to the product's main webview. The TS host
//! authenticates exact active package bytes/epoch before assigning owner IDs.
use milkup_mermaid_engine::{Lease, Registry, Request};
use std::time::Instant;
use tauri::{AppHandle, Manager, WebviewWindow};

fn caller(window: &WebviewWindow) -> Result<String, String> {
    if window.label() != "main" {
        return Err("Fixed Mermaid commands are private to the product main webview".into());
    }
    Ok(window.label().into())
}
#[tauri::command]
pub async fn private_mermaid_render(
    app: AppHandle,
    window: WebviewWindow,
    mut request: Request,
) -> Result<Lease, String> {
    let received = Instant::now();
    let scope = caller(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        // Async executor scheduling consumes the caller's remaining deadline.
        let elapsed = received
            .elapsed()
            .as_nanos()
            .div_ceil(1_000_000)
            .min(u64::MAX as u128) as u64;
        request.remaining_ms = request.remaining_ms.saturating_sub(elapsed);
        app.state::<Registry>()
            .render_with(&scope, request, |input, control| {
                #[cfg(windows)]
                {
                    milkup_mermaid_engine::render_native(input, control)
                }
                #[cfg(target_os = "linux")]
                {
                    crate::private_mermaid_linux::render(input, control)
                }
                #[cfg(not(any(windows, target_os = "linux")))]
                {
                    let _ = (input, control);
                    Err("Fixed Mermaid native engine is unavailable on this platform".into())
                }
            })
    })
    .await
    .map_err(|error| error.to_string())?
}
#[tauri::command]
pub fn private_mermaid_cancel(
    app: AppHandle,
    window: WebviewWindow,
    owner_id: String,
    request_id: String,
) -> Result<bool, String> {
    app.state::<Registry>()
        .cancel(&caller(&window)?, &owner_id, &request_id)
}
#[tauri::command]
pub fn private_mermaid_release(
    app: AppHandle,
    window: WebviewWindow,
    owner_id: String,
    lease_id: String,
) -> Result<bool, String> {
    app.state::<Registry>()
        .release(&caller(&window)?, &owner_id, &lease_id)
}
#[tauri::command]
pub fn private_mermaid_retire_owner(
    app: AppHandle,
    window: WebviewWindow,
    owner_id: String,
) -> Result<bool, String> {
    app.state::<Registry>()
        .retire_owner(&caller(&window)?, &owner_id)
}

#[tauri::command]
pub async fn private_mermaid_shutdown(app: AppHandle, window: WebviewWindow) -> Result<(), String> {
    caller(&window)?;
    tauri::async_runtime::spawn_blocking(move || app.state::<Registry>().shutdown_and_wait())
        .await
        .map_err(|error| error.to_string())?
}
