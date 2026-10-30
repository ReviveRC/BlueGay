param([Parameter(Mandatory=$true)][string]$Archive,[Parameter(Mandatory=$true)][string]$Destination)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$root = [IO.Path]::GetFullPath($Destination)
$prefix = $root.TrimEnd('\','/') + [IO.Path]::DirectorySeparatorChar
[IO.Directory]::CreateDirectory($root) | Out-Null
$zip = [IO.Compression.ZipFile]::OpenRead($Archive)
try {
  $expanded = 0L
  if ($zip.Entries.Count -gt 30000) { throw 'Too many archive entries.' }
  foreach ($entry in $zip.Entries) {
    $expanded += $entry.Length
    if ($expanded -gt 1GB) { throw 'Expanded archive is too large.' }
    if ((($entry.ExternalAttributes -shr 16) -band 0xF000) -eq 0xA000) { throw 'Archive links are not supported.' }
    $target = [IO.Path]::GetFullPath([IO.Path]::Combine($root,$entry.FullName))
    if (-not $target.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase)) { throw 'Archive path escapes its target directory.' }
  }
  foreach ($entry in $zip.Entries) {
    $target = [IO.Path]::GetFullPath([IO.Path]::Combine($root,$entry.FullName))
    if ($entry.FullName.EndsWith('/')) { [IO.Directory]::CreateDirectory($target) | Out-Null }
    else {
      [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target)) | Out-Null
      [IO.Compression.ZipFileExtensions]::ExtractToFile($entry,$target,$true)
    }
  }
} finally { $zip.Dispose() }
