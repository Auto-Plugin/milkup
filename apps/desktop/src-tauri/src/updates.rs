use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{ipc::Channel, AppHandle, Manager, State};
use tauri_plugin_updater::{Update, UpdaterExt};
use tokio::sync::{watch, Mutex as AsyncMutex};

const MAX_DOWNLOAD_BYTES: u64 = 256 * 1024 * 1024;
const CHANNEL_CONFIG: &str = include_str!("../../../../release/update-channel.json");

#[path = "update_pe.rs"]
mod pe;
#[path = "update_policy.rs"]
mod policy;

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
    download_epoch: u64,
    update: Option<Update>,
    // Only Update::download, after its minisign verification succeeds, can set this.
    verified_bytes: Option<Vec<u8>>,
    abort: Option<watch::Sender<bool>>,
    check_abort: Option<watch::Sender<bool>>,
    check_started: bool,
}

impl Candidate {
    fn begin_check(&mut self) -> Result<u64, String> {
        if self.check_abort.is_some() || self.abort.is_some() {
            return Err("更新操作正在进行".into());
        }
        self.generation += 1;
        self.update = None;
        self.verified_bytes = None;
        self.check_abort = Some(watch::channel(false).0);
        self.check_started = false;
        Ok(self.generation)
    }

    fn start_check(&mut self, token: u64) -> Result<watch::Receiver<bool>, String> {
        if self.generation != token || self.check_started {
            return Err("检查更新已取消或失效".into());
        }
        let receiver = self
            .check_abort
            .as_ref()
            .ok_or("检查更新已取消或失效")?
            .subscribe();
        self.check_started = true;
        Ok(receiver)
    }

    fn cancel_check(&mut self, token: u64) {
        if self.generation != token {
            return;
        }
        self.generation += 1;
        if let Some(abort) = self.check_abort.take() {
            let _ = abort.send(true);
        }
        self.check_started = false;
        self.update = None;
        self.verified_bytes = None;
        self.download_epoch += 1;
        if let Some(abort) = self.abort.take() {
            let _ = abort.send(true);
        }
    }

    fn finish_check(&mut self, token: u64, update: Option<Update>) -> Result<(), String> {
        self.finish_check_with(token, update, || Ok(()))
    }

    fn finish_check_with(
        &mut self,
        token: u64,
        update: Option<Update>,
        commit: impl FnOnce() -> Result<(), String>,
    ) -> Result<(), String> {
        if self.generation != token || self.check_abort.is_none() {
            return Err("检查更新已取消或失效".into());
        }
        // Caller holds the candidate mutex. Cancellation and durable trust
        // publication have one linearization point; stale results do not write.
        let result = commit();
        self.check_abort = None;
        self.check_started = false;
        result?;
        self.update = update;
        Ok(())
    }

    fn begin_download(&mut self, abort: watch::Sender<bool>) -> u64 {
        self.download_epoch += 1;
        self.verified_bytes = None;
        self.abort = Some(abort);
        self.download_epoch
    }

    fn finish_download(
        &mut self,
        token: u64,
        epoch: u64,
        result: Result<Vec<u8>, String>,
    ) -> Result<(), String> {
        // Cancellation and publication hold the same candidate mutex. Checking
        // the download epoch here closes the gap after verification returns;
        // a stale completion must not publish bytes or disarm a newer download.
        if self.generation != token || self.download_epoch != epoch {
            return Err("下载已取消，请重新检查更新".into());
        }
        self.abort = None;
        self.verified_bytes = Some(result?);
        Ok(())
    }

    fn cancel_download(&mut self, token: u64) {
        if self.generation != token {
            return;
        }
        // The release token stays valid so cancelling does not break retry.
        self.download_epoch += 1;
        if let Some(abort) = self.abort.take() {
            let _ = abort.send(true);
        }
        self.verified_bytes = None;
    }
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
    next.cmp_precedence(current).is_gt() && (channel == "beta" || next.pre.is_empty())
}

