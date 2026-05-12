# Phase 7 — Blissful native shell installer build pipeline.
#
# What this does:
#   1. Builds the React app (apps/blissful-mvs).
#   2. Builds the Rust shell in release mode.
#   3. Stages every file the installer needs under installer/staging/.
#   4. Runs WiX (heat → candle → light) to produce an MSI.
#   5. Optionally signs the MSI (call installer/sign.ps1 -Path ...).
#
# Prerequisites (one-time, on the machine running this script):
#   - Rust toolchain (rustup + MSVC build tools)
#   - Node + npm
#   - WiX Toolset 3.x installed and on PATH (heat.exe, candle.exe, light.exe)
#     https://github.com/wixtoolset/wix3/releases
#   - signtool.exe on PATH if you intend to sign — comes with the Windows SDK
#   - resources/mpv-x64/libmpv-2.dll present per PREREQUISITES.md §2
#   - resources/stremio-service.zip present per PREREQUISITES.md §3
#
# Run from anywhere; paths are computed relative to this script.

param(
  [switch]$SkipSign,
  [string]$CertPath = $env:BLISSFUL_CERT_PATH,
  [string]$CertPassword = $env:BLISSFUL_CERT_PASSWORD,
  [string]$TimestampUrl = 'http://timestamp.digicert.com'
)

$ErrorActionPreference = 'Stop'

$installerDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$shellDir = Split-Path -Parent $installerDir
$repoRoot = Split-Path -Parent (Split-Path -Parent $shellDir)
$mvsDir = Join-Path $repoRoot 'apps\blissful-mvs'
$stagingDir = Join-Path $installerDir 'staging'
$distDir = Join-Path $installerDir 'dist'

# Read version from Cargo.toml so the MSI version matches the binary.
$cargoToml = Get-Content (Join-Path $shellDir 'Cargo.toml') -Raw
if ($cargoToml -notmatch '(?m)^version\s*=\s*"([^"]+)"') {
  throw 'could not parse version from Cargo.toml'
}
$rawVersion = $matches[1]
# WiX wants 4-part numeric; strip pre-release suffix.
$msiVersion = $rawVersion -replace '-.*$', ''
if ($msiVersion -notmatch '^\d+\.\d+\.\d+$') {
  throw "version '$rawVersion' -> '$msiVersion' isn't a 3-part numeric version"
}
$msiVersion = "$msiVersion.0"
Write-Host "Building Blissful $rawVersion (MSI version $msiVersion)" -ForegroundColor Cyan

# --- 1. Build the React app ---
Write-Host '== building React app (Vite) ==' -ForegroundColor Yellow
& npm.cmd --prefix $mvsDir ci
if ($LASTEXITCODE -ne 0) { throw 'npm ci failed' }
& npm.cmd --prefix $mvsDir run build
if ($LASTEXITCODE -ne 0) { throw 'npm run build failed' }

# --- 2. Build the Rust shell (release) ---
Write-Host '== building Rust shell (release) ==' -ForegroundColor Yellow
& cargo build --manifest-path (Join-Path $shellDir 'Cargo.toml') --release
if ($LASTEXITCODE -ne 0) { throw 'cargo build --release failed' }
$shellExe = Join-Path $shellDir 'target\release\blissful-shell.exe'
if (-not (Test-Path $shellExe)) { throw "shell exe not found at $shellExe" }

# Optional EXE signing — separately useful so we can validate the binary
# before bundling it.
if (-not $SkipSign -and $CertPath -and (Test-Path $CertPath)) {
  Write-Host '== signing blissful-shell.exe ==' -ForegroundColor Yellow
  & (Join-Path $installerDir 'sign.ps1') `
    -Path $shellExe `
    -CertPath $CertPath `
    -CertPassword $CertPassword `
    -TimestampUrl $TimestampUrl
}

# --- 3. Stage installer payload ---
Write-Host '== staging installer payload ==' -ForegroundColor Yellow
if (Test-Path $stagingDir) { Remove-Item $stagingDir -Recurse -Force }
New-Item -ItemType Directory -Path $stagingDir | Out-Null

# Required payload:
Copy-Item $shellExe (Join-Path $stagingDir 'blissful-shell.exe')
Copy-Item (Join-Path $shellDir 'resources\mpv-x64\libmpv-2.dll') $stagingDir
$ffmpegDir = Join-Path $shellDir 'resources\ffmpeg-dlls'
if (Test-Path $ffmpegDir) {
  Get-ChildItem $ffmpegDir -Filter '*.dll' | ForEach-Object {
    Copy-Item $_.FullName $stagingDir
  }
}
Copy-Item (Join-Path $shellDir 'resources\stremio-service.zip') $stagingDir
Copy-Item (Join-Path $shellDir 'resources\icon.ico') $stagingDir

