//! Installed package icons are bounded PNG resources, never arbitrary host paths or URLs.
#[cfg(test)]
use std::fs;
#[cfg(test)]
use std::io::Read;
#[cfg(test)]
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

#[cfg(test)]
const MAX_ICON_BYTES: u64 = 256 * 1024;

#[tauri::command]
pub fn read_plugin_icon(app: AppHandle, plugin_id: String) -> Result<Vec<u8>, String> {
    crate::validate_plugin_id(&plugin_id)?;
    let root = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("plugins");
    let bytes = crate::plugin_catalog::read_icon(&root, &plugin_id)?;
    validate_png(&bytes)?;
    Ok(bytes)
}

#[cfg(test)]
fn read_installed_icon(plugins_root: &Path, plugin_id: &str) -> Result<Vec<u8>, String> {
    crate::validate_plugin_id(plugin_id)?;
    let package = confined_file(plugins_root, &format!("{plugin_id}/package"))?;
    let manifest_path = confined_file(&package, "plugin.json")?;
    let manifest: serde_json::Value =
        serde_json::from_slice(&read_bounded(&manifest_path, 1024 * 1024)?)
            .map_err(|error| error.to_string())?;
    if manifest.get("id").and_then(|id| id.as_str()) != Some(plugin_id) {
        return Err("Plugin icon manifest identity does not match".into());
    }
    let icon = manifest
        .get("icon")
        .and_then(|icon| icon.as_str())
        .ok_or("Plugin has no icon")?;
    if !valid_icon_path(icon)
        || !manifest
            .get("resources")
            .and_then(|resources| resources.as_array())
            .is_some_and(|resources| {
                resources
                    .iter()
                    .any(|resource| resource.as_str() == Some(icon))
            })
    {
        return Err("Icon must be an explicitly declared package PNG resource".into());
    }
    let bytes = read_bounded(&confined_file(&package, icon)?, MAX_ICON_BYTES)?;
    validate_png(&bytes)?;
    Ok(bytes)
}

#[cfg(test)]
fn valid_icon_path(icon: &str) -> bool {
    if !icon.to_ascii_lowercase().ends_with(".png") {
        return false;
    }
    let stem = &icon[..icon.len() - 4];
    stem.split('/').all(|part| {
        !part.is_empty()
            && part
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
    })
}

#[cfg(test)]
fn confined_file(root: &Path, relative: &str) -> Result<PathBuf, String> {
    let root = root.canonicalize().map_err(|error| error.to_string())?;
    let relative = crate::validate_plugin_relative_path(relative)?;
    let mut path = root.clone();
    for component in relative.components() {
        path.push(component);
        if fs::symlink_metadata(&path)
            .map_err(|error| error.to_string())?
            .file_type()
            .is_symlink()
        {
            return Err("Plugin icon paths must not contain symlinks".into());
        }
    }
    let resolved = path.canonicalize().map_err(|error| error.to_string())?;
    if !resolved.starts_with(&root) {
        return Err("Plugin icon escaped its package".into());
    }
    Ok(resolved)
}

#[cfg(test)]
fn read_bounded(path: &Path, limit: u64) -> Result<Vec<u8>, String> {
    let entry = fs::symlink_metadata(path).map_err(|error| error.to_string())?;
    if !entry.is_file() || entry.len() > limit {
        return Err("Plugin icon resource is too large or not a regular file".into());
    }
    let file = fs::File::open(path).map_err(|error| error.to_string())?;
    let metadata = file.metadata().map_err(|error| error.to_string())?;
    if !metadata.is_file() || metadata.len() > limit {
        return Err("Plugin icon resource is too large or not a file".into());
    }
    let mut bytes = Vec::new();
    file.take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| error.to_string())?;
    if bytes.len() as u64 > limit {
        return Err("Plugin icon resource is too large".into());
    }
    Ok(bytes)
}

fn validate_png(bytes: &[u8]) -> Result<(), String> {
    if bytes.len() < 33
        || bytes[..16] != [137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]
    {
        return Err("Plugin icon must contain PNG image data".into());
    }
    let width = u32::from_be_bytes(bytes[16..20].try_into().unwrap());
    let height = u32::from_be_bytes(bytes[20..24].try_into().unwrap());
    if width == 0 || height == 0 || width > 1024 || height > 1024 {
        return Err("Plugin icon dimensions must be within 1024 pixels".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn fixture() -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "milkup-icon-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(path.join("test.icon/package/assets")).unwrap();
        fs::write(
            path.join("test.icon/package/plugin.json"),
            r#"{"id":"test.icon","icon":"assets/logo.png","resources":["assets/logo.png"]}"#,
        )
        .unwrap();
        let mut png = vec![137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82];
        png.extend_from_slice(&1u32.to_be_bytes());
        png.extend_from_slice(&1u32.to_be_bytes());
        png.resize(33, 0);
        fs::write(path.join("test.icon/package/assets/logo.png"), png).unwrap();
        path
    }

    #[test]
    fn bounded_installed_png_and_invalid_resources() {
        let root = fixture();
        assert_eq!(read_installed_icon(&root, "test.icon").unwrap().len(), 33);
        let icon = root.join("test.icon/package/assets/logo.png");
        fs::write(&icon, b"<svg />").unwrap();
        assert!(read_installed_icon(&root, "test.icon").is_err());
        fs::write(&icon, vec![0; MAX_ICON_BYTES as usize + 1]).unwrap();
        assert!(read_installed_icon(&root, "test.icon").is_err());
        fs::write(
            root.join("test.icon/package/plugin.json"),
            r#"{"id":"test.icon","icon":"assets/logo.png","resources":[]}"#,
        )
        .unwrap();
        assert!(read_installed_icon(&root, "test.icon").is_err());
        assert!(read_installed_icon(&root, "../outside").is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlinked_package_and_icon() {
        use std::os::unix::fs::symlink;
        let root = fixture();
        let icon = root.join("test.icon/package/assets/logo.png");
        fs::rename(&icon, root.join("outside.png")).unwrap();
        symlink(root.join("outside.png"), &icon).unwrap();
        assert!(read_installed_icon(&root, "test.icon").is_err());
        fs::rename(root.join("test.icon/package"), root.join("elsewhere")).unwrap();
        symlink(root.join("elsewhere"), root.join("test.icon/package")).unwrap();
        assert!(read_installed_icon(&root, "test.icon").is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_urls_traversal_and_active_images() {
        for path in [
            "https://host/logo.png",
            "../logo.png",
            "/logo.png",
            "assets\\logo.png",
            "logo.svg",
            "a%2f.png",
            "./logo.png",
        ] {
            assert!(!valid_icon_path(path), "{path}");
        }
        assert!(valid_icon_path("assets/logo.png"));
    }
}
