use serde_json::{json, Value};

pub(super) fn assess(
    events: &[Value],
    endpoints: &[Value],
    native_controls: &[Value],
    require_native: bool,
) -> Value {
    let observer_errors: Vec<_> = events
        .iter()
        .filter(|e| e.get("listenerError").is_some())
        .cloned()
        .collect();
    let mut missing = Vec::new();
    for endpoint in endpoints {
        let family = &endpoint["family"];
        if !events
            .iter()
            .any(|e| &e["family"] == family && e["turnUsername"] == "ordinary")
        {
            missing.push(format!("ordinary TURN {}", family));
        }
        for route in [
            "GET /ordinary/native ",
            "GET /ordinary/fetch ",
            "GET /ordinary/xhr ",
            "POST /ordinary/beacon ",
            "GET /ordinary/websocket ",
        ] {
            if !events.iter().any(|e| {
                &e["family"] == family
                    && e["request"].as_str().is_some_and(|s| s.starts_with(route))
            }) {
                missing.push(format!("{route} {family}"));
            }
        }
    }
    if require_native {
        if native_controls.len() != endpoints.len() * 5 * 2 {
            missing.push("complete native before/after variant matrix".to_string());
        }
        for control in native_controls {
            let marker = control["marker"].as_str().unwrap_or("");
            if marker.is_empty()
                || !events.iter().any(|e| e["nativeMarker"] == marker)
                || control["sendResult"]["ok"] != true
                || (control["holdMs"].as_u64().unwrap_or(0) > 0
                    && control["reply"]["exactEcho"] != true)
            {
                missing.push(format!("native receipt/echo {marker}"));
            }
        }
    }
    let violations: Vec<Value> = events
        .iter()
        .filter(|e| {
            e["turnUsername"]
                .as_str()
                .is_some_and(|s| s.starts_with("restricted"))
                || e["nativeMarker"]
                    .as_str()
                    .is_some_and(|s| s.starts_with("w0/restricted"))
                || e["query"]
                    .as_str()
                    .is_some_and(|s| s.starts_with("w0-restricted"))
                || e["request"]
                    .as_str()
                    .is_some_and(|s| s.contains(" /restricted"))
        })
        .cloned()
        .collect();
    let controls = observer_errors.is_empty() && missing.is_empty() && !endpoints.is_empty();
    let gate = if !violations.is_empty() {
        json!(false)
    } else if controls {
        json!(true)
    } else {
        Value::Null
    };
    json!({"observationControlsPassed":controls,"observerErrors":observer_errors,"missingPositiveControls":missing,"receivedRestrictedCanaries":violations,"networkCanaryGatePassed":gate,"boundary":"No received canary is a denial observation only with healthy receivers and matched positive controls. This narrow gate never enables the product."})
}

#[cfg(test)]
mod tests {
    use super::*;
    fn positive() -> Vec<Value> {
        let mut events = vec![json!({"family":"ipv4","turnUsername":"ordinary"})];
        for route in [
            "GET /ordinary/native ",
            "GET /ordinary/fetch ",
            "GET /ordinary/xhr ",
            "POST /ordinary/beacon ",
            "GET /ordinary/websocket ",
        ] {
            events.push(json!({"family":"ipv4","request":route}));
        }
        events
    }
    #[test]
    fn dead_receiver_never_turns_no_packets_into_pass() {
        let mut events = positive();
        events.push(json!({"listenerError":"10054","family":"ipv4"}));
        let result = assess(&events, &[json!({"family":"ipv4"})], &[], false);
        assert_eq!(result["observationControlsPassed"], false);
        assert!(result["networkCanaryGatePassed"].is_null());
    }
    #[test]
    fn missing_positive_and_native_matrix_are_unresolved() {
        let endpoints = [json!({"family":"ipv4"})];
        assert!(assess(&[], &endpoints, &[], false)["networkCanaryGatePassed"].is_null());
        assert!(assess(&positive(), &endpoints, &[], true)["networkCanaryGatePassed"].is_null());
    }
    #[test]
    fn actual_restricted_delivery_fails_without_hiding_in_missing_controls() {
        let endpoints = [json!({"family":"ipv4"})];
        let mut events = positive();
        assert_eq!(
            assess(&events, &endpoints, &[], false)["networkCanaryGatePassed"],
            true
        );
        events.push(json!({"family":"ipv4","turnUsername":"restricted"}));
        assert_eq!(
            assess(&events, &endpoints, &[], false)["networkCanaryGatePassed"],
            false
        );
        assert_eq!(
            assess(&events, &endpoints, &[], true)["networkCanaryGatePassed"],
            false
        );
    }
}
