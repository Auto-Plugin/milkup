//! Test-only process boundary probe. Never linked into the desktop application.
use milkup_catalog_core_tests::plugin_catalog;
use serde_json::{json, Value};
use std::path::Path;

fn candidate(root: &Path, state: &Value, kind: &str) -> Result<Value, String> {
    let entry = &state["entries"][0];
    let pending = &entry["pending"];
    let mut action = json!({"type":kind,"transactionId":pending["transactionId"],"fingerprint":pending["generation"]["capabilityFingerprint"]});
    if kind == "commit" {
        action["enabled"] = json!(true);
    }
    plugin_catalog::transition(
        root,
        "test.process",
        entry["revision"].as_u64().unwrap(),
        action,
    )
}
fn archive(version: &str) -> Value {
    json!({"format":"milkup-plugin","version":1,"manifest":{"id":"test.process","name":"Process fixture","version":version,"host":"worker","main":"main.js","permissions":[]},"files":[{"path":"main.js","encoding":"utf8","content":"export default { activate() {} }"}]})
}
fn run() -> Result<Value, String> {
    let mut args = std::env::args_os().skip(1);
    let command = args.next().ok_or("missing command")?;
    let root = args.next().ok_or("missing root")?;
    if args.next().is_some() {
        return Err("unexpected arguments".into());
    }
    let root = Path::new(&root);
    if command == "read" {
        return plugin_catalog::read(root);
    }
    if command != "seed-interrupted-trial" && command != "seed-interrupted-startup" {
        return Err("unknown command".into());
    }
    let mut state = plugin_catalog::prepare(root, archive("1.0.0"), "test:process".into(), None)?;
    for kind in ["approve", "beginTrial", "commit"] {
        state = candidate(root, &state, kind)?;
    }
    if command == "seed-interrupted-trial" {
        state = plugin_catalog::prepare(
            root,
            archive("2.0.0"),
            "test:process-upgrade".into(),
            state["entries"][0]["revision"].as_u64(),
        )?;
        candidate(root, &state, "beginTrial")
    } else {
        let entry = &state["entries"][0];
        plugin_catalog::transition(
            root,
            "test.process",
            entry["revision"].as_u64().unwrap(),
            json!({"type":"startupBegin","generationId":entry["active"]["id"]}),
        )
    }
}
fn main() {
    match run() {
        Ok(value) => println!("{value}"),
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(1);
        }
    }
}
