use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{ipc::Channel, AppHandle, State};
use tauri_plugin_updater::{Update, UpdaterExt};
use tokio::sync::{watch, Mutex as AsyncMutex};

const MAX_DOWNLOAD_BYTES: u64 = 256 * 1024 * 1024;
const CHANNEL_CONFIG: &str = include_str!("../../../../release/update-channel.json");

#[cfg(test)]
#[path = "updates_tests.rs"]
mod tests;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ReleaseChannel {
    channel: String,
    endpoints: Vec<String>,
    public_key: Option<String>,
}

impl ReleaseChannel {
    fn configured(&self) -> Result<bool, String> {
        if !matches!(self.channel.as_str(), "stable" | "beta") {
            return Err("更新渠道配置无效".into());
        }
        if self.endpoints.is_empty() && self.public_key.is_none() {
            return Ok(false);
        }
        if self.endpoints.is_empty() || self.public_key.as_deref().is_none_or(str::is_empty) {
            return Err("更新渠道配置不完整".into());
        }
        for endpoint in &self.endpoints {
            let url = tauri::Url::parse(endpoint).map_err(|_| "更新地址无效")?;
            if url.scheme() != "https" || !url.username().is_empty() || url.password().is_some() {
                return Err("更新地址必须使用不含凭据的 HTTPS".into());
            }
        }
        Ok(true)
    }
}

#[derive(Default)]
struct Candidate {
    generation: u64,
    update: Option<Update>,
    // Only Update::download, after its minisign verification succeeds, can set this.
    verified_bytes: Option<Vec<u8>>,
    abort: Option<watch::Sender<bool>>,
}

