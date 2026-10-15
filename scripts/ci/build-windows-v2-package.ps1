[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$OutputDirectory,
    [Parameter(Mandatory)][ValidatePattern('^[0-9a-f]{40}$')][string]$ExpectedCommit,
    [switch]$UserTrialPackage,
    [switch]$BundledPlugins,
    [switch]$OfflineEvergreen
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if (-not $IsWindows -or $env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted') {
    throw 'Run only in an approved disposable GitHub-hosted Windows job.'
}
if ($env:GITHUB_REPOSITORY -ne 'Auto-Plugin/milkup' -or
    ($env:GITHUB_REF -ne 'refs/heads/dot/milkup-v2-quality' -and
      -not ($BundledPlugins -and -not $OfflineEvergreen -and $env:GITHUB_REF -eq 'refs/heads/dot/milkup-v2-windows-delivery') -and
      -not ($OfflineEvergreen -and $BundledPlugins -and $UserTrialPackage -and $env:GITHUB_REF -eq 'refs/heads/dot/milkup-v2-product-completion-phase1'))) {
    throw 'Unexpected repository or branch.'
}
if ($OfflineEvergreen -and $env:GITHUB_REF -ne 'refs/heads/dot/milkup-v2-product-completion-phase1') {
    throw 'Offline Evergreen is restricted to the reviewed product-completion branch.'
}
if ($OfflineEvergreen -and (-not $BundledPlugins -or -not $UserTrialPackage)) {
    throw 'Offline Evergreen requires the explicitly approved bundled-plugin user-trial delivery.'
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
    Invoke-Checked 'node' @('--test', 'tests/windows/verify-build-tree.test.mjs')
    if ($OfflineEvergreen) {
        Invoke-Checked 'node' @('--test', 'tests/windows/plugin-offline-delivery.test.mjs')
    }
    Invoke-Checked 'cargo' @('test', '--locked', '--manifest-path', 'apps/desktop/src-tauri/Cargo.toml', '--lib')
    if ($BundledPlugins) {
        $standardConfig = Get-Content 'apps/desktop/src-tauri/tauri.conf.json' -Raw | ConvertFrom-Json
        if ($env:TAURI_CONFIG -or
            $standardConfig.bundle.windows.PSObject.Properties.Name -contains 'webviewInstallMode' -or
            (Test-Path 'apps/desktop/src-tauri/tauri.windows.conf.json')) {
            throw 'Standard delivery requires the reviewed default WebView2 mode without overrides.'
        }
        Invoke-Checked 'pnpm' @('test:outline')
        Invoke-Checked 'node' @('scripts/ci/prepare-bundled-plugins.mjs')
        $pluginFiles = @(Get-ChildItem -LiteralPath 'apps/desktop/src/bundled-plugins' -Filter '*.milkup-plugin' -File | Sort-Object Name)
        if ($OfflineEvergreen) {
            $inventoryPath = Join-Path $evidence 'plugin-inventory.json'
            Invoke-Checked 'node' @('scripts/ci/plugin-offline-delivery.mjs', 'inventory', (Get-Location).Path, $inventoryPath)
            $inventory = @(Get-Content $inventoryPath -Raw | ConvertFrom-Json)
            if ($pluginFiles.Count -ne 2 -or (Compare-Object @($pluginFiles.Name) @($inventory.name))) { throw 'Bundled plugins do not match the reviewed release inventory' }
            $overlayPath = (Resolve-Path 'scripts/ci/tauri-windows-offline.json').Path
            $overlay = Get-Content $overlayPath -Raw | ConvertFrom-Json
            $expectedOverlay = '{"bundle":{"windows":{"webviewInstallMode":{"type":"offlineInstaller","silent":true}}}}'
            if (($overlay | ConvertTo-Json -Depth 10 -Compress) -cne $expectedOverlay) { throw 'Unreviewed offline config overlay' }
            $manifest['webviewInstallMode'] = 'offlineInstaller'
            $manifest['pluginSdkVersion'] = (Get-Content 'packages/plugin-sdk/package.json' -Raw | ConvertFrom-Json).version
            $globalModules = (& npm root --global).Trim()
            if ($LASTEXITCODE -ne 0) { throw 'Cannot resolve the pinned pnpm CLI' }
            $pnpmCli = Join-Path $globalModules 'pnpm/bin/pnpm.cjs'
            $publicBuild = Join-Path $OutputDirectory 'public-sdk-verification'
            Invoke-Checked 'node' @('scripts/ci/verify-public-plugin-builds.mjs', $publicBuild, $pnpmCli)
            $manifest['publicSdkVerification'] = Get-Content (Join-Path $publicBuild 'verification.json') -Raw | ConvertFrom-Json
        } else {
            if ($pluginFiles.Count -ne 1) { throw 'Legacy standard delivery expects its reviewed single-plugin inventory' }
            $manifest['bundledPlugin'] = File-Record $pluginFiles[0].FullName
            $manifest['webviewInstallMode'] = 'downloadBootstrapper (Tauri default; internet required if Runtime is missing)'
        }
        $manifest['bundledPlugins'] = @($pluginFiles | ForEach-Object { File-Record $_.FullName })
    }
    $tauriArguments = @('--filter', '@milkup/desktop', 'tauri', 'build', '--target', 'x86_64-pc-windows-msvc', '--bundles', 'nsis', '--ci')
    if ($OfflineEvergreen) { $tauriArguments += @('--config', $overlayPath) }
    $tauriArguments += @('--', '--locked')
    Invoke-Checked 'pnpm' $tauriArguments
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
        $manifest.artifactPublication = 'Workflow separately gates upload on the approved request; a build-only run publishes no artifact'
        $manifest.installedTest = @{ status = 'not-run'; reason = 'User requested direct download and personal installation'; startupAndEditingAcceptance = 'unverified' }
    } else {
        # Same locked release runtime; never substitutes for product acceptance.
        Invoke-Checked 'cargo' @('build', '--locked', '--manifest-path', 'apps/desktop/src-tauri/Cargo.toml', '--release', '--target', 'x86_64-pc-windows-msvc', '--features', 'tauri/custom-protocol', '--example', 'windows_startup_control')
        Invoke-Checked 'node' @('tests/windows/minimal-startup-control.mjs', (Join-Path $target 'examples/windows_startup_control.exe'), $evidence)
        $manifest.installedTest = & "$PSScriptRoot/test-windows-v2-installed.ps1" -Installer $packages[0].FullName -BuiltBinary $binary -EvidenceDirectory $evidence
        if ($manifest.installedTest.status -ne 'passed') { throw 'Installed application acceptance did not pass' }
    }
    # Tauri writes these editor-support JSON schemas for the current platform.
    # Verify all other source paths remain unchanged and retain generated hashes.
    $treeEvidence = Join-Path $evidence 'build-tree.json'
    Invoke-Checked 'node' @('tests/windows/verify-build-tree.mjs', (Get-Location).Path, $treeEvidence)
    $manifest.buildTree = Get-Content -LiteralPath $treeEvidence -Raw | ConvertFrom-Json
    $manifest.status = if ($UserTrialPackage) { 'built-for-user-trial' } else { 'passed' }
    $deliverable = Join-Path $OutputDirectory 'deliverable'
    New-Item -ItemType Directory -Path $deliverable | Out-Null
    $name = "milkup-v2-test-windows-x64-$checkout.exe"
    Copy-Item -LiteralPath $packages[0].FullName -Destination (Join-Path $deliverable $name)
    if ($BundledPlugins) {
        foreach ($pluginFile in $pluginFiles) {
            Copy-Item -LiteralPath $pluginFile.FullName -Destination (Join-Path $deliverable $pluginFile.Name)
        }
    }
    $manifest.installer.deliveredName = $name
    $manifest | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath (Join-Path $deliverable 'manifest.json') -Encoding utf8
    "$($manifest.installer.sha256)  $name" | Set-Content -LiteralPath (Join-Path $deliverable 'SHA256SUMS.txt') -Encoding ascii
    if ($BundledPlugins) {
        foreach ($plugin in $manifest.bundledPlugins) {
            "$($plugin.sha256)  $($plugin.name)" | Add-Content -LiteralPath (Join-Path $deliverable 'SHA256SUMS.txt') -Encoding ascii
        }
    }
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
        if ($BundledPlugins) {
            if ($OfflineEvergreen) {
                @"

离线 Evergreen WebView2 Runtime 安装包：包含离线安装程序，缺少 Runtime 时无需联网获取安装文件。
用户已明确接受本次 Runtime 条款；应用安装包仍未签名，不是正式 Release。
通过公开插件机制预装 Outline 与 Updates；Updates 含敏感 app:updates 权限，安装后不默认审批或启用。
请在插件管理详情中明确审批后启用 Updates。禁用或卸载后重启不会自动恢复。
版本、签名、安全保存与恢复由宿主保护；关闭可选插件不影响基础打开、编辑、保存和恢复。
更新渠道默认未配置，不能用此试用包声称真实更新安装或 Windows 实机体验已验收。
"@ | Add-Content -LiteralPath (Join-Path $deliverable 'README.txt') -Encoding utf8
            } else {
                @"

标准小体积安装包：缺少 WebView2 Runtime 时需要联网下载，不是离线安装包。
"@ | Add-Content -LiteralPath (Join-Path $deliverable 'README.txt') -Encoding utf8
            }
            foreach ($plugin in $manifest.bundledPlugins) {
                "插件 $($plugin.name)，SHA-256: $($plugin.sha256)。此独立档案与预装包字节相同，可通过安装本地插件导入。" | Add-Content -LiteralPath (Join-Path $deliverable 'README.txt') -Encoding utf8
            }
        }
    }
} catch {
    $manifest.status = 'failed'
    $manifest.error = $_.ToString()
    throw
} finally {
    $manifest | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath (Join-Path $evidence 'build-result.json') -Encoding utf8
    Stop-Transcript | Out-Null
}
