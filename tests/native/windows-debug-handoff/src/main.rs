#[cfg(windows)]
mod windows;

#[cfg(windows)]
fn main() {
    if let Err(error) = windows::run() {
        eprintln!("PROBE_FAILED: {error}");
        std::process::exit(1);
    }
}

#[cfg(not(windows))]
fn main() {
    eprintln!(
        "Windows runtime probe is unavailable here; use cargo test --lib for portable gates only."
    );
    std::process::exit(2);
}
