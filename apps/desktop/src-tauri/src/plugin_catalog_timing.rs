//! Opt-in bounded observations only. These records never authorize catalogue operations.
use serde_json::{json, Value};
use std::cell::RefCell;
use std::io::Write;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::OnceLock;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

const MAX_TRACES: u64 = 64;
const MAX_STAGES: usize = 64;
static ENABLED: OnceLock<bool> = OnceLock::new();
static NEXT: AtomicU64 = AtomicU64::new(0);
thread_local! { static ACTIVE: RefCell<Option<Trace>> = const { RefCell::new(None) }; }
struct Trace {
    id: u64,
    operation: &'static str,
    start: Instant,
    unix_ms: u128,
    stages: Vec<(&'static str, u128)>,
    truncated: bool,
}
impl Trace {
    fn new(id: u64, operation: &'static str) -> Self {
        Self {
            id,
            operation,
            start: Instant::now(),
            unix_ms: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis(),
            stages: Vec::new(),
            truncated: false,
        }
    }
    fn mark(&mut self, stage: &'static str) {
        if self.stages.len() < MAX_STAGES {
            self.stages.push((stage, self.start.elapsed().as_micros()));
        } else {
            self.truncated = true;
        }
    }
    fn record(&self, success: bool) -> Value {
        json!({"schema":1,"pid":std::process::id(),"id":self.id,
            "operation":self.operation,"startedUnixMs":self.unix_ms,
            "durationUs":self.start.elapsed().as_micros(),"success":success,
            "truncated":self.truncated,"stages":self.stages.iter().map(|(stage,us)|
                json!({"stage":stage,"elapsedUs":us})).collect::<Vec<_>>()})
    }
}
fn emit(record: Value) {
    // A closed diagnostic pipe cannot turn successful catalogue work into a failure.
    let _ = writeln!(std::io::stderr().lock(), "MILKUP_CATALOG_TIMING {}", record);
}
fn allocate(operation: &'static str) -> Option<Trace> {
    if !*ENABLED.get_or_init(|| std::env::var("MILKUP_MERMAID_NATIVE_AUDIT").as_deref() == Ok("1"))
    {
        return None;
    }
    let id = NEXT.fetch_add(1, Ordering::Relaxed);
    if id == MAX_TRACES {
        emit(json!({"schema":1,"pid":std::process::id(),"limitReached":true,"limit":MAX_TRACES}));
    }
    (id < MAX_TRACES).then(|| Trace::new(id, operation))
}

/// Carries the command-entry clock into its blocking worker without a global shared trace.
pub(crate) struct Ticket(Option<Trace>);
impl Ticket {
    pub(crate) fn mark(&mut self, stage: &'static str) {
        if let Some(trace) = self.0.as_mut() {
            trace.mark(stage);
        }
    }
}
impl Drop for Ticket {
    fn drop(&mut self) {
        // Includes errors before the worker was queued (e.g. root resolution).
        if let Some(trace) = self.0.take() {
            emit(trace.record(false));
        }
    }
}
pub(crate) fn queued(operation: &'static str) -> Ticket {
    let mut ticket = Ticket(allocate(operation));
    ticket.mark("command-enter");
    ticket
}
pub(crate) fn dispatched<T, E>(
    mut ticket: Ticket,
    task: impl FnOnce() -> Result<T, E>,
) -> Result<T, E> {
    let owns = ticket.0.is_some();
    ACTIVE.with(|slot| *slot.borrow_mut() = ticket.0.take());
    let mut scope = Scope { owns };
    mark("worker-enter");
    let result = task();
    scope.finish(result.is_ok());
    result
}
pub(super) struct Scope {
    owns: bool,
}
impl Scope {
    pub(super) fn finish(&mut self, success: bool) {
        if self.owns {
            self.owns = false;
            let trace = ACTIVE.with(|slot| slot.borrow_mut().take());
            if let Some(trace) = trace {
                emit(trace.record(success));
            }
        }
    }
}
impl Drop for Scope {
    fn drop(&mut self) {
        self.finish(false);
    }
}
pub(super) fn begin(operation: &'static str) -> Scope {
    let existing = ACTIVE.with(|slot| {
        if let Some(trace) = slot.borrow_mut().as_mut() {
            trace.operation = operation;
            trace.mark("catalog-enter");
            true
        } else {
            false
        }
    });
    if existing {
        return Scope { owns: false };
    }
    let trace = allocate(operation);
    let owns = trace.is_some();
    ACTIVE.with(|slot| *slot.borrow_mut() = trace);
    Scope { owns }
}
pub(super) fn mark(stage: &'static str) {
    ACTIVE.with(|slot| {
        if let Some(trace) = slot.borrow_mut().as_mut() {
            trace.mark(stage);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bounded_monotonic_stages_retain_failure_and_explicit_truncation() {
        let mut trace = Trace::new(7, "approve");
        for _ in 0..(MAX_STAGES + 3) {
            trace.mark("verify");
        }
        let record = trace.record(false);
        assert_eq!(record["success"], false);
        assert_eq!(record["truncated"], true);
        let stages = record["stages"].as_array().unwrap();
        assert_eq!(stages.len(), MAX_STAGES);
        assert!(stages
            .windows(2)
            .all(|w| w[0]["elapsedUs"].as_u64() <= w[1]["elapsedUs"].as_u64()));
        assert!(record["durationUs"].as_u64() >= stages.last().unwrap()["elapsedUs"].as_u64());
        assert_eq!(record["operation"], "approve");
    }
    #[test]
    fn thread_local_diagnostics_do_not_mix_concurrent_operations() {
        ACTIVE.with(|slot| *slot.borrow_mut() = Some(Trace::new(1, "read")));
        std::thread::spawn(|| {
            ACTIVE.with(|slot| assert!(slot.borrow().is_none()));
            mark("unrelated");
        })
        .join()
        .unwrap();
        mark("lock-acquired");
        ACTIVE.with(|slot| {
            let trace = slot.borrow_mut().take().unwrap();
            assert_eq!(trace.stages.len(), 1);
            assert_eq!(trace.stages[0].0, "lock-acquired");
        });
    }
    #[test]
    fn worker_trace_includes_queue_and_inner_store_without_early_finish() {
        let mut ticket = Ticket(Some(Trace::new(9, "transition")));
        ticket.mark("command-enter");
        ticket.mark("root-resolved");
        let result = std::thread::spawn(move || {
            dispatched(ticket, || {
                let mut store = begin("approve");
                mark("lock-acquired");
                store.finish(true);
                ACTIVE.with(|slot| {
                    let slot = slot.borrow();
                    let trace = slot.as_ref().unwrap();
                    assert_eq!(trace.operation, "approve");
                    assert_eq!(
                        trace.stages.iter().map(|x| x.0).collect::<Vec<_>>(),
                        [
                            "command-enter",
                            "root-resolved",
                            "worker-enter",
                            "catalog-enter",
                            "lock-acquired"
                        ]
                    );
                });
                Err::<(), _>("original failure")
            })
        })
        .join()
        .unwrap();
        assert_eq!(result, Err("original failure"));
    }
    #[test]
    fn panic_clears_worker_scope_before_the_thread_is_reused() {
        let result = std::panic::catch_unwind(|| {
            dispatched(Ticket(Some(Trace::new(10, "read"))), || {
                mark("lock-wait");
                panic!("controlled test panic");
                #[allow(unreachable_code)]
                Ok::<(), ()>(())
            })
        });
        assert!(result.is_err());
        ACTIVE.with(|slot| assert!(slot.borrow().is_none()));
    }
}
