# Candidate-only gate. This runs the real installed WebView2 renderer, not a
# browser mock. It does not claim installer, picker GUI, paper printer or Linux
# acceptance, nor copy/search and all-page visual fidelity.
param([Parameter(Mandatory=$true)][string]$EvidenceDirectory)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$evidence = [IO.Path]::GetFullPath($EvidenceDirectory)
if (Test-Path -LiteralPath $evidence) { throw 'Evidence directory must be new' }
New-Item -ItemType Directory -Path $evidence | Out-Null
$sha = (& git -C $root rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Cannot identify candidate' }
$manifest = Join-Path $root 'apps/desktop/src-tauri/Cargo.toml'
$env:MILKUP_PDF_EVIDENCE_DIR = $evidence
$summary = [ordered]@{
  schema = 1; candidateSha = $sha; platform = [Environment]::OSVersion.VersionString
  nativeContracts = 'not-run'; installedWebView2Pdf = 'not-run'
  guiPicker = 'not-run'; nativePrintDialogCancel = 'not-run'; printedToQueue = 'not-run'; physicalPrint = 'not-run'
  textAndVisualFidelity = 'not-run'; linuxRegression = 'not-run'; releaseReady = $false
}
try {
  & cargo test --locked --manifest-path $manifest --lib output::windows:: -- --test-threads=1 --nocapture 2>&1 | Tee-Object -FilePath (Join-Path $evidence 'contracts.log')
  if ($LASTEXITCODE -ne 0) { $summary.nativeContracts = 'failed'; throw 'Windows output contracts failed' }
  $summary.nativeContracts = 'passed'
  & cargo test --locked --manifest-path $manifest --lib output::windows::pdf::tests::installed_webview2_renders_static_pdf_without_document_network_access -- --exact --ignored --test-threads=1 --nocapture 2>&1 | Tee-Object -FilePath (Join-Path $evidence 'webview2-pdf.log')
  if ($LASTEXITCODE -ne 0) { $summary.installedWebView2Pdf = 'failed'; throw 'Installed WebView2 PDF failed' }
  $summary.installedWebView2Pdf = 'passed'
  & cargo test --locked --manifest-path $manifest --lib output::windows::pdf::tests::native_print_dialog_cancel_returns_cancelled_without_submission -- --exact --ignored --test-threads=1 --nocapture 2>&1 | Tee-Object -FilePath (Join-Path $evidence 'print-dialog-cancel.log')
  if ($LASTEXITCODE -ne 0) { $summary.nativePrintDialogCancel = 'failed'; throw 'Real native print dialog cancellation failed' }
  $summary.nativePrintDialogCancel = 'passed'

  $summary.artifacts = @('a4.pdf', 'letter-landscape.pdf') | ForEach-Object {
    $file = Join-Path $evidence $_
    if (!(Test-Path -LiteralPath $file)) { throw "Missing native PDF: $_" }
    [ordered]@{name=$_; bytes=(Get-Item -LiteralPath $file).Length; sha256=(Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()}
  }
} finally {
  Remove-Item Env:MILKUP_PDF_EVIDENCE_DIR -ErrorAction SilentlyContinue
  $summary | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $evidence 'summary.json') -Encoding utf8
}
