# Table-break experiment: inconclusive, no product candidate

[Run 43691007753](https://github.com/Auto-Plugin/milkup/actions/runs/43691007753), exact QA SHA `a0cf074dc9fcdee4751ca8c0c5d5f393245a41e6`. **Actions shows success, but the authoritative native `result.json` is `failed-mechanism-gate`, `baselineReproduced=false`, `passingMechanisms=[]`. No mechanism is accepted.** The workflow's pipeline originally returned `tee`'s success instead of the failed Python process. `set -euo pipefail` is now added; a local negative command through the same pipeline returns exit 7. No corrected native run was dispatched, and the original false-green record is retained without reinterpretation.

## Executed scope

One short, manual, isolated Ubuntu 26.04 experiment; no Milkup/package build or installation, private WebKit, print queue or wider matrix. Six local structural/measurement tests passed, with 16 HTML fixtures: four structures × short/long tables × room/edge placement. All 16 system WebKit print calls completed and generated PDFs. JavaScript disabled, ephemeral context and WebKit sandbox enabled. Host maps show `/usr/lib/x86_64-linux-gnu/libwebkit2gtk-4.1.so.0.21.10` and `libjavascriptcoregtk-4.1.so.0.10.14`.

Versions: WebKitGTK/JavaScriptCore `2.52.6-0ubuntu0.26.04.1`, fonts-noto-cjk `1:20240730+repack1-1build1`, Poppler `26.01.0-2ubuntu0.3`, python3-fitz `1.26.7+ds1-1build1`. Local execution was unavailable because the local host has neither WebKitGTK/GTK pkg-config development packages nor Xvfb; no local security workaround was attempted. Active/queued workflow lists were empty before the single dispatch.

## Actual outcomes

The structures were: whole-table avoid wrapper (baseline); external heading + break-avoid chain; external heading + first row group; heading inside first row group. All preserve one table and original data rows; the latter two remove automatic repeated thead behavior, and the internal variant adds a title cell. Even a geometric pass would require accessibility and header behavior review before product adoption.

| Context | Results for all four structures |
| --- | --- |
| 3-row short table, 8 prelude lines | 1 page; heading/header/first row together; bounded checks pass |
| 3-row short table, 45 prelude lines | heading/header/first row page 2, but PREBS exceeds page 1 |
| 72-row long table, 8 prelude lines | 4 pages, 72 row pairs; boundary words exceed pages 1–3 |
| 72-row long table, 45 prelude lines | 5 pages; heading/header/first row all page 2; only 71 complete row pairs, ROWAU/ENDAU absent; boundary failures |

The baseline was required to reproduce heading page 1 / first row page 2, with its other controls passing. It did not. None of the proposed structures therefore provides evidence for the known application orphan defect. The additional clipping/missing markers are facts about this probe's generated PDFs, not newly attributed Milkup product defects.

## Why the fixed-height control was invalid

The probe reused the earlier sandboxed print helper, which sets **GTK margins to 0mm** and calls print directly from `WEBKIT_LOAD_FINISHED`. The actual product `output_linux.rs` sets **12mm margins**, requests a 1024×768 view, and starts printing later from the loaded/guard-ready timer. The helper's default visible window is 800×900. These are concrete mismatches; this experiment did not isolate which one causes the observed scale/layout difference.

Independent PDF observations:

- First probe text starts at x=0. The installed application baseline starts at x≈34.015747pt (12mm).
- A declared 20px prelude line advances ≈18.89764pt in the probe PDF, rather than the assumed 15pt at unscaled 96dpi conversion. The ratio is about 1.25984.
- Thus 45 lines consume about 850.39pt, more than the A4 page's 841.89pt height before any title. The intended leftover-height condition never existed. The CSS `@page margin:16mm` did not yield the intended probe margin.
- Four short-room positives do not repair this failed negative control. Changing row counts or permitting off-page words merely to pass would not validate the mechanism.

The report stores every PDF, HTML, coordinate and raster guard. MuPDF font bounds and independent Poppler raster output were used without relaxing the two-pixel guard threshold. Original `result.json` is unchanged. This does not prove that the proposed CSS chains work or fail when run through application-equivalent printing.

## Stop condition and next prerequisite

No second native job or product candidate was started. First align a standalone harness to the actual GTK page setup, view allocation and deferred print readiness. Its preflight must quantitatively prove actual margins and CSS-to-PDF scale/usable height, then reproduce the existing baseline orphan with complete short/room controls. Preserve the original full application HTML/PDF as a reference; do not compensate for unknown scale by tuning content until the result happens to turn green. Only after that discrimination is restored can a mechanism comparison justify another bounded probe. No caption rebuild or integration is warranted now.

The working integration remains `8d93519b` (product equivalent to `0e4e8c58`). No application files, existing acceptance matrix, security/notification/production settings, main or release were changed.

## Evidence retention

Artifact **14151863577**, `milkup-table-break-43691007753`, 3,828,209 bytes; SHA-256 `16022a6519c6284a26527acf2c8752afa9d5c771fe88a2fdd517772ad50d94f8`; expiry **2026-11-22 07:42:13 UTC**. ZIP digest, size, CRC and safe extraction bounds verified.

Local raw evidence: `/workspace/milkup-table-mechanism-evidence/43691007753/`. `offline-scale-comparison.json` derives measured prelude advances from the retained coordinates; it is separate from the original report. A private persistent PDF/HTML/text archive is retained separately; workspace and expiring Actions artifacts alone are not permanent retention. No browser screenshots are included in that private archive.
