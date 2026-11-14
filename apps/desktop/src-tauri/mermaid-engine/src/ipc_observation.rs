//! Fixed native IPC progress, observed without altering I/O or cleanup decisions.
//! Completion describes an I/O/protocol result, not process exit or a joined
//! thread; the existing join's `finished` observation remains authoritative.
use serde_json::{json, Value};
use std::sync::{
    atomic::{AtomicU16, Ordering},
    Arc, Mutex, OnceLock,
};

#[derive(Clone, Copy)]
#[repr(u8)]
pub(crate) enum Phase {
    Created = 0,
    ReadyFrame,
    ReadyEvent,
    ResultFrame,
    PngBody,
    ResultEvent,
    TrailingByte,
    StderrRead,
    StdinWrite,
    StdinFlush,
    WrittenEvent,
}

#[derive(Clone, Copy)]
#[repr(u8)]
pub(crate) enum Completion {
    Pending = 0,
    Eof,
    BrokenPipe,
    Written,
    ReadError,
    SchemaError,
    ChannelError,
    TrailingData,
    BudgetError,
    WriteError,
}

// One process-local monotonic clock shared with launcher observations.
pub(crate) fn diagnostic_tick_ms() -> u64 {
    static START: OnceLock<std::time::Instant> = OnceLock::new();
    START
        .get_or_init(std::time::Instant::now)
        .elapsed()
        .as_millis()
        .min(u64::MAX as u128) as u64
}
#[derive(Clone)]
pub(crate) struct Progress(Arc<AtomicU16>, Arc<Mutex<Vec<(u64, u16)>>>);
impl Default for Progress {
    fn default() -> Self {
        Self(
            Arc::new(AtomicU16::new(
                (Phase::Created as u16) | ((Completion::Pending as u16) << 8),
            )),
            Arc::new(Mutex::new(vec![(diagnostic_tick_ms(), 0)])),
        )
    }
}
impl Progress {
    pub(crate) fn phase(&self, phase: Phase) {
        self.0.store(phase as u16, Ordering::Release);
        self.record();
    }
    pub(crate) fn finish(&self, completion: Completion) {
        // One producer updates a stream. Packing the two values in one atomic
        // prevents observers from combining a new completion with an old phase.
        self.0.fetch_or((completion as u16) << 8, Ordering::AcqRel);
        self.record();
    }
    fn record(&self) {
        // Fixed protocol phases only; never records payloads. No decision reads this log.
        if let Ok(mut entries) = self.1.lock() {
            if entries.len() < 24 {
                entries.push((diagnostic_tick_ms(), self.0.load(Ordering::Acquire)));
            }
        }
    }
    pub(crate) fn timeline(&self) -> Value {
        let entries = self
            .1
            .lock()
            .map(|entries| entries.clone())
            .unwrap_or_default();
        json!(entries
            .into_iter()
            .map(|(tick, state)| json!({"tickMs":tick,"state":state}))
            .collect::<Vec<_>>())
    }
    pub(crate) fn snapshot(&self) -> Value {
        let value = self.0.load(Ordering::Acquire);
        json!({"phase":match value & 255 {
            0=>"created",1=>"ready-frame",2=>"ready-event",3=>"result-frame",
            4=>"png-body",5=>"result-event",6=>"trailing-byte",7=>"stderr-read",
            8=>"stdin-write",9=>"stdin-flush",10=>"written-event",_=>"unknown"
        },"completion":match value >> 8 {
            0=>"pending",1=>"eof",2=>"broken-pipe",3=>"written",4=>"read-error",
            5=>"schema-error",6=>"channel-error",7=>"trailing-data",
            8=>"budget-error",9=>"write-error",_=>"unknown"
        }})
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn timeline_orders_pending_and_eof_and_has_a_fixed_budget() {
        let progress = Progress::default();
        progress.phase(Phase::TrailingByte);
        progress.finish(Completion::Eof);
        let timeline = progress.timeline();
        let rows = timeline.as_array().unwrap();
        assert_eq!(rows.len(), 3);
        assert_eq!(rows[1]["state"], 6);
        assert_eq!(rows[2]["state"], 262);
        assert!(rows
            .windows(2)
            .all(|pair| pair[0]["tickMs"].as_u64() <= pair[1]["tickMs"].as_u64()));
        for _ in 0..50 {
            progress.phase(Phase::TrailingByte);
        }
        assert_eq!(progress.timeline().as_array().unwrap().len(), 24);
    }
    #[test]
    fn blocked_reader_progress_and_cancelled_completion_remain_distinct_from_eof() {
        let progress = Progress::default();
        let worker = progress.clone();
        let (entered, ready) = std::sync::mpsc::channel();
        let (cancel, released) = std::sync::mpsc::channel();
        let reader = std::thread::spawn(move || {
            worker.phase(Phase::TrailingByte);
            entered.send(()).unwrap();
            released.recv().unwrap();
            worker.finish(Completion::ReadError);
        });
        ready.recv().unwrap();
        assert_eq!(
            progress.snapshot(),
            json!({"phase":"trailing-byte","completion":"pending"})
        );
        cancel.send(()).unwrap();
        reader.join().unwrap();
        assert_eq!(
            progress.snapshot(),
            json!({"phase":"trailing-byte","completion":"read-error"})
        );
        assert_ne!(progress.snapshot()["completion"], "eof");
    }
}
