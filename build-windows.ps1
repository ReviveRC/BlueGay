param([switch]$Test)
$ErrorActionPreference = 'Stop'
Push-Location $PSScriptRoot
$oldPath = $env:PATH
$oldCargo = $env:CARGO_HOME
$oldRustup = $env:RUSTUP_HOME
try {
  $localCargo = Join-Path $PSScriptRoot '.build-tools\cargo'
  $localRustup = Join-Path $PSScriptRoot '.build-tools\rustup'
  if (Test-Path -LiteralPath (Join-Path $localCargo 'bin\cargo.exe')) {
    $env:CARGO_HOME = $localCargo
    $env:RUSTUP_HOME = $localRustup
    $env:PATH = "$localCargo\bin;$env:PATH"
  }
  if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) { throw 'Install the Rust MSVC toolchain before building.' }
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Install Node.js or run this script from a terminal with Node.js on PATH.' }
  if (-not (Test-Path -LiteralPath 'node_modules\@tauri-apps\cli\tauri.js')) { throw 'Install project dependencies with npm ci before building.' }
  node scripts/check.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Source checks failed.' }
  node node_modules/@tauri-apps/cli/tauri.js build --no-bundle --ci
  if ($LASTEXITCODE -ne 0) { throw 'Windows executable build failed.' }
  if ($Test) {
    cargo test --release --locked --manifest-path src-tauri/Cargo.toml
    if ($LASTEXITCODE -ne 0) { throw 'Native tests failed.' }
  }
  New-Item -ItemType Directory -Path 'release' -Force | Out-Null
  Copy-Item -LiteralPath 'src-tauri\target\release\bluegay.exe' -Destination 'release\BlueGay.exe' -Force
  $artifact = Get-Item -LiteralPath 'release\BlueGay.exe'
  $hash = Get-FileHash -LiteralPath $artifact.FullName -Algorithm SHA256
  "$($hash.Hash)  BlueGay.exe" | Set-Content -LiteralPath 'release\SHA256SUMS.txt'
  Write-Output "Built $($artifact.FullName) ($($artifact.Length) bytes)"
} finally {
  $env:PATH = $oldPath
  $env:CARGO_HOME = $oldCargo
  $env:RUSTUP_HOME = $oldRustup
  Pop-Location
}