// Reserve an opaque generation before starting I/O. Cancellation can then win
// even if it arrives before the asynchronous check command starts executing.
#[tauri::command]
pub fn begin_application_update_check(service: State<'_, UpdateService>) -> Result<u64, String> {
    let _operation = service
        .operation
        .try_lock()
        .map_err(|_| "更新操作正在进行")?;
    service
        .candidate
        .lock()
        .map_err(|_| "更新状态不可用")?
        .begin_check()
}

#[tauri::command]
pub fn cancel_application_update_check(
    token: u64,
    service: State<'_, UpdateService>,
) -> Result<(), String> {
    service
        .candidate
        .lock()
        .map_err(|_| "更新状态不可用")?
        .cancel_check(token);
    Ok(())
}

#[tauri::command]
pub async fn check_application_update(
    token: u64,
    app: AppHandle,
    service: State<'_, UpdateService>,
) -> Result<UpdateCheck, String> {
    let _operation = service
        .operation
        .try_lock()
        .map_err(|_| "更新操作正在进行")?;
    let aborted = service
        .candidate
        .lock()
        .map_err(|_| "更新状态不可用")?
        .start_check(token)?;
    let result = await_check(aborted, check_release(&app, token), Duration::from_secs(20)).await;
    let mut candidate = service.candidate.lock().map_err(|_| "更新状态不可用")?;
    match result {
        Ok((info, update, observation)) => {
            candidate.finish_check_with(token, update, || {
                if let Some(observation) = observation {
                    trust_store(&app, &info.channel)?.accept(&observation, policy::now()?)?;
                }
                Ok(())
            })?;
            Ok(info)
        }
        Err(error) => {
            // A late failure must not clear a subsequent request's cancellation.
            candidate.finish_check(token, None)?;
            Err(error)
        }
    }
}

async fn await_check<T>(
    mut aborted: watch::Receiver<bool>,
    check: impl std::future::Future<Output = Result<T, String>>,
    deadline: Duration,
) -> Result<T, String> {
    if *aborted.borrow() {
        return Err("检查更新已取消".into());
    }
    tokio::select! {
        biased;
        _ = aborted.changed() => Err("检查更新已取消".into()),
        result = tokio::time::timeout(deadline, check) =>
            result.map_err(|_| "检查更新超时".to_string()).and_then(|result| result),
    }
}

async fn check_release(
    app: &AppHandle,
    token: u64,
) -> Result<(UpdateCheck, Option<Update>, Option<policy::Observation>), String> {
    let config: ReleaseChannel =
        serde_json::from_str(CHANNEL_CONFIG).map_err(|_| "更新配置无法读取")?;
    if !config.configured()? {
        return Ok((
            UpdateCheck {
                configured: false,
                channel: config.channel,
                update: None,
            },
            None,
            None,
        ));
    }
    let updater = app
        .updater_builder()
        .pubkey(config.public_key.expect("validated public key"))
        .require_signed_manifest("milkup-desktop", &config.channel)
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
        // Same/older signed statements must pass freshness and replay policy
        // before a "no update" answer can be trusted.
        .version_comparator(|_, _| true)
        .build()
        .map_err(|error| error.to_string())?;
    let update = updater
        .check()
        .await
        .map_err(|error| format!("检查更新失败：{error}"))?;
    let mut update = update.ok_or("更新服务未提供签名版本清单，无法确认是否为最新版本")?;
    let observation = policy::Observation::from_update(&update)?;
    let offered = newer_version(
        &app.package_info().version,
        &update.version.parse().map_err(|_| "更新版本无效")?,
        &config.channel,
    );
    if config.channel == "stable"
        && !update
            .version
            .parse::<semver::Version>()
            .map_err(|_| "更新版本无效")?
            .pre
            .is_empty()
    {
        return Err("稳定渠道的签名清单包含预发布版本".into());
    }
    let info = {
        if !update.has_verified_manifest() {
            return Err("更新元数据未通过签名绑定校验".into());
        }
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
            token,
            version: update.version.clone(),
            notes: update.body.clone().unwrap_or_default(),
            date: update.date.map(|date| date.to_string()),
        };
        offered.then_some(info)
    };
    Ok((
        UpdateCheck {
            configured: true,
            channel: config.channel,
            update: info,
        },
        offered.then_some(update),
        Some(observation),
    ))
}

