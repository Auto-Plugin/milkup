//! Test-only crate compiling the desktop catalog implementation without Tauri.
//! Tauri reexports url::Url; use the identical locked type for that single reference.
extern crate self as tauri;
pub use url::Url;

#[path = "../../../../apps/desktop/src-tauri/src/plugin_catalog.rs"]
pub mod plugin_catalog;
