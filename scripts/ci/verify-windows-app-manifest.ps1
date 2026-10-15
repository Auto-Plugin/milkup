[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Executable,
    [Parameter(Mandatory)][string]$EvidenceDirectory,
    [Parameter(Mandatory)][ValidateSet('rust-harness', 'production-binary')][string]$EvidenceName
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if (-not $IsWindows) { throw 'Embedded manifest verification requires Windows' }
$record = [ordered]@{ executable = $Executable; status = 'failed'; sha256 = (Get-FileHash $Executable -Algorithm SHA256).Hash }
try {
    $mtCandidates = @(Get-ChildItem "${env:ProgramFiles(x86)}/Windows Kits/10/bin/*/x64/mt.exe" -File | Sort-Object FullName -Descending)
    if ($mtCandidates.Count -eq 0) { throw 'Windows SDK manifest tool unavailable' }
    $mt = $mtCandidates[0].FullName
    $manifestPath = Join-Path $EvidenceDirectory "$EvidenceName.manifest"
    $toolOutput = & $mt '-nologo' "-inputresource:$Executable;#1" "-out:$manifestPath" 2>&1
    $record['extractExitCode'] = $LASTEXITCODE
    if ($LASTEXITCODE -ne 0) { throw "Embedded application manifest missing: $toolOutput" }
    $manifestText = Get-Content $manifestPath -Raw
    if ($manifestText.Length -gt 16384) { throw 'Unexpectedly large application manifest' }
    $record['manifest'] = $manifestText
    $settings = [System.Xml.XmlReaderSettings]::new()
    $settings.DtdProcessing = [System.Xml.DtdProcessing]::Prohibit
    $settings.XmlResolver = $null
    $reader = [System.Xml.XmlReader]::Create([System.IO.StringReader]::new($manifestText), $settings)
    try {
        $document = [System.Xml.XmlDocument]::new()
        $document.XmlResolver = $null
        $document.Load($reader)
    } finally { $reader.Dispose() }
    $namespaces = [System.Xml.XmlNamespaceManager]::new($document.NameTable)
    $namespaces.AddNamespace('asm', 'urn:schemas-microsoft-com:asm.v1')
    $dependencies = $document.SelectNodes('/asm:assembly/asm:dependency/asm:dependentAssembly/asm:assemblyIdentity[@name="Microsoft.Windows.Common-Controls"]', $namespaces)
    if ($dependencies.Count -ne 1) { throw 'Expected exactly one Common Controls manifest dependency' }
    $dependency = $dependencies[0]
    if ($dependency.GetAttribute('type') -cne 'win32' -or
        $dependency.GetAttribute('version') -cne '6.0.0.0' -or
        $dependency.GetAttribute('publicKeyToken') -cne '6595b64144ccf1df' -or
        $dependency.GetAttribute('processorArchitecture') -cnotin @('*', 'amd64') -or
        $dependency.GetAttribute('language') -cne '*') {
        throw 'Unexpected Common Controls manifest identity'
    }
    $record['commonControlsVersion'] = $dependency.GetAttribute('version')
    $record['sha256After'] = (Get-FileHash $Executable -Algorithm SHA256).Hash
    if ($record.sha256 -ne $record.sha256After) { throw 'Executable changed during read-only manifest verification' }
    $record.status = 'passed'
} catch { $record['error'] = $_.ToString(); throw }
finally { $record | ConvertTo-Json -Depth 6 | Set-Content (Join-Path $EvidenceDirectory "$EvidenceName-manifest.json") }
