//! Non-default CI feature: public fixture authority and client-local TLS trust.
//! No signature, freshness, replay, PE-version or install checks are bypassed.
//! Never present in a normal candidate. No system trust store is changed.
use super::ReleaseChannel;
use serde::Deserialize;
use std::{
    path::PathBuf,
    sync::OnceLock,
    time::{SystemTime, UNIX_EPOCH},
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Fixture {
    scope: String,
    expires_at: u64,
    pub channel: ReleaseChannel,
    certificate_pem: String,
}
#[cfg(not(target_os = "linux"))]
compile_error!("Linux download-only QA fixture cannot target another platform");
impl Fixture {
    pub fn validate_download(&self, url: &tauri::Url) -> Result<(), String> {
        let endpoint =
            tauri::Url::parse(&self.channel.endpoints[0]).map_err(|_| "CI endpoint invalid")?;
        if url.scheme() != "https"
            || url.host_str() != Some("127.0.0.1")
            || url.port() != endpoint.port()
            || url.path() != "/candidate.deb"
            || !url.username().is_empty()
            || url.password().is_some()
            || url.query().is_some()
            || url.fragment().is_some()
        {
            return Err("CI download must stay at exact loopback authority".into());
        }
        Ok(())
    }

    pub fn certificate(&self) -> Result<reqwest::Certificate, String> {
        reqwest::Certificate::from_pem(self.certificate_pem.as_bytes())
            .map_err(|_| "CI fixture certificate invalid".into())
    }
    fn validate(&self, now: u64) -> Result<(), String> {
        if self.scope != "isolated-linux-download-only-not-for-distribution"
            || self.expires_at <= now
            || self.expires_at - now > 7200
            || self.certificate_pem.len() > 8192
            || !self.channel.configured()?
            || self.channel.channel != "beta"
            || self.channel.endpoints.len() != 1
        {
            return Err("Bounded unexpired CI fixture required".into());
        }
        let url = tauri::Url::parse(&self.channel.endpoints[0]).map_err(|_| "CI URL invalid")?;
        if url.host_str() != Some("127.0.0.1")
            || url.port().is_none()
            || url.path() != "/manifest.json"
            || url.query().is_some()
            || url.fragment().is_some()
        {
            return Err("CI endpoint must be exact loopback HTTPS manifest".into());
        }
        self.certificate()?;
        Ok(())
    }
}
fn now() -> Result<u64, String> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|t| t.as_secs())
        .map_err(|_| "Clock invalid".into())
}
pub(super) fn get() -> Result<&'static Fixture, String> {
    static FIXTURE: OnceLock<Result<Fixture, String>> = OnceLock::new();
    let fixture = FIXTURE
        .get_or_init(|| {
            if unsafe { libc::geteuid() } == 0
                || !cfg!(target_os = "linux")
                || std::env::var("GITHUB_ACTIONS").as_deref() != Ok("true")
                || std::env::var("RUNNER_ENVIRONMENT").as_deref() != Ok("github-hosted")
                || std::env::var("GITHUB_REPOSITORY").as_deref() != Ok("Auto-Plugin/milkup")
            {
                return Err("CI update build is not a distributable application".into());
            }
            let path = PathBuf::from(
                std::env::var_os("MILKUP_CI_UPDATE_FIXTURE").ok_or("CI fixture absent")?,
            );
            let meta = std::fs::symlink_metadata(&path).map_err(|_| "CI fixture unreadable")?;
            use std::os::unix::fs::MetadataExt;
            if meta.uid() != unsafe { libc::geteuid() }
                || meta.mode() & 0o077 != 0
                || !path.is_absolute()
                || !meta.is_file()
                || meta.file_type().is_symlink()
                || meta.len() > 16384
            {
                return Err("Bounded regular public fixture required".into());
            }
            let bytes = std::fs::read(path).map_err(|_| "CI fixture unreadable")?;
            if bytes.len() > 16384 {
                return Err("CI fixture too large".into());
            }
            let value: Fixture =
                serde_json::from_slice(&bytes).map_err(|_| "CI fixture malformed")?;
            value.validate(now()?)?;
            Ok(value)
        })
        .as_ref()
        .map_err(Clone::clone)?;
    // Same immutable authority for check/download/install; expiry rechecked.
    fixture.validate(now()?)?;
    Ok(fixture)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn download_is_exact_loopback_origin_and_path() {
        let fixture = Fixture {
            scope: "isolated-linux-download-only-not-for-distribution".into(),
            expires_at: 0,
            channel: ReleaseChannel {
                channel: "beta".into(),
                endpoints: vec!["https://127.0.0.1:4567/manifest.json".into()],
                public_key: None,
            },
            certificate_pem: String::new(),
        };
        assert!(fixture
            .validate_download(&tauri::Url::parse("https://127.0.0.1:4567/candidate.deb").unwrap())
            .is_ok());
        for bad in [
            "http://127.0.0.1:4567/candidate.deb",
            "https://127.0.0.1:4568/candidate.deb",
            "https://example.com:4567/candidate.deb",
            "https://localhost:4567/candidate.deb",
            "https://127.0.0.1:4567/other.deb",
            "https://127.0.0.1:4567/candidate.deb?q=1",
            "https://127.0.0.1:4567/candidate.deb#f",
            "https://user@127.0.0.1:4567/candidate.deb",
        ] {
            assert!(
                fixture
                    .validate_download(&tauri::Url::parse(bad).unwrap())
                    .is_err(),
                "{bad}"
            );
        }
    }
}
