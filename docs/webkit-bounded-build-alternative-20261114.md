# One different bounded WebKit build plan

43574464936 / 06ed15c5 ended at its own 150-minute compile boundary, not a
compiler error or proved resource exhaustion. Last visible step: 8648/9449;
2582/3263 compile-command objects completed. The final 30 minutes completed 168
objects. The longest completed object took 135.224 seconds. Final records were
still progressing through WebCore graphics unified sources; final WebKit linking,
private-library load and PDF acceptance did not run.

Original ZIP artifact 14110447854: 591,570 bytes, SHA-256
`d178c76343226bdd784bdd429d1250bf35b61830663b5bd717a869069faac0bf`.
Minimum MemAvailable was 6.840 GiB, minimum free disk 82.408 GiB; final build tree
was 1,425,054,486 bytes. The earlier two-job run completed only 2390 objects in the
same time, versus 2582 with three jobs. This does not justify assuming linear
scaling. At the most recent half-hour rate, the remaining 681 objects alone
would need about 122 minutes, with final links still additional.

No alternative build was already running. Repository cache API returned
`total_count=0`; previous evidence artifacts contain logs/cache metadata, not the
lost runner's object files. Listing custom/self-hosted runner inventory returned
HTTP 403, so no larger or paid runner is assumed available.

The one proposed explicit replacement uses the already measured Ubuntu 26.04
four-core host, four compiler jobs, at least 14 GiB total RAM and 20 GiB initial
free disk. It retains the exact source/patch, compiler optimization/hardening,
GNU linker, GTK3 and enabled bubblewrap sandbox. A signed-distribution ccache
installation retains at most 2 GB of compiler objects, never the private runtime
prefix or user documents; keyed object cache is an optimization, not proof.

Compile **and link** get at most 310 minutes, within a 350-minute operation budget
that reserves 35 minutes for private installation and actual installed GUI/PDF
proof. The job has 355 minutes including final evidence/cache upload. The compile
budget is shortened if prerequisites consume reserve time. Stops remain explicit:
free disk below 4 GiB, MemAvailable below 2 GiB, 30 minutes with no completed Ninja
edge, or the deadline. Three policy tests cover reserves/deadlines/stalls. No
retry or second dispatch is automatic. GitHub's hosted-job limit is six hours:
https://docs.github.com/en/actions/reference/limits

This is a measured feasibility decision, not proof that the runtime will build or
that the Unicode patch works. The original PDF contract, system-library unchanged
hashes, private `/proc/maps` loading proof, normal-user sandbox checks, original
characters versus radicals, pagination and copy/search checks remain required.
No system runtime replacement, Release, main merge or security-policy change.
