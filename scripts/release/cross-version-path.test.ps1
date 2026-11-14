$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'cross-version-path.ps1')
foreach($value in @('C:\owned path','"C:\owned path"','C:\owned path\','"C:\owned path\"')) {
 if ((ConvertFrom-NsisInstallLocation $value) -cne 'C:\owned path') { throw 'NSIS path normalization mismatch' }
}
foreach($value in @('','relative','C:relative','"C:\owned','C:\owned"','"C:\owned" /arg','"C:\ow"ned"')) {
 $rejected=$false
 try { $null=ConvertFrom-NsisInstallLocation $value } catch { $rejected=$true }
 if (!$rejected) { throw 'Ambiguous/nonabsolute registry location accepted' }
}
Write-Output 'NSIS path cases: 4 exact paths and 7 rejection cases passed'
