# Attached App CLI Protocol

Attached CLI mode lets `milkup` forward action requests to an already-running desktop app instead of creating a headless editor.

## CLI Flag

Use `--attached-url` on action commands:

```bash
milkup action list --attached-url http://127.0.0.1:3765/milkup-cli
milkup action describe document.replaceSelection --attached-url http://127.0.0.1:3765/milkup-cli
milkup action run document.replaceSelection --attached-url http://127.0.0.1:3765/milkup-cli --input '{"text":"hello"}'
```

Without `--attached-url`, the CLI continues to use the existing headless editor path.

## Transport

The CLI sends JSON-RPC 2.0 requests over HTTP `POST` with `content-type: application/json`.

Required methods:

- `action/list`
- `action/describe`
- `action/run`

Example request:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "action/run",
  "params": {
    "actionId": "document.replaceSelection",
    "input": { "text": "hello" },
    "permissions": ["document:write"]
  }
}
```

Example response:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "action": "document.replaceSelection",
    "output": { "changed": true },
    "documentId": "desktop-doc",
    "selection": { "anchor": 5, "head": 5 }
  }
}
```

Errors use the normal JSON-RPC error shape; the CLI surfaces `error.message` as stderr.

## Host Responsibilities

The attached desktop host must:

- Run actions through the same `ActionRegistry` as GUI commands.
- Use the active document, current selection, and active window context unless the action input says otherwise.
- Apply permission filtering before listing or running actions.
- Reject requests when there is no active editor context.
- Keep the loopback endpoint local-only and require an explicit user/app opt-in before exposing it.

The current implementation provides the CLI client contract and tests. A production desktop loopback host must reuse this protocol instead of inventing another attached-mode command surface.
