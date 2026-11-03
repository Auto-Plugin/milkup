// Host-private code identity reviewed with the 1.3.0 bundled Worker archive.
// These are native catalog seals, not a capability fingerprint or a receipt.
// Staging must fail on drift; changing these values requires reviewing the new
// package. Neither plugin-supplied metadata nor a build can extend this identity.
export const REVIEWED_MERMAID_PACKAGE = Object.freeze({
  pluginId: 'milkup.diagrams',
  rendererId: 'diagrams.mermaid',
  manifestSha256: 'bf619c6e213a8d1f9a7eb9c9808234c20c037970dba3c8a931fd6188ad074421',
  contentSha256: '299e683daece532238d0a46f6dffaf0c3a36d57a70597c42dccba5a26e7e998c',
})
