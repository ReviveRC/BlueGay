param([Parameter(Mandatory=$true)][string]$JobPath, [switch]$VerifyOnly)
$ErrorActionPreference = 'Stop'
$stageRoot = [IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($JobPath))
$logPath = Join-Path $stageRoot 'update.log'
function Get-UpdateHash([string]$FilePath) {
  $stream = [IO.File]::OpenRead($FilePath)
  $hasher = [Security.Cryptography.SHA256]::Create()
  try { [BitConverter]::ToString($hasher.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() }
  finally { $hasher.Dispose(); $stream.Dispose() }
}
$moved = $false
$installed = $false
$oldPath = Join-Path $stageRoot 'previous.exe'
try {
  $job = Get-Content -LiteralPath $JobPath -Raw | ConvertFrom-Json
  $target = [IO.Path]::GetFullPath($job.target)
  $staged = [IO.Path]::GetFullPath($job.staged)
  $targetRoot = [IO.Path]::GetDirectoryName($target)
  # All filesystem mutations stay in the explicitly identified EXE directory.
  if ([IO.Path]::GetDirectoryName($stageRoot) -ne $targetRoot -or
      -not ([IO.Path]::GetFileName($stageRoot).StartsWith('.bluegay-update-')) -or
      [IO.Path]::GetDirectoryName($staged) -ne $stageRoot -or
      [IO.Path]::GetExtension($target) -ne '.exe' -or $staged -eq $target) { throw 'Invalid update paths.' }
  if ((Get-UpdateHash $staged) -ne $job.sha256 -or
      (Get-UpdateHash $target) -ne $job.old_sha256) { throw 'Update checksum mismatch. Original executable kept.' }
  if ($VerifyOnly) { 'Update paths and checksums verified.'; exit 0 }
  $parentApp = Get-Process -Id $job.pid -ErrorAction SilentlyContinue
  if ($parentApp -and -not $parentApp.WaitForExit(60000)) { throw 'BlueGay did not close. Original executable kept.' }
  # Another BlueGay window or antivirus scan can hold the executable briefly.
  $deadline = [DateTime]::UtcNow.AddSeconds(60)
  do {
    try {
      if ((Get-UpdateHash $target) -ne $job.old_sha256) { throw 'The installed executable changed during the update.' }
      Move-Item -LiteralPath $target -Destination $oldPath -ErrorAction Stop
      $moved = $true
    } catch {
      if ([DateTime]::UtcNow -ge $deadline) { throw }
      Start-Sleep -Milliseconds 500
    }
  } until ($moved)
  # Recheck staged bytes immediately before replacement.
  if ((Get-UpdateHash $staged) -ne $job.sha256) { throw 'Staged executable changed.' }
  Move-Item -LiteralPath $staged -Destination $target
  $installed = $true
  # This launches the interactive app the user chose to restart.
  $newApp = Start-Process -FilePath $target -WorkingDirectory $targetRoot -PassThru
  if ($newApp.WaitForExit(5000) -and $newApp.ExitCode -ne 0) { throw 'The updated app failed to start.' }
  'Update installed. Previous executable retained as previous.exe.' | Set-Content -LiteralPath $logPath
} catch {
  $failure = $_.Exception.Message
  if ($moved) {
    try {
      if ($installed -and (Test-Path -LiteralPath $target)) { Move-Item -LiteralPath $target -Destination (Join-Path $stageRoot 'failed.exe') }
      Move-Item -LiteralPath $oldPath -Destination $target
      Start-Process -FilePath $target -WorkingDirectory $targetRoot
      $failure += ' Previous version restored.'
    } catch { $failure += ' Recovery copy: ' + $oldPath }
  }
  $failure | Set-Content -LiteralPath $logPath
  exit 1
}
