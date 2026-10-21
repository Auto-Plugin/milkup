//! Durable raw signed handoff and read-only restart reconciliation.
//! No install, completion, health, SDK or IPC operation is exposed here.
use super::{identity, policy, transaction, ReleaseChannel, CHANNEL_CONFIG};
use sha2::{Digest, Sha256};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri_plugin_updater::{verify_signed_manifest, Update, VerifiedManifest};

type Result<T> = std::result::Result<T, String>;

fn configured() -> Result<ReleaseChannel> {
    let config: ReleaseChannel = serde_json::from_str(CHANNEL_CONFIG).map_err(|e| e.to_string())?;
    if !config.configured()? {
        return Err("更新渠道未配置，不能恢复签名交接".into());
    }
    Ok(config)
}

fn active(cancelled: &AtomicBool) -> Result<()> {
    if cancelled.load(Ordering::SeqCst) {
        Err("签名交接核对已取消".into())
    } else {
        Ok(())
    }
}

fn verify(bytes: &[u8], config: &ReleaseChannel) -> Result<VerifiedManifest> {
    verify_signed_manifest(
        bytes,
        config.public_key.as_deref().ok_or("缺少宿主信任根")?,
        "milkup-desktop",
        &config.channel,
    )
    .map_err(|e| e.to_string())
}

fn release_hash(manifest: &VerifiedManifest) -> Result<String> {
    Ok(format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(manifest.release()).map_err(|e| e.to_string())?)
    ))
}

pub(super) fn retain(
    update: &Update,
    trust: &policy::Store,
    store: &mut transaction::Store,
    expected: &transaction::Token,
    cancelled: &AtomicBool,
) -> Result<transaction::Record> {
    retain_with(
        update,
        trust,
        store,
        expected,
        cancelled,
        &configured()?,
        policy::now,
    )
}

fn retain_with(
    update: &Update,
    trust: &policy::Store,
    store: &mut transaction::Store,
    expected: &transaction::Token,
    cancelled: &AtomicBool,
    config: &ReleaseChannel,
    clock: impl Fn() -> Result<u64>,
) -> Result<transaction::Record> {
    active(cancelled)?;
    let raw = update.verified_envelope().ok_or("没有原始签名 envelope")?;
    let manifest = verify(raw, config)?;
    let selection = identity::Declaration::selection(update)?;
    let declaration = identity::Declaration::from_manifest(&manifest, &selection)?;
    let record = store.snapshot().map_err(|e| format!("{e:?}"))?;
    if record.token() != *expected || !declaration.matches_intent(record.intent()) {
        return Err("签名交接与当前事务不符".into());
    }
    let observation = policy::Observation::from_manifest(&manifest)?;
    trust.authorize_existing(&observation, clock()?)?;
    let packet = transaction::Handoff {
        transaction: expected.transaction.clone(),
        revision: expected.revision,
        release_sha256: release_hash(&manifest)?,
        platform: identity::host_platform()?,
        selection,
        installer_sha256: record.intent().installer_sha256.clone(),
        envelope: String::from_utf8(manifest.envelope().to_vec()).map_err(|e| e.to_string())?,
    };
    active(cancelled)?;
    let result = store
        .attach(expected, packet, clock()?)
        .map_err(|e| format!("{e:?}"))?;
    // A cancellation/expiry after commit leaves evidence in Prepared. Never
    // announce success, erase it, or advance toward installation on that error.
    active(cancelled)?;
    trust.authorize_existing(&observation, clock()?)?;
    active(cancelled)?;
    Ok(result)
}

#[derive(Debug)]
pub(super) struct RestartObservation {
    transaction: transaction::Token,
    release_sha256: String,
    image: identity::CurrentImage,
}
impl RestartObservation {
    pub(super) fn transaction(&self) -> &transaction::Token {
        &self.transaction
    }
    pub(super) fn image(&self) -> &identity::CurrentImage {
        &self.image
    }
    pub(super) fn release_sha256(&self) -> &str {
        &self.release_sha256
    }
    pub(super) fn disposition(&self) -> transaction::Phase {
        transaction::Phase::NeedsReview
    }
    pub(super) fn verification(&self) -> transaction::Verification {
        transaction::Verification::Unverified
    }
}

pub(super) fn inspect_restart(
    directory: PathBuf,
    expected_transaction: &str,
    trust: &policy::Store,
    cancelled: &AtomicBool,
) -> Result<RestartObservation> {
    inspect_with(
        directory,
        expected_transaction,
        trust,
        cancelled,
        &configured()?,
        policy::now,
        identity::observe_current,
    )
}

fn inspect_with(
    directory: PathBuf,
    expected_transaction: &str,
    trust: &policy::Store,
    cancelled: &AtomicBool,
    config: &ReleaseChannel,
    clock: impl Fn() -> Result<u64>,
    observe: impl FnOnce() -> Result<identity::CurrentImage>,
) -> Result<RestartObservation> {
    active(cancelled)?;
    let view = transaction::Store::inspect(directory).map_err(|e| format!("{e:?}"))?;
    let record = view.snapshot().map_err(|e| format!("{e:?}"))?;
    if record.token().transaction != expected_transaction
        || !matches!(
            record.phase(),
            transaction::Phase::AwaitingCompletion | transaction::Phase::NeedsReview
        )
    {
        return Err("重启事务不匹配或尚未提交启动；保持待核对".into());
    }
    let packet = record.handoff().ok_or("旧事务缺少原始签名交接包")?;
    let manifest = verify(packet.envelope.as_bytes(), config)?;
    if packet.release_sha256 != release_hash(&manifest)?
        || packet.platform != identity::host_platform()?
    {
        return Err("签名交接 release 或平台绑定失效".into());
    }
    let declaration = identity::Declaration::from_manifest(&manifest, &packet.selection)?;
    if !declaration.matches_intent(record.intent()) {
        return Err("签名交接意图不符".into());
    }
    let observation = policy::Observation::from_manifest(&manifest)?;
    trust.authorize_existing(&observation, clock()?)?;
    active(cancelled)?;
    let image = observe()?;
    declaration.check_image(&image)?;
    trust.authorize_existing(&observation, clock()?)?;
    if view.snapshot().map_err(|e| format!("{e:?}"))? != record {
        return Err("重启核对期间事务发生变化".into());
    }
    active(cancelled)?;
    Ok(RestartObservation {
        transaction: record.token(),
        release_sha256: packet.release_sha256.clone(),
        image,
    })
}

#[cfg(test)]
#[path = "update_handoff_tests.rs"]
mod tests;
