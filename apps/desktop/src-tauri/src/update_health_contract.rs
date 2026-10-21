//! Pure, test-only lifecycle specification. No IPC, installer, process launch,
//! filesystem writer, signature verifier, health probe or rollback executor.
//! Completion/health inputs represent already-authenticated HOST observations;
//! their authentication adapters do not exist yet. Matching fields is not proof.
use serde::{Deserialize, Serialize};

const MAX_RECORD: usize = 4096;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Binding {
    process_instance: String,
    app_sha256: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", deny_unknown_fields)]
enum Phase {
    Prepared,
    HandoffPending,
    AwaitingCompletion,
    AwaitingHealth { binding: Binding },
    HealthConfirmed { binding: Binding },
    LaunchRejected,
    Cancelled,
    Attention { reason: Attention },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
enum Attention {
    Deadline,
    Interrupted,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Record {
    schema: u32,
    transaction: String,
    revision: u64,
    previous_version: String,
    expected_version: String,
    installer_sha256: String,
    old_process_instance: String,
    started: u64,
    last_observed: u64,
    deadline: u64,
    phase: Phase,
}

struct Completion {
    version: String,
    installer_sha256: String,
    binding: Binding,
}

struct Health {
    version: String,
    binding: Binding,
    storage_ready: bool,
    plugin_host_ready: bool,
    document_safety_ready: bool,
}

enum Event {
    BeginHandoff,
    LaunchAccepted,
    LaunchRejected,
    Completion(Completion),
    Health(Health),
    Cancel,
    Deadline,
    Interrupted,
}

fn hex(value: &str, length: usize) -> bool {
    value.len() == length
        && value
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
}

fn version(value: &str) -> Result<semver::Version, &'static str> {
    if value.len() > 128 {
        return Err("version too long");
    }
    let parsed = semver::Version::parse(value).map_err(|_| "invalid version")?;
    if parsed.to_string() != value {
        return Err("noncanonical version");
    }
    Ok(parsed)
}

impl Record {
    fn validate(&self) -> Result<(), &'static str> {
        if self.schema != 1
            || !hex(&self.transaction, 32)
            || !hex(&self.old_process_instance, 32)
            || !hex(&self.installer_sha256, 64)
            || self.deadline <= self.started
            || self.deadline - self.started > 600
            || self.last_observed < self.started
            || !version(&self.expected_version)?
                .cmp_precedence(&version(&self.previous_version)?)
                .is_gt()
        {
            return Err("invalid lifecycle record");
        }
        let minimum_revision = match self.phase {
            Phase::Prepared => 0,
            Phase::HandoffPending | Phase::Cancelled | Phase::Attention { .. } => 1,
            Phase::AwaitingCompletion | Phase::LaunchRejected => 2,
            Phase::AwaitingHealth { .. } => 3,
            Phase::HealthConfirmed { .. } => 4,
        };
        if self.revision < minimum_revision
            || (matches!(self.phase, Phase::Prepared)
                && (self.revision != 0 || self.last_observed != self.started))
        {
            return Err("inconsistent lifecycle revision");
        }
        if let Phase::AwaitingHealth { binding } | Phase::HealthConfirmed { binding } = &self.phase
        {
            if !hex(&binding.process_instance, 32)
                || !hex(&binding.app_sha256, 64)
                || binding.process_instance == self.old_process_instance
            {
                return Err("invalid new-process binding");
            }
        }
        if matches!(self.phase, Phase::HealthConfirmed { .. })
            && self.last_observed >= self.deadline
        {
            return Err("health confirmed after deadline");
        }
        Ok(())
    }

    fn pending(&self) -> bool {
        matches!(
            self.phase,
            Phase::Prepared
                | Phase::HandoffPending
                | Phase::AwaitingCompletion
                | Phase::AwaitingHealth { .. }
        )
    }

    // Returns a proposal. A future durable coordinator must compare-and-swap
    // under its lock and persist BEFORE publishing this revision or doing I/O.
    fn advance(
        &self,
        transaction: &str,
        revision: u64,
        event: Event,
        now: u64,
    ) -> Result<Self, &'static str> {
        self.validate()?;
        if transaction != self.transaction || revision != self.revision {
            return Err("stale transaction/revision");
        }
        if now < self.last_observed {
            return Err("clock moved backwards");
        }
        // Expiry blocks positive confirmation. A known launch refusal or a
        // pre-handoff cancellation still records that no installation started.
        if now >= self.deadline
            && !matches!(
                event,
                Event::Deadline | Event::Interrupted | Event::LaunchRejected | Event::Cancel
            )
        {
            return Err("deadline requires reconciliation");
        }
        let phase = match (&self.phase, event) {
            (Phase::Prepared, Event::BeginHandoff) => Phase::HandoffPending,
            (Phase::Prepared, Event::Cancel) => Phase::Cancelled,
            (Phase::HandoffPending, Event::LaunchRejected) => Phase::LaunchRejected,
            (Phase::HandoffPending, Event::LaunchAccepted) => Phase::AwaitingCompletion,
            (Phase::AwaitingCompletion, Event::Completion(receipt)) => {
                if receipt.version != self.expected_version
                    || receipt.installer_sha256 != self.installer_sha256
                {
                    return Err("completion does not bind this offer");
                }
                Phase::AwaitingHealth {
                    binding: receipt.binding,
                }
            }
            (Phase::AwaitingHealth { binding }, Event::Health(health)) => {
                if health.version != self.expected_version
                    || health.binding != *binding
                    || !health.storage_ready
                    || !health.plugin_host_ready
                    || !health.document_safety_ready
                {
                    return Err("health observation not ready or not bound");
                }
                Phase::HealthConfirmed {
                    binding: binding.clone(),
                }
            }
            (_, Event::Deadline) if self.pending() && now >= self.deadline => Phase::Attention {
                reason: Attention::Deadline,
            },
            (_, Event::Interrupted) if self.pending() => Phase::Attention {
                reason: Attention::Interrupted,
            },
            _ => return Err("invalid lifecycle transition"),
        };
        let next = Self {
            phase,
            revision: self.revision.checked_add(1).ok_or("revision overflow")?,
            last_observed: now,
            ..self.clone()
        };
        next.validate()?;
        Ok(next)
    }

    fn encode(&self) -> Result<Vec<u8>, &'static str> {
        self.validate()?;
        let bytes = serde_json::to_vec(self).map_err(|_| "encode failed")?;
        if bytes.len() > MAX_RECORD {
            return Err("record too large");
        }
        Ok(bytes)
    }

    fn decode(bytes: &[u8]) -> Result<Self, &'static str> {
        if bytes.len() > MAX_RECORD {
            return Err("record too large");
        }
        let record: Self = serde_json::from_slice(bytes).map_err(|_| "invalid record bytes")?;
        record.validate()?;
        Ok(record)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn prepared() -> Record {
        Record {
            schema: 1,
            transaction: "1".repeat(32),
            revision: 0,
            previous_version: "2.0.0-beta.1".into(),
            expected_version: "2.0.0-beta.2".into(),
            installer_sha256: "a".repeat(64),
            old_process_instance: "2".repeat(32),
            started: 100,
            last_observed: 100,
            deadline: 200,
            phase: Phase::Prepared,
        }
    }
    fn binding() -> Binding {
        Binding {
            process_instance: "3".repeat(32),
            app_sha256: "b".repeat(64),
        }
    }
    fn receipt() -> Completion {
        Completion {
            version: "2.0.0-beta.2".into(),
            installer_sha256: "a".repeat(64),
            binding: binding(),
        }
    }
    fn health() -> Health {
        Health {
            version: "2.0.0-beta.2".into(),
            binding: binding(),
            storage_ready: true,
            plugin_host_ready: true,
            document_safety_ready: true,
        }
    }
    fn step(record: &Record, event: Event, now: u64) -> Record {
        record
            .advance(&record.transaction, record.revision, event, now)
            .unwrap()
    }
    fn awaiting_completion() -> Record {
        step(
            &step(&prepared(), Event::BeginHandoff, 101),
            Event::LaunchAccepted,
            102,
        )
    }
    fn awaiting_health() -> Record {
        step(&awaiting_completion(), Event::Completion(receipt()), 103)
    }

    #[test]
    fn health_contract_launch_acceptance_is_never_completion_or_health() {
        let pending = awaiting_completion();
        assert_eq!(pending.phase, Phase::AwaitingCompletion);
        assert!(pending
            .advance(
                &pending.transaction,
                pending.revision,
                Event::Health(health()),
                103
            )
            .is_err());
        let waiting = awaiting_health();
        assert!(matches!(waiting.phase, Phase::AwaitingHealth { .. }));
        let done = step(&waiting, Event::Health(health()), 104);
        assert!(matches!(done.phase, Phase::HealthConfirmed { .. }));
        // This success assumes mocked authenticated observations. It does NOT
        // prove that an installer, child process, binary or storage is healthy.
        assert_eq!(Record::decode(&done.encode().unwrap()).unwrap(), done);
    }

    #[test]
    fn health_contract_cancel_and_known_launch_failure_allow_only_a_new_attempt() {
        let original = prepared();
        let cancelled = step(&original, Event::Cancel, 101);
        assert_eq!(cancelled.phase, Phase::Cancelled);
        let handoff = step(&original, Event::BeginHandoff, 101);
        assert!(handoff
            .advance(&handoff.transaction, handoff.revision, Event::Cancel, 102)
            .is_err());
        let rejected = step(&handoff, Event::LaunchRejected, 102);
        assert_eq!(rejected.phase, Phase::LaunchRejected);
        assert_eq!(
            step(&handoff, Event::LaunchRejected, 250).phase,
            Phase::LaunchRejected
        );
        assert_eq!(step(&original, Event::Cancel, 250).phase, Phase::Cancelled);
        assert!(rejected
            .advance(
                &rejected.transaction,
                rejected.revision,
                Event::LaunchAccepted,
                103
            )
            .is_err());
        let mut retry = prepared();
        retry.transaction = "4".repeat(32);
        assert!(retry
            .advance(
                &original.transaction,
                retry.revision,
                Event::BeginHandoff,
                103
            )
            .is_err());
        let next = step(&retry, Event::BeginHandoff, 103);
        assert!(next
            .advance(&next.transaction, 0, Event::LaunchAccepted, 104)
            .is_err());
        assert_eq!(
            step(&next, Event::LaunchAccepted, 104).phase,
            Phase::AwaitingCompletion
        );
    }

    #[test]
    fn health_contract_wrong_completion_or_old_process_never_binds() {
        let pending = awaiting_completion();
        for variant in 0..5 {
            let mut proof = receipt();
            match variant {
                0 => proof.version = "2.0.0-beta.1".into(),
                1 => proof.installer_sha256 = "c".repeat(64),
                2 => proof.binding.process_instance = pending.old_process_instance.clone(),
                3 => proof.binding.process_instance.clear(),
                _ => proof.binding.app_sha256 = "not-a-digest".into(),
            }
            assert!(pending
                .advance(
                    &pending.transaction,
                    pending.revision,
                    Event::Completion(proof),
                    103
                )
                .is_err());
        }
        assert_eq!(pending.phase, Phase::AwaitingCompletion);
    }

    #[test]
    fn health_contract_readiness_and_running_identity_must_all_match() {
        let waiting = awaiting_health();
        for variant in 0..6 {
            let mut proof = health();
            match variant {
                0 => proof.storage_ready = false,
                1 => proof.plugin_host_ready = false,
                2 => proof.document_safety_ready = false,
                3 => proof.version = "2.0.0-beta.1".into(),
                4 => proof.binding.app_sha256 = "c".repeat(64),
                _ => proof.binding.process_instance = "5".repeat(32),
            }
            assert!(waiting
                .advance(
                    &waiting.transaction,
                    waiting.revision,
                    Event::Health(proof),
                    104
                )
                .is_err());
        }
        assert!(waiting
            .advance(
                &waiting.transaction,
                waiting.revision,
                Event::Health(health()),
                200
            )
            .is_err());
        assert!(waiting
            .advance(
                &waiting.transaction,
                waiting.revision,
                Event::Health(health()),
                102
            )
            .is_err());
    }

    #[test]
    fn health_contract_timeout_and_interruption_never_order_rollback_or_claim_health() {
        for pending in [
            prepared(),
            step(&prepared(), Event::BeginHandoff, 101),
            awaiting_completion(),
            awaiting_health(),
        ] {
            for (event, now, reason) in [
                (Event::Deadline, 200, Attention::Deadline),
                (Event::Interrupted, 150, Attention::Interrupted),
            ] {
                let attention = step(&pending, event, now);
                assert_eq!(attention.phase, Phase::Attention { reason });
                assert!(attention
                    .advance(
                        &attention.transaction,
                        attention.revision,
                        Event::Health(health()),
                        now
                    )
                    .is_err());
            }
        }
    }

    #[test]
    fn health_contract_temp_snapshot_failure_restart_and_corruption_are_explicit() {
        let root = std::env::temp_dir().join(format!(
            "milkup-health-contract-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir(&root).unwrap();
        let path = root.join("synthetic.json");
        let old = prepared();
        std::fs::write(&path, old.encode().unwrap()).unwrap();
        let proposal = step(&old, Event::BeginHandoff, 101);
        // A proposal is pure: failed persistence must not publish it. This is
        // fault injection into the harness, not a durable product journal.
        assert!(std::fs::write(
            root.join("missing").join("state.json"),
            proposal.encode().unwrap()
        )
        .is_err());
        assert_eq!(Record::decode(&std::fs::read(&path).unwrap()).unwrap(), old);
        std::fs::write(&path, proposal.encode().unwrap()).unwrap();
        let reopened = Record::decode(&std::fs::read(&path).unwrap()).unwrap();
        let reconciled = step(&reopened, Event::Interrupted, 102);
        assert_eq!(
            reconciled.phase,
            Phase::Attention {
                reason: Attention::Interrupted
            }
        );
        for damaged in [
            b"{truncated".to_vec(),
            vec![b'x'; MAX_RECORD + 1],
            b"null".to_vec(),
        ] {
            std::fs::write(&path, &damaged).unwrap();
            assert!(Record::decode(&std::fs::read(&path).unwrap()).is_err());
            assert_eq!(std::fs::read(&path).unwrap(), damaged);
        }
        let mut invalid = serde_json::to_value(&old).unwrap();
        invalid["unexpected"] = true.into();
        assert!(Record::decode(&serde_json::to_vec(&invalid).unwrap()).is_err());
        let mut impossible = awaiting_health();
        impossible.revision = 0;
        assert!(Record::decode(&serde_json::to_vec(&impossible).unwrap()).is_err());
        let mut overflow = awaiting_health();
        overflow.revision = u64::MAX;
        assert!(overflow
            .advance(
                &overflow.transaction,
                overflow.revision,
                Event::Health(health()),
                104
            )
            .is_err());
        std::fs::remove_dir_all(root).unwrap();
    }
}