fn trust_store(app: &AppHandle, channel: &str) -> Result<policy::Store, String> {
    Ok(policy::Store::new(
        app.path()
            .app_data_dir()
            .map_err(|error| error.to_string())?,
        channel,
        &format!("{}-{}", std::env::consts::OS, std::env::consts::ARCH),
        &app.package_info().version.to_string(),
    ))
}

fn authorize_candidate(app: &AppHandle, update: &Update) -> Result<(), String> {
    let config: ReleaseChannel =
        serde_json::from_str(CHANNEL_CONFIG).map_err(|_| "更新配置无法读取")?;
    if !config.configured()? {
        return Err("更新渠道未配置".into());
    }
    trust_store(app, &config.channel)?
        .authorize(&policy::Observation::from_update(update)?, policy::now()?)
}

fn verify_package_version(update: &Update, bytes: &[u8]) -> Result<(), String> {
    if update.target == "windows" || update.target.starts_with("windows-") {
        pe::verify(bytes, &update.version)?;
    }
    Ok(())
}

async fn verified_download(
    update: &Update,
    mut aborted: watch::Receiver<bool>,
    on_progress: impl Fn(DownloadProgress) + Send + Sync,
) -> Result<Vec<u8>, String> {
    if !update.has_verified_manifest() {
        return Err("更新元数据未通过签名绑定校验".into());
    }
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
    verify_package_version(update, &bytes)?;
    Ok(bytes)
}

async fn authorized_download(
    update: &Update,
    aborted: watch::Receiver<bool>,
    authorize: impl Fn() -> Result<(), String>,
    on_progress: impl Fn(DownloadProgress) + Send + Sync,
) -> Result<Vec<u8>, String> {
    authorize()?;
    let bytes = verified_download(update, aborted, on_progress).await?;
    // A valid signature does not keep a candidate fresh across a long download,
    // or across another process observing a newer release during that download.
    authorize()?;
    Ok(bytes)
}

#[tauri::command]
pub async fn download_application_update(
    app: AppHandle,
    token: u64,
    progress: Channel<DownloadProgress>,
    service: State<'_, UpdateService>,
) -> Result<(), String> {
    let _operation = service
        .operation
        .try_lock()
        .map_err(|_| "更新操作正在进行")?;
    let (abort, aborted) = watch::channel(false);
    let (update, epoch) = {
        let mut candidate = service.candidate.lock().map_err(|_| "更新状态不可用")?;
        if candidate.generation != token {
            return Err("版本信息已过期，请重新检查更新".into());
        }
        let update = candidate.update.clone().ok_or("请先检查更新")?;
        if !update.has_verified_manifest() {
            return Err("更新元数据未通过签名绑定校验".into());
        }
        let epoch = candidate.begin_download(abort);
        (update, epoch)
    };
    let result = authorized_download(
        &update,
        aborted,
        || authorize_candidate(&app, &update),
        |event| {
            let _ = progress.send(event);
        },
    )
    .await;
    let mut candidate = service.candidate.lock().map_err(|_| "更新状态不可用")?;
    candidate.finish_download(token, epoch, result)
}

#[tauri::command]
pub fn cancel_application_update(
    token: u64,
    service: State<'_, UpdateService>,
) -> Result<(), String> {
    let mut candidate = service.candidate.lock().map_err(|_| "更新状态不可用")?;
    candidate.cancel_download(token);
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
        authorize_candidate(&app, &update)?;
        verify_package_version(
            &update,
            candidate
                .verified_bytes
                .as_deref()
                .ok_or("请重新下载更新包")?,
        )?;
        let bytes = candidate
            .verified_bytes
            .take()
            .ok_or("更新包尚未通过签名校验，请重新下载")?;
        if !update.has_verified_manifest() {
            return Err("更新元数据未通过签名绑定校验".into());
        }
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
