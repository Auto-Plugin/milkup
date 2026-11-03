# Windows EOL mechanism experiment

Run `41634920060` failed during checkout because this new diagnostic workflow
omitted the existing build workflows’ process-scoped `core.longpaths=true`
setting. The original evidence tree contains long paths. The experiment never
ran and this result provides no EOL conclusion. The original log is retained.

Commit `b919afba` restores the same Git option for checkout; it does not change
Windows policy, source bytes, or the original strict build gate.
