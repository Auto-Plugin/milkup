use std::collections::hash_map::DefaultHasher;
use std::collections::HashMap;
use std::fs;
use std::hash::{Hash, Hasher};
use std::io::{Read, Write};
#[cfg(test)]
use std::io::{Seek, SeekFrom};
#[cfg(all(unix, test))]
use std::os::unix::fs::PermissionsExt;
#[cfg(windows)]
use std::os::windows::ffi::OsStrExt;
#[cfg(test)]
use std::path::Component;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State, Window};

mod native_search;
pub mod output;
mod piece_tree;
mod plugin_catalog;
pub mod plugin_dom;
mod plugin_icon;
mod plugin_sidecar;
use plugin_sidecar::{SidecarEvent, SidecarRegistry, SidecarStarted};
mod recovery;
mod recovery_storage;
mod resources;
mod updates;
#[cfg(windows)]
mod windows_process;
mod workspace;
use piece_tree::PieceTree;

const FILE_WATCH_EVENT_NAME: &str = "milkup-file-watch-event";
const PLUGIN_SIDECAR_EVENT_NAME: &str = "milkup-plugin-sidecar-message";
const LARGE_FILE_WORKING_TEMP_MARKER: &str = "milkup-large";
#[cfg(windows)]
const MOVEFILE_REPLACE_EXISTING: u32 = 0x1;
#[cfg(windows)]
const MOVEFILE_WRITE_THROUGH: u32 = 0x8;

#[cfg(windows)]
#[link(name = "kernel32")]
extern "system" {
    fn MoveFileExW(
        lp_existing_file_name: *const u16,
        lp_new_file_name: *const u16,
        dw_flags: u32,
    ) -> i32;
}

struct WatchRegistry(Mutex<HashMap<String, WatchRegistration>>);
struct LargeFileRegistry(Mutex<HashMap<String, LargeFileRegistration>>);

struct WatchRegistration {
    stop: Arc<AtomicBool>,
}

struct LargeFileRegistration {
    path: String,
    size_bytes: usize,
    piece_tree: PieceTree,
    disk_snapshot_hash: String,
    version: usize,
    saved_version: usize,
}

impl Drop for LargeFileRegistry {
    fn drop(&mut self) {
        if let Ok(stores) = self.0.get_mut() {
            stores.clear();
        }
    }
}

#[tauri::command]
fn bridge_status() -> &'static str {
    "ok"
}

#[tauri::command]
fn window_control(window: Window, action: String) -> Result<bool, String> {
    match action.as_str() {
        "minimize" => window.minimize().map_err(|error| error.to_string())?,
        "maximize" => {
            if window.is_maximized().map_err(|error| error.to_string())? {
                window.unmaximize().map_err(|error| error.to_string())?;
            } else {
                window.maximize().map_err(|error| error.to_string())?;
            }
        }
        "close" => window.close().map_err(|error| error.to_string())?,
        _ => return Err(format!("Unknown window control action: {action}")),
    }

    Ok(true)
}

