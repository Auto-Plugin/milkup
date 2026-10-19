# Mounted UI retirement fix

The production03 outline run p6-m02-outline-01 retains its failed status. Native catalog was disabled while the mirror reported Plugin cleanup did not fully complete. Its raw observation did not expose the nested cause, so the exact inner production exception was not recovered from that record.

The manager control flow deterministically dispatches renderUi(dispose) for mounted UI after revokeExecutionEpoch has already called runtime.disablePlugin. runtime.render rejects disabled renderers. The new mounted-panel regression reproduces the same outer AggregateError, with the serialized inner error Renderer is not available: outline-panel (mounted-ui-red.log). Base fixtures had no mounted UI and did not take this path.

Fix: revoke the epoch first and clear host UI tracking synchronously. Runtime activation disposal and the trusted isolation owner reclaim resources; manager teardown does not dispatch new UI renderer RPC into the retired realm. A late host panel-close notification after retirement returns without RPC. Normal enabled panel disposal continues to invoke its renderer. A renderer completing after an epoch change cannot add/remove UI tracking for a new epoch.

Real owner rejection remains a blocking cleanup failure, retains retry handles, and is explicitly covered by the adjacent regression. No runtime is re-enabled to make cleanup succeed.

Validation: mounted-ui-green.log has 57 passing tests across catalog/manager/output/editing; mounted-ui-types.log is desktop TypeScript exit 0; owned files formatted. Native production04 confirmation remains Root-owned and pending.
