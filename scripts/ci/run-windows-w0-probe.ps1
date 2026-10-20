# Authorized, bounded AppContainer compatibility experiment. No delivery actions.
param([switch]$Matrix, [switch]$UdpDiagnosis)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if (-not $IsWindows -or $env:GITHUB_ACTIONS -ne 'true' -or
    $env:GITHUB_REPOSITORY -ne 'Auto-Plugin/milkup' -or
    $env:GITHUB_REF -ne 'refs/heads/dot/milkup-v2-windows-backends') {
    throw 'Unexpected W0 execution scope'
}
if ($UdpDiagnosis) { $Matrix = $true }
$marker = if ($UdpDiagnosis) { '[windows-w0-udp-diagnosis]' } elseif ($Matrix) { '[windows-w0-matrix]' } else { '[windows-w0-probe]' }
$baseline = if ($UdpDiagnosis) { '1d095d4def531e73578902ad36591e13ed1d8d58' } elseif ($Matrix) { 'e37e9b43e0f8481074872a7514c62246e1cd0d0f' } else { '3747004b15e1dcf9c92b794b1f818c0853b98d11' }
$event = Get-Content -Raw $env:GITHUB_EVENT_PATH | ConvertFrom-Json
if ($event.repository.private -or $event.deleted -or
    -not $event.head_commit.message.Contains($marker)) { throw 'Missing public W0 gate' }
if ((git rev-parse HEAD).Trim() -ne $env:GITHUB_SHA) { throw 'W0 source mismatch' }
git merge-base --is-ancestor $baseline HEAD
if ($LASTEXITCODE -ne 0) { throw 'Unexpected W0 baseline' }
$roots = @(
    (Join-Path ${env:ProgramFiles(x86)} 'Microsoft/EdgeWebView/Application'),
    (Join-Path $env:ProgramFiles 'Microsoft/EdgeWebView/Application'),
    (Join-Path $env:LOCALAPPDATA 'Microsoft/EdgeWebView/Application')
) | Select-Object -Unique
$candidates = @(foreach ($root in $roots) {
    if (Test-Path -LiteralPath $root -PathType Container) {
        foreach ($directory in Get-ChildItem -LiteralPath $root -Directory) {
            $version = $null
            if ([Version]::TryParse($directory.Name, [ref]$version) -and
                (Test-Path -LiteralPath (Join-Path $directory.FullName 'msedgewebview2.exe') -PathType Leaf)) {
                [pscustomobject]@{ path = $directory.FullName; version = $version }
            }
        }
    }
})
if ($candidates.Count -eq 0) { throw 'No installed WebView2 Runtime; W0 blocked without download fallback' }
$runtime = ($candidates | Sort-Object version -Descending | Select-Object -First 1).path
$env:CARGO_TARGET_DIR = Join-Path $env:RUNNER_TEMP 'milkup-w0-target'
$env:MILKUP_W0_AUTHORIZED = 'temporary-ci-no-network-private-directory-only'
try {
    cargo build --locked --manifest-path scripts/ci/windows-w0-probe/Cargo.toml
    if ($LASTEXITCODE -ne 0) { throw 'W0 prototype build failed' }
    $binary = Join-Path $env:CARGO_TARGET_DIR 'debug/milkup-windows-w0-probe.exe'
    Write-Host "W0 exact source: $env:GITHUB_SHA; Runtime: $runtime"
    if ($UdpDiagnosis) {
        $env:MILKUP_W0_UDP_DIAGNOSIS = '1'
        $privateAddresses = @(Get-NetIPAddress -AddressFamily IPv4 -AddressState Preferred |
            Where-Object { $_.IPAddress -match '^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)' } |
            Sort-Object InterfaceIndex, IPAddress)
        if ($privateAddresses.Count -gt 0) { $env:MILKUP_W0_LOCAL_IPV4 = $privateAddresses[0].IPAddress }
    }
    if ($Matrix) {
        $mechanism = [ordered]@{
            baseline = $baseline
            services = @(Get-Service -Name BFE, mpssvc, Dnscache | Select-Object Name, Status, StartType)
            firewallProfiles = @(Get-NetFirewallProfile | Select-Object Name, Enabled, DefaultInboundAction, DefaultOutboundAction)
            readOnly = $true
            changedConfiguration = $false
            udpDiagnosis = [bool]$UdpDiagnosis
            assignedPrivateIpv4Control = $env:MILKUP_W0_LOCAL_IPV4
            nonLoopbackIpv6Count = @(Get-NetIPAddress -AddressFamily IPv6 -AddressState Preferred | Where-Object { $_.IPAddress -ne '::1' -and $_.IPAddress -notmatch '^fe80:' }).Count
            addressBoundary = 'Loopback plus one assigned private IPv4 on this same runner; no remote host or public endpoint tested'

        }
        Write-Host '::group::windows-w0-platform.json'
        $mechanism | ConvertTo-Json -Depth 6 | Write-Host
        Write-Host '::endgroup::'
        & $binary --matrix $runtime
    } else {
        & $binary $runtime
    }
    if ($LASTEXITCODE -ne 0) { throw 'W0 compatibility or cleanup failed; retain the reported boundary, do not expand permissions' }
} finally {
    Remove-Item Env:MILKUP_W0_AUTHORIZED -ErrorAction SilentlyContinue
    Remove-Item Env:MILKUP_W0_UDP_DIAGNOSIS -ErrorAction SilentlyContinue
    Remove-Item Env:MILKUP_W0_LOCAL_IPV4 -ErrorAction SilentlyContinue
}