#[tauri::command]
fn initial_open_file_path() -> Option<String> {
    std::env::args_os()
        .skip(1)
        .map(PathBuf::from)
        .find(|path| is_supported_markdown_path(path))
        .map(path_to_string)
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DocumentFileIdentity {
    path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct OpenFileResult {
    document_id: String,
    file: DocumentFileIdentity,
    text: String,
    disk_snapshot_hash: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TextFileMetadataResult {
    path: String,
    size_bytes: u64,
    readonly: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SaveFileResult {
    document_id: String,
    file: DocumentFileIdentity,
    disk_snapshot_hash: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct FileWatchEvent {
    kind: FileWatchEventKind,
    document_id: String,
    file: DocumentFileIdentity,
    disk_snapshot_hash: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
enum FileWatchEventKind {
    Modified,
    Deleted,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LargeFileOpenResult {
    document_id: String,
    path: String,
    version: usize,
    size_bytes: usize,
    line_count: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LargeFileChunkResult {
    document_id: String,
    from_byte: usize,
    to_byte: usize,
    from_utf16: usize,
    to_utf16: usize,
    text: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LargeFileLine {
    number: usize,
    from_byte: usize,
    to_byte: usize,
    from_utf16: usize,
    to_utf16: usize,
    text: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LargeFileLineWindowResult {
    document_id: String,
    from_line: usize,
    to_line: usize,
    from_byte: usize,
    to_byte: usize,
    from_utf16: usize,
    to_utf16: usize,
    text: String,
    lines: Vec<LargeFileLine>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LargeFileTextChange {
    from_utf16: usize,
    to_utf16: usize,
    insert: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LargeFileSnapshotResult {
    document_id: String,
    path: String,
    version: usize,
    size_bytes: usize,
    line_count: usize,
}

#[tauri::command]
fn open_markdown_file(path: String) -> Result<OpenFileResult, String> {
    read_markdown_file(format!("file:{}", path), path)
}

#[tauri::command]
fn reload_markdown_file(document_id: String, path: String) -> Result<OpenFileResult, String> {
    read_markdown_file(document_id, path)
}

#[tauri::command]
fn stat_text_file(path: String) -> Result<TextFileMetadataResult, String> {
    let metadata = fs::metadata(&path).map_err(|error| error.to_string())?;

    Ok(TextFileMetadataResult {
        path,
        size_bytes: metadata.len(),
        readonly: metadata.permissions().readonly(),
    })
}

#[tauri::command]
fn save_markdown_file(
    document_id: String,
    path: String,
    text: String,
    expected_disk_snapshot_hash: Option<String>,
    expected_file_path: Option<String>,
) -> Result<SaveFileResult, String> {
    let target = Path::new(&path);
    let same_file = expected_file_path
        .as_deref()
        .map_or(true, |source| same_file_path(Path::new(source), target));
    let expected = if same_file {
        expected_disk_snapshot_hash.as_deref()
    } else {
        None
    };
    write_markdown_atomically(target, expected, |file| {
        file.write_all(text.as_bytes())
            .map_err(|error| error.to_string())
    })?;

    resources::document_write_committed(&document_id, target);
    resources::register_document(&document_id, target);
    Ok(SaveFileResult {
        document_id,
        file: DocumentFileIdentity { path },
        disk_snapshot_hash: snapshot_hash(&text),
    })
}

fn same_file_path(left: &Path, right: &Path) -> bool {
    left == right
        || match (fs::canonicalize(left), fs::canonicalize(right)) {
            (Ok(left), Ok(right)) => left == right,
            _ => false,
        }
}

// Stage bytes beside the destination. Compare again after writing so a delayed
// watcher or an external edit during staging cannot silently replace newer text.
// The final comparison/rename is not an OS-level compare-and-swap against writers
// that ignore our protocol; the remaining inter-process race is documented.
fn write_markdown_atomically(
    path: &Path,
    expected_hash: Option<&str>,
    write: impl FnOnce(&mut fs::File) -> Result<(), String>,
) -> Result<(), String> {
    let target = match fs::canonicalize(path) {
        Ok(target) => target,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => path.to_path_buf(),
        Err(error) => return Err(error.to_string()),
    };
    let read_snapshot = || match fs::read_to_string(&target) {
        Ok(text) => Ok(Some(snapshot_hash(&text))),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.to_string()),
    };
    let initial = read_snapshot()?;
    if expected_hash.is_some() && initial.as_deref() != expected_hash {
        return Err("File changed outside the editor; refusing to overwrite".into());
    }
    let permissions = match fs::metadata(&target) {
        Ok(metadata) => {
            if metadata.permissions().readonly() {
                return Err("File is read-only; save a copy to another path".into());
            }
            Some(metadata.permissions())
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => return Err(error.to_string()),
    };
    let parent = target.parent().unwrap_or_else(|| Path::new("."));
    let name = target
        .file_name()
        .ok_or_else(|| "Invalid save path".to_string())?;
    static NEXT_SAVE: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let (temp_path, mut temp) = loop {
        let sequence = NEXT_SAVE.fetch_add(1, Ordering::Relaxed);
        let candidate = parent.join(format!(
            ".{}.milkup-save.{}.{}.tmp",
            name.to_string_lossy(),
            std::process::id(),
            sequence
        ));
        let mut options = fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        match options.open(&candidate) {
            Ok(file) => break (candidate, file),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error.to_string()),
        }
    };
    let staged = (|| {
        write(&mut temp)?;
        if let Some(permissions) = permissions {
            temp.set_permissions(permissions)
                .map_err(|error| error.to_string())?;
        }
        temp.sync_all().map_err(|error| error.to_string())?;
        if read_snapshot()? != initial {
            return Err(
                "File changed outside the editor during save; refusing to overwrite".into(),
            );
        }
        Ok(())
    })();
    drop(temp);
    let result = staged.and_then(|()| replace_file_atomically(&temp_path, &target));
    result.map_err(|error| save_error_with_cleanup(&temp_path, error))
}

fn save_error_with_cleanup(temp_path: &Path, error: String) -> String {
    match fs::remove_file(temp_path) {
        Ok(()) => error,
        Err(cleanup) if cleanup.kind() == std::io::ErrorKind::NotFound => error,
        Err(cleanup) => format!(
            "{error}; temporary file retained at {} (cleanup failed: {cleanup})",
            temp_path.display()
        ),
    }
}

#[tauri::command]
fn ensure_asset_directory(_path: String) -> Result<bool, String> {
    Err("Legacy path-based asset writes are disabled; use authorized resource transactions".into())
}
#[tauri::command]
fn asset_file_exists(_path: String) -> Result<bool, String> {
    Err("Legacy path-based asset access is disabled".into())
}
#[tauri::command]
fn write_asset_file(_path: String, _data: Vec<u8>) -> Result<bool, String> {
    Err("Legacy path-based asset writes are disabled; use authorized resource transactions".into())
}

#[tauri::command]
fn resolve_plugin_file_path(path: String) -> Result<String, String> {
    resolve_plugin_path(&path).map(path_to_string)
}

#[tauri::command]
fn read_plugin_text_file(path: String) -> Result<String, String> {
    let resolved = resolve_plugin_path(&path)?;
    fs::read_to_string(resolved).map_err(|error| error.to_string())
}

#[tauri::command]
fn write_plugin_text_file(path: String, text: String) -> Result<bool, String> {
    let resolved = resolve_plugin_path(&path)?;

    fs::write(resolved, text).map_err(|error| error.to_string())?;
    Ok(true)
}

#[tauri::command]
fn delete_plugin_file(path: String) -> Result<bool, String> {
    let resolved = resolve_plugin_path(&path)?;

    fs::remove_file(resolved).map_err(|error| error.to_string())?;
    Ok(true)
}

#[tauri::command]
async fn plugin_catalog_read(app: AppHandle) -> Result<serde_json::Value, String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("plugins");
    tauri::async_runtime::spawn_blocking(move || plugin_catalog::read(&root))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn plugin_catalog_prepare(
    app: AppHandle,
    archive: serde_json::Value,
    source_path: String,
    expected_revision: Option<u64>,
) -> Result<serde_json::Value, String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("plugins");
    tauri::async_runtime::spawn_blocking(move || {
        plugin_catalog::prepare(&root, archive, source_path, expected_revision)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn plugin_catalog_transition(
    app: AppHandle,
    plugin_id: String,
    expected_revision: u64,
    action: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("plugins");
    tauri::async_runtime::spawn_blocking(move || {
        plugin_catalog::transition(&root, &plugin_id, expected_revision, action)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn plugin_catalog_migrate(
    app: AppHandle,
    legacy_raw: String,
    validation: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("plugins");
    tauri::async_runtime::spawn_blocking(move || {
        plugin_catalog::migrate(&root, &legacy_raw, validation)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn plugin_catalog_read_worker_module(
    app: AppHandle,
    plugin_id: String,
    generation: String,
) -> Result<String, String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("plugins");
    tauri::async_runtime::spawn_blocking(move || {
        plugin_catalog::read_worker_module(&root, &plugin_id, &generation)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn open_large_text_file(
    registry: State<LargeFileRegistry>,
    document_id: String,
    path: String,
) -> Result<LargeFileOpenResult, String> {
    open_large_text_file_in_registry(&registry.0, document_id, path)
}

fn open_large_text_file_in_registry(
    registry: &Mutex<HashMap<String, LargeFileRegistration>>,
    document_id: String,
    path: String,
) -> Result<LargeFileOpenResult, String> {
    cleanup_large_file_working_temps_for_path(Path::new(&path))?;
    let add_path = large_file_add_buffer_path(Path::new(&path), &document_id)?;
    let piece_tree = PieceTree::open(Path::new(&path), add_path)?;
    let size_bytes = piece_tree.byte_len();
    let disk_snapshot_hash = hash_file_contents(Path::new(&path))?;
    let line_count = piece_tree.line_count();

    {
        let mut stores = registry.lock().map_err(|error| error.to_string())?;
        stores.insert(
            document_id.clone(),
            LargeFileRegistration {
                path: path.clone(),
                size_bytes,
                piece_tree,
                disk_snapshot_hash,
                version: 0,
                saved_version: 0,
            },
        );
    }

    resources::register_document(&document_id, Path::new(&path));
    Ok(LargeFileOpenResult {
        document_id,
        path,
        version: 0,
        size_bytes,
        line_count,
    })
}

#[tauri::command]
fn read_large_text_file_chunk(
    registry: State<LargeFileRegistry>,
    document_id: String,
    from_byte: usize,
    to_byte: usize,
) -> Result<LargeFileChunkResult, String> {
    let mut stores = registry.0.lock().map_err(|error| error.to_string())?;
    let store = stores
        .get_mut(&document_id)
        .ok_or_else(|| format!("Unknown large text file: {document_id}"))?;

    validate_large_file_byte_range(store, from_byte, to_byte)?;
    let text = read_large_text_byte_range(store, from_byte, to_byte)?;

    Ok(LargeFileChunkResult {
        document_id,
        from_byte,
        to_byte,
        from_utf16: byte_to_utf16_offset_in_file(store, from_byte)?,
        to_utf16: byte_to_utf16_offset_in_file(store, to_byte)?,
        text,
    })
}

#[tauri::command]
fn read_large_text_file_line_window(
    registry: State<LargeFileRegistry>,
    document_id: String,
    from_line: usize,
    to_line: usize,
    max_text_length: Option<usize>,
) -> Result<LargeFileLineWindowResult, String> {
    read_bounded_large_line_window(
        &registry.0,
        document_id,
        from_line,
        to_line,
        max_text_length,
    )
}

#[cfg(test)]
fn read_large_text_file_line_window_from_registry(
    registry: &Mutex<HashMap<String, LargeFileRegistration>>,
    document_id: String,
    from_line: usize,
    to_line: usize,
) -> Result<LargeFileLineWindowResult, String> {
    read_bounded_large_line_window(registry, document_id, from_line, to_line, None)
}

fn read_bounded_large_line_window(
    registry: &Mutex<HashMap<String, LargeFileRegistration>>,
    document_id: String,
    from_line: usize,
    to_line: usize,
    max_text_length: Option<usize>,
) -> Result<LargeFileLineWindowResult, String> {
    let mut stores = registry.lock().map_err(|error| error.to_string())?;
    let store = stores
        .get_mut(&document_id)
        .ok_or_else(|| format!("Unknown large text file: {document_id}"))?;
    if let Some(budget) = max_text_length {
        if from_line == 0 || to_line < from_line || to_line > store.piece_tree.line_count() {
            return Err("Invalid line window".to_string());
        }
        let start = store.piece_tree.line_start_byte(from_line)?;
        let end = store.piece_tree.line_content_end_byte(to_line)?;
        // Check indexed coordinates before allocating the requested text or IPC payload.
        let length =
            store.piece_tree.byte_to_utf16(end)? - store.piece_tree.byte_to_utf16(start)?;
        if length > budget {
            return Err("Line window exceeds text budget".to_string());
        }
    }
    let (from_byte, to_byte, lines) = read_large_line_window(store, from_line, to_line)?;
    let from_utf16 = lines
        .first()
        .map(|line| line.from_utf16)
        .unwrap_or_default();
    let to_utf16 = lines.last().map(|line| line.to_utf16).unwrap_or(from_utf16);

    Ok(LargeFileLineWindowResult {
        document_id,
        from_line,
        to_line,
        from_byte,
        to_byte,
        from_utf16,
        to_utf16,
        text: read_large_text_byte_range(store, from_byte, to_byte)?,
        lines,
    })
}

#[tauri::command]
fn apply_large_text_file_changes(
    registry: State<LargeFileRegistry>,
    document_id: String,
    expected_version: usize,
    changes: Vec<LargeFileTextChange>,
) -> Result<LargeFileSnapshotResult, String> {
    apply_large_text_file_changes_in_registry(&registry.0, document_id, expected_version, changes)
}

fn apply_large_text_file_changes_in_registry(
    registry: &Mutex<HashMap<String, LargeFileRegistration>>,
    document_id: String,
    expected_version: usize,
    changes: Vec<LargeFileTextChange>,
) -> Result<LargeFileSnapshotResult, String> {
    let mut stores = registry.lock().map_err(|error| error.to_string())?;
    let store = stores
        .get_mut(&document_id)
        .ok_or_else(|| format!("Unknown large text file: {document_id}"))?;

    if store.version != expected_version {
        return Err(format!(
            "Large text file version mismatch: expected {expected_version}, current {}",
            store.version
        ));
    }

    if !changes.is_empty() {
        let batch = changes
            .into_iter()
            .map(|change| (change.from_utf16, change.to_utf16, change.insert))
            .collect::<Vec<_>>();
        store.piece_tree.apply_batch(&batch)?;
        store.size_bytes = store.piece_tree.byte_len();
        store.version += 1;
    }

    Ok(large_file_snapshot(&document_id, store))
}

#[tauri::command]
fn flush_large_text_file(
    registry: State<LargeFileRegistry>,
    document_id: String,
    expected_version: usize,
) -> Result<LargeFileSnapshotResult, String> {
    flush_large_text_file_in_registry(&registry.0, document_id, expected_version)
}

fn flush_large_text_file_in_registry(
    registry: &Mutex<HashMap<String, LargeFileRegistration>>,
    document_id: String,
    expected_version: usize,
) -> Result<LargeFileSnapshotResult, String> {
    let mut stores = registry.lock().map_err(|error| error.to_string())?;
    let store = stores
        .get_mut(&document_id)
        .ok_or_else(|| format!("Unknown large text file: {document_id}"))?;

    if store.version != expected_version {
        return Err(format!(
            "Large text file version mismatch: expected {expected_version}, current {}",
            store.version
        ));
    }

    if store.version != store.saved_version {
        let current_disk_hash = hash_file_contents(Path::new(&store.path))?;

        if current_disk_hash != store.disk_snapshot_hash {
            return Err(
                "Large text file changed outside the editor; refusing to overwrite".to_string(),
            );
        }

        let temp_path =
            large_file_save_as_temp_path(Path::new(&store.path), &document_id, store.version)?;
        if let Err(error) = store.piece_tree.write_to(&temp_path) {
            let _ = fs::remove_file(&temp_path);
            return Err(error);
        }
        store.piece_tree.release_base_handle();
        if let Err(error) = replace_file_with_temp(
            &temp_path,
            Path::new(&store.path),
            Some(&store.disk_snapshot_hash),
        ) {
            let _ = store.piece_tree.restore_base_handle();
            let _ = fs::remove_file(&temp_path);
            return Err(error);
        }
        store.piece_tree.rebase(Path::new(&store.path))?;
        store.size_bytes = store.piece_tree.byte_len();
        store.disk_snapshot_hash = hash_file_contents(Path::new(&store.path))?;
        store.saved_version = store.version;
    }

    Ok(large_file_snapshot(&document_id, store))
}

#[tauri::command]
fn flush_large_text_file_as(
    registry: State<LargeFileRegistry>,
    document_id: String,
    expected_version: usize,
    path: String,
) -> Result<LargeFileSnapshotResult, String> {
    flush_large_text_file_as_in_registry(&registry.0, document_id, expected_version, path)
}

fn flush_large_text_file_as_in_registry(
    registry: &Mutex<HashMap<String, LargeFileRegistration>>,
    document_id: String,
    expected_version: usize,
    path: String,
) -> Result<LargeFileSnapshotResult, String> {
    let mut stores = registry.lock().map_err(|error| error.to_string())?;
    let store = stores
        .get_mut(&document_id)
        .ok_or_else(|| format!("Unknown large text file: {document_id}"))?;

    if store.version != expected_version {
        return Err(format!(
            "Large text file version mismatch: expected {expected_version}, current {}",
            store.version
        ));
    }

    let target_path = PathBuf::from(&path);
    if same_file_path(&target_path, Path::new(&store.path)) {
        if store.version != store.saved_version {
            let current_disk_hash = hash_file_contents(Path::new(&store.path))?;

            if current_disk_hash != store.disk_snapshot_hash {
                return Err(
                    "Large text file changed outside the editor; refusing to overwrite".to_string(),
                );
            }

            let temp_path =
                large_file_save_as_temp_path(Path::new(&store.path), &document_id, store.version)?;
            if let Err(error) = store.piece_tree.write_to(&temp_path) {
                let _ = fs::remove_file(&temp_path);
                return Err(error);
            }
            store.piece_tree.release_base_handle();
            if let Err(error) = replace_file_with_temp(
                &temp_path,
                Path::new(&store.path),
                Some(&store.disk_snapshot_hash),
            ) {
                let _ = store.piece_tree.restore_base_handle();
                let _ = fs::remove_file(&temp_path);
                return Err(error);
            }
            finish_large_save_after_rename(store, &document_id, &target_path)?;
        }

        return Ok(large_file_snapshot(&document_id, store));
    }

    let target_hash = optional_file_hash(&target_path)?;
    let temp_path = large_file_save_as_temp_path(&target_path, &document_id, store.version)?;

    if let Err(error) = store.piece_tree.write_to(&temp_path) {
        let _ = fs::remove_file(&temp_path);
        return Err(error);
    }
    if let Err(error) = replace_file_with_temp(&temp_path, &target_path, target_hash.as_deref()) {
        let _ = fs::remove_file(&temp_path);
        return Err(error);
    }

    finish_large_save_after_rename(store, &document_id, &target_path)?;

    Ok(large_file_snapshot(&document_id, store))
}

#[cfg(test)]
thread_local! {
    static FAIL_LARGE_SAVE_AFTER_RENAME: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
}
fn finish_large_save_after_rename(
    store: &mut LargeFileRegistration,
    document_id: &str,
    target: &Path,
) -> Result<(), String> {
    resources::document_write_committed(document_id, target);
    let completed = (|| {
        #[cfg(test)]
        if FAIL_LARGE_SAVE_AFTER_RENAME.with(|value| value.replace(false)) {
            return Err("Injected post-rename indexing failure".to_string());
        }
        let disk_snapshot_hash = hash_file_contents(target)?;
        store.piece_tree.rebase(target)?;
        store.path = path_to_string(target.to_owned());
        store.size_bytes = store.piece_tree.byte_len();
        store.disk_snapshot_hash = disk_snapshot_hash;
        store.saved_version = store.version;
        resources::register_document(document_id, target);
        Ok(())
    })();
    completed.map_err(|error: String| format!("Document was written to {} and its image resources were retained, but editor refresh failed: {error}. Reopen the saved file to continue.", target.display()))
}

#[tauri::command]
fn close_large_text_file(
    registry: State<LargeFileRegistry>,
    searches: State<native_search::NativeSearchRegistry>,
    document_id: String,
) -> Result<bool, String> {
    let mut stores = registry.0.lock().map_err(|error| error.to_string())?;

    let Some(store) = stores.get_mut(&document_id) else {
        return Ok(true);
    };
    store.piece_tree.close()?;
    stores.remove(&document_id);
    native_search::close_document(&searches, &document_id);
    Ok(true)
}

#[tauri::command]
fn start_plugin_sidecar_process(
    app: AppHandle,
    registry: State<SidecarRegistry>,
    plugin_id: String,
    executable: String,
    args: Vec<String>,
    module_specifier: Option<String>,
) -> Result<SidecarStarted, String> {
    let mut command = Command::new(validate_sidecar_executable(&executable)?);
    command.args(args).env("MILKUP_PLUGIN_ID", &plugin_id);
    if let Some(module_specifier) = module_specifier {
        command.env("MILKUP_PLUGIN_MODULE_SPECIFIER", module_specifier);
    }
    registry.start(
        plugin_id,
        command,
        Arc::new(move |event: SidecarEvent| {
            let _ = app.emit(PLUGIN_SIDECAR_EVENT_NAME, event);
        }),
    )
}

#[tauri::command]
async fn send_plugin_sidecar_message(
    registry: State<'_, SidecarRegistry>,
    plugin_id: String,
    instance_id: String,
    message: serde_json::Value,
) -> Result<bool, String> {
    registry.send(&plugin_id, &instance_id, message).await?;
    Ok(true)
}

#[tauri::command]
fn stop_plugin_sidecar_process(
    registry: State<SidecarRegistry>,
    plugin_id: String,
    instance_id: String,
) -> Result<bool, String> {
    registry.stop(&plugin_id, &instance_id)?;
    Ok(true)
}

#[tauri::command]
fn reveal_in_folder(_document_id: String, path: String) -> Result<bool, String> {
    let target = Path::new(&path)
        .parent()
        .ok_or_else(|| "Cannot reveal a path without a parent directory".to_string())?;

    if std::env::var_os("MILKUP_DESKTOP_TEST_SKIP_REVEAL").is_some() {
        return Ok(true);
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(target)
            .spawn()
            .map_err(|error| error.to_string())?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(target)
            .spawn()
            .map_err(|error| error.to_string())?;
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(target)
            .spawn()
            .map_err(|error| error.to_string())?;
    }

    Ok(true)
}

#[tauri::command]
fn watch_markdown_file(
    app: AppHandle,
    registry: State<WatchRegistry>,
    document_id: String,
    path: String,
    disk_snapshot_hash: Option<String>,
) -> Result<bool, String> {
    let stop = Arc::new(AtomicBool::new(false));
    let previous = {
        let mut watchers = registry.0.lock().map_err(|error| error.to_string())?;
        watchers.insert(
            document_id.clone(),
            WatchRegistration { stop: stop.clone() },
        )
    };

    if let Some(previous) = previous {
        previous.stop.store(true, Ordering::Relaxed);
    }

    let watched_document_id = document_id.clone();
    let watched_path = path.clone();

    thread::spawn(move || {
        poll_watched_file(
            app,
            watched_document_id,
            watched_path,
            disk_snapshot_hash,
            stop,
        );
    });

    Ok(true)
}

#[tauri::command]
fn unwatch_markdown_file(
    registry: State<WatchRegistry>,
    document_id: String,
) -> Result<bool, String> {
    let previous = {
        let mut watchers = registry.0.lock().map_err(|error| error.to_string())?;
        watchers.remove(&document_id)
    };

    if let Some(previous) = previous {
        previous.stop.store(true, Ordering::Relaxed);
    }

    Ok(true)
}

pub fn run() {
    tauri::Builder::default()
        .manage(WatchRegistry(Mutex::new(HashMap::new())))
        .manage(SidecarRegistry::default())
        .manage(plugin_dom::DomRegistry::default())
        .manage(LargeFileRegistry(Mutex::new(HashMap::new())))
        .manage(native_search::NativeSearchRegistry::default())
        .manage(updates::UpdateService::default())
        .manage(workspace::WorkspaceRegistry::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            app.manage(recovery::RecoveryStore::new(
                app.path().app_data_dir()?.join("recovery-v1"),
            ));
            let temp_dir = std::env::temp_dir();
            thread::spawn(move || {
                let _ = cleanup_large_file_working_temps_in_dir(&temp_dir);
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            workspace::workspace_create_scope,
            workspace::workspace_choose_root,
            workspace::workspace_list_children,
            workspace::workspace_resolve_entry,
            workspace::workspace_refresh_root,
            workspace::workspace_cancel_cursor,
            workspace::workspace_release_root,
            workspace::workspace_release_scope,
            workspace::workspace_prepare_open,
            workspace::workspace_read_file,
            workspace::workspace_open_large_file,
            workspace::workspace_validate_open,
            workspace::workspace_finish_open,
            updates::begin_application_update_check,
            updates::cancel_application_update_check,
            updates::check_application_update,
            updates::download_application_update,
            updates::cancel_application_update,
            updates::install_application_update,
            recovery::list_recovery_records,
            recovery::checkpoint_recovery,
            recovery::settle_recovery,
            recovery::materialize_recovery,
            recovery::resources_restore_recovery,
            recovery::archive_recovery,
            bridge_status,
            window_control,
            initial_open_file_path,
            stat_text_file,
            open_markdown_file,
            reload_markdown_file,
            save_markdown_file,
            resources::resources_read_document_chunk,
            resources::resources_choose_image,
            resources::resources_grant_clipboard,
            resources::resources_stage_image,
            resources::resources_validate_assets,
            resources::resources_accept,
            resources::resources_abort,
            resources::resources_resolve_image,
            resources::resources_choose_save_target,
            output::output_prepare,
            output::output_choose_target,
            output::output_write_html,
            output::output_write_pdf,
            output::output_print,
            output::output_abort,
            resources::resources_prepare_relocation,
            resources::resources_commit_relocation,
            resources::resources_release_document,
            resources::resources_release_source,
            ensure_asset_directory,
            asset_file_exists,
            write_asset_file,
            resolve_plugin_file_path,
            read_plugin_text_file,
            plugin_icon::read_plugin_icon,
            write_plugin_text_file,
            delete_plugin_file,
            plugin_catalog_read,
            plugin_catalog_prepare,
            plugin_catalog_transition,
            plugin_catalog_migrate,
            plugin_catalog_read_worker_module,
            native_search::begin_large_text_search,
            native_search::step_large_text_search,
            native_search::append_large_text_search_matches,
            native_search::page_large_text_search,
            native_search::cancel_large_text_search,
            native_search::begin_large_text_replacement,
            native_search::step_large_text_replacement,
            native_search::commit_large_text_replacement,
            native_search::cancel_large_text_replacement,
            native_search::restore_large_text_history,
            open_large_text_file,
            read_large_text_file_chunk,
            read_large_text_file_line_window,
            apply_large_text_file_changes,
            flush_large_text_file,
            flush_large_text_file_as,
            close_large_text_file,
            plugin_dom::prepare_plugin_dom_module,
            plugin_dom::release_plugin_dom_module,
            plugin_dom::start_plugin_dom_process,
            plugin_dom::send_plugin_dom_message,
            plugin_dom::stop_plugin_dom_process,
            start_plugin_sidecar_process,
            send_plugin_sidecar_message,
            stop_plugin_sidecar_process,
            reveal_in_folder,
            watch_markdown_file,
            unwatch_markdown_file
        ])
        .build(tauri::generate_context!())
        .expect("failed to build milkup desktop app")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                app.state::<plugin_dom::DomRegistry>().stop_all();
            }
        });
}

fn snapshot_hash(text: &str) -> String {
    let mut hasher = DefaultHasher::new();
    text.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

fn hash_file_contents(path: &Path) -> Result<String, String> {
    let mut file = fs::File::open(path).map_err(|error| error.to_string())?;
    hash_open_file_contents(&mut file)
}

fn hash_open_file_contents(file: &mut fs::File) -> Result<String, String> {
    hash_open_file_contents_with_progress(file, || Ok(()))
}

fn hash_open_file_contents_with_progress(
    file: &mut fs::File,
    mut progress: impl FnMut() -> Result<(), String>,
) -> Result<String, String> {
    let mut hasher = DefaultHasher::new();
    let mut buffer = [0_u8; 64 * 1024];

    loop {
        progress()?;
        let read = file.read(&mut buffer).map_err(|error| error.to_string())?;

        if read == 0 {
            break;
        }

        buffer[..read].hash(&mut hasher);
    }

    Ok(format!("{:016x}", hasher.finish()))
}

fn read_markdown_file(document_id: String, path: String) -> Result<OpenFileResult, String> {
    let text = fs::read_to_string(&path).map_err(|error| error.to_string())?;

    resources::register_document(&document_id, Path::new(&path));
    Ok(OpenFileResult {
        document_id,
        file: DocumentFileIdentity { path },
        disk_snapshot_hash: snapshot_hash(&text),
        text,
    })
}

fn is_supported_markdown_path(path: &Path) -> bool {
    if !path.is_file() {
        return false;
    }

    let Some(extension) = path.extension().and_then(|extension| extension.to_str()) else {
        return false;
    };

    matches!(
        extension.to_ascii_lowercase().as_str(),
        "md" | "markdown" | "mdown" | "mkd"
    )
}

fn poll_watched_file(
    app: AppHandle,
    document_id: String,
    path: String,
    disk_snapshot_hash: Option<String>,
    stop: Arc<AtomicBool>,
) {
    let mut last_snapshot_hash = disk_snapshot_hash.or_else(|| read_snapshot_hash(&path).ok());
    let mut was_deleted = !Path::new(&path).exists();

    while !stop.load(Ordering::Relaxed) {
        thread::sleep(Duration::from_millis(1000));

        if stop.load(Ordering::Relaxed) {
            break;
        }

        let exists = Path::new(&path).exists();

        if !exists {
            if !was_deleted {
                was_deleted = true;
                emit_file_watch_event(
                    &app,
                    FileWatchEvent {
                        kind: FileWatchEventKind::Deleted,
                        document_id: document_id.clone(),
                        file: DocumentFileIdentity { path: path.clone() },
                        disk_snapshot_hash: None,
                    },
                );
            }

            continue;
        }

        was_deleted = false;

        let next_snapshot_hash = match read_snapshot_hash(&path) {
            Ok(hash) => hash,
            Err(_) => continue,
        };

        if last_snapshot_hash.as_deref() != Some(next_snapshot_hash.as_str()) {
            last_snapshot_hash = Some(next_snapshot_hash.clone());
            emit_file_watch_event(
                &app,
                FileWatchEvent {
                    kind: FileWatchEventKind::Modified,
                    document_id: document_id.clone(),
                    file: DocumentFileIdentity { path: path.clone() },
                    disk_snapshot_hash: Some(next_snapshot_hash),
                },
            );
        }
    }
}

fn read_snapshot_hash(path: &str) -> Result<String, String> {
    let text = fs::read_to_string(path).map_err(|error| error.to_string())?;
    Ok(snapshot_hash(&text))
}

fn resolve_plugin_path(path: &str) -> Result<PathBuf, String> {
    let candidate = PathBuf::from(path);

    if candidate.exists() {
        return candidate.canonicalize().map_err(|error| error.to_string());
    }

    let parent = candidate
        .parent()
        .ok_or_else(|| "Plugin file path must have a parent directory".to_string())?;
    let file_name = candidate
        .file_name()
        .ok_or_else(|| "Plugin file path must have a file name".to_string())?;
    let resolved_parent = parent.canonicalize().map_err(|error| error.to_string())?;

    Ok(resolved_parent.join(file_name))
}

fn validate_plugin_id(plugin_id: &str) -> Result<(), String> {
    if plugin_id.is_empty()
        || plugin_id.len() > 128
        || !plugin_id
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-'))
    {
        return Err("Plugin id contains invalid path characters".to_string());
    }
    Ok(())
}

#[cfg(test)]
fn validate_plugin_relative_path(path: &str) -> Result<PathBuf, String> {
    let candidate = Path::new(path);

    if candidate.as_os_str().is_empty() || candidate.is_absolute() {
        return Err("Plugin package path must be relative".to_string());
    }

    if candidate
        .components()
        .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err("Plugin package path must stay inside the package root".to_string());
    }

    Ok(candidate.to_path_buf())
}

fn path_to_string(path: PathBuf) -> String {
    path.to_string_lossy()
        .trim_start_matches(r"\\?\")
        .replace('\\', "/")
}

fn emit_file_watch_event(app: &AppHandle, event: FileWatchEvent) {
    let _ = app.emit(FILE_WATCH_EVENT_NAME, event);
}

fn validate_sidecar_executable(path: &str) -> Result<PathBuf, String> {
    if path.trim().is_empty() {
        return Err("Plugin sidecar executable path must be non-empty".to_string());
    }

    let executable = PathBuf::from(path);

    if !executable.is_absolute() {
        return Err("Plugin sidecar executable path must be absolute".to_string());
    }

    Ok(executable)
}

#[cfg(test)]
fn validate_byte_range(text: &str, from_byte: usize, to_byte: usize) -> Result<(), String> {
    if from_byte > to_byte || to_byte > text.len() {
        return Err(format!(
            "Invalid byte range: {from_byte}-{to_byte} for {} bytes",
            text.len()
        ));
    }

    if !text.is_char_boundary(from_byte) || !text.is_char_boundary(to_byte) {
        return Err(format!(
            "Byte range must align to UTF-8 character boundaries: {from_byte}-{to_byte}"
        ));
    }

    Ok(())
}

fn validate_large_file_byte_range(
    store: &LargeFileRegistration,
    from_byte: usize,
    to_byte: usize,
) -> Result<(), String> {
    if from_byte > to_byte || to_byte > store.size_bytes {
        return Err(format!(
            "Invalid byte range: {from_byte}-{to_byte} for {} bytes",
            store.size_bytes
        ));
    }

    Ok(())
}

#[cfg(test)]
fn read_text_byte_range(path: &Path, from_byte: usize, to_byte: usize) -> Result<String, String> {
    if to_byte < from_byte {
        return Err(format!("Invalid byte range: {from_byte}-{to_byte}"));
    }

    let mut file = fs::File::open(path).map_err(|error| error.to_string())?;
    file.seek(SeekFrom::Start(from_byte as u64))
        .map_err(|error| error.to_string())?;
    let mut bytes = vec![0; to_byte - from_byte];
    file.read_exact(&mut bytes)
        .map_err(|error| error.to_string())?;
    String::from_utf8(bytes).map_err(|error| error.to_string())
}

fn read_large_text_byte_range(
    store: &mut LargeFileRegistration,
    from_byte: usize,
    to_byte: usize,
) -> Result<String, String> {
    validate_large_file_byte_range(store, from_byte, to_byte)?;
    store.piece_tree.read_range(from_byte, to_byte)
}

#[cfg(test)]
fn byte_to_utf16_offset(text: &str, byte_offset: usize) -> Result<usize, String> {
    validate_byte_range(text, byte_offset, byte_offset)?;

    Ok(text[..byte_offset].encode_utf16().count())
}

fn byte_to_utf16_offset_in_file(
    store: &mut LargeFileRegistration,
    byte_offset: usize,
) -> Result<usize, String> {
    validate_large_file_byte_range(store, byte_offset, byte_offset)?;

    store.piece_tree.byte_to_utf16(byte_offset)
}

#[cfg(test)]
fn utf16_to_byte_offset(text: &str, utf16_offset: usize) -> Result<usize, String> {
    let mut current_utf16 = 0;

    for (byte_offset, character) in text.char_indices() {
        if current_utf16 == utf16_offset {
            return Ok(byte_offset);
        }

        let next_utf16 = current_utf16 + character.len_utf16();

        if utf16_offset < next_utf16 {
            return Err(format!(
                "UTF-16 offset {utf16_offset} does not align to a Unicode scalar boundary"
            ));
        }

        current_utf16 = next_utf16;
    }

    if current_utf16 == utf16_offset {
        Ok(text.len())
    } else {
        Err(format!(
            "UTF-16 offset {utf16_offset} exceeds document length {current_utf16}"
        ))
    }
}

#[cfg(test)]
fn apply_large_text_changes(text: &str, changes: &[LargeFileTextChange]) -> Result<String, String> {
    let mut resolved_changes = changes
        .iter()
        .map(|change| {
            if change.from_utf16 > change.to_utf16 {
                return Err(format!(
                    "Invalid UTF-16 change range: {}-{}",
                    change.from_utf16, change.to_utf16
                ));
            }

            Ok((
                utf16_to_byte_offset(text, change.from_utf16)?,
                utf16_to_byte_offset(text, change.to_utf16)?,
                change.insert.as_str(),
            ))
        })
        .collect::<Result<Vec<_>, String>>()?;

    resolved_changes.sort_by_key(|(from_byte, to_byte, _insert)| (*from_byte, *to_byte));

    let mut next_text = String::with_capacity(text.len());
    let mut cursor = 0;

    for (from_byte, to_byte, insert) in resolved_changes {
        if from_byte < cursor {
            return Err("Large text file changes must not overlap".to_string());
        }

        next_text.push_str(&text[cursor..from_byte]);
        next_text.push_str(insert);
        cursor = to_byte;
    }

    next_text.push_str(&text[cursor..]);
    Ok(next_text)
}

fn large_file_save_as_temp_path(
    path: &Path,
    document_id: &str,
    version: usize,
) -> Result<PathBuf, String> {
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| format!("Invalid file path: {}", path.display()))?;
    let safe_document_id = document_id
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character
            } else {
                '-'
            }
        })
        .collect::<String>();
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_millis();

    Ok(parent.join(format!(
        ".{file_name}.{LARGE_FILE_WORKING_TEMP_MARKER}.{}.{}.v{version}.{nonce}.save-as.tmp",
        std::process::id(),
        safe_document_id
    )))
}

fn large_file_add_buffer_path(path: &Path, document_id: &str) -> Result<PathBuf, String> {
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| format!("Invalid file path: {}", path.display()))?;
    let safe_document_id = document_id
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character
            } else {
                '-'
            }
        })
        .collect::<String>();
    // Reopening the same document ID must never truncate a generation still
    // leased by a recovery writer (or an unknown buffer from an earlier process).
    static NEXT_ADD: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
    let sequence = NEXT_ADD.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_nanos();
    Ok(parent.join(format!(
        ".{file_name}.{LARGE_FILE_WORKING_TEMP_MARKER}.{}.{safe_document_id}.{nonce}.{sequence}.add.work",
        std::process::id()
    )))
}

fn cleanup_large_file_working_temps_for_path(path: &Path) -> Result<usize, String> {
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| format!("Invalid file path: {}", path.display()))?;

    cleanup_large_file_working_temps_by_prefix(parent, &format!(".{file_name}."))
}

fn cleanup_large_file_working_temps_in_dir(dir: &Path) -> Result<usize, String> {
    cleanup_large_file_working_temps_by_prefix(dir, ".")
}

fn cleanup_large_file_working_temps_by_prefix(_dir: &Path, _prefix: &str) -> Result<usize, String> {
    // A dead PID does not prove the buffers are expendable. Legacy add/work and
    // save staging files have no durable reconstruction manifest: preserve them.
    // Live-session cleanup remains owned by PieceTree::close/Drop only.
    Ok(0)
}

fn large_file_snapshot(
    document_id: &str,
    store: &LargeFileRegistration,
) -> LargeFileSnapshotResult {
    LargeFileSnapshotResult {
        document_id: document_id.to_string(),
        path: store.path.clone(),
        version: store.version,
        size_bytes: store.size_bytes,
        line_count: store.piece_tree.line_count(),
    }
}

#[cfg(test)]
fn write_large_file_atomically(path: &Path, text: &str) -> Result<(), String> {
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| format!("Invalid file path: {}", path.display()))?;
    let temp_path = parent.join(format!(".{file_name}.{}.tmp", std::process::id()));

    {
        let mut temp_file = fs::File::create(&temp_path).map_err(|error| error.to_string())?;
        temp_file
            .write_all(text.as_bytes())
            .map_err(|error| error.to_string())?;
        temp_file.sync_all().map_err(|error| error.to_string())?;
    }

    if let Err(error) = replace_file_atomically(&temp_path, path) {
        let _ = fs::remove_file(&temp_path);
        return Err(error);
    }

    Ok(())
}

fn optional_file_hash(path: &Path) -> Result<Option<String>, String> {
    match fs::metadata(path) {
        Ok(_) => hash_file_contents(path).map(Some),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

fn replace_file_with_temp(
    temp_path: &Path,
    path: &Path,
    expected_hash: Option<&str>,
) -> Result<(), String> {
    let result = (|| {
        let target = match fs::canonicalize(path) {
            Ok(target) => target,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => path.to_path_buf(),
            Err(error) => return Err(error.to_string()),
        };
        match fs::metadata(&target) {
            Ok(metadata) => {
                if metadata.permissions().readonly() {
                    return Err("File is read-only; save a copy to another path".into());
                }
                fs::set_permissions(temp_path, metadata.permissions())
                    .map_err(|error| error.to_string())?;
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.to_string()),
        }
        if optional_file_hash(&target)?.as_deref() != expected_hash {
            return Err(
                "Large text file changed outside the editor during save; refusing to overwrite"
                    .into(),
            );
        }
        replace_file_atomically(temp_path, &target)
    })();
    if let Err(error) = result {
        return Err(save_error_with_cleanup(temp_path, error));
    }

    Ok(())
}

#[cfg(windows)]
fn replace_file_atomically(from: &Path, to: &Path) -> Result<(), String> {
    let from_wide = wide_path(from);
    let to_wide = wide_path(to);

    for attempt in 0..4 {
        let result = unsafe {
            MoveFileExW(
                from_wide.as_ptr(),
                to_wide.as_ptr(),
                MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
            )
        };

        if result != 0 {
            return Ok(());
        }

        let error = std::io::Error::last_os_error();
        if attempt == 3
            || !matches!(
                error.kind(),
                std::io::ErrorKind::PermissionDenied | std::io::ErrorKind::WouldBlock
            )
        {
            return Err(error.to_string());
        }

        thread::sleep(Duration::from_millis(50 * (attempt + 1)));
    }

    unreachable!()
}

#[cfg(windows)]
fn wide_path(path: &Path) -> Vec<u16> {
    path.as_os_str().encode_wide().chain(Some(0)).collect()
}

#[cfg(not(windows))]
fn replace_file_atomically(from: &Path, to: &Path) -> Result<(), String> {
    fs::rename(from, to).map_err(|error| error.to_string())
}

fn read_large_line_window(
    store: &mut LargeFileRegistration,
    from_line: usize,
    to_line: usize,
) -> Result<(usize, usize, Vec<LargeFileLine>), String> {
    let line_count = store.piece_tree.line_count();
    if from_line == 0 || to_line < from_line || to_line > line_count {
        return Err(format!(
            "Invalid line window: {from_line}-{to_line} for {} lines",
            line_count
        ));
    }

    let from_byte = store.piece_tree.line_start_byte(from_line)?;
    let to_byte = line_content_end_byte(store, to_line)?;
    // Resolve tree offsets only at the window boundary. Re-resolving every row
    // reads/scans the same piece prefixes repeatedly, and blocks native IPC.
    let text = read_large_text_byte_range(store, from_byte, to_byte)?;
    let mut byte_offset = from_byte;
    let mut utf16_offset = store.piece_tree.byte_to_utf16(from_byte)?;
    let mut lines = Vec::with_capacity(to_line - from_line + 1);
    for (index, raw_line) in text.split('\n').enumerate() {
        let number = from_line + index;
        // The final line's CR has already been excluded by line_content_end_byte.
        // Intermediate rows still contain their CRLF separator; remove one CR only.
        let content = if number == to_line {
            raw_line
        } else {
            raw_line.strip_suffix('\r').unwrap_or(raw_line)
        };
        let content_utf16_len = content.encode_utf16().count();
        lines.push(LargeFileLine {
            number,
            from_byte: byte_offset,
            to_byte: byte_offset + content.len(),
            from_utf16: utf16_offset,
            to_utf16: utf16_offset + content_utf16_len,
            text: content.to_string(),
        });
        byte_offset += raw_line.len() + 1;
        utf16_offset += raw_line.encode_utf16().count() + 1;
    }

    Ok((from_byte, to_byte, lines))
}

fn line_content_end_byte(
    store: &mut LargeFileRegistration,
    line_number: usize,
) -> Result<usize, String> {
    store.piece_tree.line_content_end_byte(line_number)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn open_and_reload_markdown_files_preserve_document_identity() {
        let dir = create_test_dir("open-reload");
        let path = dir.join("note.md");

        fs::write(&path, "# Title\r\n\r\nbody\r\n").expect("write fixture");

        let opened =
            open_markdown_file(path_to_string(path.clone())).expect("open markdown fixture");
        assert_eq!(
            opened.document_id,
            format!("file:{}", path_to_string(path.clone()))
        );
        assert_eq!(opened.file.path, path_to_string(path.clone()));
        assert_eq!(opened.text, "# Title\r\n\r\nbody\r\n");

        fs::write(&path, "# Title\n\nupdated\n").expect("update fixture");

        let reloaded = reload_markdown_file("doc-1".to_string(), path_to_string(path.clone()))
            .expect("reload markdown fixture");
        assert_eq!(reloaded.document_id, "doc-1");
        assert_eq!(reloaded.file.path, path_to_string(path.clone()));
        assert_eq!(reloaded.text, "# Title\n\nupdated\n");

        release_test_document(&opened.document_id);
        release_test_document(&reloaded.document_id);
        remove_test_dir(dir);
    }

    #[test]
    fn save_markdown_file_writes_text_and_returns_matching_document_id() {
        let dir = create_test_dir("save");
        let path = dir.join("saved.md");
        let text = "alpha\r\nbeta\r\n".to_string();

        let result = save_markdown_file(
            "doc-save".to_string(),
            path_to_string(path.clone()),
            text,
            None,
            None,
        )
        .expect("save markdown file");

        assert_eq!(result.document_id, "doc-save");
        assert_eq!(result.file.path, path_to_string(path.clone()));
        assert_eq!(
            fs::read_to_string(&path).expect("read saved markdown"),
            "alpha\r\nbeta\r\n",
        );

        release_test_document(&result.document_id);
        remove_test_dir(dir);
    }

    #[test]
    fn save_markdown_file_rejects_unobserved_external_changes_and_deletion() {
        let dir = create_test_dir("save-conflict");
        let path = dir.join("note.md");
        fs::write(&path, "original").unwrap();
        let opened = open_markdown_file(path_to_string(path.clone())).unwrap();
        fs::write(&path, "external").unwrap();
        let result = save_markdown_file(
            "doc".into(),
            path_to_string(path.clone()),
            "local".into(),
            Some(opened.disk_snapshot_hash.clone()),
            Some(path_to_string(path.clone())),
        );
        assert!(
            result.is_err(),
            "must reject stale snapshot before watcher notification"
        );
        assert_eq!(fs::read_to_string(&path).unwrap(), "external");
        fs::remove_file(&path).unwrap();
        assert!(save_markdown_file(
            "doc".into(),
            path_to_string(path.clone()),
            "local".into(),
            Some(opened.disk_snapshot_hash),
            Some(path_to_string(path.clone()))
        )
        .is_err());
        assert!(!path.exists());
        release_test_document(&opened.document_id);
        remove_test_dir(dir);
    }

    #[cfg(unix)]
    #[test]
    fn large_file_commit_preserves_mode_and_rejects_readonly_destination() {
        let dir = create_test_dir("large-permissions");
        let path = dir.join("note.md");
        let staged = dir.join("staged.tmp");
        fs::write(&path, "original").unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o640)).unwrap();
        fs::write(&staged, "saved").unwrap();
        replace_file_with_temp(&staged, &path, Some(&hash_file_contents(&path).unwrap())).unwrap();
        assert_eq!(
            fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o640
        );
        fs::set_permissions(&path, fs::Permissions::from_mode(0o444)).unwrap();
        fs::write(&staged, "local").unwrap();
        assert!(
            replace_file_with_temp(&staged, &path, Some(&hash_file_contents(&path).unwrap()))
                .unwrap_err()
                .contains("read-only")
        );
        assert_eq!(fs::read_to_string(&path).unwrap(), "saved");
        assert!(!staged.exists());
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();
        remove_test_dir(dir);
    }

    #[test]
    fn large_file_commit_rechecks_disk_after_staging_and_cleans_failed_temp() {
        let dir = create_test_dir("large-stage-conflict");
        let path = dir.join("note.md");
        let staged = dir.join("staged.tmp");
        fs::write(&path, "original").unwrap();
        let expected = hash_file_contents(&path).unwrap();
        fs::write(&staged, "local staged snapshot").unwrap();
        fs::write(&path, "external during staging").unwrap();
        assert!(replace_file_with_temp(&staged, &path, Some(&expected))
            .unwrap_err()
            .contains("during save"));
        assert!(!staged.exists());
        assert_eq!(
            fs::read_to_string(&path).unwrap(),
            "external during staging"
        );
        remove_test_dir(dir);
    }

    #[test]
    fn atomic_save_preserves_original_and_cleans_temp_after_partial_write_failure() {
        let dir = create_test_dir("save-partial");
        let path = dir.join("note.md");
        fs::write(&path, "original").unwrap();
        let result = write_markdown_atomically(&path, Some(&snapshot_hash("original")), |file| {
            file.write_all(b"partial").unwrap();
            Err("injected disk write failure".into())
        });
        assert!(result.unwrap_err().contains("injected"));
        assert_eq!(fs::read_to_string(&path).unwrap(), "original");
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 1);
        remove_test_dir(dir);
    }

    #[test]
    fn atomic_save_rechecks_external_changes_after_staging() {
        let dir = create_test_dir("save-staging-race");
        let path = dir.join("note.md");
        fs::write(&path, "original").unwrap();
        let result = write_markdown_atomically(&path, Some(&snapshot_hash("original")), |file| {
            file.write_all(b"local").unwrap();
            fs::write(&path, "external while staging").unwrap();
            Ok(())
        });
        assert!(result.unwrap_err().contains("during save"));
        assert_eq!(fs::read_to_string(&path).unwrap(), "external while staging");
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 1);
        remove_test_dir(dir);
    }

    #[test]
    fn atomic_save_does_not_overwrite_new_destination_created_during_staging() {
        let dir = create_test_dir("save-new-race");
        let path = dir.join("new.md");
        assert!(write_markdown_atomically(&path, None, |file| {
            file.write_all(b"local").unwrap();
            fs::write(&path, "external creation").unwrap();
            Ok(())
        })
        .is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), "external creation");
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 1);
        remove_test_dir(dir);
    }

    #[test]
    fn save_as_copy_allows_rescue_but_same_path_preserves_conflict_guard() {
        let dir = create_test_dir("save-copy");
        let path = dir.join("note.md");
        let copy = dir.join("copy.md");
        fs::write(&path, "external").unwrap();
        let save = |target: &Path| {
            save_markdown_file(
                "doc".into(),
                path_to_string(target.to_path_buf()),
                "local".into(),
                Some(snapshot_hash("original")),
                Some(path_to_string(path.clone())),
            )
        };
        assert!(save(&path).is_err());
        save(&copy).unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "external");
        assert_eq!(fs::read_to_string(&copy).unwrap(), "local");
        release_test_document("doc");
        remove_test_dir(dir);
    }

    #[cfg(unix)]
    #[test]
    fn atomic_save_preserves_permissions_symlinks_and_readonly_files() {
        let dir = create_test_dir("save-metadata");
        let path = dir.join("note.md");
        let link = dir.join("link.md");
        fs::write(&path, "original").unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o640)).unwrap();
        std::os::unix::fs::symlink(&path, &link).unwrap();
        save_markdown_file(
            "doc".into(),
            path_to_string(link.clone()),
            "saved".into(),
            Some(snapshot_hash("original")),
            Some(path_to_string(path.clone())),
        )
        .unwrap();
        assert!(fs::symlink_metadata(&link).unwrap().is_symlink());
        assert_eq!(
            fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o640
        );
        assert_eq!(fs::read_to_string(&path).unwrap(), "saved");
        fs::write(&path, "external").unwrap();
        assert!(save_markdown_file(
            "doc".into(),
            path_to_string(link),
            "local".into(),
            Some(snapshot_hash("saved")),
            Some(path_to_string(path.clone()))
        )
        .is_err());
        fs::set_permissions(&path, fs::Permissions::from_mode(0o444)).unwrap();
        assert!(write_markdown_atomically(&path, None, |file| {
            file.write_all(b"local").map_err(|error| error.to_string())
        })
        .unwrap_err()
        .contains("read-only"));
        assert_eq!(fs::read_to_string(&path).unwrap(), "external");
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();
        release_test_document("doc");
        remove_test_dir(dir);
    }

    #[cfg(unix)]
    #[test]
    fn atomic_replace_and_cleanup_permission_failure_preserves_original_and_reports_temp() {
        let dir = create_test_dir("save-cleanup-error");
        let path = dir.join("note.md");
        fs::write(&path, "original").unwrap();
        let result = write_markdown_atomically(&path, None, |file| {
            file.write_all(b"staged").unwrap();
            fs::set_permissions(&dir, fs::Permissions::from_mode(0o500)).unwrap();
            Ok(())
        });
        fs::set_permissions(&dir, fs::Permissions::from_mode(0o700)).unwrap();
        let error = result.unwrap_err();
        assert!(error.contains("temporary file retained"), "{error}");
        assert!(error.contains("cleanup failed"));
        assert_eq!(fs::read_to_string(&path).unwrap(), "original");
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 2);
        remove_test_dir(dir);
    }

    #[cfg(unix)]
    #[test]
    fn stale_cleanup_retains_files_when_unlink_is_denied() {
        let dir = create_test_dir("cleanup-permission");
        let stale = dir.join(".note.md.milkup-large.2147483647.doc.v1.work");
        fs::write(&stale, "stale").unwrap();
        fs::set_permissions(&dir, fs::Permissions::from_mode(0o500)).unwrap();
        let result = cleanup_large_file_working_temps_in_dir(&dir);
        fs::set_permissions(&dir, fs::Permissions::from_mode(0o700)).unwrap();
        assert_eq!(result.unwrap(), 0);
        assert!(stale.exists());
        remove_test_dir(dir);
    }

    #[test]
    fn cleanup_requires_exact_app_filename_shape_and_preserves_unknown_ownership() {
        let dir = create_test_dir("cleanup-shape");
        let keep = [
            ".note.md.work",
            ".note.md.milkup-large.2147483647.doc.notes.work",
            ".note.md.extra.milkup-large.2147483647.doc.v1.work",
            ".note.md.milkup-large.unknown.doc.add.work",
            ".note.md.milkup-large.2147483647.doc.v.save-as.tmp",
            ".note.md..doc.v1.work",
        ];
        for name in keep {
            fs::write(dir.join(name), "keep").unwrap();
        }
        assert_eq!(
            cleanup_large_file_working_temps_for_path(&dir.join("note.md")).unwrap(),
            0
        );
        for name in keep {
            assert!(dir.join(name).exists(), "{name}");
        }
        remove_test_dir(dir);
    }

    #[test]
    fn cleanup_preserves_active_process_working_files() {
        let dir = create_test_dir("cleanup-active");
        let active = dir.join(format!(
            ".note.md.milkup-large.{}.doc.add.work",
            std::process::id()
        ));
        fs::write(&active, "unsaved edits").unwrap();
        assert_eq!(cleanup_large_file_working_temps_in_dir(&dir).unwrap(), 0);
        assert_eq!(fs::read_to_string(&active).unwrap(), "unsaved edits");
        remove_test_dir(dir);
    }

    #[test]
    fn stat_text_file_reports_size_and_readonly_flag() {
        let dir = create_test_dir("stat");
        let path = dir.join("note.md");

        fs::write(&path, "hello").expect("write fixture");

        let result = stat_text_file(path_to_string(path.clone())).expect("stat text file");

        assert_eq!(result.path, path_to_string(path.clone()));
        assert_eq!(result.size_bytes, 5);
        assert!(!result.readonly);

        remove_test_dir(dir);
    }

    #[test]
    fn legacy_asset_commands_cannot_overwrite_arbitrary_existing_files() {
        let dir = create_test_dir("asset-unsafe");
        let asset_path = dir.join("original.png");
        fs::write(&asset_path, [7, 8, 9]).unwrap();
        assert!(write_asset_file(path_to_string(asset_path.clone()), vec![1, 2, 3]).is_err());
        assert_eq!(fs::read(&asset_path).unwrap(), vec![7, 8, 9]);
        assert!(ensure_asset_directory(path_to_string(dir.join("new"))).is_err());
        assert!(asset_file_exists(path_to_string(asset_path)).is_err());
        remove_test_dir(dir);
    }

    #[test]
    fn plugin_file_commands_resolve_and_mutate_canonical_paths() {
        let dir = create_test_dir("plugin-file");
        let path = dir.join("plugin.md");

        fs::write(&path, "plugin").expect("write plugin fixture");

        let resolved =
            resolve_plugin_file_path(path_to_string(path.clone())).expect("resolve plugin path");
        // Windows temp paths may use an 8.3 alias (RUNNER~1); this API promises
        // the canonical path, which expands that alias to the actual name.
        assert_eq!(resolved, path_to_string(fs::canonicalize(&path).unwrap()));
        assert_eq!(
            read_plugin_text_file(path_to_string(path.clone())).expect("read plugin file"),
            "plugin",
        );
        assert!(
            write_plugin_text_file(path_to_string(path.clone()), "updated".to_string())
                .expect("write plugin file")
        );
        assert_eq!(
            fs::read_to_string(&path).expect("read updated plugin file"),
            "updated"
        );
        assert!(delete_plugin_file(path_to_string(path.clone())).expect("delete plugin file"));
        assert!(!path.exists());

        remove_test_dir(dir);
    }

    #[test]
    fn plugin_sidecar_executable_must_be_absolute() {
        assert!(validate_sidecar_executable("").is_err());
        assert!(validate_sidecar_executable("relative-sidecar").is_err());

        let absolute = std::env::temp_dir().join("sidecar.exe");

        assert_eq!(
            validate_sidecar_executable(&path_to_string(absolute.clone()))
                .expect("absolute sidecar executable"),
            absolute
        );
    }

    #[test]
    fn plugin_sidecar_event_uses_camel_case_payload() {
        let event = SidecarEvent {
            plugin_id: "sidecar-tools".to_string(),
            instance_id: "sidecar_1".to_string(),
            kind: "message",
            message: Some(serde_json::json!({ "type": "ready" })),
            request_id: None,
            error: None,
        };

        assert_eq!(
            serde_json::to_value(event).expect("serialize sidecar event"),
            serde_json::json!({
                "pluginId": "sidecar-tools",
                "instanceId": "sidecar_1",
                "kind": "message",
                "message": {
                    "type": "ready"
                }
            })
        );
    }

    #[test]
    fn plugin_package_paths_cannot_escape_the_plugin_root() {
        assert!(validate_plugin_id("example.tools-1").is_ok());
        assert!(validate_plugin_id("../outside").is_err());
        assert_eq!(
            validate_plugin_relative_path("dist/plugin.js").expect("valid package path"),
            PathBuf::from("dist/plugin.js")
        );
        assert!(validate_plugin_relative_path("../outside.exe").is_err());
        assert!(validate_plugin_relative_path("/absolute/plugin.js").is_err());
    }

    #[test]
    fn large_file_line_index_handles_lf_crlf_and_trailing_newline() {
        let dir = create_test_dir("large-line-index");
        let mut store = create_large_file_store(&dir, "large.md", "alpha\r\nbeta\n");

        assert_eq!(store.piece_tree.line_count(), 3);

        let (from_byte, to_byte, lines) =
            read_large_line_window(&mut store, 1, 3).expect("read line window");

        assert_eq!(from_byte, 0);
        assert_eq!(to_byte, 12);
        assert_eq!(
            read_text_byte_range(Path::new(&store.path), from_byte, to_byte)
                .expect("read full window"),
            "alpha\r\nbeta\n"
        );
        assert_eq!(
            lines
                .iter()
                .map(|line| {
                    (
                        line.number,
                        line.from_byte,
                        line.to_byte,
                        line.from_utf16,
                        line.to_utf16,
                        line.text.as_str(),
                    )
                })
                .collect::<Vec<_>>(),
            vec![
                (1, 0, 5, 0, 5, "alpha"),
                (2, 7, 11, 7, 11, "beta"),
                (3, 12, 12, 12, 12, "")
            ]
        );
        remove_test_dir(dir);
    }

    #[test]
    fn line_window_offsets_match_unicode_crlf_and_piece_boundaries_after_edits() {
        let dir = create_test_dir("window-boundaries");
        // Cross both the 64 KiB piece boundary and a CRLF boundary, retaining
        // literal CRs before separators, empty rows and an empty final row.
        let text = format!("{}\r\nA👩🏽‍💻é🇨🇳\r\r\n\r\n尾\n", "x".repeat(65_535));
        let mut store = create_large_file_store(&dir, "large.md", &text);
        assert_window_offsets(&mut store, &text);
        store
            .piece_tree
            .apply_batch(&[(65_535, 65_537, "😀\n中\r\n".to_string())])
            .unwrap();
        store.size_bytes = store.piece_tree.byte_len();
        let edited = text.replacen("\r\n", "😀\n中\r\n", 1);
        assert_window_offsets(&mut store, &edited);
        drop(store);
        remove_test_dir(dir);
    }

    fn assert_window_offsets(store: &mut LargeFileRegistration, text: &str) {
        let raw_lines = text.split('\n').collect::<Vec<_>>();
        for from in 1..=raw_lines.len() {
            for to in from..=raw_lines.len() {
                let (_, _, lines) = read_large_line_window(store, from, to).unwrap();
                assert_eq!(lines.len(), to - from + 1);
                let mut byte_offset = 0;
                let mut utf16_offset = 0;
                for (index, raw_line) in raw_lines.iter().enumerate() {
                    let number = index + 1;
                    let content = raw_line.strip_suffix('\r').unwrap_or(raw_line);
                    if number >= from && number <= to {
                        let line = &lines[number - from];
                        assert_eq!(line.number, number);
                        assert_eq!(line.text, content);
                        assert_eq!(
                            (line.from_byte, line.to_byte),
                            (byte_offset, byte_offset + content.len())
                        );
                        assert_eq!(
                            (line.from_utf16, line.to_utf16),
                            (utf16_offset, utf16_offset + content.encode_utf16().count())
                        );
                    }
                    byte_offset += raw_line.len() + 1;
                    utf16_offset += raw_line.encode_utf16().count() + 1;
                }
            }
        }
    }

    #[test]
    fn profiles_distant_line_windows_with_unicode_crlf_fixture() {
        let dir = create_test_dir("window-profile");
        let text = format!("A👩🏽‍💻B\r\n{}", "body line\r\n".repeat(100_000));
        let mut store = create_large_file_store(&dir, "large.md", &text);
        for repeat in 0..4 {
            for (from, to) in [(4738, 4819), (1, 58)] {
                let started = std::time::Instant::now();
                let (_, _, lines) = read_large_line_window(&mut store, from, to).unwrap();
                let elapsed = started.elapsed().as_secs_f64() * 1000.0;
                assert_eq!(lines.len(), to - from + 1);
                assert_eq!(
                    lines[0].from_utf16,
                    if from == 1 { 0 } else { (from - 1) * 11 }
                );
                assert_eq!(lines.last().unwrap().text, "body line");
                println!("WINDOW_PROFILE {{\"repeat\":{repeat},\"from\":{from},\"to\":{to},\"rustMs\":{elapsed}}}");
            }
        }
        drop(store);
        remove_test_dir(dir);
    }

    #[test]
    fn large_file_maps_utf8_bytes_to_utf16_offsets() {
        let dir = create_test_dir("large-utf16");
        let text = "a😀中\r\nb";
        let mut store = create_large_file_store(&dir, "large.md", text);

        assert_eq!(byte_to_utf16_offset(text, 0).expect("start offset"), 0);
        assert_eq!(byte_to_utf16_offset(text, 1).expect("ascii offset"), 1);
        assert_eq!(byte_to_utf16_offset(text, 5).expect("emoji offset"), 3);
        assert_eq!(byte_to_utf16_offset(text, 8).expect("cjk offset"), 4);
        assert!(byte_to_utf16_offset(text, 2).is_err());

        let (_from_byte, _to_byte, lines) =
            read_large_line_window(&mut store, 1, 2).expect("read unicode line window");

        assert_eq!(
            lines
                .iter()
                .map(|line| {
                    (
                        line.number,
                        line.from_byte,
                        line.to_byte,
                        line.from_utf16,
                        line.to_utf16,
                        line.text.as_str(),
                    )
                })
                .collect::<Vec<_>>(),
            vec![(1, 0, 8, 0, 4, "a😀中"), (2, 10, 11, 6, 7, "b")]
        );
        remove_test_dir(dir);
    }

    #[test]
    fn large_file_line_window_accepts_utf8_character_before_lf() {
        let dir = create_test_dir("large-utf8-before-lf");
        let mut store = create_large_file_store(&dir, "large.md", "# 标题\n正文😀\n");

        let (_from_byte, _to_byte, lines) =
            read_large_line_window(&mut store, 1, 3).expect("read unicode LF line window");

        assert_eq!(
            lines
                .iter()
                .map(|line| line.text.as_str())
                .collect::<Vec<_>>(),
            vec!["# 标题", "正文😀", ""]
        );
        remove_test_dir(dir);
    }

    #[test]
    fn large_file_chunk_ranges_must_align_to_utf8_boundaries() {
        let text = "a中b";

        assert!(validate_byte_range(text, 1, 4).is_ok());
        assert!(validate_byte_range(text, 2, 4).is_err());
        assert!(validate_byte_range(text, 0, text.len() + 1).is_err());
    }

    #[test]
    fn large_file_line_windows_validate_bounds() {
        let dir = create_test_dir("large-window-bounds");
        let text = "one\ntwo";
        let mut store = create_large_file_store(&dir, "large.md", text);

        assert!(read_large_line_window(&mut store, 0, 1).is_err());
        assert!(read_large_line_window(&mut store, 2, 1).is_err());
        assert!(read_large_line_window(&mut store, 1, 3).is_err());
        remove_test_dir(dir);
    }

    #[test]
    fn large_file_applies_non_overlapping_utf16_changes_safely() {
        let text = "a😀中\nlast";
        let changed = apply_large_text_changes(
            text,
            &[
                LargeFileTextChange {
                    from_utf16: 1,
                    to_utf16: 3,
                    insert: "emoji".to_string(),
                },
                LargeFileTextChange {
                    from_utf16: 4,
                    to_utf16: 4,
                    insert: "!".to_string(),
                },
            ],
        )
        .expect("apply utf16 changes");

        assert_eq!(changed, "aemoji中!\nlast");
        assert!(apply_large_text_changes(
            text,
            &[LargeFileTextChange {
                from_utf16: 2,
                to_utf16: 3,
                insert: "bad".to_string(),
            }]
        )
        .is_err());
        assert!(apply_large_text_changes(
            text,
            &[
                LargeFileTextChange {
                    from_utf16: 0,
                    to_utf16: 4,
                    insert: "first".to_string(),
                },
                LargeFileTextChange {
                    from_utf16: 3,
                    to_utf16: 5,
                    insert: "overlap".to_string(),
                },
            ]
        )
        .is_err());
    }

    #[test]
    fn large_file_flush_writes_atomically_to_disk() {
        let dir = create_test_dir("large-flush");
        let path = dir.join("large.md");

        fs::write(&path, "old").expect("write original file");
        write_large_file_atomically(&path, "new\ntext").expect("atomic write");

        assert_eq!(
            fs::read_to_string(&path).expect("read flushed file"),
            "new\ntext"
        );
        remove_test_dir(dir);
    }

    #[test]
    fn large_file_open_and_window_reads_do_not_materialize_full_text() {
        let dir = create_test_dir("large-open-lazy");
        let path = dir.join("large.md");
        fs::write(&path, "one\ntwo\nthree").expect("write large fixture");
        let registry = LargeFileRegistry(Mutex::new(HashMap::new()));

        let opened = open_large_text_file_in_registry(
            &registry.0,
            "large-doc".to_string(),
            path_to_string(path.clone()),
        )
        .expect("open large file");

        assert_eq!(opened.size_bytes, "one\ntwo\nthree".len());
        assert_eq!(opened.line_count, 3);
        assert_eq!(
            registry
                .0
                .lock()
                .expect("lock registry")
                .get("large-doc")
                .expect("large registration")
                .piece_tree
                .byte_len(),
            opened.size_bytes
        );

        let window = read_large_text_file_line_window_from_registry(
            &registry.0,
            "large-doc".to_string(),
            2,
            3,
        )
        .expect("read line window");

        assert_eq!(window.text, "two\nthree");
        assert_eq!(
            read_bounded_large_line_window(&registry.0, "large-doc".into(), 2, 3, Some(9))
                .unwrap()
                .text,
            "two\nthree"
        );
        assert!(
            read_bounded_large_line_window(&registry.0, "large-doc".into(), 2, 3, Some(8))
                .err()
                .unwrap()
                .contains("text budget")
        );
        assert!(
            read_bounded_large_line_window(&registry.0, "large-doc".into(), 3, 2, Some(8)).is_err()
        );

        assert_eq!(
            registry
                .0
                .lock()
                .expect("lock registry")
                .get("large-doc")
                .expect("large registration")
                .piece_tree
                .byte_len(),
            opened.size_bytes
        );
        drop(registry);
        release_test_document("large-doc");
        remove_test_dir(dir);
    }

    #[test]
    fn bounded_line_windows_use_utf16_before_text_allocation() {
        let dir = create_test_dir("bounded-window-utf16");
        let path = dir.join("unicode.md");
        fs::write(&path, "中文😀\r\nend").unwrap();
        let registry = LargeFileRegistry(Mutex::new(HashMap::new()));
        open_large_text_file_in_registry(&registry.0, "doc".into(), path_to_string(path)).unwrap();
        assert_eq!(
            read_bounded_large_line_window(&registry.0, "doc".into(), 1, 1, Some(4))
                .unwrap()
                .text,
            "中文😀"
        );
        assert!(
            read_bounded_large_line_window(&registry.0, "doc".into(), 1, 1, Some(3))
                .err()
                .unwrap()
                .contains("text budget")
        );
        assert!(read_bounded_large_line_window(&registry.0, "doc".into(), 1, 2, Some(8)).is_err());
        assert_eq!(
            read_bounded_large_line_window(&registry.0, "doc".into(), 1, 2, Some(9))
                .unwrap()
                .to_utf16,
            9
        );
        drop(registry);
        release_test_document("doc");
        remove_test_dir(dir);
    }

    #[test]
    fn large_file_flush_rejects_external_modification_after_visible_edit() {
        let dir = create_test_dir("large-flush-conflict");
        let path = dir.join("large.md");
        fs::write(&path, "hello world").expect("write large fixture");
        let registry = LargeFileRegistry(Mutex::new(HashMap::new()));

        open_large_text_file_in_registry(
            &registry.0,
            "large-doc".to_string(),
            path_to_string(path.clone()),
        )
        .expect("open large file");

        apply_large_text_file_changes_in_registry(
            &registry.0,
            "large-doc".to_string(),
            0,
            vec![LargeFileTextChange {
                from_utf16: 6,
                to_utf16: 11,
                insert: "milkup".to_string(),
            }],
        )
        .expect("apply visible edit");
        fs::write(&path, "external change").expect("external edit");

        let error = match flush_large_text_file_in_registry(&registry.0, "large-doc".to_string(), 1)
        {
            Ok(_) => panic!("expected flush conflict"),
            Err(error) => error,
        };

        assert!(error.contains("changed outside the editor"));
        assert_eq!(
            fs::read_to_string(&path).expect("read conflicted file"),
            "external change"
        );
        drop(registry);
        release_test_document("large-doc");
        remove_test_dir(dir);
    }

    #[test]
    fn large_file_visible_edit_uses_memory_snapshot_without_working_file() {
        let dir = create_test_dir("large-edit-working");
        let path = dir.join("large.md");
        fs::write(&path, "hello world\nsecond").expect("write large fixture");
        let registry = LargeFileRegistry(Mutex::new(HashMap::new()));

        open_large_text_file_in_registry(
            &registry.0,
            "large-doc".to_string(),
            path_to_string(path.clone()),
        )
        .expect("open large file");

        let snapshot = apply_large_text_file_changes_in_registry(
            &registry.0,
            "large-doc".to_string(),
            0,
            vec![LargeFileTextChange {
                from_utf16: 6,
                to_utf16: 11,
                insert: "milkup".to_string(),
            }],
        )
        .expect("apply visible edit");

        assert_eq!(snapshot.version, 1);
        {
            let stores = registry.0.lock().expect("lock registry");
            let store = stores.get("large-doc").expect("large registration");
            assert_eq!(store.piece_tree.byte_len(), "hello milkup\nsecond".len());
            assert_eq!(
                fs::read_to_string(&path).expect("read original"),
                "hello world\nsecond"
            );
        }

        let window = read_large_text_file_line_window_from_registry(
            &registry.0,
            "large-doc".to_string(),
            1,
            1,
        )
        .expect("read edited window");

        assert_eq!(window.text, "hello milkup");
        drop(registry);
        release_test_document("large-doc");
        remove_test_dir(dir);
    }

    #[test]
    fn large_file_flush_commits_memory_snapshot_and_clears_edit_log() {
        let dir = create_test_dir("large-flush-memory");
        let path = dir.join("large.md");
        fs::write(&path, "hello world\nsecond").expect("write large fixture");
        let registry = LargeFileRegistry(Mutex::new(HashMap::new()));

        open_large_text_file_in_registry(
            &registry.0,
            "large-doc".to_string(),
            path_to_string(path.clone()),
        )
        .expect("open large file");
        apply_large_text_file_changes_in_registry(
            &registry.0,
            "large-doc".to_string(),
            0,
            vec![LargeFileTextChange {
                from_utf16: 12,
                to_utf16: 18,
                insert: "tail".to_string(),
            }],
        )
        .expect("apply visible edit");

        {
            let stores = registry.0.lock().expect("lock registry");
            let store = stores.get("large-doc").expect("large registration");
            assert_eq!(store.piece_tree.byte_len(), "hello world\ntail".len());
        }

        flush_large_text_file_in_registry(&registry.0, "large-doc".to_string(), 1)
            .expect("flush memory snapshot");

        assert_eq!(
            fs::read_to_string(&path).expect("read flushed file"),
            "hello world\ntail"
        );
        {
            let stores = registry.0.lock().expect("lock registry");
            let store = stores.get("large-doc").expect("large registration");
            assert_eq!(store.piece_tree.byte_len(), "hello world\ntail".len());
        }
        drop(registry);
        release_test_document("large-doc");
        remove_test_dir(dir);
    }

    #[test]
    fn large_file_save_as_writes_memory_snapshot_without_overwriting_original() {
        let dir = create_test_dir("large-save-as-memory");
        let path = dir.join("large.md");
        let save_as_path = dir.join("large-copy.md");
        fs::write(&path, "hello world\nsecond").expect("write large fixture");
        let registry = LargeFileRegistry(Mutex::new(HashMap::new()));

        open_large_text_file_in_registry(
            &registry.0,
            "large-doc".to_string(),
            path_to_string(path.clone()),
        )
        .expect("open large file");
        apply_large_text_file_changes_in_registry(
            &registry.0,
            "large-doc".to_string(),
            0,
            vec![LargeFileTextChange {
                from_utf16: 6,
                to_utf16: 11,
                insert: "milkup".to_string(),
            }],
        )
        .expect("apply visible edit");

        {
            let stores = registry.0.lock().expect("lock registry");
            let store = stores.get("large-doc").expect("large registration");
            assert_eq!(store.piece_tree.byte_len(), "hello milkup\nsecond".len());
        }

        let snapshot = flush_large_text_file_as_in_registry(
            &registry.0,
            "large-doc".to_string(),
            1,
            path_to_string(save_as_path.clone()),
        )
        .expect("save large file as");

        assert_eq!(snapshot.path, path_to_string(save_as_path.clone()));
        assert_eq!(
            fs::read_to_string(&path).expect("read original file"),
            "hello world\nsecond"
        );
        assert_eq!(
            fs::read_to_string(&save_as_path).expect("read save-as file"),
            "hello milkup\nsecond"
        );
        {
            let stores = registry.0.lock().expect("lock registry");
            let store = stores.get("large-doc").expect("large registration");
            assert_eq!(store.path, path_to_string(save_as_path.clone()));
            assert_eq!(store.piece_tree.byte_len(), "hello milkup\nsecond".len());
        }

        let window = read_large_text_file_line_window_from_registry(
            &registry.0,
            "large-doc".to_string(),
            1,
            1,
        )
        .expect("read saved-as window");

        assert_eq!(window.text, "hello milkup");
        drop(registry);
        release_test_document("large-doc");
        remove_test_dir(dir);
    }

    #[test]
    fn large_file_save_as_to_same_path_preserves_external_conflict_guard() {
        let dir = create_test_dir("large-save-as-conflict");
        let path = dir.join("large.md");
        fs::write(&path, "hello world").expect("write large fixture");
        let registry = LargeFileRegistry(Mutex::new(HashMap::new()));

        open_large_text_file_in_registry(
            &registry.0,
            "large-doc".to_string(),
            path_to_string(path.clone()),
        )
        .expect("open large file");
        apply_large_text_file_changes_in_registry(
            &registry.0,
            "large-doc".to_string(),
            0,
            vec![LargeFileTextChange {
                from_utf16: 6,
                to_utf16: 11,
                insert: "milkup".to_string(),
            }],
        )
        .expect("apply visible edit");
        fs::write(&path, "external change").expect("external edit");

        let error = match flush_large_text_file_as_in_registry(
            &registry.0,
            "large-doc".to_string(),
            1,
            path_to_string(path.clone()),
        ) {
            Ok(_) => panic!("expected save-as conflict"),
            Err(error) => error,
        };

        assert!(error.contains("changed outside the editor"));
        let alias = dir.join(".").join(path.file_name().unwrap());
        assert!(
            flush_large_text_file_as_in_registry(
                &registry.0,
                "large-doc".into(),
                1,
                path_to_string(alias)
            )
            .is_err(),
            "Save As aliases must retain the original snapshot guard"
        );
        assert_eq!(
            fs::read_to_string(&path).expect("read conflicted file"),
            "external change"
        );
        drop(registry);
        release_test_document("large-doc");
        remove_test_dir(dir);
    }

    #[test]
    fn large_file_open_preserves_unrecoverable_stale_buffers() {
        let dir = create_test_dir("large-clean-open");
        let path = dir.join("large.md");
        let other_path = dir.join("other.md");
        fs::write(&path, "hello").expect("write large fixture");
        fs::write(&other_path, "other").expect("write other fixture");
        let stale = dir.join(".large.md.milkup-large.2147483647.doc.v1.work");
        let legacy_stale = dir.join(".large.md.2147483647.doc.v2.work");
        let unrelated = dir.join(".other.md.milkup-large.2147483647.doc.v1.work");
        fs::write(&stale, "stale").expect("write stale temp");
        fs::write(&legacy_stale, "legacy").expect("write legacy temp");
        fs::write(&unrelated, "other").expect("write unrelated temp");
        let registry = LargeFileRegistry(Mutex::new(HashMap::new()));

        open_large_text_file_in_registry(
            &registry.0,
            "large-doc".to_string(),
            path_to_string(path.clone()),
        )
        .expect("open large file");

        assert!(stale.exists());
        assert!(legacy_stale.exists());
        assert!(unrelated.exists());
        drop(registry);
        release_test_document("large-doc");
        remove_test_dir(dir);
    }

    #[test]
    fn large_file_temp_cleanup_retains_dead_owner_and_unknown_buffers() {
        let dir = create_test_dir("large-clean-dir");
        let stale = dir.join(".note.md.milkup-large.2147483647.doc.v1.work");
        let stale_save = dir.join(".note.md.milkup-large.2147483647.doc.v1.123.save-as.tmp");
        let keep_regular_work = dir.join("draft.work");
        let keep_tmp = dir.join(".note.md.2147483647.tmp");
        fs::write(&stale, "stale").expect("write stale temp");
        fs::write(&stale_save, "stale save").expect("write stale save temp");
        fs::write(&keep_regular_work, "work").expect("write regular work");
        fs::write(&keep_tmp, "tmp").expect("write tmp");

        let removed = cleanup_large_file_working_temps_in_dir(&dir).expect("cleanup dir");

        assert_eq!(removed, 0);
        assert!(stale.exists());
        assert!(stale_save.exists());
        assert!(keep_regular_work.exists());
        assert!(keep_tmp.exists());
        remove_test_dir(dir);
    }

    #[test]
    fn large_file_registry_drop_removes_active_working_temps() {
        let dir = create_test_dir("large-registry-drop");
        let store = create_large_file_store(&dir, "note.md", "hello");
        let working = store.piece_tree.add_path.clone();

        {
            let registry = LargeFileRegistry(Mutex::new(HashMap::from([(
                "large-doc".to_string(),
                store,
            )])));
            drop(registry);
        }

        assert!(!working.exists());
        remove_test_dir(dir);
    }

    #[test]
    fn document_resource_lease_outlives_large_registry_until_explicit_release() {
        let dir = create_test_dir("document-resource-lease");
        let moved = dir.with_extension("released");
        let path = dir.join("note.md");
        let document_id = format!("lease-test-{}", dir.file_name().unwrap().to_string_lossy());
        fs::write(&path, "original document").unwrap();
        let registry = LargeFileRegistry(Mutex::new(HashMap::new()));
        open_large_text_file_in_registry(
            &registry.0,
            document_id.clone(),
            path_to_string(path.clone()),
        )
        .unwrap();
        let working = registry.0.lock().unwrap()[&document_id]
            .piece_tree
            .add_path
            .clone();

        // Dropping the local piece-tree registry closes its files, but the
        // resource service still owns this document's parent/ancestor handles.
        drop(registry);
        assert!(!working.exists());
        let (_, mut file) = resources::registered_document_file(&document_id)
            .expect("resource document remains registered after local registry drop");
        let mut text = String::new();
        file.read_to_string(&mut text).unwrap();
        assert_eq!(text, "original document");
        drop(file);
        #[cfg(windows)]
        assert_eq!(
            fs::rename(&dir, &moved).unwrap_err().raw_os_error(),
            Some(32),
            "the live document resource lease must still protect its directory"
        );

        release_test_document(&document_id);
        fs::rename(&dir, &moved).expect("released document no longer pins the directory");
        assert_eq!(fs::read_to_string(moved.join("note.md")).unwrap(), text);
        remove_test_dir(moved);
    }

    fn release_test_document(document_id: &str) {
        // Native open/save hooks register resources independently of a local
        // LargeFileRegistry. Match the host's explicit document-close lifecycle.
        resources::resources_release_document(document_id.into())
            .expect("release test document resources");
        assert_eq!(
            resources::registered_document_file(document_id).unwrap_err(),
            "Save or open this document before importing resources",
            "released document must no longer be available in the resource registry"
        );
    }

    fn create_test_dir(name: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "milkup-desktop-{name}-{}-{nonce}",
            std::process::id()
        ));

        fs::create_dir_all(&path).expect("create test directory");
        path
    }

    fn create_large_file_store(dir: &Path, name: &str, text: &str) -> LargeFileRegistration {
        let path = dir.join(name);
        fs::write(&path, text).expect("write large fixture");
        let add_path = large_file_add_buffer_path(&path, "test-document").expect("add buffer path");
        let piece_tree = PieceTree::open(&path, add_path).expect("open piece tree");

        LargeFileRegistration {
            path: path_to_string(path.clone()),
            size_bytes: piece_tree.byte_len(),
            piece_tree,
            disk_snapshot_hash: hash_file_contents(&path).expect("hash large fixture"),
            version: 0,
            saved_version: 0,
        }
    }

    fn remove_test_dir(path: PathBuf) {
        fs::remove_dir_all(path).expect("remove test directory");
    }
}

