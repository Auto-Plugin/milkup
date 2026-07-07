# Implementation Decisions

This document closes the architecture questions that were left open during the early planning phase. These decisions reflect the current repository state and should be revisited only through a new decision note.

## Frontend App Framework

Decision: keep the editor core and current app shells framework-free TypeScript for v1 foundation work. If the product shell needs a component framework later, prefer Svelte over React.

Rationale:

- `packages/core`, `packages/markdown`, `packages/view-dom`, and `packages/input` are framework-independent.
- `apps/playground` and `apps/desktop` currently prove the editor can run without binding the core to a UI framework.
- Svelte remains the preferred future product-shell framework because it keeps runtime overhead low and does not require the editor model to adopt a React-style reconciliation contract.

## Text Storage Implementation

Decision: keep `TextDocument` and `DocumentStore` as the public contracts; use the current memory implementation for normal documents, and prefer Piece Table before Rope for the first replaceable production storage engine.

Rationale:

- `MemoryTextDocument` preserves Markdown source exactly and gives a simple, well-tested contract for normal editing.
- `DocumentStore` already separates chunk/window reads, mutation, snapshots, and flush, allowing a future Piece Table, Rope, or native store to replace the backing data structure.
- Piece Table is the first production-storage target because it fits editor undo/redo and original-file preservation. Rope remains a future option for very large random edit workloads.

## Markdown Parser Compliance Target

Decision: target CommonMark as the baseline syntax model and GFM as the first extension set.

Rationale:

- The current parser is source-preserving and error-tolerant, which matches CommonMark-style parsing needs.
- GFM pipe tables are already represented in the CST and export pipeline.
- Future compliance work should add official CommonMark and GFM spec fixtures before claiming broad compatibility.

## Plugin Isolation Level

Decision: Browser Worker is the default JavaScript plugin realm. Sidecar is the explicitly approved advanced host tier. In-process plugin modules are denied by default and reserved for trusted tests or development fixtures.

Rationale:

- `PluginRuntime.allowedHosts` defaults to `worker`.
- Sidecar manifests require explicit host-tier approval and run through lifecycle/RPC adapters.
- Filesystem and network access go through scoped brokers, with permissions projected into Action Registry, CLI, and MCP metadata.
- The M11 sandbox audit maps this decision to package, CLI, desktop, Rust, and native WebDriver evidence.

## MCP Server Runtime

Decision: MCP tools and resources are generated from the shared Action Registry and projection layer. The implemented runtime is a headless JSON-RPC/stdio-capable server; an embedded desktop MCP runtime must reuse the same Action Registry and Tauri broker policy when added.

Rationale:

- `@milkup/mcp` projects tools from `ActionRegistry` rather than maintaining a separate tool list.
- MCP resources expose document, selection, and workspace context through the same model used by actions.
- Headless MCP is the current verified runtime path. Embedded desktop MCP is a future adapter around the same contracts, not a new capability model.
