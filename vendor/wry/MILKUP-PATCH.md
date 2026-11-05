# Milkup Windows frame boundary patch

This is the pinned wry 0.55.1 crate, retaining upstream licenses. `MILKUP-UPSTREAM.json` records the original file hashes. The only upstream files changed are `src/webview2/mod.rs` and its API documentation in `src/lib.rs`.

WebView2 injects initialization scripts into child frames. The patched Windows backend honors `for_main_frame_only` by guarding the script before it runs. This prevents Tauri's invocation credential and main-frame plugin state from being initialized inside the opaque fixed Mermaid frame. The generic `window.ipc` convenience wrapper is also initialized only in the top frame.

This patch alone is not claimed to prove absence of native dispatch. Milkup additionally registers a frame message receiver that rejects rather than forwards frame messages, records a fixed nonce for the boundary test, and rejects frame navigation outside `about:srcdoc`. The production renderer requires a native rejection record before it receives any diagram source. Real Windows testing remains necessary.

This does not provide per-frame OS memory quotas or hard termination of arbitrary JavaScript. It does not admit third-party plugin code into the frame. The renderer loads only the pinned official Mermaid bundle and the host's fixed bootstrap, uses an opaque `allow-scripts` sandbox, and returns bounded PNG bytes after isolated SVG validation and canvas rasterization.
