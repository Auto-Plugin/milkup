//! Explicitly authorized CI-only compatibility experiment. Not a product backend.
#[cfg(windows)]
#[path = "windows-w0/probe.rs"]
mod probe;
fn main() {
    #[cfg(windows)]
    if let Err(error) = probe::run() {
        eprintln!("W0 probe failed: {error}");
        std::process::exit(1);
    }
    #[cfg(not(windows))]
    panic!("W0 requires an actual Windows runner");
}
