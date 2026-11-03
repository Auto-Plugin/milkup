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

The corrected Windows experiment `41635596471` **passed**, using instrumentation
`56ca025ff3a24081015eccd51bc8a10259b31c10` and the unchanged original ca10 checkout.
Both synthetic groups began clean. With original attributes, an LF-only rewrite
of the two exact schema blobs produced the same two ` M` entries and an empty
text diff; index refresh returned 1 and left both entries dirty. With explicit
`text eol=lf`, checkout/rewrite/refresh all remained clean and byte-identical.
The raw log, run metadata and all byte/hash/newline/index snapshots are retained.

Together with the actual original-source build replay (first mutation at desktop
check, same two paths, empty diffs) and the locked Tauri generator code, this
identifies the CRLF checkout versus LF generation mismatch. The correction pins
only these two paths to LF in `.gitattributes`. The strict build gate is unchanged:
any dirty tracked/untracked source still fails. No checkout/reset/restore or
index-refresh operation is added to the product build. The next actual Windows
product workflow must independently prove a clean source build before UI testing.
The original first run did not print its changed paths, so its unrecoverable
file list is not misrepresented as direct evidence from this later experiment.
