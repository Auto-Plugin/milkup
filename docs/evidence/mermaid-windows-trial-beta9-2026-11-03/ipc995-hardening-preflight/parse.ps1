$ErrorActionPreference = 'Stop'
$files = Get-Content (Join-Path $PSScriptRoot 'parse-inputs.json') -Raw | ConvertFrom-Json
foreach ($file in $files) {
  $tokens = $null; $parseErrors = $null
  $null = [Management.Automation.Language.Parser]::ParseFile($file, [ref]$tokens, [ref]$parseErrors)
  if ($parseErrors.Count) { throw ($parseErrors | Out-String) }
}
[ordered]@{ status = 'passed'; parsedPowerShellFiles = $files.Count; execution = $false } | ConvertTo-Json
