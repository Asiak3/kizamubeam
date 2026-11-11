param([string]$ResourceDirectory='', [switch]$SkipPrivateResources)
$ErrorActionPreference='Stop'
$root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Set-Location $root
if(-not $ResourceDirectory){$ResourceDirectory=[IO.Path]::GetFullPath((Join-Path $root '../../resources'))}
$archive=Join-Path $root ('artifacts/windows-island-topology-'+(Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Path $archive | Out-Null
function Run-Check([string]$name,[string]$program,[string[]]$arguments){
  $ErrorActionPreference='Continue'
  & $program @arguments *> (Join-Path $archive ($name+'.log'))
  $code=$LASTEXITCODE
  $ErrorActionPreference='Stop'
  if($code -ne 0){Get-Content (Join-Path $archive ($name+'.log')) -Tail 45;throw "$name failed ($code); archive: $archive"}
  Write-Output "PASS $name"
}
git rev-parse HEAD | Set-Content -Encoding utf8 (Join-Path $archive 'baseline.txt')
git branch --show-current | Set-Content -Encoding utf8 (Join-Path $archive 'branch.txt')
git status --short | Set-Content -Encoding utf8 (Join-Path $archive 'worktree.txt')
& git diff --binary HEAD "--output=$(Join-Path $archive 'tracked-changes.patch')" -- . ':(exclude)artifacts/**'
if($LASTEXITCODE -ne 0){throw 'Unable to save tracked changes'}
$checks=@('test:contour-topology','test:path-islands','test:freehand-edit','test:component-selection','test:camera-overlay','test:apps','test:vector','test:interaction','test:outline','test:contour-offset','test:canvas-zoom','test:file-drop','test:paths','test:history','test:slot-features','test:slot-worker','test:generators','test:gcode','i18n:check')
foreach($check in $checks){Run-Check ($check.Replace(':','-')) 'npm.cmd' @('run',$check)}
Run-Check 'outline-precision-60' 'node' @('scripts/vector-offline-test.mjs','scripts/outline-precision-study.ts')
if(-not $SkipPrivateResources){
  $islands=Join-Path $ResourceDirectory 'inseln.kzb'
  $frame=Join-Path $ResourceDirectory 'photoframe.kzb'
  $resourceHashes=@{};foreach($file in @($islands,$frame)){$resourceHashes[$file]=(Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash}
  Run-Check 'path-islands-original-resource' 'node' @('scripts/vector-offline-test.mjs','scripts/path-islands-test.ts',$islands)
  Run-Check 'extraction-original-resource' 'node' @('scripts/vector-offline-test.mjs','scripts/island-geometry-resource-test.ts',$frame)
  Run-Check 'path-islands-performance' 'node' @('scripts/vector-offline-test.mjs','scripts/path-islands-performance-study.ts',$islands)
  Run-Check 'path-islands-browser-bundle' 'node' @('scripts/editor-resource-browser-fixture.mjs',$islands)
  Run-Check 'path-islands-browser' 'node' @('scripts/run-feature-browser.mjs','artifacts/resource-browser','runPathIslandResourceChecks')
  Run-Check 'path-islands-browser-performance' 'node' @('scripts/run-feature-browser.mjs','artifacts/resource-browser','runPathIslandPerformanceChecks')
  Copy-Item 'artifacts/resource-browser/runPathIslandResourceChecks-results.json','artifacts/resource-browser/runPathIslandPerformanceChecks-results.json' $archive
  foreach($file in @($islands,$frame)){if((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -ne $resourceHashes[$file]){throw "Private resource changed: $file"};'{0}  {1}' -f $resourceHashes[$file],(Split-Path $file -Leaf) | Add-Content -Encoding utf8 (Join-Path $archive 'private-resource-sha256.txt')}
}
Run-Check 'prototype-browser-bundle' 'node' @('scripts/editor-prototype-browser-fixture.mjs')
Run-Check 'outline-browser' 'node' @('scripts/run-feature-browser.mjs','artifacts/local-prototypes/editor-browser','runOutlinePrototypeChecks')
Copy-Item 'artifacts/local-prototypes/editor-browser/runOutlinePrototypeChecks-results.json' $archive
$files=@(git ls-files --cached --others --exclude-standard -- src scripts src-tauri package.json package-lock.json vite.config.ts tsconfig.json index.html README.md AGENTS.md CONTRIBUTING.md 'docs/*.md' 'docs/**/*.md' | Sort-Object -Unique)
$manifest=foreach($file in $files){if(Test-Path -LiteralPath $file -PathType Leaf){'{0}  {1}' -f (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash,$file}}
$manifest | Set-Content -Encoding utf8 (Join-Path $archive 'source-sha256.txt')
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.IO.Compression
$zip=[IO.Compression.ZipFile]::Open((Join-Path $archive 'build-sources.zip'),[IO.Compression.ZipArchiveMode]::Create)
try{foreach($line in $manifest){$expected,$file=$line -split '  ',2;[IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip,(Join-Path $root $file),$file.Replace('\','/'),[IO.Compression.CompressionLevel]::Optimal)|Out-Null}}finally{$zip.Dispose()}
Copy-Item 'docs/handoff-islands-20261108.md' (Join-Path $archive 'START-HERE.md')
$todo=Join-Path $root '../../TODO.md'
if(Test-Path -LiteralPath $todo){Copy-Item -LiteralPath $todo -Destination (Join-Path $archive 'TODO-local.md')}
$started=Get-Date
Run-Check 'build' 'npm.cmd' @('run','tauri','build')
foreach($line in $manifest){$expected,$file=$line -split '  ',2;if((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -ne $expected){throw "Source changed during build: $file"}}
$exe=Get-Item 'src-tauri/target/release/kizamubeam.exe'
$installer=Get-ChildItem 'src-tauri/target/release/bundle/nsis' -Filter '*_x64-setup.exe' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if($exe.LastWriteTime -lt $started -or -not $installer -or $installer.LastWriteTime -lt $started){throw 'Fresh EXE/NSIS missing'}
Copy-Item $exe.FullName (Join-Path $archive 'KizamuBeam-island-topology.exe')
Copy-Item $installer.FullName $archive
Get-ChildItem $archive -Filter '*.exe' | ForEach-Object {'{0}  {1}' -f (Get-FileHash $_.FullName -Algorithm SHA256).Hash,$_.Name} | Set-Content -Encoding utf8 (Join-Path $archive 'binary-sha256.txt')
$zip=[IO.Compression.ZipFile]::OpenRead((Join-Path $archive 'build-sources.zip'))
try{foreach($line in $manifest){$expected,$file=$line -split '  ',2;$entry=$zip.GetEntry($file.Replace('\','/'));if(-not $entry){throw "Missing source entry $file"};$stream=$entry.Open();$sha=[Security.Cryptography.SHA256]::Create();try{$actual=[BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-','')}finally{$stream.Dispose();$sha.Dispose()};if($actual -ne $expected){throw "Archived source mismatch $file"}}}finally{$zip.Dispose()}
@"
PASS Windows EXE/NSIS packaging, source ZIP entries and post-build source hashes.
19 focused npm commands and60-case precision study passed; see actual logs.
Private resources skipped: $SkipPrivateResources
If not skipped: original inseln regression (50 exact islands +1 retained crossing),
photoframe reconstruction regression, separation/browser performance and15 browser checks passed.
Topology uses source Bezier convex hull subdivision, monotone spans and analytic area,
not0.001mm raster contacts. Numerical resolution1e-10mm; unresolved contacts fail closed.
Source nodes/handles/IDs/metadata and all51 original spans survive, with exact Undo.
Extraction validates reconstructed boundaries and final combinations before mutation.
Unsafe reconstruction is refused as exact; individually selected validated polygon
approximation remains labeled and never silently substituted or blanket-approved.
Performance: cached picking, bounded spatial distance rejection, per-operation topology cache.
No native application/installer launch, installation, machine connection or physical tests.
No PR publication/merge, release, tag or version bump; this is a mixed local test build.
Private project contents are not bundled. See START-HERE.md for handoff and limitations.
Substantial AI assistance: GPT6.1 Sol (OpenAI) via OpenCode.
"@ | Set-Content -Encoding utf8 (Join-Path $archive 'verification.txt')
Write-Output "BUILD PASSED: $archive"
Get-Content (Join-Path $archive 'binary-sha256.txt')
