[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Executable,
    [Parameter(Mandatory)][string]$EvidenceDirectory
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$record = [ordered]@{ executable = $Executable; diagnosticOnly = $true; originalSha256 = (Get-FileHash $Executable -Algorithm SHA256).Hash; errors = @() }
$probe = $null
function Invoke-Probe([string]$Program, [string[]]$Arguments, [string]$Name) {
    $start = [System.Diagnostics.ProcessStartInfo]::new($Program)
    $start.UseShellExecute = $false
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    $start.CreateNoWindow = $true
    foreach ($argument in $Arguments) { $start.ArgumentList.Add($argument) }
    $process = [System.Diagnostics.Process]::Start($start)
    $stdout = $process.StandardOutput.ReadToEndAsync()
    $stderr = $process.StandardError.ReadToEndAsync()
    if (-not $process.WaitForExit(120000)) { $process.Kill($true); $process.WaitForExit(); throw "$Name timed out after 120 seconds" }
    $text = $stdout.GetAwaiter().GetResult() + $stderr.GetAwaiter().GetResult()
    $text.Substring(0, [Math]::Min($text.Length, 48000)) | Set-Content (Join-Path $EvidenceDirectory "$Name.log")
    return $process.ExitCode
}
try {
    $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'
    $dumpbins = @(& $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -find 'VC/Tools/MSVC/**/bin/Hostx64/x64/dumpbin.exe')
    if ($LASTEXITCODE -ne 0 -or $dumpbins.Count -eq 0) { throw 'MSVC dumpbin unavailable' }
    $dumpbin = $dumpbins[0]
    $record['dumpbin'] = $dumpbin
    $record['importsExitCode'] = Invoke-Probe $dumpbin @('/nologo', '/imports', $Executable) 'rust-loader-imports'
    $directories = @((Split-Path $Executable), (Get-Location).Path, "$env:SystemRoot/System32") + @($env:PATH -split ';' | Where-Object { $_ })
    $sxs = @(Get-ChildItem "$env:SystemRoot/WinSxS" -Directory -Filter 'amd64_microsoft.windows.common-controls_*' | Sort-Object Name -Descending | Select-Object -First 2)
    $directories += @($sxs | ForEach-Object { $_.FullName })
    $inputPath = Join-Path $EvidenceDirectory 'rust-loader-input.json'
    @{ executable = $Executable; dumpbin = $dumpbin; directories = @($directories | Select-Object -Unique) } | ConvertTo-Json -Depth 4 | Set-Content $inputPath
    $importsPath = Join-Path $EvidenceDirectory 'rust-loader-analysis.json'
    & node "$PSScriptRoot/windows-loader-imports.mjs" $inputPath $importsPath
    if ($LASTEXITCODE -ne 0) { throw 'Static import analysis failed' }
    $analysis = Get-Content $importsPath -Raw | ConvertFrom-Json
    $record['missingCandidates'] = @($analysis.missing)
    $record['staticAnalysisErrors'] = @($analysis.errors)
    $record['staticAnalysisTruncated'] = $analysis.truncated
    $record['staticAnalysisLimit'] = $analysis.limitation
    $mtCandidates = @(Get-ChildItem "${env:ProgramFiles(x86)}/Windows Kits/10/bin/*/x64/mt.exe" -File | Sort-Object FullName -Descending)
    if ($mtCandidates.Count -eq 0) { throw 'Windows SDK manifest tool unavailable' }
    $mt = $mtCandidates[0].FullName
    $manifestPath = Join-Path $EvidenceDirectory 'rust-original.manifest'
    $record['manifestExtractExitCode'] = Invoke-Probe $mt @('-nologo', "-inputresource:$Executable;#1", "-out:$manifestPath") 'rust-loader-manifest'
    if (Test-Path $manifestPath) { $record['originalManifest'] = Get-Content $manifestPath -Raw }
    # Hypothesis check only when the static evidence points to this precise symbol.
    $controlMissing = @($analysis.missing | Where-Object { $_.dll -ieq 'comctl32.dll' -and $_.names -contains 'TaskDialogIndirect' -and -not $_.delayed })
    if ($controlMissing.Count -gt 0) {
        $probe = Join-Path (Split-Path $Executable) ('milkup-loader-probe-' + [Guid]::NewGuid().ToString('N') + '.exe')
        Copy-Item -LiteralPath $Executable -Destination $probe
        $v6Manifest = Join-Path $EvidenceDirectory 'rust-v6-probe.manifest'
        @'
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">
  <dependency><dependentAssembly><assemblyIdentity type="win32" name="Microsoft.Windows.Common-Controls" version="6.0.0.0" processorArchitecture="amd64" publicKeyToken="6595b64144ccf1df" language="*" /></dependentAssembly></dependency>
</assembly>
'@ | Set-Content $v6Manifest -Encoding utf8
        $record['probeManifestExitCode'] = Invoke-Probe $mt @('-nologo', '-manifest', $v6Manifest, "-outputresource:$probe;#1") 'rust-v6-embed'
        if ($record.probeManifestExitCode -eq 0) {
            $record['probeListExitCode'] = Invoke-Probe $probe @('--list') 'rust-v6-list'
            if ($record.probeListExitCode -eq 0) {
                $record['probeFullTestsExitCode'] = Invoke-Probe $probe @('--test-threads=1') 'rust-v6-tests'
            }
        }
        $record['probeAcceptance'] = 'Diagnostic temporary copy only; original test failure remains fatal and upload is forbidden'
    }
} catch { $record.errors += $_.ToString() }
finally {
    if ($probe -and (Test-Path $probe)) { Remove-Item -LiteralPath $probe -Force }
    $record['originalSha256After'] = (Get-FileHash $Executable -Algorithm SHA256).Hash
    $record['originalUnchanged'] = $record.originalSha256 -eq $record.originalSha256After
    $record | ConvertTo-Json -Depth 12 | Set-Content (Join-Path $EvidenceDirectory 'rust-loader-result.json')
    if (-not $record.originalUnchanged) { throw 'Original Rust harness changed during diagnostics' }
}
