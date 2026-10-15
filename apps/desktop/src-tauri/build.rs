fn main() {
    println!("cargo:rerun-if-changed=../../../package.json");
    println!("cargo:rerun-if-changed=../package.json");
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
        println!(
            "cargo:rustc-link-arg=/MANIFESTDEPENDENCY:\"type='win32' name='Microsoft.Windows.Common-Controls' version='6.0.0.0' processorArchitecture='*' publicKeyToken='6595b64144ccf1df' language='*'\""
        );
    } else {
        tauri_build::build()
    }
}
