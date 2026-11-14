# Original b877 installer preservation — 2026-11-12

The three original artifact ZIP files from [build 43176766599](https://github.com/Auto-Plugin/milkup/actions/runs/43176766599) were already downloaded locally. On November 12 each complete ZIP was checked against the current GitHub artifact byte length and SHA-256 digest, read through ZIP CRC validation, and compared to its extracted installer. Installer hashes match both the original manifest/SHA256SUMS and subsequent install acceptance run 43182892985. Standard-package installed document/export/dirty-close acceptance is run 43182444625; source product/GUI acceptance is 43176724739.

No rebuild, binary modification, signature change or Release was performed. Original build-stage manifests retain their historical `built-not-installed` state; later acceptance records are preserved separately, with their scope limitations.

## Retained files

Local directory: `/workspace/milkup-preserved-b877746f-20261112/`.

- standard: `milkup-2.0.0-beta.10-windows-standard-b877746f5dfd.exe`, 7253821 bytes; installer SHA-256 `605a428bd3f985e82854ead0f6f24026780449df0402257793ba474f8a45a425`. Original artifact 13925585212; ZIP `milkup-windows-standard-b877746f5dfd236dfc13f718ed23d837b8e4f89d-artifact-13925585212.zip`, SHA-256 `27c412486d91bdf1c4fce390b8c373c4c913c3a038e4562de2855a507ff039dc`; Actions expiration `2026-11-13T07:48:19Z`.
- offline: `milkup-2.0.0-beta.10-windows-offline-b877746f5dfd.exe`, 225032492 bytes; installer SHA-256 `bf6ae351d874dd51e38d981afca86338d790d331098d3ce98cb45dca828150d0`. Original artifact 13926086243; ZIP `milkup-windows-offline-b877746f5dfd236dfc13f718ed23d837b8e4f89d-artifact-13926086243.zip`, SHA-256 `a4fa598961ee18c9185bec282a94492de0271baf545756ddc0f6719813b2ee89`; Actions expiration `2026-11-13T08:00:51Z`.
- linux: `milkup-2.0.0-beta.10-linux-deb-b877746f5dfd.deb`, 9845776 bytes; installer SHA-256 `36c4873d840a06e85bf08398e119f9ddb494c813727eff6479aa4e434141f86e`. Original artifact 13926127345; ZIP `milkup-linux-deb-b877746f5dfd236dfc13f718ed23d837b8e4f89d-artifact-13926127345.zip`, SHA-256 `18e60ffe64f2f8f4b1f8aa75c9e5ebded8031f598b1dcc8e6cd3f0b0b8f8c2b6`; Actions expiration `2026-11-13T08:06:29Z`.

The directory also contains `preservation-manifest.json`, `SHA256SUMS.txt`, `retention-status.json` and `milkup-b877746f-provenance-and-acceptance.zip`. The provenance ZIP preserves GitHub metadata, build/installer digests, relevant acceptance reviews and remaining scope boundaries. It contains no screenshots.

## Persistent retention blocker

The Library search did not find a b877-named retained item; this is not proof that no other-name copy exists. A new preservation batch was attempted using the current required Library upload helper. It failed at **hosted apps tools/list HTTP 401**, before preparation, upload or finalization. No Library identity or upload session was returned. No fallback write was made and no authentication bypass was attempted.

**Persistent Library retention is not confirmed.** The local files are verified and ready, but the workspace alone is not being represented as a durable backup. Restore the helper's authorized Library connection and save the three original ZIPs plus provenance before the Actions expirations. The original ZIPs can be transferred unchanged; there is no need to build again.