# React build:
$uiSrc = Join-Path $mvsDir 'dist'
$uiDst = Join-Path $stagingDir 'blissful-ui'
New-Item -ItemType Directory -Path $uiDst | Out-Null
Copy-Item "$uiSrc\*" $uiDst -Recurse

# WebView2 bootstrapper. Download once + cache locally; the bootstrapper
# is a tiny .exe (~150KB) that no-op's if WebView2 is already installed.
$wv2Boot = Join-Path $installerDir 'MicrosoftEdgeWebview2Setup.exe'
if (-not (Test-Path $wv2Boot)) {
  Write-Host '== downloading WebView2 evergreen bootstrapper ==' -ForegroundColor Yellow
  Invoke-WebRequest `
    -Uri 'https://go.microsoft.com/fwlink/p/?LinkId=2124703' `
    -OutFile $wv2Boot
}
Copy-Item $wv2Boot (Join-Path $stagingDir 'MicrosoftEdgeWebview2Setup.exe')

# --- 4. WiX: heat -> candle -> light ---
$generatedWxs = Join-Path $installerDir 'staging-files.wxs'
Write-Host '== WiX heat: harvesting staging payload ==' -ForegroundColor Yellow
& heat.exe dir $stagingDir `
  -cg MainFiles `
  -gg `
  -srd `
  -sreg `
  -dr INSTALLDIR `
  -var var.StagingDir `
  -out $generatedWxs
if ($LASTEXITCODE -ne 0) { throw 'heat.exe failed' }

# Also surface the WebView2 bootstrapper under a stable FileKey so the
# WiX <CustomAction FileKey="WebView2BootstrapperFile"> resolves. The
# auto-generated component IDs aren't stable, so we patch via a sed-
# style replace.
$wxsText = Get-Content $generatedWxs -Raw
$wxsText = $wxsText -replace 'Source="\$\(var.StagingDir\)\\MicrosoftEdgeWebview2Setup\.exe"', `
  'Source="$(var.StagingDir)\MicrosoftEdgeWebview2Setup.exe" Id="WebView2BootstrapperFile"'
Set-Content $generatedWxs $wxsText -Encoding UTF8

Write-Host '== WiX candle: compiling ==' -ForegroundColor Yellow
$resourcesDir = Join-Path $shellDir 'installer'
$wxsMain = Join-Path $installerDir 'blissful.wxs'
& candle.exe -nologo `
  "-dProductVersion=$msiVersion" `
  "-dResourcesDir=$resourcesDir" `
  "-dStagingDir=$stagingDir" `
  -ext WixUIExtension `
  -ext WixUtilExtension `
  -out (Join-Path $installerDir 'obj\') `
  $wxsMain $generatedWxs
if ($LASTEXITCODE -ne 0) { throw 'candle.exe failed' }

Write-Host '== WiX light: linking MSI ==' -ForegroundColor Yellow
if (-not (Test-Path $distDir)) { New-Item -ItemType Directory -Path $distDir | Out-Null }
$msiPath = Join-Path $distDir "Blissful-Setup-$rawVersion.msi"
& light.exe -nologo `
  -ext WixUIExtension `
  -ext WixUtilExtension `
  -out $msiPath `
  (Join-Path $installerDir 'obj\blissful.wixobj') `
  (Join-Path $installerDir 'obj\staging-files.wixobj')
if ($LASTEXITCODE -ne 0) { throw 'light.exe failed' }
Write-Host "MSI produced: $msiPath" -ForegroundColor Green

# --- 5. Sign the MSI ---
if (-not $SkipSign -and $CertPath -and (Test-Path $CertPath)) {
  Write-Host '== signing MSI ==' -ForegroundColor Yellow
  & (Join-Path $installerDir 'sign.ps1') `
    -Path $msiPath `
    -CertPath $CertPath `
    -CertPassword $CertPassword `
    -TimestampUrl $TimestampUrl
} else {
  Write-Host 'NOTE: MSI not signed. Pass -CertPath or set BLISSFUL_CERT_PATH to sign.' -ForegroundColor DarkYellow
}

Write-Host "Done. Output: $msiPath" -ForegroundColor Green
