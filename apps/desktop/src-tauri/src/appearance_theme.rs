//! Desktop-only wrappers for raw theme storage. No plugin RPC exposes these commands.
use crate::appearance_theme_store::{
    candidate_from_file, CandidateCommit, Store, ThemeCandidate, ThemeSnapshot,
};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::Manager;
type Result<T> = std::result::Result<T, String>;
fn error(value: impl std::fmt::Display) -> String {
    format!("[appearance-theme] {value}")
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CommitCandidate {
    path: String,
    expected_digest: String,
    expected_revision: String,
}
#[derive(Serialize)]
pub(crate) struct OpenRequested {
    status: &'static str,
    path: String,
}
fn read_candidate(path: &Path) -> Result<ThemeCandidate> {
    if !path.is_absolute()
        || !path
            .extension()
            .is_some_and(|v| v.eq_ignore_ascii_case("css"))
    {
        return Err(error("请选择绝对路径的 .css 文件"));
    }
    let name = path
        .file_stem()
        .and_then(|v| v.to_str())
        .ok_or_else(|| error("主题文件名不是有效文本"))?;
    let parent_path = path.parent().ok_or_else(|| error("主题文件缺少父目录"))?;
    let (parent, _guards) = crate::workspace::open_absolute_directory(parent_path)?;
    let file = crate::workspace::open_child(
        &parent,
        parent_path,
        path.file_name().ok_or("Missing theme file name")?,
        false,
    )
    .map_err(error)?;
    candidate_from_file(file, name.into())
}
fn app_root(app: &tauri::AppHandle) -> Result<PathBuf> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(error)?
        .join("appearance-themes-v1"))
}
#[tauri::command]
pub(crate) fn appearance_theme_load(app: tauri::AppHandle) -> Result<ThemeSnapshot> {
    Store::open(&app_root(&app)?)?.snapshot()
}
#[tauri::command]
pub(crate) fn appearance_theme_read_candidate(path: String) -> Result<ThemeCandidate> {
    read_candidate(Path::new(&path))
}
#[tauri::command]
pub(crate) fn appearance_theme_commit_candidate(
    app: tauri::AppHandle,
    input: CommitCandidate,
) -> Result<ThemeSnapshot> {
    {
        let candidate = read_candidate(Path::new(&input.path))?;
        Store::open(&app_root(&app)?)?.commit(CandidateCommit {
            candidate,
            expected_digest: input.expected_digest,
            expected_revision: input.expected_revision,
        })
    }
}
#[tauri::command]
pub(crate) fn appearance_theme_reset(
    app: tauri::AppHandle,
    expected_revision: String,
) -> Result<ThemeSnapshot> {
    Store::open(&app_root(&app)?)?.reset(&expected_revision)
}
#[tauri::command]
pub(crate) fn appearance_theme_open_current(
    app: tauri::AppHandle,
    expected_revision: String,
) -> Result<OpenRequested> {
    let store = Store::open(&app_root(&app)?)?;
    let path = store.open_path(&expected_revision)?;
    request_open(&path)?;
    Ok(OpenRequested {
        status: "requested",
        path: path.to_string_lossy().into_owned(),
    })
}
#[cfg(windows)]
fn request_open(path: &Path) -> Result<()> {
    use std::ffi::c_void;
    use std::os::windows::ffi::OsStrExt;
    #[link(name = "shell32")]
    extern "system" {
        fn ShellExecuteW(
            window: *mut c_void,
            operation: *const u16,
            file: *const u16,
            parameters: *const u16,
            directory: *const u16,
            show: i32,
        ) -> *mut c_void;
    }
    let operation: Vec<u16> = "open\0".encode_utf16().collect();
    let file: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    let result = unsafe {
        ShellExecuteW(
            std::ptr::null_mut(),
            operation.as_ptr(),
            file.as_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            1,
        )
    } as isize;
    if result <= 32 {
        return Err(error(format!(
            "系统未接受 CSS 默认关联打开请求（{result}），请检查 .css 文件关联"
        )));
    }
    Ok(())
}
#[cfg(not(windows))]
fn request_open(path: &Path) -> Result<()> {
    use std::process::{Command, Stdio};
    #[cfg(target_os = "macos")]
    let mut command = {
        let mut c = Command::new("open");
        c.arg("--");
        c
    };
    #[cfg(not(target_os = "macos"))]
    let mut command = Command::new("xdg-open");
    let mut child = command
        .arg(path)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(error)?;
    // xdg-open can wait for a running editor. A successful spawn is a request,
    // not proof that a GUI appeared. Surface immediate association failures and
    // reap a long-running launcher without blocking the UI indefinitely.
    for _ in 0..10 {
        match child.try_wait().map_err(error)? {
            Some(status) if status.success() => return Ok(()),
            Some(status) => return Err(error(format!("系统打开 CSS 失败：{status}"))),
            None => std::thread::sleep(std::time::Duration::from_millis(20)),
        }
    }
    std::thread::spawn(move || {
        let _ = child.wait();
    });
    Ok(())
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::os::unix::{ffi::OsStrExt, fs::symlink};
    #[test]
    fn selected_source_rejects_symlink_ancestor_special_and_wrong_extension() {
        let root = std::env::temp_dir().join(format!(
            "milkup-theme-wrapper-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir(&root).unwrap();
        let source = root.join("真实 空格 &.css");
        std::fs::write(&source, "p { color: red; }").unwrap();
        assert!(read_candidate(&source).is_ok());
        let link = root.join("linked.css");
        symlink(&source, &link).unwrap();
        assert!(read_candidate(&link).is_err());
        let dirlink = root.join("dirlink");
        symlink(&root, &dirlink).unwrap();
        assert!(read_candidate(&dirlink.join("真实 空格 &.css")).is_err());
        let wrong = root.join("wrong.css.exe");
        std::fs::write(&wrong, "css").unwrap();
        assert!(read_candidate(&wrong).is_err());
        let fifo = root.join("fifo.css");
        let name = std::ffi::CString::new(fifo.as_os_str().as_bytes()).unwrap();
        assert_eq!(unsafe { libc::mkfifo(name.as_ptr(), 0o600) }, 0);
        assert!(read_candidate(&fifo).is_err());
        std::fs::remove_dir_all(&root).unwrap();
    }
}
