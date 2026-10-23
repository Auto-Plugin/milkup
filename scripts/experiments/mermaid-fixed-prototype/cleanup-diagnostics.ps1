# Read-only, bounded metadata for a failed case's newly owned private tree.
# This never retries deletion, changes ACLs, reads residual file contents or marks success.
function Test-OwnedCleanupPath([string]$Root, [string]$PrivateTemp) {
    $expected = [IO.Path]::GetFullPath($PrivateTemp).TrimEnd([IO.Path]::DirectorySeparatorChar)
    # The runner stage is a drive-absolute path. Accept only its exact ordinary
    # spelling or the exact extended spelling produced by Rust canonicalize.
    # No generic prefix stripping, UNC/device namespace or sibling is accepted.
    if ($expected -cnotmatch '^[A-Za-z]:\\' -or $expected.StartsWith('\\')) { return $false }
    $candidate = [IO.Path]::GetFullPath($Root)
    if ([IO.Path]::GetFileName($candidate) -cnotmatch '^milkup-fixed-mermaid-[0-9]+-[0-9]+$') { return $false }
    $parent = [IO.Path]::GetDirectoryName($candidate)
    return [String]::Equals($parent, $expected, [StringComparison]::OrdinalIgnoreCase) -or
        [String]::Equals($parent, '\\?\' + $expected, [StringComparison]::OrdinalIgnoreCase)
}

function Write-OwnedCleanupDiagnosis([string]$Output, [string]$PrivateTemp, $OuterResult) {
    if (-not $OuterResult.jobEmpty -or $OuterResult.cleanupErrors.Count -ne 0) {
        throw 'Owned process emptiness is not established for diagnostic traversal'
    }
    Assert-PlainPath $Output
    Assert-PlainPath $PrivateTemp
    $files = @(Get-ChildItem -LiteralPath $Output -File -Filter '*.json' | Where-Object { $_.Name -cne 'report.json' } | Select-Object -First 52)
    if ($files.Count -gt 51) { throw 'Diagnostic report count exceeds matrix budget' }
    $failed = @()
    foreach ($file in $files) {
        Assert-PlainPath $file.FullName
        if ($file.Length -gt 1048576) { throw 'Oversized diagnostic source report' }
        $record = Get-Content -LiteralPath $file.FullName -Raw | ConvertFrom-Json -AsHashtable
        $native = $record['launcher']
        if ($native -and $native['privateTreeRemoved'] -eq $false -and $native['stopMatrixAfterThisCase'] -eq $true) {
            $failed += $record
        }
    }
    if ($failed.Count -gt 1) { throw 'More than one retained case violates matrix stop contract' }
    foreach ($record in $failed) {
        $native = $record['launcher']
        $root = [IO.Path]::GetFullPath([string]$native['privateRoot'])
        $leaf = [IO.Path]::GetFileName($root)
        if (-not (Test-OwnedCleanupPath $root $PrivateTemp)) {
            throw 'Diagnostic root is not an immediate owned temporary case directory'
        }
        # Once exact parent/leaf equivalence is proven, use the ordinary owned
        # path for PowerShell-provider metadata calls. This changes no file path
        # supplied to the renderer and does not normalize arbitrary paths.
        $observedExtendedPrefix = $root.StartsWith('\\?\', [StringComparison]::Ordinal)
        $root = [IO.Path]::Combine([IO.Path]::GetFullPath($PrivateTemp), $leaf)
        $diagnostic = [ordered]@{
            schema=1; runId=$env:GITHUB_RUN_ID; attempt=$env:GITHUB_RUN_ATTEMPT; source=$env:GITHUB_SHA
            fixture=$record['fixture']; privateRootLeaf=$leaf
            observedExtendedLengthPrefix=$observedExtendedPrefix; exactOwnedParentAndLeafVerified=$true
            originalCleanupErrors=$native['cleanupErrors']; originalDeleteAttempts=$native['privateTreeDeleteAttempts']
            nativeJobActiveAfterStop=$native['jobActiveAfterStop']; outerJobEmpty=$OuterResult.jobEmpty
            originalErrorNamesSpecificChild=$false; causeEstablished=$false; residualFileContentsRead=$false; aclsChanged=$false
            entryLimit=64; depthLimit=8; byteLimit=65536; truncated=$false; entries=@(); errors=@()
        }
        $queue = [Collections.Generic.Queue[object]]::new()
        $queue.Enqueue(@{path=$root; depth=0})
        while ($queue.Count -gt 0 -and $diagnostic.entries.Count -lt 64) {
            $next = $queue.Dequeue()
            $path = [string]$next.path
            $entry = [ordered]@{relative=[IO.Path]::GetRelativePath($root, $path); depth=$next.depth; exists=$null}
            try {
                # .NET metadata calls do not read file data. Reject reparse points
                # before ACL inspection or queuing any children.
                $attributes = [IO.File]::GetAttributes($path)
                $entry['exists']=$true; $entry['attributes']=[string]$attributes
                $entry['attributesValue']=[int]$attributes
                $reparse = ($attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0
                $directory = ($attributes -band [IO.FileAttributes]::Directory) -ne 0
                $entry['kind']=$(if ($reparse) { 'reparse-rejected' } elseif ($directory) { 'directory' } else { 'file' })
                if (-not $reparse) {
                    Assert-PlainPath $path
                    try {
                        $acl = Get-Acl -LiteralPath $path -ErrorAction Stop
                        $sections = [Security.AccessControl.AccessControlSections]'Access,Owner,Group'
                        $sddl = $acl.GetSecurityDescriptorSddlForm($sections)
                        $originalSddlLength = $sddl.Length
                        $sddl = $sddl.Substring(0, [Math]::Min(2048, $sddl.Length))
                        while ([Text.Encoding]::UTF8.GetByteCount($sddl) -gt 2048) {
                            $sddl = $sddl.Substring(0, [Math]::Max(0, $sddl.Length - 128))
                        }
                        $entry['sddl'] = $sddl
                        $entry['sddlTruncated'] = $sddl.Length -ne $originalSddlLength
                    } catch { $entry['aclReadError'] = $_.Exception.Message.Substring(0, [Math]::Min(256, $_.Exception.Message.Length)) }
                    if ($directory -and $next.depth -lt 8) {
                        $enumerator = [IO.Directory]::EnumerateFileSystemEntries($path).GetEnumerator()
                        try {
                            while ($enumerator.MoveNext()) {
                                if ($queue.Count + $diagnostic.entries.Count -ge 63) { $diagnostic.truncated=$true; break }
                                $queue.Enqueue(@{path=$enumerator.Current; depth=$next.depth + 1})
                            }
                        } finally { $enumerator.Dispose() }
                    } elseif ($directory) { $diagnostic.truncated=$true }
                }
            } catch {
                $baseError = $_.Exception.GetBaseException()
                $entry['metadataReadError'] = $baseError.Message.Substring(0, [Math]::Min(256, $baseError.Message.Length))
                $entry['hresult'] = $baseError.HResult
                $entry['errorType'] = $baseError.GetType().FullName
                if ($baseError -is [IO.FileNotFoundException] -or $baseError -is [IO.DirectoryNotFoundException]) {
                    $entry['exists'] = $false
                }
            }
            $diagnostic.entries += $entry
        }
        if ($queue.Count) { $diagnostic.truncated=$true }
        $prefix = 'MILKUP_CLEANUP_DIAGNOSTIC '
        $json = $diagnostic | ConvertTo-Json -Depth 12 -Compress
        while ([Text.Encoding]::UTF8.GetByteCount($prefix + $json) -gt 65536 -and $diagnostic.entries.Count -gt 0) {
            $diagnostic.truncated=$true
            $diagnostic.entries = @($diagnostic.entries | Select-Object -SkipLast 1)
            $json = $diagnostic | ConvertTo-Json -Depth 12 -Compress
        }
        if ([Text.Encoding]::UTF8.GetByteCount($prefix + $json) -gt 65536) { throw 'Diagnostic header exceeds byte budget' }
        Write-Output ($prefix + $json)
    }
}
