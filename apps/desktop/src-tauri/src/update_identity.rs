//! Signed single-image evidence, not installer completion or runtime health.
//! The only production observation entry reads this process's executable. No
//! external hash/version/path or completion message can construct an observation.
use super::{policy, transaction};
use serde::Deserialize;
use sha2::{Digest, Sha256};
#[cfg(target_os = "linux")]
use std::{fs::File, io::Read};
use tauri_plugin_updater::Update;

const MAX_IMAGE_BYTES: u64 = 256 * 1024 * 1024;
type Result<T> = std::result::Result<T, String>;

#[derive(Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Declaration {
    schema: u32,
    version: String,
    platform: String,
    sha256: String,
    size: u64,
    installer_sha256: String,
}

pub(super) fn host_platform() -> Result<String> {
    let os = match std::env::consts::OS {
        "linux" => "linux",
        "windows" => "windows",
        "macos" => "darwin",
        _ => return Err("当前平台不支持应用映像身份观测".into()),
    };
    if !matches!(std::env::consts::ARCH, "x86_64" | "aarch64") {
        return Err("当前架构不支持应用映像身份观测".into());
    }
    Ok(format!("{os}-{}", std::env::consts::ARCH))
}

impl Declaration {
    pub(super) fn selection(update: &Update) -> Result<String> {
        let release = update.verified_release().ok_or("应用身份的签名绑定失效")?;
        let platforms = release["platforms"].as_object().ok_or("缺少签名平台项")?;
        // The upstream target field is sometimes only the OS. Recover selection
        // from its authenticated URL + package signature and reject ambiguity;
        // never guess between two signed entries with different image claims.
        let matches = platforms
            .iter()
            .filter(|(_, entry)| {
                entry["url"].as_str() == Some(update.download_url.as_str())
                    && entry["signature"].as_str() == Some(update.signature.as_str())
            })
            .collect::<Vec<_>>();
        if matches.len() != 1 {
            return Err("无法唯一绑定已签名的应用平台项".into());
        }
        Ok(matches[0].0.clone())
    }

    fn from_update(update: &Update, platform: &str) -> Result<Self> {
        let selected = Self::selection(update)?;
        let os = platform.split('-').next().ok_or("无效平台")?;
        if update.target != os && update.target != selected {
            return Err("应用映像平台与当前宿主不符".into());
        }
        Self::parse(
            update.verified_release().ok_or("签名绑定失效")?,
            &selected,
            platform,
        )
    }

    pub(super) fn from_manifest(
        manifest: &tauri_plugin_updater::VerifiedManifest,
        selected: &str,
    ) -> Result<Self> {
        Self::parse(manifest.release(), selected, &host_platform()?)
    }

    fn parse(release: &serde_json::Value, selected: &str, platform: &str) -> Result<Self> {
        let os = platform.split('-').next().ok_or("无效平台")?;
        let kinds: &[&str] = match os {
            "linux" => &["appimage", "deb", "rpm"],
            "windows" => &["nsis"],
            "darwin" => &["app"],
            _ => &[],
        };
        let valid_target = selected == platform
            || kinds
                .iter()
                .any(|kind| selected == format!("{platform}-{kind}"));
        if !valid_target {
            return Err("应用映像平台与当前宿主不符".into());
        }
        let declaration: Self =
            serde_json::from_value(release["platforms"][selected]["application"].clone())
                .map_err(|_| "清单没有受支持的签名应用身份证明")?;
        let digest = |s: &str| {
            s.len() == 64
                && s.bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        };
        if declaration.schema != 1
            || Some(declaration.version.as_str()) != release["version"].as_str()
            || declaration.platform != platform
            || !digest(&declaration.sha256)
            || !digest(&declaration.installer_sha256)
            || declaration.size == 0
            || declaration.size > MAX_IMAGE_BYTES
        {
            return Err("签名应用身份的版本、平台、摘要或大小无效".into());
        }
        Ok(declaration)
    }

    pub(super) fn matches_intent(&self, intent: &transaction::Intent) -> bool {
        intent.expected_version == self.version && intent.installer_sha256 == self.installer_sha256
    }

    pub(super) fn check_image(&self, image: &CurrentImage) -> Result<()> {
        if image.version != self.version
            || image.platform != self.platform
            || image.sha256 != self.sha256
            || image.size != self.size
            || image.process != std::process::id()
        {
            return Err("当前应用映像与签名声明不一致".into());
        }
        Ok(())
    }
}

// Fields are deliberately private. This is an instantaneous local observation,
// not a serialized receipt and not an authorization token for another process.
#[derive(Debug)]
pub(super) struct CurrentImage {
    version: String,
    platform: String,
    sha256: String,
    size: u64,
    process: u32,
}

impl CurrentImage {
    pub(super) fn version(&self) -> &str {
        &self.version
    }
    pub(super) fn platform(&self) -> &str {
        &self.platform
    }
    pub(super) fn sha256(&self) -> &str {
        &self.sha256
    }
    pub(super) fn size(&self) -> u64 {
        self.size
    }
}

