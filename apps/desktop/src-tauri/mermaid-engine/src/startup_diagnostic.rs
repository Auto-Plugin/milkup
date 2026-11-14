//! Fixed helper startup metadata only; never raw stderr, paths, source or proof.
use serde_json::{json, Value};

pub(crate) const STARTUP_PHASES: &[&str] = &[
    "helper-enter",
    "token-before",
    "token-ok",
    "com-start",
    "com-returned",
    "environment-call-start",
    "environment-call-returned",
    "environment-callback-ok",
    "environment-callback-failed",
    "controller-call-start",
    "controller-call-returned",
    "controller-pump-alive",
    "controller-callback-ok",
    "controller-callback-failed",
    "controls-installed",
    "navigate-start",
    "navigate-returned",
    "index-request",
    "index-response",
    "bundle-request",
    "bundle-response",
    "bootstrap-ready-validated",
    "ready-frame-start",
    "ready-frame-flushed",
];

pub(crate) fn startup_phase_line(
    phase: &str,
    elapsed_us: u128,
    hresult: Option<i32>,
) -> Option<String> {
    if !STARTUP_PHASES.contains(&phase) {
        return None;
    }
    let elapsed_us = elapsed_us.min(999_999_999_999);
    Some(match hresult {
        Some(code) => format!(
            "MILKUP_PHASE {phase} elapsedUs={elapsed_us} hresult=0x{:08X}\n",
            code as u32
        ),
        None => format!("MILKUP_PHASE {phase} elapsedUs={elapsed_us}\n"),
    })
}

pub(crate) fn startup_diagnostics(value: &Value) -> Value {
    let Some(text) = value.as_str() else {
        return json!({"records":[],"partialLine":false,"omitted":false});
    };
    let mut records = Vec::new();
    let mut omitted = false;
    // The launcher already caps stderr at 16 KiB. Do not parse an unbounded
    // synthetic report or export arbitrary browser/OS diagnostics.
    if text.len() > 16 * 1024 {
        return json!({"records":[],"partialLine":true,"omitted":true});
    }
    for line in text.split_inclusive('\n') {
        if !line.ends_with('\n') {
            continue;
        }
        let fields: Vec<_> = line.trim_end_matches('\n').split(' ').collect();
        if !(3..=4).contains(&fields.len())
            || fields[0] != "MILKUP_PHASE"
            || !STARTUP_PHASES.contains(&fields[1])
        {
            continue;
        }
        let Some(elapsed) = fields[2]
            .strip_prefix("elapsedUs=")
            .and_then(|v| v.parse::<u64>().ok())
            .filter(|v| *v <= 999_999_999_999)
        else {
            continue;
        };
        let code = if fields.len() == 4 {
            let Some(hex) = fields[3]
                .strip_prefix("hresult=0x")
                .filter(|v| v.len() == 8 && v.bytes().all(|c| c.is_ascii_hexdigit()))
            else {
                continue;
            };
            Some(u32::from_str_radix(hex, 16).unwrap())
        } else {
            None
        };
        if records.len() == 24 {
            omitted = true;
            break;
        }
        records.push(json!({"phase":fields[1],"elapsedUs":elapsed,"hresult":code}));
    }
    json!({"records":records,"partialLine":!text.is_empty() && !text.ends_with('\n'),"omitted":omitted})
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn retains_completed_phases_even_when_a_cancelled_read_has_a_partial_tail() {
        let raw = "MILKUP_PHASE helper-enter elapsedUs=0\nMILKUP_PHASE environment-call-returned elapsedUs=17 hresult=0x80004005\nMILKUP_PHASE controller-call";
        let d = startup_diagnostics(&json!(raw));
        assert_eq!(d["records"].as_array().unwrap().len(), 2);
        assert_eq!(d["records"][1]["hresult"], json!(0x80004005u32));
        assert_eq!(d["partialLine"], true);
        assert_eq!(d["omitted"], false);
    }
    #[test]
    fn exports_only_fixed_phases_numeric_metadata_and_at_most_24_records() {
        let raw = "private path C:/secret\nMILKUP_PHASE helper-enter elapsedUs=1 source=secret\nMILKUP_PHASE secret elapsedUs=1\nMILKUP_PHASE token-ok elapsedUs=secret\n";
        assert!(startup_diagnostics(&json!(raw))["records"]
            .as_array()
            .unwrap()
            .is_empty());
        let line = startup_phase_line("helper-enter", u128::MAX, Some(-1)).unwrap();
        let d = startup_diagnostics(&json!(line.repeat(25)));
        assert_eq!(d["records"].as_array().unwrap().len(), 24);
        assert_eq!(d["omitted"], true);
        assert!(startup_diagnostics(&json!("x".repeat(16385)))["records"]
            .as_array()
            .unwrap()
            .is_empty());
        assert!(startup_phase_line("secret", 0, None).is_none());
    }
}
