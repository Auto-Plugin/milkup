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
    tauri_build::build()
}
