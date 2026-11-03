#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if milkup_mermaid_engine::run_helper_if_requested() {
        return;
    }
    #[cfg(target_os = "linux")]
    if milkup_desktop_lib::private_mermaid_linux::run_helper_if_requested() {
        return;
    }
    if milkup_desktop_lib::output::run_helper_if_requested() {
        return;
    }
    if milkup_desktop_lib::plugin_dom::run_helper_if_requested() {
        return;
    }
    milkup_desktop_lib::run()
}
