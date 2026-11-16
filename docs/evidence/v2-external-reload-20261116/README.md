# Small-document external reload: late-result protection

Base: v2 integration `491089e8e35d3e21327c8e39126e82127e42fd64`,
branch `dot/release-quality-integration-20261112`. Its remote ref was verified.
This candidate preserves the integration branch's Mermaid pending-preview,
catalog-refresh and file-conflict fixes. It does not copy the older research main.ts.

## Defect and change

`reloadExternalDocument` checked eligibility before awaiting the native read.
It then replaced the editor state before the bridge validated the returned
document identity. Edits or document switches during that await could therefore
replace the current document even when bridge validation subsequently threw.

Capture the admitted view, immutable text document, document ID/version, file
path and disk snapshot. Immediately before commit, require the newest admitted
request, the same identities, a clean modified-external session and no open/save/
close transition. Superseded results do not touch notices/focus; invalidated
same-document results retain content and report cancellation without refocusing.
Selection-only movement still permits normal reload. Validate the native response
with the existing bridge before mutating editor state. Existing cancellation,
read errors, large-document confirmation and normal reload behavior remain.

## Reproducible regression

Node 24:
```
node --test tests/native/external-reload-contract.test.mjs
# equivalently, with the repository package manager:
pnpm test:desktop:external-reload
```

The test extracts the actual production function and actual bridge validation/
line-ending functions, strips TypeScript types with Node, and controls only the
asynchronous native-read boundary plus UI collaborators. It does not duplicate
the reload implementation. The same contracts executed against the exact base
had 4 passes / 17 failures; the candidate has 21 passes / 0 failures / 0 skips.
Raw local outputs are retained beside this report.

Covered: normal commit and CRLF, late edits, document switch, view disposal,
version/path/disk snapshot/text identity changes, dirty/external state, busy/save/
close transitions, selection-only changes, both duplicate completion orders,
newest cancellation suppressing an older read, read rejection, and native identity
mismatch before any editor mutation. Existing conflicting documents admit no read.

Local disk returned ENOSPC when creating a preparation directory. Only this
task's redundant test log and redundant backup were removed after verifying
their complete existing copies; no original history or evidence was deleted.
The candidate was prepared in memory from the exact GitHub source blob and
saved through authorized repository APIs on a new isolated v2 branch.
The normal full desktop typecheck/build, browser and installed native regressions
were NOT run. This is not an installed/native pass or a release-readiness claim.
No CI dispatch, runtime rebuild, package install, main merge, release, production,
security or notification change is part of this fix. Run 43890194973 is untouched.
