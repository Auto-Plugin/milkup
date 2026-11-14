# Read-only availability evidence. Never starts, installs or configures a Runtime.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if (-not $IsWindows) { throw 'Windows environment probe requires Windows' }
$principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
$roots = @(
    (Join-Path ${env:ProgramFiles(x86)} 'Microsoft/EdgeWebView/Application'),
    (Join-Path $env:ProgramFiles 'Microsoft/EdgeWebView/Application'),
    (Join-Path $env:LOCALAPPDATA 'Microsoft/EdgeWebView/Application')
) | Select-Object -Unique
$results = foreach ($root in $roots) {
    if (-not (Test-Path -LiteralPath $root -PathType Container)) {
        [ordered]@{ root = $root; status = 'absent'; executables = @() }
        continue
    }
    try {
        $files = @(Get-ChildItem -LiteralPath $root -Directory | ForEach-Object {
            $path = Join-Path $_.FullName 'msedgewebview2.exe'
            if (Test-Path -LiteralPath $path -PathType Leaf) {
                $file = Get-Item -LiteralPath $path
                [ordered]@{ path = $file.FullName; bytes = $file.Length; fileVersion = $file.VersionInfo.FileVersion }
            }
        })
        [ordered]@{ root = $root; status = 'inspected'; executables = $files }
    } catch {
        [ordered]@{ root = $root; status = 'inspection-error'; error = $_.ToString() }
    }
}
Write-Host '::group::windows-backend-environment.json'
[ordered]@{
    utc = [DateTime]::UtcNow.ToString('o')
    source = $env:GITHUB_SHA
    os = [System.Runtime.InteropServices.RuntimeInformation]::OSDescription
    processHasAdministratorRole = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    existingRuntimeLocations = @($results)
    runtimeStarted = $false
    runtimeInstalled = $false
    appContainerCreated = $false
    aclOrSystemPolicyChanged = $false
    boundary = 'File metadata only. Presence is not WebView2 execution, restricted-token compatibility or GUI validation.'
} | ConvertTo-Json -Depth 8 | Write-Host
Write-Host '::endgroup::'
