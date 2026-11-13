# Existing private ETW retention check — 2026-11-13

At 22:53 UTC, all four retained artifact ZIPs were readable in the existing
isolated workspace. Their byte counts and SHA-256 digests matched the current
GitHub artifact metadata. Every sealed payload matched its retained summary.
Using the **existing local key only**, authenticated decryption succeeded for all
four bundles into a fresh mode-0700 temporary directory. All 25 internal files
matched the existing private copies byte-for-byte; ZIP CRC checks also passed.
The temporary verification plaintext was removed afterward. No key was created,
printed or transmitted, and no raw trace was uploaded or published by this check.

The original ETL remains 550,502,400 bytes, SHA-256
`4ca45baaa69c468edddca6499f110608e4a788268b3dd5f52678d94a2faec13b`,
matching the previously committed analysis report. The partial nature of the
last symbol-analysis run is unchanged by this successful integrity check.

| Run | Artifact | Expiry (UTC, 2026-11-20) | ZIP SHA-256 |
|---|---:|---|---|
| 43513112486 | 14080227264 | 21:55:59 | `7d962c072b925a785308e4eb4b07bc7901c126d9fc3dcde2bb8de8252427e90f` |
| 43515322201 | 14080422603 | 22:00:00 | `104d0f603c8ba859d614f1a68b23159898e2a0208ba50bb87e872cd7a02772f8` |
| 43515829392 | 14079888858 | 22:03:04 | `966948e89cc4a1263fd768e70b0312bb27a1028d6cc3bcdfb6e7438fc309cbe9` |
| 43517089223 | 14082370229 | 22:16:17 | `e5183405a72326eef1941385e69ac65c36f208752ba7df6118806e13bf941dcc` |

Existing copies are under `/workspace/milkup-etw-results-43513112486`.
This workspace survived the current reconnection, but it is **temporary storage
with no guaranteed retention period**. No durable external copy or extended
Actions expiry has been established. The remote artifacts were not expired at
verification time; their expiry remains as listed above.

The accompanying JSON contains sanitized verification results, archive hashes,
entry counts and expiry metadata. It contains no key material or trace payload.
