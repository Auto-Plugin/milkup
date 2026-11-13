Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../../scripts/ci/webview-etw-capture.ps1')
$temp = Join-Path ([IO.Path]::GetTempPath()) ('milkup-profile-identity-' + [guid]::NewGuid().ToString('N') + '.wprp')
try {
    $hashes = @{
        FileIO = '00a9fb33b9ae83d5425ddaf49ac2f146bb86a0336c3989b0a9e5773936ef4d4b'
        Minifilter = 'ced41e04c200f6d1fe2b51cf3fd7295dee443e3cf85d5b9e71222d6448341256'
        DiskIO = '22ad8fdde533887f41178ef488c2c9e524700547c4a68964eff8dc68ffaa8f04'
    }
    foreach ($name in @('FileIO','Minifilter','DiskIO')) {
        $reference = Join-Path $PSScriptRoot ('../native/fixtures/etw-io/' + $name + '.wprp')
        if ((Get-FileHash $reference).Hash.ToLowerInvariant() -cne $hashes[$name]) { throw 'Exact reference checkout hash required before build' }
        $expected = Get-EtwProfileIdentity $reference
        [xml]$doc = Get-Content $reference -Raw
        foreach ($parent in @($doc.SelectNodes('/WindowsPerformanceRecorder/Profiles | //EventProviders'))) {
            $nodes = @($parent.ChildNodes | Where-Object { $_.LocalName -in @('EventProvider','EventProviderId') })
            [array]::Reverse($nodes)
            foreach ($node in $nodes) { $null = $parent.RemoveChild($node) }
            foreach ($node in $nodes) { $null = $parent.AppendChild($node) }
        }
        $doc.Save($temp)
        if ((Get-EtwProfileIdentity $temp) -cne $expected) { throw 'Provider permutation changed identity' }
        $keyword = $doc.SelectSingleNode('//SystemProvider/Keywords/Keyword')
        $keyword.SetAttribute('Value','UnexpectedKeyword')
        $doc.Save($temp)
        if ((Get-EtwProfileIdentity $temp) -ceq $expected) { throw 'Keyword mutation escaped identity' }
        [xml]$doc = Get-Content $reference -Raw
        $provider = $doc.SelectSingleNode('//EventProvider')
        $null = $provider.ParentNode.RemoveChild($provider)
        $doc.Save($temp)
        if ((Get-EtwProfileIdentity $temp) -ceq $expected) { throw 'Missing provider escaped identity' }
        [xml]$doc = Get-Content $reference -Raw
        $buffer = $doc.SelectSingleNode('//BufferSize')
        $buffer.SetAttribute('Value','1')
        $doc.Save($temp)
        if ((Get-EtwProfileIdentity $temp) -ceq $expected) { throw 'Buffer mutation escaped identity' }
    }
    [IO.File]::WriteAllText($temp, '<!DOCTYPE x [<!ENTITY e "forbidden">]><x>&e;</x>')
    $rejected = $false
    try { $null = Get-EtwProfileIdentity $temp } catch { $rejected = $true }
    if (-not $rejected) { throw 'DTD not rejected' }
    Write-Output 'Profile identity: reorder accepted; changed/missing content and DTD rejected'
} finally { Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue }
