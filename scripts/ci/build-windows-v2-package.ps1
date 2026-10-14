[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$OutputDirectory,
    [Parameter(Mandatory)][ValidatePattern('^[0-9a-f]{40}$')][string]$ExpectedCommit,
    [switch]$UserTrialPackage
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if (-not $IsWindows -or $env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted') {
    throw 'Run only in an approved disposable GitHub-hosted Windows job.'
}
if ($env:GITHUB_REPOSITORY -ne 'Auto-Plugin/milkup' -or $env:GITHUB_REF -ne 'refs/heads/dot/milkup-v2-quality') {
    throw 'Unexpected repository or branch.'
}
function Invoke-Checked([string]$Program, [string[]]$Arguments) {
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Program failed with exit code $LASTEXITCODE" }
}
function File-Record([string]$Path) {
    $file = Get-Item -LiteralPath $Path
    $signature = Get-AuthenticodeSignature -LiteralPath $Path
    return [ordered]@{
        name = $file.Name; bytes = $file.Length
        sha256 = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
        signature = $signature.Status.ToString()
        signer = if ($signature.SignerCertificate) { $signature.SignerCertificate.Subject } else { $null }
    }
}
$checkout = (git rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $checkout -ne $ExpectedCommit -or $checkout -ne $env:GITHUB_SHA) { throw 'Source SHA mismatch' }
if (git status --porcelain) { throw 'Dirty source tree' }
if (Test-Path -LiteralPath $OutputDirectory) { throw 'Output directory already exists; refusing to overwrite evidence' }
$evidence = Join-Path $OutputDirectory 'evidence'
New-Item -ItemType Directory -Path $evidence | Out-Null
$manifest = [ordered]@{
    commitSha = $checkout; platform = 'windows'; architecture = 'x64'; status = 'started'
    runId = $env:GITHUB_RUN_ID; runAttempt = $env:GITHUB_RUN_ATTEMPT
    runnerImage = $env:ImageOS; runnerImageVersion = $env:ImageVersion
    os = [System.Runtime.InteropServices.RuntimeInformation]::OSDescription
    runnerAccount = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
    signedPackageRequested = $false; realImeAccepted = $false
    windowsDesktopManualAcceptance = 'pending'; releaseCreated = $false
    deliveryMode = 'validation-only-no-artifacts'; artifactUploaded = $false; packageDelivered = $false
    packagePurpose = 'Automated installed validation'
    knownLimits = @('Unsigned test installer', 'GitHub runner is not a consumer Windows desktop',
        'Real IME, Word 2016, assistive technology, DPI/multi-monitor and power-loss acceptance pending')
}
Start-Transcript -Path (Join-Path $evidence 'build.log') | Out-Null
try {
    $manifest['tools'] = [ordered]@{ node = (& node --version); pnpm = (& pnpm --version); rust = (& rustc --version); cargo = (& cargo --version) }
    if ((Get-PSDrive -Name (Get-Location).Drive.Name).Free -lt 8GB) { throw 'Less than 8 GiB build disk budget remains' }
    Invoke-Checked 'pnpm' @('install', '--frozen-lockfile')
    $tauriVersion = (& pnpm --filter '@milkup/desktop' exec tauri --version).Trim()
    if ($LASTEXITCODE -ne 0 -or $tauriVersion -ne 'tauri-cli 2.11.4') { throw 'Review binary verification contract before changing Tauri CLI version' }
    $manifest.tools['tauriCli'] = $tauriVersion
    Invoke-Checked 'pnpm' @('-r', '--workspace-concurrency=1', 'test')
    Invoke-Checked 'pnpm' @('typecheck')
    Invoke-Checked 'node' @('--test', 'tests/windows/verify-installed-binary.test.mjs')
    Invoke-Checked 'cargo' @('test', '--locked', '--manifest-path', 'apps/desktop/src-tauri/Cargo.toml', '--lib')
    Invoke-Checked 'pnpm' @('--filter', '@milkup/desktop', 'tauri', 'build', '--target', 'x86_64-pc-windows-msvc', '--bundles', 'nsis', '--ci', '--', '--locked')
    $target = Join-Path (Get-Location) 'apps/desktop/src-tauri/target/x86_64-pc-windows-msvc/release'
    $packages = @(Get-ChildItem -LiteralPath (Join-Path $target 'bundle/nsis') -Filter '*.exe' -File)
    if ($packages.Count -ne 1) { throw 'Expected exactly one NSIS installer' }
    $binary = Join-Path $target 'milkup-desktop.exe'
    $manifest.installer = File-Record $packages[0].FullName
    $manifest.binary = File-Record $binary
    if ($manifest.installer.signature -ne 'NotSigned' -or $manifest.binary.signature -ne 'NotSigned') {
        throw 'Expected explicitly unsigned local test artifacts; review unexpected signing state.'
    }
    if ($UserTrialPackage) {
        # User explicitly chose to install and try the package personally.
        $manifest.deliveryMode = 'user-trial-package'
        $manifest.packagePurpose = 'Unsigned Windows x64 NSIS for user manual trial'
        $manifest.Remove('artifactUploaded')
        $manifest.Remove('packageDelivered')
        $manifest.artifactPublication = 'Workflow uploads once after this build manifest is written'
        $manifest.installedTest = @{ status = 'not-run'; reason = 'User requested direct download and personal installation'; startupAndEditingAcceptance = 'unverified' }
    } else {
        # Same locked release runtime; never substitutes for product acceptance.
        Invoke-Checked 'cargo' @('build', '--locked', '--manifest-path', 'apps/desktop/src-tauri/Cargo.toml', '--release', '--target', 'x86_64-pc-windows-msvc', '--features', 'tauri/custom-protocol', '--example', 'windows_startup_control')
        Invoke-Checked 'node' @('tests/windows/minimal-startup-control.mjs', (Join-Path $target 'examples/windows_startup_control.exe'), $evidence)
        $manifest.installedTest = & "$PSScriptRoot/test-windows-v2-installed.ps1" -Installer $packages[0].FullName -BuiltBinary $binary -EvidenceDirectory $evidence
        if ($manifest.installedTest.status -ne 'passed') { throw 'Installed application acceptance did not pass' }
    }
    if (git status --porcelain) { throw 'Build changed tracked or untracked source files' }
    $manifest.status = if ($UserTrialPackage) { 'built-for-user-trial' } else { 'passed' }
    $deliverable = Join-Path $OutputDirectory 'deliverable'
    New-Item -ItemType Directory -Path $deliverable | Out-Null
    $name = "milkup-v2-test-windows-x64-$checkout.exe"
    Copy-Item -LiteralPath $packages[0].FullName -Destination (Join-Path $deliverable $name)
    $manifest.installer.deliveredName = $name
    $manifest | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath (Join-Path $deliverable 'manifest.json') -Encoding utf8
    "$($manifest.installer.sha256)  $name" | Set-Content -LiteralPath (Join-Path $deliverable 'SHA256SUMS.txt') -Encoding ascii
    if ($UserTrialPackage) {
        @"
milkup v2 Windows x64 test installer (unsigned)
Commit: $checkout
Installer: $name
Bytes: $($manifest.installer.bytes)
SHA-256: $($manifest.installer.sha256)

用户自行安装试用包。此版本没有代码签名，不是正式发布。
自动化启动/编辑保存尚未验收；此前 hosted Windows 的 WebView2 自动化入口阻塞。
本次构建不执行自动安装。真实中文 IME、Word 2016、辅助技术等仍未验。
请先备份重要文档，并使用副本试用。不要为运行此包关闭系统安全设置。
Windows PowerShell 校验：Get-FileHash -Algorithm SHA256 .\$name
请核对结果与 SHA256SUMS.txt 一致。安装器为 NSIS currentUser，含 Markdown 文件关联。
"@ | Set-Content -LiteralPath (Join-Path $deliverable 'README.txt') -Encoding utf8
    }
} catch {
    $manifest.status = 'failed'
    $manifest.error = $_.ToString()
    throw
} finally {
    $manifest | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath (Join-Path $evidence 'build-result.json') -Encoding utf8
    Stop-Transcript | Out-Null
}
