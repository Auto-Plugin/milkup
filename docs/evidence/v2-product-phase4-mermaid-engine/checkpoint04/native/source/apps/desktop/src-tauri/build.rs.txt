fn main() {
    build_dom_guard();
    println!("cargo:rerun-if-changed=../../../package.json");
    println!("cargo:rerun-if-changed=../package.json");
    println!("cargo:rerun-if-changed=windows-app.manifest");
    let root: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string("../../../package.json").expect("read application version"),
    )
    .expect("parse application version");
    let desktop: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string("../package.json").expect("read desktop package"),
    )
    .expect("parse desktop package");
    assert_eq!(
        root["version"].as_str(),
        Some(env!("CARGO_PKG_VERSION")),
        "Run pnpm version:sync before building"
    );
    assert_eq!(
        root["version"], desktop["version"],
        "Desktop version differs from the application version"
    );
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows")
        && std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc")
    {
        // Tauri's resource compiler attaches its manifest only to binary targets.
        // Let the MSVC linker embed it for every executable, including lib tests.
        // Keep Tauri's icon/version resources, but avoid duplicate RT_MANIFESTs.
        let windows = tauri_build::WindowsAttributes::new_without_app_manifest();
        tauri_build::try_build(tauri_build::Attributes::new().windows_attributes(windows))
            .expect("build Tauri resources");
        println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
        // Pass one path argument, not manifest attributes with nested quotes.
        // CARGO_MANIFEST_DIR is absolute; do not add manual command-line quoting.
        let manifest =
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("windows-app.manifest");
        println!("cargo:rustc-link-arg=/MANIFESTINPUT:{}", manifest.display());
    } else {
        tauri_build::build()
    }
}

// Embed the native WebProcess request guard. It is extracted only into an owned
// private directory, never resolved from a plugin package or system search path.
fn build_dom_guard() {
    println!("cargo:rerun-if-changed=src/plugin_dom_guard.c");
    println!("cargo:rerun-if-changed=src/plugin_dom_bootstrap.js");
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("linux") {
        return;
    }
    let flags = std::process::Command::new("pkg-config")
        .args(["--cflags", "--libs", "webkit2gtk-web-extension-4.1"])
        .output()
        .expect("pkg-config is required for the native DOM resource guard");
    assert!(
        flags.status.success(),
        "WebKitGTK extension development files unavailable: {}",
        String::from_utf8_lossy(&flags.stderr)
    );
    let output =
        std::path::PathBuf::from(std::env::var_os("OUT_DIR").expect("Cargo output directory"))
            .join("libmilkup_dom_guard.so");
    let status = std::process::Command::new(std::env::var_os("CC").unwrap_or_else(|| "cc".into()))
        .args([
            "-shared",
            "-fPIC",
            "-O2",
            "-Wl,-z,relro,-z,now",
            "src/plugin_dom_guard.c",
            "-o",
        ])
        .arg(output)
        .args(
            String::from_utf8(flags.stdout)
                .expect("pkg-config UTF-8")
                .split_whitespace(),
        )
        .status()
        .expect("compile native DOM resource guard");
    assert!(
        status.success(),
        "Native DOM resource guard compilation failed"
    );
}
