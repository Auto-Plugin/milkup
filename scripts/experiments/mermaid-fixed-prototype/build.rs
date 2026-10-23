use sha2::{Digest, Sha256};

fn main() {
    // Offline staging only. Never discover code in a plugin package at runtime.
    let path = "assets/mermaid-12.2.0.min.js";
    println!("cargo:rerun-if-changed={path}");
    let bytes = std::fs::read(path).expect("Run prepare-assets.py with the already-cached Mermaid 12.2.0 package first; no download fallback");
    assert_eq!(bytes.len(), 5_494_801, "Unexpected official engine length");
    assert_eq!(
        format!("{:x}", Sha256::digest(&bytes)),
        "a8a6a6f805b074a8261a2825c86f99c8054acb3b35f50bb7e24a4f9f2c3c3b9f",
        "Unexpected official engine digest"
    );
}
