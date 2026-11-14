function ConvertFrom-NsisInstallLocation([string]$Value) {
 if ([string]::IsNullOrEmpty($Value)) { throw 'Missing install location' }
 # Tauri CLI 2.11.4 writes exactly one surrounding quote pair. This is a
 # registry path value, not a command line; arguments or embedded quotes fail.
 if ($Value.StartsWith('"') -or $Value.EndsWith('"')) {
  if ($Value.Length -lt 3 -or !$Value.StartsWith('"') -or !$Value.EndsWith('"')) { throw 'Unbalanced install location quotes' }
  $Value=$Value.Substring(1,$Value.Length-2)
 }
 if ($Value.Contains('"') -or ![IO.Path]::IsPathFullyQualified($Value) -or $Value.Contains([char]0)) { throw 'Exact absolute installation path required' }
 return [IO.Path]::GetFullPath($Value).TrimEnd('\')
}
