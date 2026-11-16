# Behavior candidate built; native acceptance not executed

- Run: https://github.com/Auto-Plugin/milkup/actions/runs/43811419661
- Tested SHA: `e1dc335b2ee86c6ccf49975414b74e71097e0089`.
- Branch: `dot/linux-webkit-build-probe-20261114`; research only.
- Original build evidence: artifact `14201112418`, retained unchanged as
  `build-original.zip` (5,167,934 bytes, SHA-256
  `4cd12491fcf49dc5009d2e76843c68405b7b3e901fd1ba0d24ea99184ddb94c4`).

The candidate implements a bounded heading/table first-fragment keep in the
legacy block fragmenter and separate continuation-header space reservation
plus painting in table layout. The exact patch hash remains
`660f13b8e61ed2e6af4a1bec7602e08755b4deb685e4af9d6c639053286f210f`.
No CSS, application HTML, original installed package or guard was changed.

The inherited four-TU gate and exact old-cache restore/first-hit gates passed.
The three changed source files are covered by **two distinct actual unified
translation units**, both compiled successfully with real generated headers
and flags. Earlier shorthand “three TUs” meant three source files; the retained
compiler commands are authoritative. The full engine then compiled and linked
successfully in 465.932 seconds: 3,235 cache hits, 28 misses and 3,263 completed
object targets. This is build evidence, not loaded-runtime or PDF evidence.

The next step, `Preserve verified compiler objects after success or controlled
stop`, failed. `webkit-pagination-cache.identity()` included a seventh fixed
digest, `behaviorInputs`, but the shared old `object_bundle.key()` accepted
exactly six. It raised `Exact input digests required; no environment or
credentials`. The strict check correctly refused to save a mislabeled bundle.
The workflow stopped before assets, installation or native PDF. No new object
archive or runtime was retained; the 28 new objects are not reusable from this
run. Original observation archive `14199955883` remains the valid base.

The local repair adds a separate fixed seven-field cache schema/key namespace.
The six-field key remains byte-identical. Behavior identity is never stripped;
unknown fields, malformed digests, changed identity and downgrade on restore
are rejected. The exact downloaded seven-field receipt reproduces the old
error and produces the new key recorded in `result.json`.

Local validation after repair:

- Cache transfer contracts 10/10; original object-only contracts 8/8.
- Behavior contracts 6/6, including original native failure rejection.
- Real existing ccache 4.7.5 and a compiler, in temporary directories: both
  six- and seven-field archives restored with a first-process hit, zero miss
  and identical object bytes; changed header and flags each produced a miss.
  See `cache-schema-fixed-local-live.json`. This is synthetic cache evidence,
  not WebKit or PDF acceptance. The same extended check is now wired before
  expensive CI reconstruction.
- Offline PDF reviewer rechecked all four previous original PDFs and retained
  the orphan and repeated-header failures. It can inspect a failed native case
  independently rather than losing header evidence at the first assertion.

No second run was dispatched automatically. A corrected bounded follow-up can
reuse the original verified observation objects; measured incremental work is
28 misses rather than a cold build. It must still prove successful retention,
actual mapped private WebProcess identity and all native PDF contracts. The
40-minute/160-miss reconstruction limits and strict cleanup/identity/contents
remain unchanged; no acceptance gate was bypassed.

Still unverified: candidate heading/header/first-row geometry, repeated headers,
A4/Letter orientations, clipping/content ordering and normal native cleanup.
Oversized/forced-break/margin policies have local arithmetic coverage only.
Known Unicode/URI and complex-table limitations remain separate release gaps.
The research runtime is not a deliverable: upstream/distribution integration,
security updates, exact supported-package tests and release maintenance remain
required. No system runtime, sandbox, main, release, notification or production
configuration changed.
