//! Non-default CI feature: public fixture authority and client-local TLS trust.
//! No signature, freshness, replay, PE-version or install checks are bypassed.
//! Never present in a normal candidate. No system trust store is changed.
use super::ReleaseChannel;
use serde::Deserialize;
use std::{path::PathBuf, sync::OnceLock, time::{SystemTime, UNIX_EPOCH}};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Fixture {
    scope: String,
    expires_at: u64,
    pub channel: ReleaseChannel,
    certificate_pem: String,
}
impl Fixture {
    pub fn certificate(&self) -> Result<reqwest::Certificate, String> {
        reqwest::Certificate::from_pem(self.certificate_pem.as_bytes())
            .map_err(|_| "CI fixture certificate invalid".into())
    }
    fn validate(&self, now: u64) -> Result<(), String> {
        if self.scope != "isolated-in-app-update-not-for-distribution"
            || self.expires_at <= now || self.expires_at - now > 7200
            || self.certificate_pem.len() > 8192 || !self.channel.configured()?
            || self.channel.channel != "beta" || self.channel.endpoints.len() != 1 {
            return Err("Bounded unexpired CI fixture required".into());
        }
        let url = tauri::Url::parse(&self.channel.endpoints[0]).map_err(|_| "CI URL invalid")?;
        if url.host_str() != Some("127.0.0.1") || url.port().is_none()
            || url.path() != "/manifest.json" || url.query().is_some() || url.fragment().is_some() {
            return Err("CI endpoint must be exact loopback HTTPS manifest".into());
        }
        self.certificate()?;
        Ok(())
    }
}
fn now() -> Result<u64, String> {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|t| t.as_secs()).map_err(|_| "Clock invalid".into())
}
pub(super) fn get() -> Result<&'static Fixture, String> {
    static FIXTURE: OnceLock<Result<Fixture, String>> = OnceLock::new();
    let fixture = FIXTURE.get_or_init(|| {
        if !cfg!(windows) || std::env::var("GITHUB_ACTIONS").as_deref() != Ok("true")
            || std::env::var("RUNNER_ENVIRONMENT").as_deref() != Ok("github-hosted")
            || std::env::var("GITHUB_REPOSITORY").as_deref() != Ok("Auto-Plugin/milkup") {
            return Err("CI update build is not a distributable application".into());
        }
        let path = PathBuf::from(std::env::var_os("MILKUP_CI_UPDATE_FIXTURE").ok_or("CI fixture absent")?);
        let meta = std::fs::symlink_metadata(&path).map_err(|_| "CI fixture unreadable")?;
        if !path.is_absolute() || !meta.is_file() || meta.file_type().is_symlink() || meta.len() > 16384 {
            return Err("Bounded regular public fixture required".into());
        }
        let bytes = std::fs::read(path).map_err(|_| "CI fixture unreadable")?;
        if bytes.len() > 16384 { return Err("CI fixture too large".into()); }
        let value: Fixture = serde_json::from_slice(&bytes).map_err(|_| "CI fixture malformed")?;
        value.validate(now()?)?;
        Ok(value)
    }).as_ref().map_err(Clone::clone)?;
    // Same immutable authority for check/download/install; expiry rechecked.
    fixture.validate(now()?)?;
    Ok(fixture)
}
