[CmdletBinding()]
param([Parameter(Mandatory)][string]$InstallerPath)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
# Read PE resources only. Never execute the installer during recovery preparation.
$item = Get-Item -LiteralPath $InstallerPath
if ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
    throw 'Recovery installer must be a regular file'
}
# This reader can be launched by PowerShell 7 through Windows PowerShell 5.
# Use framework hashing, not Get-FileHash module auto-loading from an inherited
# PSModulePath. Hold a read-only sharing handle across version/hash inspection.
$stream = [IO.File]::Open($item.FullName, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
$hash = [Security.Cryptography.SHA256]::Create()
try {
    $info = [Diagnostics.FileVersionInfo]::GetVersionInfo($item.FullName)
    $digest = [BitConverter]::ToString($hash.ComputeHash($stream)).Replace('-', '').ToLowerInvariant()
    [ordered]@{
        productVersion = $info.ProductVersion
        sha256 = $digest
    } | ConvertTo-Json -Compress
} finally {
    $hash.Dispose()
    $stream.Dispose()
}
