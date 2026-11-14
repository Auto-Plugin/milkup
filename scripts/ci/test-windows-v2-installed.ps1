[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Installer,
    [Parameter(Mandatory)][string]$BuiltBinary,
    [Parameter(Mandatory)][string]$EvidenceDirectory
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if (-not $IsWindows -or $env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted') {
    throw 'Installation is restricted to a disposable GitHub-hosted Windows runner account.'
}
function Registry-State {
    $state = [ordered]@{}
    foreach ($name in @('.md', '.markdown', '.mdown', '.mkd', 'Markdown Document', 'Markdown Document\DefaultIcon')) {
        $key = "Registry::HKEY_CURRENT_USER\Software\Classes\$name"
        $state[$name] = if (Test-Path -LiteralPath $key) { (Get-Item -LiteralPath $key).GetValue('') } else { $null }
    }
    return $state
}
$runRoot = Join-Path $env:RUNNER_TEMP ('milkup-v2-installed-' + [Guid]::NewGuid().ToString('N'))
$installRoot = Join-Path $runRoot 'app'
New-Item -ItemType Directory -Path $runRoot | Out-Null
$started = Get-Date
$result = [ordered]@{
    status = 'started'; installDirectory = $installRoot; account = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
    registryBefore = Registry-State; installerExitCode = $null; securitySettingsChanged = $false
    isolation = 'Fresh GitHub-hosted VM and its existing runner account; not a new persistent user'
    consumerSmartScreenAndUacAcceptance = 'pending; GitHub runner defaults differ from a normal desktop'
    realImeAccepted = $false
}
try {
    # Standard NSIS silent mode, with /D last. Never Unblock-File, elevate, alter
    # Defender/UAC/SmartScreen, or acknowledge a security warning automatically.
    $install = Start-Process -FilePath $Installer -ArgumentList @('/S', "/D=$installRoot") -PassThru
    if (-not $install.WaitForExit(120000)) {
        $install.Kill($true)
        throw 'Installer timed out or was blocked; no warning bypass attempted.'
    }
    $result.installerExitCode = $install.ExitCode
    if ($install.ExitCode -ne 0) { throw "Installer failed or requires reboot: $($install.ExitCode)" }
    $application = Join-Path $installRoot 'milkup-desktop.exe'
    if (-not (Test-Path -LiteralPath $application)) { throw 'Installed application executable is missing' }
    $installedHash = (Get-FileHash -LiteralPath $application -Algorithm SHA256).Hash
    $result['installedBinary'] = [ordered]@{
        path = $application; sha256 = $installedHash.ToLowerInvariant()
        signature = (Get-AuthenticodeSignature -LiteralPath $application).Status.ToString()
    }
    $comparisonPath = Join-Path $EvidenceDirectory 'binary-comparison.json'
    & node tests/windows/verify-installed-binary.mjs $BuiltBinary $application 1> $comparisonPath
    $comparisonExitCode = $LASTEXITCODE
    $result['binaryComparison'] = Get-Content -LiteralPath $comparisonPath -Raw | ConvertFrom-Json
    if ($comparisonExitCode -ne 0 -or $result.binaryComparison.status -ne 'passed') { throw 'Installed binary does not match the exact Tauri NSIS transformation' }
    if ($result.installedBinary.signature -ne 'NotSigned') { throw 'Unexpected installed application signing state' }
    $reader = [System.IO.BinaryReader]::new([System.IO.File]::OpenRead($application))
    try {
        $reader.BaseStream.Position = 0x3c
        $reader.BaseStream.Position = $reader.ReadInt32()
        if ($reader.ReadUInt32() -ne 0x4550 -or $reader.ReadUInt16() -ne 0x8664) { throw 'Installed application is not PE x64' }
    } finally { $reader.Dispose() }
    $result.installedBinary['peMachine'] = '0x8664'
    $result['registryAfterInstall'] = Registry-State
    $runtimeRoot = Join-Path ${env:ProgramFiles(x86)} 'Microsoft/EdgeWebView/Application'
    $versions = @(Get-ChildItem -LiteralPath $runtimeRoot -Directory | Where-Object Name -Match '^\d+\.\d+\.\d+\.\d+$' | Sort-Object { [version]$_.Name } -Descending)
    if ($versions.Count -eq 0) { throw 'Evergreen WebView2 runtime not found; stop without installing or changing system policy.' }
    $runtime = $versions[0].Name
    $driverUrl = "https://msedgedriver.microsoft.com/$runtime/edgedriver_win64.zip"
    $archive = Join-Path $runRoot 'edgedriver.zip'
    Invoke-WebRequest -Uri $driverUrl -OutFile $archive
    $driverDirectory = Join-Path $runRoot 'edgedriver'
    Expand-Archive -LiteralPath $archive -DestinationPath $driverDirectory
    $edgeDriver = Join-Path $driverDirectory 'msedgedriver.exe'
    $signature = Get-AuthenticodeSignature -LiteralPath $edgeDriver
    if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'Microsoft') { throw 'Microsoft Edge driver signature validation failed' }
    $driverVersion = (& $edgeDriver --version).Trim()
    if ($LASTEXITCODE -ne 0 -or $driverVersion -notmatch [regex]::Escape($runtime)) { throw 'Edge driver/runtime version mismatch' }
    $result['webview2'] = $runtime
    $result['edgeDriver'] = [ordered]@{ version = $driverVersion; source = $driverUrl; sha256 = (Get-FileHash $edgeDriver -Algorithm SHA256).Hash.ToLowerInvariant() }
    $env:MILKUP_WINDOWS_INSTALLED_APP = $application
    $env:MILKUP_WINDOWS_EDGE_DRIVER = $edgeDriver
    $env:MILKUP_WINDOWS_SMOKE_WORK = Join-Path $runRoot 'fixtures'
    $env:MILKUP_WINDOWS_SMOKE_EVIDENCE = $EvidenceDirectory
    & node tests/windows/installed-package-smoke.mjs 1> (Join-Path $EvidenceDirectory 'smoke-stdout.log') 2> (Join-Path $EvidenceDirectory 'smoke-stderr.log')
    if ($LASTEXITCODE -ne 0) { throw 'Installed application open/edit/save/reopen smoke failed; inspect retained evidence.' }
    $smoke = Get-Content -LiteralPath (Join-Path $EvidenceDirectory 'installed-smoke.json') -Raw | ConvertFrom-Json
    if ($smoke.status -ne 'passed' -or $smoke.cases.Count -ne 4) { throw 'Incomplete installed smoke evidence' }
    $result['smoke'] = $smoke
    $result.status = 'passed'
} catch {
    $result.status = 'failed'
    $result['error'] = $_.ToString()
    throw
} finally {
    $result['applicationProcessesBeforeCleanup'] = @(Get-Process -Name 'milkup-desktop' -ErrorAction SilentlyContinue | ForEach-Object {
        $ownedProcess = $_
        try {
            if ($_.Path -and $_.Path.StartsWith($installRoot + '\', [StringComparison]::OrdinalIgnoreCase)) {
                [ordered]@{ id = $_.Id; path = $_.Path; responding = $_.Responding; mainWindowHandle = $_.MainWindowHandle.ToInt64(); mainWindowTitle = $_.MainWindowTitle }
            }
        } catch { [ordered]@{ id = $ownedProcess.Id; inspectionError = 'Process exited during inspection' } }
    })
    $result['applicationErrorEvents'] = @(Get-WinEvent -FilterHashtable @{ LogName = 'Application'; StartTime = $started; Id = 1000, 1001, 1002 } -MaxEvents 20 -ErrorAction SilentlyContinue |
        Where-Object { $_.Message -match 'milkup-desktop' } | ForEach-Object {
            [ordered]@{ time = $_.TimeCreated.ToUniversalTime().ToString('o'); id = $_.Id; message = $_.Message.Substring(0, [Math]::Min($_.Message.Length, 16384)) }
        })
    # Only processes launched from this newly created installer/driver directory.
    foreach ($process in Get-Process -ErrorAction SilentlyContinue) {
        try {
            if ($process.Path -and $process.Path.StartsWith($runRoot + '\', [StringComparison]::OrdinalIgnoreCase) -and $process.StartTime -ge $started) {
                Stop-Process -Id $process.Id -ErrorAction Stop
            }
        } catch { Write-Warning "Owned-process cleanup could not inspect or stop PID $($process.Id)" }
    }
    $result | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath (Join-Path $EvidenceDirectory 'installation-result.json') -Encoding utf8
    # Keep fixtures/recovery data until this disposable VM is torn down. Do not
    # uninstall/reset file associations or remove data from another user profile.
}
return $result