#[derive(Default)]
pub struct UpdateService {
    operation: AsyncMutex<()>,
    candidate: Mutex<Candidate>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    token: u64,
    version: String,
    notes: String,
    date: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheck {
    configured: bool,
    channel: String,
    update: Option<UpdateInfo>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgress {
    phase: &'static str,
    received: u64,
    total: Option<u64>,
}

fn newer_version(current: &semver::Version, next: &semver::Version, channel: &str) -> bool {
    next > current && (channel == "beta" || next.pre.is_empty())
}

#[tauri::command]
pub async fn check_application_update(
    app: AppHandle,
    service: State<'_, UpdateService>,
) -> Result<UpdateCheck, String> {
    let _operation = service
        .operation
        .try_lock()
        .map_err(|_| "更新操作正在进行")?;
    let config: ReleaseChannel =
        serde_json::from_str(CHANNEL_CONFIG).map_err(|_| "更新配置无法读取")?;
    {
        let mut candidate = service.candidate.lock().map_err(|_| "更新状态不可用")?;
        candidate.generation += 1;
        candidate.update = None;
        candidate.verified_bytes = None;
    }
    if !config.configured()? {
        return Ok(UpdateCheck {
            configured: false,
            channel: config.channel,
            update: None,
        });
    }
    let channel = config.channel.clone();
    let updater = app
        .updater_builder()
        .pubkey(config.public_key.expect("validated public key"))
        .endpoints(
            config
                .endpoints
                .iter()
                .map(|endpoint| tauri::Url::parse(endpoint).expect("validated endpoint"))
                .collect(),
        )
        .map_err(|error| error.to_string())?
        .timeout(Duration::from_secs(20))
        .configure_client(|client| client.https_only(true))
        .version_comparator(move |current, release| {
            newer_version(&current, &release.version, &channel)
        })
        .build()
        .map_err(|error| error.to_string())?;
    let update = updater
        .check()
        .await
        .map_err(|error| format!("检查更新失败：{error}"))?;
    let mut candidate = service.candidate.lock().map_err(|_| "更新状态不可用")?;
    let info = if let Some(mut update) = update {
        if update.download_url.scheme() != "https"
            || !update.download_url.username().is_empty()
            || update.download_url.password().is_some()
        {
            return Err("更新包地址必须使用不含凭据的 HTTPS".into());
        }
        if update
            .body
            .as_ref()
            .is_some_and(|body| body.len() > 128 * 1024)
        {
            return Err("版本说明过大，请稍后重试".into());
        }
        update.timeout = Some(Duration::from_secs(300));
        let info = UpdateInfo {
            token: candidate.generation,
            version: update.version.clone(),
            notes: update.body.clone().unwrap_or_default(),
            date: update.date.map(|date| date.to_string()),
        };
        candidate.update = Some(update);
        Some(info)
    } else {
        None
    };
    Ok(UpdateCheck {
        configured: true,
        channel: config.channel,
        update: info,
    })
}

async fn verified_download(
    update: &Update,
    mut aborted: watch::Receiver<bool>,
    on_progress: impl Fn(DownloadProgress) + Send + Sync,
) -> Result<Vec<u8>, String> {
    let (limit_tx, mut limit_rx) = watch::channel(false);
    let received = Arc::new(std::sync::atomic::AtomicU64::new(0));
    let count = received.clone();
    let download = update.download(
        |chunk, total| {
            let bytes =
                count.fetch_add(chunk as u64, std::sync::atomic::Ordering::Relaxed) + chunk as u64;
            if bytes > MAX_DOWNLOAD_BYTES || total.is_some_and(|total| total > MAX_DOWNLOAD_BYTES) {
                let _ = limit_tx.send(true);
            }
            on_progress(DownloadProgress {
                phase: "downloading",
                received: bytes,
                total,
            });
        },
        || {
            on_progress(DownloadProgress {
                phase: "verifying",
                received: received.load(std::sync::atomic::Ordering::Relaxed),
                total: None,
            })
        },
    );
    let bytes = tokio::select! {
        biased;
        _ = aborted.changed() => return Err("下载已取消".into()),
        _ = limit_rx.changed() => return Err("更新包超过 256 MiB 下载上限".into()),
        result = download => result.map_err(|error| format!("下载或签名校验失败：{error}"))?,
    };
    if *aborted.borrow() {
        return Err("下载已取消".into());
    }
    if bytes.is_empty() || bytes.len() as u64 > MAX_DOWNLOAD_BYTES {
        return Err("更新包为空或超过下载上限".into());
    }
    Ok(bytes)
}

#[tauri::command]
pub async fn download_application_update(
    token: u64,
    progress: Channel<DownloadProgress>,
    service: State<'_, UpdateService>,
) -> Result<(), String> {
    let _operation = service
        .operation
        .try_lock()
        .map_err(|_| "更新操作正在进行")?;
    let (abort, aborted) = watch::channel(false);
    let update = {
        let mut candidate = service.candidate.lock().map_err(|_| "更新状态不可用")?;
        if candidate.generation != token {
            return Err("版本信息已过期，请重新检查更新".into());
        }
        let update = candidate.update.clone().ok_or("请先检查更新")?;
        candidate.verified_bytes = None;
        candidate.abort = Some(abort);
        update
    };
    let result = verified_download(&update, aborted, |event| {
        let _ = progress.send(event);
    })
    .await;
    let mut candidate = service.candidate.lock().map_err(|_| "更新状态不可用")?;
    candidate.abort = None;
    if candidate.generation != token {
        return Err("下载已取消，请重新检查更新".into());
    }
    candidate.verified_bytes = Some(result?);
    Ok(())
}

#[tauri::command]
pub fn cancel_application_update(
    token: u64,
    service: State<'_, UpdateService>,
) -> Result<(), String> {
    let mut candidate = service.candidate.lock().map_err(|_| "更新状态不可用")?;
    if candidate.generation != token {
        return Ok(());
    }
    if let Some(abort) = &candidate.abort {
        let _ = abort.send(true);
    }
    candidate.verified_bytes = None;
    Ok(())
}

#[tauri::command]
pub async fn install_application_update(
    app: AppHandle,
    token: u64,
    service: State<'_, UpdateService>,
) -> Result<(), String> {
    let _operation = service
        .operation
        .try_lock()
        .map_err(|_| "更新操作正在进行")?;
    let (update, bytes) = {
        let mut candidate = service.candidate.lock().map_err(|_| "更新状态不可用")?;
        if candidate.generation != token {
            return Err("版本信息已过期，请重新检查更新".into());
        }
        let update = candidate.update.clone().ok_or("请先检查更新")?;
        let bytes = candidate
            .verified_bytes
            .take()
            .ok_or("更新包尚未通过签名校验，请重新下载")?;
        (update, bytes)
    };
    // Windows NSIS starts the installer and exits here; /R relaunches the app.
    // The UI must finish the document-save gate before invoking this command.
    // No path or payload from the frontend is accepted by the installation API.
    tauri::async_runtime::spawn_blocking(move || update.install(bytes))
        .await
        .map_err(|error| format!("安装任务失败：{error}"))?
        .map_err(|error| format!("安装失败，请重新下载后重试：{error}"))?;
    #[cfg(not(windows))]
    {
        app.restart()
    }
    #[cfg(windows)]
    {
        let _ = app;
        Ok(())
    }
}
