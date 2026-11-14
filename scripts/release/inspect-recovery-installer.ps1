[CmdletBinding()]
param([Parameter(Mandatory)][string]$InstallerPath)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
# Read PE resources only. Never execute the installer during recovery preparation.
$item = Get-Item -LiteralPath $InstallerPath
if ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
    throw 'Recovery installer must be a regular file'
}
$info = [Diagnostics.FileVersionInfo]::GetVersionInfo($item.FullName)
[ordered]@{
    productVersion = $info.ProductVersion
    sha256 = (Get-FileHash -LiteralPath $item.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
} | ConvertTo-Json -Compress