#[cfg(test)]
mod search_profile_baseline {
    use super::*;
    #[test]
    #[ignore = "explicit same-fixture native search transport baseline"]
    fn profile_legacy_search_windows() {
        let path = std::env::var("MILKUP_SEARCH_FIXTURE").expect("fixture path");
        let registry = Mutex::new(HashMap::new());
        let opened = open_large_text_file_in_registry(&registry, "baseline".into(), path).unwrap();
        let mut read_micros = 0_u128;
        let mut serialization_micros = 0_u128;
        let mut serialized_bytes = 0_usize;
        let mut windows = 0;
        for from in (1..=opened.line_count).step_by(512) {
            let to = opened.line_count.min(from + 511);
            let at = std::time::Instant::now();
            let window = read_large_text_file_line_window_from_registry(
                &registry,
                "baseline".into(),
                from,
                to,
            )
            .unwrap();
            read_micros += at.elapsed().as_micros();
            let at = std::time::Instant::now();
            let encoded = serde_json::to_vec(&window).unwrap();
            serialization_micros += at.elapsed().as_micros();
            serialized_bytes += encoded.len();
            windows += 1;
        }
        let result = serde_json::json!({"windows": windows, "readMicros": read_micros, "serializationMicros": serialization_micros, "serializedBytes": serialized_bytes, "lineCount": opened.line_count, "sizeBytes": opened.size_bytes});
        println!("{result}");
        if let Ok(output) = std::env::var("MILKUP_SEARCH_PROFILE_OUTPUT") {
            fs::write(output, serde_json::to_vec_pretty(&result).unwrap()).unwrap();
        }
    }
}
