$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
$source='/workspace/milkup-mermaid-rebuild/scripts/ci/run-windows-mermaid-product-e2e.ps1'
$t=$null;$e=$null;$ast=[Management.Automation.Language.Parser]::ParseFile($source,[ref]$t,[ref]$e)
if($e.Count){throw($e|Out-String)}
foreach($f in $ast.FindAll({param($n)$n-is [Management.Automation.Language.FunctionDefinitionAst]},$true)){Invoke-Expression $f.Extent.Text}
$root=Join-Path ([IO.Path]::GetTempPath()) ('mermaid-partial-evidence-'+[guid]::NewGuid().ToString('N'));New-OwnedDirectory $root
$results=@();$candidate='a'*40
$node=(Get-Command node -CommandType Application|Select-Object -First 1).Source
try{
 foreach($case in @('complete','oversized-log','over-hash-budget','unknown-files','invalid-json-png','creation-collision')){
  $src=Join-Path $root ($case+'-source');$dest=Join-Path $root ($case+'-retained');New-OwnedDirectory $src;New-OwnedDirectory $dest
  Write-Json (Join-Path $src 'standard-context.json') @{status='ready';synthetic=$true}
  [IO.File]::WriteAllText((Join-Path $src 'node-stderr.log'),'Synthetic primary Node assertion failure')
  [IO.File]::WriteAllText((Join-Path $src 'fixture-ordinary.md'),'# Self-authored test')
  $png=[Convert]::FromBase64String('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1kAAAAASUVORK5CYII=')
  [IO.File]::WriteAllBytes((Join-Path $src 'unhandled-failure-window.png'),$png)
  if($case-in @('oversized-log','over-hash-budget')){
   $stream=[IO.File]::OpenWrite((Join-Path $src 'edgedriver-native.log'));try{$stream.SetLength($(if($case-ceq 'oversized-log'){2MB+1}else{33MB}))}finally{$stream.Dispose()}
  }
  if($case-ceq 'unknown-files'){for($i=0;$i-lt 70;$i++){[IO.File]::WriteAllText((Join-Path $src ('private-name-'+$i+'.log')),'Do not retain or hash this content')}}
  if($case-ceq 'invalid-json-png'){
   [IO.File]::WriteAllText((Join-Path $src 'mermaid-product-e2e.json'),'broken JSON')
   [IO.File]::WriteAllText((Join-Path $src '02-enabled-diagram.png'),'not a PNG')
  }
  $original=(Get-Command Read-BoundedEvidenceProof).ScriptBlock
  if($case-ceq 'creation-collision'){
   $script:injectCollision=$true;$script:proofOriginal=$original
   function Read-BoundedEvidenceProof([string]$Path,[long]$Limit,[string]$CopyTo='',$Created=$null){
    if($CopyTo-and $script:injectCollision){$script:injectCollision=$false;$script:collisionPath=$CopyTo;[IO.File]::WriteAllText($CopyTo,'OTHER WRITER OWNED FILE')}
    & $script:proofOriginal $Path $Limit $CopyTo $Created
   }
  }
  try{$copy=Copy-BoundedEvidence $src $dest}finally{Set-Item Function:Read-BoundedEvidenceProof $original}
  $manifest=Read-SmallJson (Join-Path $dest 'evidence-files.json')
  if($case-ceq 'complete'){
   if(-not $copy.complete -or $copy.files-ne 4 -or $copy.rejectedCount-ne 0){throw ('Complete evidence contract failed: '+($copy|ConvertTo-Json -Depth 10 -Compress))}
  }else{
   if($copy.complete -or $copy.rejectedCount-le 0){throw "Partial evidence was treated complete: $case"}
  }
  if($case-ceq 'oversized-log'){
   if($copy.files-ne 4 -or $copy.rejected[0].relativePath-cne 'edgedriver-native.log' -or $copy.rejected[0].hashStatus-cne 'complete' -or $copy.rejected[0].sha256-cne (Get-FileHash (Join-Path $src 'edgedriver-native.log')).Hash.ToLowerInvariant()){throw 'Bounded oversize rejection lost good files/full hash'}
  }
  if($case-ceq 'over-hash-budget' -and ($copy.rejected[0].hashStatus-cne 'not-read-budget' -or $null-ne $copy.rejected[0].sha256)){throw 'Oversize rejection read beyond hash budget'}
  if($case-ceq 'unknown-files'){
   if($copy.rejected.Count-ne 64-or $copy.rejectedCount-ne 70-or $copy.rejectionsOmitted-ne 6-or ($manifest|ConvertTo-Json -Depth 12)-match 'private-name-'){throw 'Unknown filename/privacy/count contract failed'}
  }
  if($case-ceq 'invalid-json-png' -and ($copy.files-ne 4 -or $copy.rejectedCount-ne 2)){throw 'Invalid structures blocked otherwise valid evidence'}
  if($case-ceq 'creation-collision'){
   if([IO.File]::ReadAllText($script:collisionPath)-cne 'OTHER WRITER OWNED FILE'){throw 'Collector deleted or changed an unowned collision target'}
  }else{
   $audit=[ordered]@{source=$candidate;status=$(if($copy.complete){'blocked'}else{'failed'});passwordInLogsFilesArgumentsOrEnvironment=$false;evidenceCopy=$copy;error='Synthetic primary Node assertion failure'}
   Write-Json (Join-Path $dest 'windows-standard-product-audit.json') $audit
   $stage=Join-Path $root ($case+'-artifact')
   & $node '/workspace/milkup-mermaid-rebuild/tests/windows/stage-mermaid-evidence.mjs' $dest $stage $candidate > (Join-Path $root ($case+'-stage.log'))
   if($LASTEXITCODE-ne 0){throw "Closed artifact stage rejected valid partial set: $case"}
   $staged=Read-SmallJson (Join-Path $stage 'artifact-manifest.json')
   if($staged.outerStatus-cne $audit.status){throw 'Artifact changed failure status'}
   if((Read-SmallJson (Join-Path $stage 'windows-standard-product-audit.json')).error-cne $audit.error){throw 'Primary failure was replaced'}
  }
  $results += [ordered]@{case=$case;retainedFiles=$copy.files;complete=$copy.complete;rejectedCount=$copy.rejectedCount;rejectionsOmitted=$copy.rejectionsOmitted;closedArtifactStagePassed=($case-cne 'creation-collision');collisionTargetPreserved=($case-ceq 'creation-collision')}
 }
 [ordered]@{status='passed';powerShell=$PSVersionTable.PSVersion.ToString();parseErrors=$e.Count;cases=$results;windowsApisCalled=$false;remoteTasksTriggered=$false}|ConvertTo-Json -Depth 8
}finally{Remove-Item -LiteralPath $root -Recurse -Force}
