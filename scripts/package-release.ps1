param([string]$KeyPath = '.release-keys\updater-private.pem', [string]$NotesPath = 'RELEASE-NOTES.md')
$ErrorActionPreference = 'Stop'
Push-Location (Split-Path $PSScriptRoot -Parent)
try {
  $version = (Get-Content -LiteralPath 'package.json' -Raw | ConvertFrom-Json).version
  $folder = Join-Path 'release' $version
  New-Item -ItemType Directory -Path $folder -Force | Out-Null
  $name = "BlueGay-$version.exe"
  $exe = Join-Path $folder $name
  Copy-Item -LiteralPath 'src-tauri\target\release\bluegay.exe' -Destination $exe -Force
  $actualVersion = [Diagnostics.FileVersionInfo]::GetVersionInfo((Resolve-Path -LiteralPath $exe).Path).ProductVersion
  if ($actualVersion -ne $version) { throw "Build version $actualVersion differs from package version $version. Build the app first." }
  node scripts/create-release.mjs --exe $exe --version $version --url "https://github.com/ReviveRC/BlueGay/releases/download/v$version/$name" --key $KeyPath --notes $NotesPath --output (Join-Path $folder 'latest.jwt')
  if ($LASTEXITCODE -ne 0) { throw 'Release signing failed.' }
  Copy-Item -LiteralPath $NotesPath -Destination (Join-Path $folder 'RELEASE-NOTES.md') -Force
  @($exe,(Join-Path $folder 'latest.jwt')) | ForEach-Object { $hash = Get-FileHash -LiteralPath $_ -Algorithm SHA256; "$($hash.Hash)  $([IO.Path]::GetFileName($_))" } | Set-Content -LiteralPath (Join-Path $folder 'SHA256SUMS.txt')
  $instructions = @"
Publish a new release at https://github.com/ReviveRC/BlueGay/releases/new
Tag: v$version
Title: BlueGay $version
Attach exactly $name and latest.jwt (SHA256SUMS.txt is optional).
Paste RELEASE-NOTES.md into the description, select latest release, and publish.
Keep the asset filenames unchanged. Do not upload .release-keys or private PEM files.

The updater checks https://github.com/ReviveRC/BlueGay/releases/latest/download/latest.jwt
The first updater-enabled version must be installed manually. Later newer releases update through the app.
"@
  $instructions | Set-Content -LiteralPath (Join-Path $folder 'UPLOAD.txt')
  $files = @($exe,(Join-Path $folder 'latest.jwt'),(Join-Path $folder 'SHA256SUMS.txt'),(Join-Path $folder 'RELEASE-NOTES.md'),(Join-Path $folder 'UPLOAD.txt'))
  Compress-Archive -LiteralPath $files -DestinationPath (Join-Path 'release' "BlueGay-$version-release.zip") -Force
  Write-Output "Release ready: $folder"
} finally { Pop-Location }
