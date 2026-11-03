# Review-only preparation of one pinned official Fixed Version Runtime. Dot-sourcing
# defines functions only. Initialize-FixedRuntime155 is the sole network/extraction
# entry point; it does not launch package contents or install/register the Runtime.
# The caller owns the fresh supervised stage, its protected ACLs and final cleanup.

function Get-FixedRuntime155Spec {
    [pscustomobject]@{
        version = '155.0.4283.62'; architecture = 'x64'
        packageName = 'Microsoft.WebView2.FixedVersionRuntime.155.0.4283.62.x64'
        url = 'https://msedge.sf.dl.delivery.mp.microsoft.com/filestreamingservice/files/232cf50b-3980-4531-afbb-779f446d7de1/Microsoft.WebView2.FixedVersionRuntime.155.0.4283.62.x64.cab'
        bytes = [long]310492238
        sha256 = 'cf54aa717a0ebd05b40e87620724583cb6eb0a5b8b64764cc11e42822f68bf6c'
        files = 256; totalBytes = [long]705180320
    }
}

function ConvertTo-Runtime155RelativePath([string]$Name) {
    # Intentionally matches the native manifest allowlist and this complete CAB.
    # Spaces inside components are needed by the official Trust Protection Lists.
    $path = $Name.Replace('\', '/')
    if ([string]::IsNullOrEmpty($path) -or $path.Length -gt 1024) { throw 'Runtime relative path length rejected' }
    foreach ($part in $path.Split('/')) {
        if ($part -ceq '' -or $part -ceq '.' -or $part -ceq '..' -or
            $part.StartsWith(' ') -or $part.EndsWith(' ') -or $part.EndsWith('.') -or
            $part -cnotmatch '\A[A-Za-z0-9._ -]+\z') { throw 'Runtime relative path component rejected' }
        $stem = $part.Split('.')[0]
        if ($stem -match '\A(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])\z') { throw 'Runtime device name rejected' }
    }
    return $path
}

function Assert-Runtime155PlainPath([string]$Path) {
    $item = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Runtime reparse path rejected' }
    if (-not $item.PSIsContainer) { $item = $item.Directory }
    do {
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Runtime reparse ancestor rejected' }
        $item = $item.Parent
    } while ($null -ne $item)
}

function Assert-Runtime155Digest([long]$ActualBytes, [string]$ActualHash, [long]$ExpectedBytes, [string]$ExpectedHash) {
    if ($ActualBytes -ne $ExpectedBytes -or $ActualHash -cnotmatch '\A[0-9a-f]{64}\z' -or
        $ActualHash -cne $ExpectedHash) { throw 'Runtime download length/SHA256 mismatch' }
}

function Assert-Runtime155EntryIdentity([string]$Architecture, [string]$FileVersion, [string]$ProductVersion) {
    $spec = Get-FixedRuntime155Spec
    if ($Architecture -cne $spec.architecture -or $FileVersion -cne $spec.version -or $ProductVersion -cne $spec.version) {
        throw 'Runtime entry architecture/FileVersion/ProductVersion mismatch'
    }
}

function Read-Runtime155CabinetEntries([string]$Path) {
    # Parse CFFILE names before expand.exe can write anything. The production
    # caller has already checked the exact complete CAB digest and signature.
    $stream = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
    $reader = [IO.BinaryReader]::new($stream, [Text.Encoding]::ASCII, $true)
    try {
        if ($stream.Length -lt 36 -or $stream.Length -gt 536870912) { throw 'Runtime CAB byte budget rejected' }
        if ($reader.ReadUInt32() -ne 0x4643534d) { throw 'Runtime CAB magic rejected' }
        if ($reader.ReadUInt32() -ne 0) { throw 'Runtime CAB reserved header rejected' }
        $cabinetBytes = [long]$reader.ReadUInt32()
        if ($reader.ReadUInt32() -ne 0) { throw 'Runtime CAB reserved header rejected' }
        $filesOffset = [long]$reader.ReadUInt32()
        if ($reader.ReadUInt32() -ne 0) { throw 'Runtime CAB reserved header rejected' }
        $minor = $reader.ReadByte(); $major = $reader.ReadByte()
        $folders = [int]$reader.ReadUInt16(); $count = [int]$reader.ReadUInt16()
        $flags = [int]$reader.ReadUInt16()
        $null = $reader.ReadUInt16(); $index = $reader.ReadUInt16()
        # An Authenticode signature may follow cbCabinet; it is not CAB payload.
        if ($cabinetBytes -lt 36 -or $cabinetBytes -gt $stream.Length -or $major -ne 1 -or $minor -ne 3 -or
            $folders -lt 1 -or $count -lt 1 -or $count -gt 10000 -or $index -ne 0 -or
            ($flags -band 0xfffb) -ne 0) { throw 'Runtime CAB header/continuation rejected' }
        $folderReserve = 0
        if ($flags -band 4) {
            if ($stream.Position + 4 -gt $cabinetBytes) { throw 'Runtime CAB reserve header truncated' }
            $headerReserve = [int]$reader.ReadUInt16()
            $folderReserve = [int]$reader.ReadByte(); $null = $reader.ReadByte()
            if ($stream.Position + $headerReserve -gt $cabinetBytes) { throw 'Runtime CAB reserve truncated' }
            $null = $stream.Seek($headerReserve, [IO.SeekOrigin]::Current)
        }
        $minimumOffset = $stream.Position + ([long]$folders * (8 + $folderReserve))
        if ($filesOffset -lt $minimumOffset -or $filesOffset -ge $cabinetBytes) { throw 'Runtime CAB file table offset rejected' }
        $stream.Position = $filesOffset
        $entries = [Collections.Generic.List[object]]::new()
        $names = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
        $total = [long]0
        for ($i = 0; $i -lt $count; $i++) {
            if ($stream.Position + 16 -gt $cabinetBytes) { throw 'Runtime CAB file table truncated' }
            $bytes = [long]$reader.ReadUInt32(); $null = $reader.ReadUInt32()
            $folder = [int]$reader.ReadUInt16(); $null = $reader.ReadUInt16(); $null = $reader.ReadUInt16()
            $attributes = [int]$reader.ReadUInt16()
            if ($folder -ge $folders -or $bytes -gt 2147483648 -or $total + $bytes -gt 2147483648) {
                throw 'Runtime CAB continuation or expanded byte budget rejected'
            }
            $nameBytes = [Collections.Generic.List[byte]]::new()
            while ($true) {
                if ($stream.Position -ge $cabinetBytes -or $nameBytes.Count -gt 1024) { throw 'Runtime CAB name truncated/oversized' }
                $b = $reader.ReadByte()
                if ($b -eq 0) { break }
                $nameBytes.Add($b)
            }
            if ($attributes -band 0x80) {
                $name = [Text.UTF8Encoding]::new($false, $true).GetString($nameBytes.ToArray())
            } else {
                foreach ($b in $nameBytes) { if ($b -gt 127) { throw 'Runtime CAB ambiguous legacy filename rejected' } }
                $name = [Text.Encoding]::ASCII.GetString($nameBytes.ToArray())
            }
            $name = ConvertTo-Runtime155RelativePath $name
            if (-not $names.Add($name)) { throw 'Runtime CAB duplicate/case alias rejected' }
            $entries.Add([pscustomobject]@{ path = $name; bytes = $bytes })
            $total += $bytes
        }
        foreach ($entry in $entries) {
            $parts = $entry.path.Split('/')
            for ($i = 1; $i -lt $parts.Length; $i++) {
                if ($names.Contains(($parts[0..($i - 1)] -join '/'))) { throw 'Runtime CAB file/directory alias rejected' }
            }
        }
        return [pscustomobject]@{ files = $entries.ToArray(); totalBytes = $total; cabinetBytes = $cabinetBytes }
    } finally { $reader.Dispose(); $stream.Dispose() }
}

function Get-Runtime155PeInfo([string]$Path) {
    # Inert header reads only; never LoadLibrary, invoke or inspect by execution.
    $stream = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
    $reader = [IO.BinaryReader]::new($stream, [Text.Encoding]::ASCII, $true)
    try {
        if ($stream.Length -lt 2 -or $reader.ReadUInt16() -ne 0x5a4d) { return $null }
        if ($stream.Length -lt 64) { throw 'Runtime PE DOS header truncated' }
        $stream.Position = 60; $offset = [long]$reader.ReadUInt32()
        if ($offset -lt 64 -or $offset -gt 16777216 -or $offset + 26 -gt $stream.Length) { throw 'Runtime PE header offset rejected' }
        $stream.Position = $offset
        if ($reader.ReadUInt32() -ne 0x00004550) { throw 'Runtime PE signature rejected' }
        $machine = [int]$reader.ReadUInt16()
        $stream.Position = $offset + 20; $optionalBytes = [int]$reader.ReadUInt16()
        if ($optionalBytes -lt 2 -or $offset + 24 + $optionalBytes -gt $stream.Length) { throw 'Runtime PE optional header truncated' }
        $stream.Position = $offset + 24; $magic = [int]$reader.ReadUInt16()
        $architecture = switch ($machine) { 0x8664 { 'x64' }; 0x014c { 'x86' }; 0xaa64 { 'arm64' }; default { 'other' } }
        if ($magic -notin @(0x010b, 0x020b) -or
            ($architecture -in @('x64', 'arm64') -and $magic -ne 0x020b) -or
            ($architecture -ceq 'x86' -and $magic -ne 0x010b)) { throw 'Runtime PE machine/optional header mismatch' }
        return [pscustomobject]@{ machine = ('0x{0:x4}' -f $machine); architecture = $architecture }
    } finally { $reader.Dispose(); $stream.Dispose() }
}

function Test-Runtime155MicrosoftSigner([string]$SimpleName, [string]$DecodedSubject) {
    $names = @('Microsoft Corporation', 'Microsoft Windows', 'Microsoft Windows Publisher')
    $organizations = @($DecodedSubject -split '\r?\n' | Where-Object { $_.StartsWith('O=') })
    return ($SimpleName -cin $names -and $organizations.Count -eq 1 -and $organizations[0] -ceq 'O=Microsoft Corporation')
}

function Get-Runtime155Signature([string]$Path, [switch]$RequireMicrosoft) {
    $signature = Get-AuthenticodeSignature -LiteralPath $Path -ErrorAction Stop
    if ($signature.Status -ne [Management.Automation.SignatureStatus]::Valid -or $null -eq $signature.SignerCertificate) {
        # No unsigned-CAB or unsigned-DLL bypass. Keep exact status and path for review.
        throw ('Runtime Authenticode rejected: {0}: {1}: {2}' -f $Path, $signature.Status, $signature.StatusMessage)
    }
    $certificate = $signature.SignerCertificate
    $simple = $certificate.GetNameInfo([Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false)
    $decoded = $certificate.SubjectName.Decode([Security.Cryptography.X509Certificates.X500DistinguishedNameFlags]::UseNewLines)
    $microsoft = Test-Runtime155MicrosoftSigner $simple $decoded
    if ($RequireMicrosoft -and -not $microsoft) { throw ('Runtime Microsoft publisher rejected: {0}: {1}' -f $Path, $certificate.Subject) }
    return [pscustomobject]@{
        status = [string]$signature.Status; signatureType = [string]$signature.SignatureType
        subject = $certificate.Subject; issuer = $certificate.Issuer; thumbprint = $certificate.Thumbprint
        microsoftPublisher = $microsoft
    }
}

function Get-Runtime155TreeFiles([string]$Root) {
    Assert-Runtime155PlainPath $Root
    $rootFull = [IO.Path]::GetFullPath($Root)
    $pending = [Collections.Generic.Queue[IO.DirectoryInfo]]::new()
    $pending.Enqueue([IO.DirectoryInfo]::new($rootFull))
    $files = [Collections.Generic.List[object]]::new()
    $seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    $total = [long]0; $directories = 0
    while ($pending.Count -gt 0) {
        $directory = $pending.Dequeue()
        foreach ($item in $directory.EnumerateFileSystemInfos()) {
            if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Runtime extracted reparse point rejected' }
            $relative = [IO.Path]::GetRelativePath($rootFull, $item.FullName)
            $relative = ConvertTo-Runtime155RelativePath $relative
            if (-not $seen.Add($relative)) { throw 'Runtime extracted path alias rejected' }
            if ($item.Attributes -band [IO.FileAttributes]::Directory) {
                $directories++
                if ($directories -gt 10000) { throw 'Runtime extracted directory budget rejected' }
                $pending.Enqueue([IO.DirectoryInfo]$item)
            } else {
                $total += ([IO.FileInfo]$item).Length
                if ($files.Count -ge 10000 -or $total -gt 2147483648) { throw 'Runtime extracted budget rejected' }
                $files.Add([pscustomobject]@{ path = $relative; fullName = $item.FullName; bytes = ([IO.FileInfo]$item).Length })
            }
        }
    }
    return [pscustomobject]@{ files = $files.ToArray(); totalBytes = $total }
}

function Initialize-FixedRuntime155 {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$Stage)
    if (-not $IsWindows -or $env:GITHUB_ACTIONS -cne 'true' -or
        $env:GITHUB_REPOSITORY -cne 'Auto-Plugin/milkup' -or
        $env:GITHUB_REF -cne 'refs/heads/dot/milkup-v2-mermaid-prototype') {
        throw 'Fixed Runtime preparation requires the reviewed disposable GitHub runner'
    }
    $spec = Get-FixedRuntime155Spec
    Assert-Runtime155PlainPath $Stage
    $stageInfo = Get-Item -LiteralPath $Stage -Force
    if (-not $stageInfo.PSIsContainer -or $stageInfo.Name -cnotmatch '\Amilkup-standard-[0-9a-f]{32}\z' -or
        [string]::IsNullOrEmpty($env:RUNNER_TEMP) -or
        -not [string]::Equals($stageInfo.Parent.FullName.TrimEnd('\'), [IO.Path]::GetFullPath($env:RUNNER_TEMP).TrimEnd('\'), [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Fixed Runtime requires the exact newly owned supervised stage'
    }
    $Stage = $stageInfo.FullName
    $code = Join-Path $Stage 'code'; Assert-Runtime155PlainPath $code
    if (-not (Test-Path -LiteralPath $code -PathType Container)) { throw 'Protected Runtime proof directory missing' }
    $downloads = Join-Path $Stage 'downloads'
    $extract = Join-Path $Stage 'runtime-extract'; $runtime = Join-Path $Stage 'runtime'
    $manifestPath = Join-Path $code 'runtime-manifest.json'
    foreach ($path in @($downloads, $extract, $runtime, $manifestPath)) {
        if (Test-Path -LiteralPath $path) { throw 'Fixed Runtime preparation refuses an existing destination' }
    }
    $null = New-Item -ItemType Directory -Path $downloads -ErrorAction Stop
    $null = New-Item -ItemType Directory -Path $extract -ErrorAction Stop
    $cab = Join-Path $downloads ($spec.packageName + '.cab')
    $handler = [Net.Http.HttpClientHandler]::new()
    $handler.AllowAutoRedirect = $false
    $handler.UseDefaultCredentials = $false; $handler.UseCookies = $false
    $client = [Net.Http.HttpClient]::new($handler)
    $client.Timeout = [Threading.Timeout]::InfiniteTimeSpan
    $deadline = [Threading.CancellationTokenSource]::new([TimeSpan]::FromMinutes(10))
    $response = $null; $inputStream = $null; $outputStream = $null
    $hash = [Security.Cryptography.IncrementalHash]::CreateHash([Security.Cryptography.HashAlgorithmName]::SHA256)
    try {
        # No ambient credentials, no redirect to a new destination, no retries to
        # another version/source. A retry requires a new caller-owned stage.
        $response = $client.GetAsync($spec.url, [Net.Http.HttpCompletionOption]::ResponseHeadersRead, $deadline.Token).GetAwaiter().GetResult()
        if ([int]$response.StatusCode -ne 200 -or $response.Content.Headers.ContentLength -ne $spec.bytes) {
            throw 'Pinned Runtime download status/content-length rejected'
        }
        $inputStream = $response.Content.ReadAsStreamAsync($deadline.Token).GetAwaiter().GetResult()
        $outputStream = [IO.File]::Open($cab, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
        $buffer = [byte[]]::new(65536); $received = [long]0
        while ($true) {
            $read = $inputStream.ReadAsync($buffer, 0, $buffer.Length, $deadline.Token).GetAwaiter().GetResult()
            if ($read -eq 0) { break }
            $received += $read
            if ($received -gt $spec.bytes) { throw 'Pinned Runtime download exceeded byte limit' }
            $outputStream.Write($buffer, 0, $read); $hash.AppendData($buffer, 0, $read)
        }
        $digest = [Convert]::ToHexString($hash.GetHashAndReset()).ToLowerInvariant()
        Assert-Runtime155Digest $received $digest $spec.bytes $spec.sha256
        $outputStream.Flush($true)
    } finally {
        if ($null -ne $outputStream) { $outputStream.Dispose() }
        if ($null -ne $inputStream) { $inputStream.Dispose() }
        if ($null -ne $response) { $response.Dispose() }
        $hash.Dispose(); $deadline.Dispose(); $client.Dispose()
    }
    $cabSignature = Get-Runtime155Signature $cab -RequireMicrosoft
    $cabinet = Read-Runtime155CabinetEntries $cab
    if ($cabinet.files.Count -ne $spec.files -or $cabinet.totalBytes -ne $spec.totalBytes) { throw 'Pinned Runtime CAB inventory mismatch' }
    $expected = [Collections.Generic.Dictionary[string,long]]::new([StringComparer]::Ordinal)
    $prefix = $spec.packageName + '/'
    foreach ($entry in $cabinet.files) {
        if (-not $entry.path.StartsWith($prefix, [StringComparison]::Ordinal)) { throw 'Pinned Runtime CAB wrapper mismatch' }
        $relative = ConvertTo-Runtime155RelativePath $entry.path.Substring($prefix.Length)
        $expected.Add($relative, $entry.bytes)
    }
    if (-not $expected.ContainsKey('msedgewebview2.exe')) { throw 'Pinned Runtime entry image missing' }
    $expand = Join-Path $env:SystemRoot 'System32/expand.exe'
    Assert-Runtime155PlainPath $expand
    $expandOutput = & $expand $cab '-F:*' $extract 2>&1
    if ($LASTEXITCODE -ne 0) { throw ('Windows expand.exe failed with exit {0}' -f $LASTEXITCODE) }
    # Only retain the line count in proof. This is not a separate output byte cap;
    # expand receives only the signature/hash-pinned, preflighted 256-file CAB.
    $expandOutputLines = @($expandOutput).Count
    Assert-Runtime155PlainPath $extract
    $children = @(Get-ChildItem -LiteralPath $extract -Force)
    if ($children.Count -ne 1 -or -not $children[0].PSIsContainer -or $children[0].Name -cne $spec.packageName) {
        throw 'Runtime extraction wrapper/extra entry rejected'
    }
    $packageRoot = $children[0].FullName
    $inventory = Get-Runtime155TreeFiles $packageRoot
    if ($inventory.files.Count -ne $expected.Count -or $inventory.totalBytes -ne $spec.totalBytes) { throw 'Runtime extraction file/byte count mismatch' }
    foreach ($file in $inventory.files) {
        if (-not $expected.ContainsKey($file.path) -or $expected[$file.path] -ne $file.bytes) { throw 'Runtime extraction path/length mismatch' }
    }
    # Directory move preserves the complete package; nothing is pruned or added.
    [IO.Directory]::Move($packageRoot, $runtime)
    $inventory = Get-Runtime155TreeFiles $runtime
    $byName = [Collections.Generic.Dictionary[string,object]]::new([StringComparer]::Ordinal)
    foreach ($file in $inventory.files) { $byName.Add($file.path, $file) }
    $orderedNames = [string[]]@($byName.Keys); [Array]::Sort($orderedNames, [StringComparer]::Ordinal)
    $files = [Collections.Generic.List[object]]::new(); $peSignatures = [Collections.Generic.List[object]]::new()
    $entryVerified = $false
    foreach ($name in $orderedNames) {
        $file = $byName[$name]
        Assert-Runtime155PlainPath $file.fullName
        $fileHash = (Get-FileHash -LiteralPath $file.fullName -Algorithm SHA256).Hash.ToLowerInvariant()
        $files.Add([ordered]@{ path = $name; bytes = $file.bytes; sha256 = $fileHash })
        $pe = Get-Runtime155PeInfo $file.fullName
        if ($null -eq $pe) {
            if ([IO.Path]::GetExtension($name) -iin @('.exe', '.dll')) { throw ('Runtime executable lacks PE header: {0}' -f $name) }
            continue
        }
        $entryImage = $name -ceq 'msedgewebview2.exe'
        $signature = Get-Runtime155Signature $file.fullName -RequireMicrosoft:$entryImage
        $peSignatures.Add([ordered]@{ path = $name; machine = $pe.machine; architecture = $pe.architecture; signature = $signature })
        if ($entryImage) {
            $version = [Diagnostics.FileVersionInfo]::GetVersionInfo($file.fullName)
            $fileVersion = '{0}.{1}.{2}.{3}' -f $version.FileMajorPart, $version.FileMinorPart, $version.FileBuildPart, $version.FilePrivatePart
            $productVersion = '{0}.{1}.{2}.{3}' -f $version.ProductMajorPart, $version.ProductMinorPart, $version.ProductBuildPart, $version.ProductPrivatePart
            Assert-Runtime155EntryIdentity $pe.architecture $fileVersion $productVersion
            $entryVerified = $true
        }
    }
    if (-not $entryVerified -or $files.Count -ne $spec.files -or $inventory.totalBytes -ne $spec.totalBytes) {
        throw 'Runtime final inventory/verified entry missing'
    }
    $manifest = [ordered]@{ schema = 1; version = $spec.version; architecture = $spec.architecture;
        cabSha256 = $spec.sha256; files = $files.ToArray(); totalBytes = $inventory.totalBytes }
    $json = [Text.UTF8Encoding]::new($false).GetBytes(($manifest | ConvertTo-Json -Depth 8 -Compress))
    $manifestStream = [IO.File]::Open($manifestPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try { $manifestStream.Write($json, 0, $json.Length); $manifestStream.Flush($true) } finally { $manifestStream.Dispose() }
    $manifestSha = (Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash.ToLowerInvariant()
    $proof = [ordered]@{
        schema = 1; version = $spec.version; architecture = $spec.architecture; sourceUrl = $spec.url
        cabBytes = $spec.bytes; cabSha256 = $spec.sha256; cabSignature = $cabSignature
        filesCount = $files.Count; totalBytes = $inventory.totalBytes; peSignatures = $peSignatures.ToArray()
        manifestSha256 = $manifestSha; expandOutputLines = $expandOutputLines
        downloads = $true; installed = $false; packageContentsExecuted = $false
        systemRuntimeChanged = $false; systemAclChanged = $false; registryChanged = $false
    }
    return [pscustomobject]@{ runtimePath = $runtime; manifestPath = $manifestPath; manifestSha256 = $manifestSha; proof = $proof }
}
