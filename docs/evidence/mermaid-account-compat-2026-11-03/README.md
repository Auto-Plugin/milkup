# Windows account compatibility follow-up

The delivered beta.8 installer remains frozen at source
`a5431693a4ea1e1a282c16b9cc9651e17b67f9ea`, Actions run `41668620695`,
ZIP SHA-256 `0ffb9793b1ab3c025b6d9d97497260ac3ad8526735bc4f1384343830702da089`.
This follow-up begins after its evidence commit
`1494852518fb449191c839ef8573ba548bbefaa3`. It does not replace that ZIP,
its Library copy, or its original reports. No main merge or Release is authorized.

## Cause and intended boundary

The original launcher rejected all Administrators membership, including
deny-only membership, and every elevation type except Default. This rejection
preceded private profile/Job/browser creation. It therefore rejected the usual
non-elevated UAC administrator launch without establishing an AppContainer
failure. The proposed compatibility scope is a real Limited, non-elevated,
medium-integrity primary token with the current user as owner, no UIAccess,
an exact interactive session, and only ordinary user privileges. An administrator
SID must be deny-only; enabled/default-enabled/owner authority remains rejected.
The old pure-standard boolean keeps its original meaning.

The existing `CreateProcessW` plus creation-time `SECURITY_CAPABILITIES`, exact
handle list and owned Job are retained. No linked-token selection, privilege
adjustment, account switch, UAC change or desktop-ACL change is introduced into
the product. Suspended helper, child self-check and browser token observations
must verify low integrity, no administrative authority, zero capabilities,
the same user/session and exact fresh AppContainer identity before proceeding.
The helper/browser must also report Default elevation type, which has no linked
token. Limited remains valid only for the host. A Limited-container combination
has not been specifically verified here; rejecting it is conservative scope,
not a claim that a vulnerability was discovered.
Elevated, UAC-disabled/default-admin and unrecognized tokens remain unsupported.

Independent review found no need to add `CreateRestrictedToken` or
`CreateProcessAsUser`: the former does not by itself establish all required
token properties, and the latter introduces additional privilege/API conditions.
The account fixtures are separate from product code: only newly owned test
accounts may acquire the group membership needed for their declared test kind.
Actual suspended-token evidence determines whether the fixture is admissible;
a full token is never relabeled as filtered.

Primary references: [deny-only SID semantics](https://learn.microsoft.com/en-us/windows/win32/secauthz/sid-attributes-in-an-access-token),
[creation-time AppContainer attribute](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-updateprocthreadattribute),
[AppContainer access model](https://learn.microsoft.com/en-us/windows/win32/secauthz/implementing-an-appcontainer),
[CreateProcessAsUser requirements](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-createprocessasuserw).

## Other findings

The close probe's `value.value ?? value` unwrapping turns a valid JSON null into
a truthy envelope. The follow-up records bounded raw responses and makes only
literal boolean true a visible-dialog observation. An actual dialog on a clean
successful-close path must fail acceptance; null/closed-frame observation still
requires the exact process to exit normally under the original deadline.
The original beta.8 response was not retained, so its historical ambiguity
cannot be retroactively diagnosed as this specific response.

C4 investigation found a label positioned toward the destination node plus the
private three-unit white background padding. Any correction must leave the
official Mermaid 12.2.0 asset bytes and connector endpoints unchanged, avoid
large reflow or overridden author offsets, and retain before/after images.

## Acceptance status

Local policy, account-fixture, close-probe and rendering regressions have passed;
their exact outputs are retained separately. Separate real Windows
pure-standard and filtered-admin product runs, plus actual elevated-host rejection,
are required before claiming compatibility. Local policy tests or a matching
account name are not native execution evidence.
