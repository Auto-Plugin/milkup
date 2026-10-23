# Fixed synthetic PNGs only. No environment/window screenshots or arbitrary paths.
function Write-PositivePngEvidence([string]$Output, [string]$Manifest, $Report) {
    Assert-PlainPath $Output
    Assert-PlainPath $Manifest
    $fixtures = @((Get-Content -LiteralPath $Manifest -Raw | ConvertFrom-Json).fixtures)
    if ($fixtures.Count -ne 50 -or $Report.records.Count -ne 50 -or $Report.acceptedAssertions -ne 50) {
        throw 'Visual evidence requires the complete fixed positive matrix'
    }
    $ids = @($fixtures | ForEach-Object { $_.id })
    if (@($ids | Sort-Object -Unique).Count -ne 50 -or
        @($ids | Where-Object { $_ -cnotmatch '^[A-Za-z0-9_-]{1,80}$' }).Count) {
        throw 'Unexpected positive fixture identities'
    }
    $records = @($Report.records)
    if (@($records.fixture | Sort-Object -Unique).Count -ne 50 -or
        @(Compare-Object ($ids | Sort-Object) ($records.fixture | Sort-Object)).Count) {
        throw 'Visual report fixture set differs'
    }
    $pngNames = @(Get-ChildItem -LiteralPath $Output -Filter '*.png' -File | ForEach-Object { $_.Name })
    $expectedNames = @($ids | ForEach-Object { $_ + '.png' })
    if (@(Compare-Object ($expectedNames | Sort-Object) ($pngNames | Sort-Object)).Count) {
        throw 'Visual output image set differs'
    }
    $checked = @()
    $total = 0
    foreach ($fixture in $fixtures) {
        $id = $fixture.id
        $record = @($records | Where-Object { $_.fixture -ceq $id })[0]
        $native = $record.launcher
        $png = $record.pngValidation
        if ($record.ok -ne $true -or $record.rawRenderSucceeded -ne $true -or
            $record.registrationMatches -ne $true -or $png.decoded -ne $true -or $png.nonUniform -ne $true -or
            $native.success -ne $true -or $native.stopMatrixAfterThisCase -ne $false -or
            $native.jobActiveAfterStop -ne 0 -or $native.cleanupErrors.Count -ne 0 -or
            $native.profileDeletedAndFolderAbsent -ne $true -or $native.privateTreeRemoved -ne $true -or
            $record.expectedRegistrationId -cne $fixture.expectedRegistrationId) {
            throw 'An image lacks successful render and cleanup evidence'
        }
        # Construct from the trusted output directory and fixed fixture ID only.
        $path = Join-Path $Output ($id + '.png')
        Assert-PlainPath $path
        $stream = [IO.File]::Open($path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
        try {
            $length = $stream.Length
            if ($length -lt 33 -or $length -gt 262144 -or $total + $length -gt 1048576) {
                throw 'PNG visual evidence exceeds the per-file or aggregate byte budget'
            }
            [byte[]]$bytes = [byte[]]::new([int]$length)
            $stream.ReadExactly($bytes, 0, $bytes.Length)
            if ($stream.ReadByte() -ne -1) { throw 'PNG length changed during read' }
        } finally { $stream.Dispose() }
        $digest = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($bytes)).ToLowerInvariant()
        if ($digest -cne $png.sha256 -or $length -ne $record.metadata.pngBytes -or
            [Convert]::ToHexString([byte[]]($bytes[0..7])) -cne '89504E470D0A1A0A') {
            throw 'PNG bytes differ from the accepted native result'
        }
        $width = [uint32]$bytes[16] * 16777216 + [uint32]$bytes[17] * 65536 + [uint32]$bytes[18] * 256 + [uint32]$bytes[19]
        $height = [uint32]$bytes[20] * 16777216 + [uint32]$bytes[21] * 65536 + [uint32]$bytes[22] * 256 + [uint32]$bytes[23]
        if ($width -ne $png.width -or $height -ne $png.height -or $width -ne 1280 -or
            $height -lt 1 -or $height -gt 8192 -or [uint64]$width * $height -gt 16777216) {
            throw 'PNG dimensions differ from the accepted native result'
        }
        $total += $length
        $checked += @{id=$id; bytes=$bytes; size=$length; sha256=$digest; width=$width; height=$height}
    }
    # Validate the entire set before emitting the first image. Only positive
    # images are exported; the canary is a separate run with no PNG stream.
    $files = @()
    foreach ($item in $checked) {
        $base64 = [Convert]::ToBase64String($item.bytes)
        $count = [int][Math]::Ceiling($base64.Length / 4096.0)
        $identity = [ordered]@{
            schema=1; runId=$env:GITHUB_RUN_ID; attempt=$env:GITHUB_RUN_ATTEMPT; source=$env:GITHUB_SHA
            execution='positive'; fixture=$item.id; sha256=$item.sha256
        }
        $header = [ordered]@{}
        foreach ($key in $identity.Keys) { $header[$key] = $identity[$key] }
        $header['bytes']=$item.size; $header['width']=$item.width; $header['height']=$item.height; $header['chunks']=$count
        Write-Output ('MILKUP_PNG_BEGIN ' + ($header | ConvertTo-Json -Compress))
        for ($index=0; $index -lt $count; $index++) {
            $chunk = [ordered]@{}
            foreach ($key in $identity.Keys) { $chunk[$key] = $identity[$key] }
            $chunk['index']=$index; $chunk['chunks']=$count
            $chunk['data']=$base64.Substring($index * 4096, [Math]::Min(4096, $base64.Length - $index * 4096))
            Write-Output ('MILKUP_PNG_CHUNK ' + ($chunk | ConvertTo-Json -Compress))
        }
        Write-Output ('MILKUP_PNG_END ' + ($header | ConvertTo-Json -Compress))
        $files += $header
    }
    # Transfer completion is not execution acceptance. The consumer must also
    # require the same run's final account/profile/stage cleanup and CI success.
    $transportManifest = [ordered]@{
        schema=1; runId=$env:GITHUB_RUN_ID; attempt=$env:GITHUB_RUN_ATTEMPT; source=$env:GITHUB_SHA
        execution='positive'; count=$files.Count; totalBytes=$total; files=$files
        capturesEnvironmentScreens=$false; artifactUpload=$false
    }
    Write-Output ('MILKUP_PNG_MANIFEST ' + ($transportManifest | ConvertTo-Json -Depth 8 -Compress))
}