#[cfg(target_os = "linux")]
fn read_image(mut file: File) -> Result<(String, u64)> {
    use std::os::unix::fs::MetadataExt;
    let stamp = |m: &std::fs::Metadata| {
        (
            m.dev(),
            m.ino(),
            m.len(),
            m.mtime(),
            m.mtime_nsec(),
            m.ctime(),
            m.ctime_nsec(),
        )
    };
    let before = file.metadata().map_err(|e| e.to_string())?;
    if !before.is_file() || before.len() == 0 || before.len() > MAX_IMAGE_BYTES {
        return Err("应用映像不是受支持的有界普通文件".into());
    }
    let mut hash = Sha256::new();
    let mut size = 0u64;
    let mut buffer = [0; 64 * 1024];
    loop {
        let count = file.read(&mut buffer).map_err(|e| e.to_string())?;
        if count == 0 {
            break;
        }
        size = size.checked_add(count as u64).ok_or("映像大小溢出")?;
        if size > MAX_IMAGE_BYTES {
            return Err("应用映像超过读取上限".into());
        }
        hash.update(&buffer[..count]);
        #[cfg(test)]
        tests::after_read_chunk();
    }
    let after = file.metadata().map_err(|e| e.to_string())?;
    if size != before.len() || stamp(&before) != stamp(&after) {
        return Err("读取期间应用映像发生变化".into());
    }
    Ok((format!("{:x}", hash.finalize()), size))
}

pub(super) fn observe_current() -> Result<CurrentImage> {
    #[cfg(target_os = "linux")]
    {
        // Intentionally open the kernel magic link, not readlink/current_exe's
        // pathname. The descriptor pins the executed inode even after rename.
        // Assumes a trusted kernel/procfs and no hostile in-process code.
        let file = File::open("/proc/self/exe").map_err(|e| e.to_string())?;
        let (sha256, size) = read_image(file)?;
        Ok(CurrentImage {
            version: env!("CARGO_PKG_VERSION").into(),
            platform: host_platform()?,
            sha256,
            size,
            process: std::process::id(),
        })
    }
    #[cfg(not(target_os = "linux"))]
    Err("缺少绑定当前已加载映像的只读句柄原语；身份保持未验证".into())
}

// A point-in-time match for one image, bound to a live transaction revision and
// authenticated release. No method converts this into healthy/installed state.
#[derive(Debug)]
pub(super) struct ImageMatch {
    transaction: transaction::Token,
    statement_sha256: String,
    image: CurrentImage,
}

impl ImageMatch {
    pub(super) fn transaction(&self) -> &transaction::Token {
        &self.transaction
    }
    pub(super) fn statement_sha256(&self) -> &str {
        &self.statement_sha256
    }
    pub(super) fn image(&self) -> &CurrentImage {
        &self.image
    }
}

pub(super) fn verify_current(
    update: &Update,
    trust: &policy::Store,
    transaction: &mut transaction::Store,
    expected: &transaction::Token,
) -> Result<ImageMatch> {
    verify_with(
        update,
        trust,
        transaction,
        expected,
        policy::now,
        observe_current,
    )
}

// Private seam: production always supplies the host clock and current-image
// observer above; only child tests substitute synthetic inert file descriptors.
fn verify_with(
    update: &Update,
    trust: &policy::Store,
    transaction: &mut transaction::Store,
    expected: &transaction::Token,
    clock: impl Fn() -> Result<u64>,
    observe: impl FnOnce() -> Result<CurrentImage>,
) -> Result<ImageMatch> {
    let declaration = Declaration::from_update(update, &host_platform()?)?;
    let observation = policy::Observation::from_update(update)?;
    let check_transaction = |record: &transaction::Record| -> Result<()> {
        if record.token() != *expected
            || record.intent().expected_version != declaration.version
            || record.intent().installer_sha256 != declaration.installer_sha256
            || !matches!(
                record.phase(),
                transaction::Phase::AwaitingCompletion | transaction::Phase::NeedsReview
            )
        {
            return Err("应用身份证明与当前事务或阶段不符".into());
        }
        Ok(())
    };
    let record = transaction.snapshot().map_err(|e| format!("{e:?}"))?;
    check_transaction(&record)?;
    trust.authorize_existing(&observation, clock()?)?;
    let image = observe()?;
    declaration.check_image(&image)?;
    // Recheck expiry/replay after I/O. Never advance the policy water mark or
    // persist health, and do not return a reusable install authorization.
    trust.authorize_existing(&observation, clock()?)?;
    check_transaction(&transaction.snapshot().map_err(|e| format!("{e:?}"))?)?;
    Ok(ImageMatch {
        transaction: expected.clone(),
        statement_sha256: format!(
            "{:x}",
            Sha256::digest(
                serde_json::to_vec(update.verified_release().ok_or("签名绑定失效")?)
                    .map_err(|e| e.to_string())?
            )
        ),
        image,
    })
}

#[cfg(test)]
#[path = "update_identity_tests.rs"]
mod tests;

#[cfg(test)]
pub(super) fn inert_fixture_image(path: &std::path::Path, version: &str) -> Result<CurrentImage> {
    #[cfg(target_os = "linux")]
    let (sha256, size) = read_image(File::open(path).map_err(|e| e.to_string())?)?;
    #[cfg(not(target_os = "linux"))]
    let (sha256, size) = {
        let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
        (format!("{:x}", Sha256::digest(&bytes)), bytes.len() as u64)
    };
    Ok(CurrentImage {
        version: version.into(),
        platform: host_platform()?,
        sha256,
        size,
        process: std::process::id(),
    })
}
