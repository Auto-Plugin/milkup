# Linux table-caption candidate: native rejection, 2026-11-15

The candidate is **not accepted and is not integrated**. [Run 43689605596](https://github.com/Auto-Plugin/milkup/actions/runs/43689605596) built and installed the intended deb, exported both PDFs through the real application and closed normally. Its independent pagination gate failed. A4 still places `TABLESECTION` on page 1 and `TAA` on page 2. The candidate also produces clipped text fragments above the table on page 2. Letter landscape passes the bounded pagination checks, not overall PDF fidelity.

## Exact scope and review

- Working product integration remains `0e4e8c580353710db9b7f0ec4820522d305ec9fc` (includes the accepted Mermaid pending and conflict fixes).
- Isolated caption change: `d6a0dc18d925514b77ff325d82d40651fae917fc`; additional DOM tests: `d671caca3853423dc442cefdb63f3763212996a2`.
- Actual build/test SHA: `a863b5b3f790d0302123a82e5c800f298e86e7c2`, branch `dot/caption-native-20261115`. Differences from d671 are only the nine QA/workflow files recorded in `source-scope.json`; product and packaging inputs are unchanged.
- The change moves a heading immediately preceding a table into that table's caption. It retains one native table, heading element/anchor, header and body; no copied rows, ARIA role replacement or hidden content. Ordinary tables without an adjacent heading and other lead blocks are unchanged in the tested DOM contracts.
- This serializer is shared by HTML export and print/PDF. Therefore the structural change also affects exported HTML; it is not a PDF-only CSS switch. DOM tests establish native element semantics, not screen-reader behavior or layout equivalence across all browsers/platforms.
- 79 export tests, TypeScript and formatting passed locally. The native workflow also passed the narrow local contracts. These do not override the failed real engine result.

## One bounded native execution

Ubuntu 26.04 ordinary user (UID 1001), fresh test configuration and synthetic Markdown only. Default WebKitGTK/JavaScriptCore `2.52.6-0ubuntu0.26.04.1`, Noto CJK `1:20240730+repack1-1build1`, Poppler `26.01.0-2ubuntu0.3`; loaded libraries are the system libraries, not the private research prefix. No sandbox or system security change.

GUI steps all passed: exact synthetic document open (2224 ms), output plugin enable (1631 ms), A4 export (4799 ms), Letter landscape export (3113 ms), normal close (123 ms). These are test-step durations, not rendering benchmarks. Exact process PID 13253 / start identity 37142 received WM_DELETE_WINDOW and disappeared; no forced termination or failure cleanup was used. This does not record an OS exit code. Removal of this run's package also succeeded.

Input SHA-256 stayed `a48d14baea38632464f88813009563508ffb7ae2a8c1822285bb7308d9ef0fcb`; no real user document or profile was involved.

| Evidence | A4 portrait | Letter landscape |
| --- | --- | --- |
| Page count / measured page size | 8 / 595 × 842 pt | 11 / 792 × 612 pt |
| Heading / first table row | page 1 / page 2: **failed** | page 2 / page 2 |
| Table completeness | 72 rows, pages 2–5 | 72 rows, pages 2–7 |
| Code completeness | 100 lines, pages 5–8 | 100 lines, pages 7–11 |
| Unique expected markers | 386, each exactly once | 386, each exactly once |
| Independent rendered row guards | 172, no guard failures | 172, no guard failures |
| Pagination errors | orphan heading; page-2 SC and O out of page | none |

The exact A4 errors are `page 2: out-of-page SC`, `page 2: out-of-page O`, `T: orphan heading`. Poppler places the SC/O em bounds at y=-4.146683..48.07559 pt. MuPDF independently extracts partial letters at the page top; raster inspection shows small clipped remnants above the table header. The original baseline has no such fragments. This is sufficient to reject the candidate; it does not establish the specific WebKit caption fragmentation internals.

## Independent edge evidence and original negative control

The previous baseline artifact 14151117902 from [43688690760](https://github.com/Auto-Plugin/milkup/actions/runs/43688690760) was reused unchanged, not rerun. ZIP digest `0cde8e2e975995f2fd51480cf93aa8310925dcd3ae0ad2f68409910b5a180e71`, length 2,229,319; digest/CRC and paths verified. Original reports remain under `baseline/original`; corrected reinspection is separate.

The earlier Poppler code em boxes included neighboring-line ink. The corrected gate matches each guard's exact text and x position to independent MuPDF font bounds, then crops the unchanged Poppler 144-dpi raster. It retains both boxes, page boundaries, per-style controls and the original two-pixel tolerance. Missing/8-pixel-clipped guard counterexamples fail. The unchanged baseline now fails **only** `a4-portrait: T: orphan heading`; its failure is explicitly required by the workflow. Candidate data goes through the same gate with no expected-failure allowance. This corrects the measurement proxy, not the heading requirement.

## Independent fidelity gaps retained

Both candidate PDFs still fail exact extraction of `中文春风又绿明月`; intentional radicals `⽂⾵⼜⽉` and this particular `WRAP0123456789` sample extract exactly. Both have zero URI link annotations. These remain overall export defects, not removed from acceptance because pagination is scoped. This run does not cover arbitrary complex scripts, every glyph's raster integrity, physical printing or private WebKit fixes.

## Package and evidence identity

Candidate deb `milkup-2.0.0-beta.10-linux-deb-a863b5b3f790.deb`, 9,854,936 bytes:

`26c7713cd5554987b3bd4d25c33fcaa4d57bbbafaf34791041201254477c97db`

Installed executable:

`6bfce568c10a31949c621fa17998569fabb3c80adc1187027e92f24caabd381a`

The package is an unsigned **failed research candidate**, not a replacement for accepted 58c78973 bytes or a release recommendation.

| Artifact | SHA-256 | Expiry UTC |
| --- | --- | --- |
| 14152330871, candidate package ZIP, 9,812,594 bytes | daecc5aece4e875228384393f3139f3cf522fc94e4d178454dc2000029562421 | 2026-11-22 07:27:27 |
| 14151499382, native evidence ZIP, 6,507,710 bytes | 490675d2be464622d3518e8863e14df4814c04e3f980417f61001db0c77f9244 | 2026-11-22 07:28:07 |
| A4 PDF | 36e79c1573c92c1f68f9f38ddeaa610e1114d3189cb0ce53ce8fbe01e856bced | within evidence |
| Letter PDF | ea8ba91d81cc272cbfd07ff012b4c92edfe8fdf24bb16a2e071e6c283426a099 | within evidence |

Raw artifacts, page images, PDFs, runtime maps and reports are retained locally at `/workspace/milkup-caption-evidence/43689605596/`. Private persistent retention of package/PDF/text evidence is recorded separately; browser screenshots are excluded. Workspace alone is not persistent retention.

## Decision

Do not cherry-pick d6a0dc18/d671caca into integration. One authorized necessary build/native comparison is complete; no second speculative build, private engine test, queue or installation matrix was launched. The caption assumption is disproved on the default runtime. Any future repair needs a discriminating fragmentation approach that keeps the heading with the first row without duplicating content or changing ordinary table semantics. The five-gap matrix is updated separately; main, production configuration, notifications and security settings are unchanged, and nothing is released.
