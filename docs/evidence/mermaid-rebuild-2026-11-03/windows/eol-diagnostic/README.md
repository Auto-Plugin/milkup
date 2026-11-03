# Windows EOL mechanism experiment

Run `41634920060` failed during checkout because this new diagnostic workflow
omitted the existing build workflows’ process-scoped `core.longpaths=true`
setting. The original evidence tree contains long paths. The experiment never
ran and this result provides no EOL conclusion. The original log is retained.

Commit `b919afba` restores the same Git option for checkout; it does not change
Windows policy, source bytes, or the original strict build gate.

Run `41635167582` completed successfully and preserved the original checkout.
Both exact original HEAD blobs are LF, 123,209 bytes, SHA-256
`b0db3c2e2fe2f1257a33a04b1cdfbce35ee7cd054220999d2e7a44a56afacb25`;
Windows checked them out as 125,620 bytes containing 2,411 CRLF pairs, SHA-256
`8417bdfab75b381351a6370e314f02c555adfe7f6f39eabf75f7350f0a3122b2`.
Their LF-normalized bytes match HEAD. The explicit `text eol=lf` synthetic group
remained byte-identical and clean throughout.

This run did **not** reproduce the actual build's dirty-after-write state: the
original-attributes synthetic group was already dirty before its rewrite because
`checkout-index` omitted `--index`, leaving stat metadata from initial LF staging.
Commit `d310cbe1` corrects that experimental setup and requires a clean control
before any rewrite. The successful run is not presented as a completed causal
reproduction or a passing product build.
