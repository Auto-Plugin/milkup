//! Bounded host diagnostics only. Never an authorization, cleanup, or deadline proof.
use serde::{Deserialize, Serialize};
#[cfg(any(windows, test))]
use serde_json::json;

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FrontendTrace {
    pub request_id: String,
    pub owner_id: String,
    pub sequence: u32,
    pub content_sequence: u32,
    pub source_version: u64,
    pub selection_anchor: u64,
    pub selection_head: u64,
    pub published: bool,
    pub events: Vec<FrontendEvent>,
}
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FrontendEvent {
    pub phase: String,
    pub tick_ms: u64,
}
impl FrontendTrace {
    fn validate(&self) -> Result<(), String> {
        if !super::id(&self.request_id)
            || !super::id(&self.owner_id)
            || self.sequence == 0
            || self.content_sequence == 0
            || self.events.is_empty()
            || self.events.len() > 10
            || self.source_version > 9_007_199_254_740_991
            || self.selection_anchor > 9_007_199_254_740_991
            || self.selection_head > 9_007_199_254_740_991
        {
            return Err("Invalid bounded Mermaid frontend trace".into());
        }
        let mut last = 0;
        let mut seen = std::collections::HashSet::new();
        for event in &self.events {
            if !matches!(
                event.phase.as_str(),
                "created"
                    | "queued"
                    | "view-aborted"
                    | "native-dispatched"
                    | "native-settled"
                    | "deadline-cancel"
                    | "owner-cancel"
                    | "settlement-cancel"
                    | "finished"
            ) || event.tick_ms < last
                || event.tick_ms > 9_007_199_254_740_991
                || !seen.insert(event.phase.as_str())
            {
                return Err("Invalid Mermaid frontend trace event".into());
            }
            last = event.tick_ms;
        }
        if self.events.first().unwrap().phase != "created"
            || self.events.last().unwrap().phase != "finished"
        {
            return Err("Incomplete Mermaid frontend trace".into());
        }
        Ok(())
    }
}
pub fn record_frontend_trace(trace: FrontendTrace) -> Result<(), String> {
    trace.validate()?;
    #[cfg(windows)]
    super::audit::emit_diagnostic(
        &json!({"phase":"frontend-request", "productPid":std::process::id(),
        "clock":"webview-performance-ms", "authority":"diagnostic-only", "trace":trace}),
    );
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    fn value() -> serde_json::Value {
        json!({"requestId":"r1","ownerId":"o1","sequence":1,"contentSequence":1,
            "sourceVersion":0,"selectionAnchor":0,"selectionHead":0,"published":false,
            "events":[{"phase":"created","tickMs":1},{"phase":"queued","tickMs":2},
            {"phase":"view-aborted","tickMs":3},{"phase":"finished","tickMs":4}]})
    }
    #[test]
    fn accepts_bounded_request_correlation_without_source_or_paths() {
        serde_json::from_value::<FrontendTrace>(value())
            .unwrap()
            .validate()
            .unwrap();
        let mut v = value();
        v["source"] = json!("secret");
        assert!(serde_json::from_value::<FrontendTrace>(v).is_err());
    }
    #[test]
    fn rejects_unknown_reordered_duplicate_or_unbounded_trace() {
        for events in [
            json!([]),
            json!([{"phase":"created","tickMs":5},{"phase":"finished","tickMs":4}]),
            json!([{"phase":"created","tickMs":1},{"phase":"arbitrary","tickMs":2},{"phase":"finished","tickMs":3}]),
            json!([{"phase":"created","tickMs":1},{"phase":"created","tickMs":2},{"phase":"finished","tickMs":3}]),
            json!(vec![json!({"phase":"created","tickMs":1}); 11]),
        ] {
            let mut v = value();
            v["events"] = events;
            assert!(serde_json::from_value::<FrontendTrace>(v)
                .unwrap()
                .validate()
                .is_err());
        }
    }
}
