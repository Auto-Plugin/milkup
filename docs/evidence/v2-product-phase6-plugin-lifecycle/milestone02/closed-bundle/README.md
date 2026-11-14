# Closed Worker bundle regression

`baseline-repro.mjs` extracts the exact `prepareModule` method from baseline 633a6d7910f9fa44b9fa89628967e6b7105071ec, removes only TypeScript annotations, and executes its Worker branches with bounded file-read fixtures. Both a direct data URL and a local entry containing dynamic import were accepted; two required-rejection assertions failed. It does not claim that fixture code executed or that a network request occurred.

`../closed-bundle-missing-module-red.log` is only an initial missing-implementation test failure, not proof of an original product bug. `../closed-bundle-green.log` records ten syntax-policy assertions passing after implementing the lexer boundary. Production now obtains the module bytes from the native selected generation and validates them before creating the Blob URL.

The existing pinned es-module-lexer 1.7.0 pure JavaScript entry (`/js`) avoids a WebAssembly/eval exception. All module imports except `import.meta` are rejected, including computed dynamic imports and export-from. Strings/comments are allowed. This is a closed-bundle check, not a full JavaScript parser or complete malicious-code sandbox.

The native production run is separately recorded under native-ui. Blob Workers are used because ordinary URL Workers do not inherit creator CSP; see https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers#content_security_policy . Production script-src omits unsafe-eval and bootstrap checks both eval and intrinsic Function denial before importing untrusted code; see https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/script-src .
