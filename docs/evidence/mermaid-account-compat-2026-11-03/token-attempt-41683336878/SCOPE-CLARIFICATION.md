# Scope clarification after independent implementation review

The original README's phrase “This probe did not attempt token duplication,
impersonation” is specifically true of the **linked-token experiment**, not of
every existing helper safety check reused by its supervisor.

The unchanged `check_code_parent_access` function duplicates the actual
low-privilege AppContainer child token and temporarily impersonates that
restricted identity for negative write-access checks, then calls `RevertToSelf`.
It never uses a returned linked token. This function was already part of the
accepted same-login native launcher and was reused by the test supervisor.

The linked-token experiment queried the returned linked objects and made the
three authorized `DuplicateHandle` requests. It did not call `DuplicateToken`,
impersonate, adjust privileges, assign a token, or launch a process using any
returned linked token. The parent and child-self query records each independently
show actual `ERROR_NO_TOKEN` (1008) for their calling thread at observation time.

This clarification changes no original ZIP, raw report, log, or observed result.
The exact SID, token type/level, full handle rights and cleanup findings remain
as recorded. `archive-manifest.json` describes the previously frozen files;
this later explanatory note is intentionally separate from that original list.
