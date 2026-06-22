<#
.SYNOPSIS
  Build the Blissful Android TV RELEASE APK (and optionally install + launch it on a TV/device).

.DESCRIPTION
  Reproduces the exact, working release build — robust to the current working directory
  (all paths are resolved relative to this script). Steps:

    1. tsc --noEmit            typecheck gate (skip with -SkipTypecheck)
    2. node scripts/link-core  junction node_modules/@blissful/core so RELEASE bundling
                               resolves the @blissful/core SOURCE workspace (Metro's
                               extraNodeModules alias is ignored when gradle bundles JS)
    3. android\gradlew.bat assembleRelease
                               bundles the JS (createBundleReleaseJsAndAssets) + builds the
                               universal, debug-keystore-signed, cleartext-patched APK

  Output: android\app\build\outputs\apk\release\app-release.apk

  WHY NOT `npm run build:release`? That script is `... && cd android && gradlew assembleRelease`.
  The bare `gradlew` (no `.\`, no `.bat`) only resolves when cmd's cwd is exactly the android dir,
  so it breaks when invoked from another cwd (e.g. `npm --prefix`). Here we always run the build
  as `.\gradlew.bat` from the android dir.

  TIMING (incremental — Gradle caches the native compile):
    ~20-30s  JS-only change       (only re-bundle + dex + package)
    ~3 min   native cache present (a few ABIs + dex + package)
    ~10 min  cold                 (NDK compile across arm64-v8a / armeabi-v7a / x86 / x86_64)
  Run it to COMPLETION — a process cut off mid-build leaves no `BUILD SUCCESSFUL` and an
  "AAPT2 ... daemon unexpectedly exit" line in ~/.gradle/daemon/*/daemon-*.out.log. It is NOT a
  memory problem on a normal dev box; just re-run (incremental resumes from where it stopped).

.PARAMETER Install
  After a successful build, `adb install -r` the APK on -Device and launch it.

.PARAMETER Device
  adb serial. Default = the living-room TV over adb-wifi (192.168.1.2:5555). For the emulator
  pass e.g. -Device emulator-5554 (connect is skipped for non ip:port serials).

.PARAMETER Clean
  `gradlew clean` first (from-scratch package) — use when icons / native resources changed and a
  fully fresh package is wanted. Much slower.

.PARAMETER SkipTypecheck
  Skip the tsc gate (faster, but you lose the early error catch before a multi-minute build).

.EXAMPLE
  ./scripts/build-apk.ps1                       # build only -> prints the APK path
.EXAMPLE
  ./scripts/build-apk.ps1 -Install              # build + install + launch on the TV
.EXAMPLE
  ./scripts/build-apk.ps1 -Install -Device emulator-5554
#>
[CmdletBinding()]
param(
  [switch]$Install,
  [string]$Device = '192.168.1.2:5555',
  [switch]$Clean,
  [switch]$SkipTypecheck
)

$ErrorActionPreference = 'Stop'

$AppDir     = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$AndroidDir = Join-Path $AppDir 'android'
$Pkg        = 'com.blissful.tv.rn'
$ApkPath    = Join-Path $AndroidDir 'app\build\outputs\apk\release\app-release.apk'

function Step([string]$msg) { Write-Host "`n=== $msg ===" -ForegroundColor Cyan }

# Resolve adb: PATH first, else the default SDK location.
$Adb = (Get-Command adb -ErrorAction SilentlyContinue).Source
if (-not $Adb) { $Adb = Join-Path $env:LOCALAPPDATA 'Android\Sdk\platform-tools\adb.exe' }

Set-Location $AppDir

try {
  # 1. Typecheck gate.
  if (-not $SkipTypecheck) {
    Step 'Typecheck (tsc --noEmit)'
    & npx tsc --noEmit -p tsconfig.json
    if ($LASTEXITCODE -ne 0) { throw "Typecheck failed - fix the errors (or pass -SkipTypecheck)." }
  }

  # 2. Link @blissful/core (idempotent; required for RELEASE bundling).
  Step 'Link @blissful/core'
  & node scripts/link-core.js
  if ($LASTEXITCODE -ne 0) { throw 'link-core.js failed.' }

  # 3. Gradle assembleRelease (from the android dir, as .\gradlew.bat).
  Set-Location $AndroidDir
  if ($Clean) {
    Step 'Gradle clean'
    & .\gradlew.bat clean --console=plain
    if ($LASTEXITCODE -ne 0) { throw 'gradlew clean failed.' }
  }
  Step 'Gradle assembleRelease'
  & .\gradlew.bat assembleRelease --console=plain
  if ($LASTEXITCODE -ne 0) { throw "gradlew assembleRelease FAILED (exit $LASTEXITCODE). See the log above + ~/.gradle/daemon/*/daemon-*.out.log." }

  if (-not (Test-Path $ApkPath)) { throw "Gradle reported success but no APK at $ApkPath" }
  $apk = Get-Item $ApkPath
  Write-Host ("`nAPK: {0}" -f $apk.FullName) -ForegroundColor Green
  Write-Host ("     {0:N1} MB, built {1}" -f ($apk.Length / 1MB), $apk.LastWriteTime) -ForegroundColor Green

  # 4. Optional install + launch.
  if ($Install) {
    if (-not (Test-Path $Adb)) { throw "adb not found (looked on PATH + $Adb)." }
    if ($Device -match ':') {
      Step "adb connect $Device"
      & $Adb connect $Device | Out-Null
    }
    Step "Install on $Device"
    & $Adb -s $Device install -r "$ApkPath"
    if ($LASTEXITCODE -ne 0) { throw "adb install failed (is the device on + reachable at $Device?)." }
    Step "Launch $Pkg"
    & $Adb -s $Device shell monkey -p $Pkg -c android.intent.category.LAUNCHER 1 | Out-Null
    Write-Host "Installed + launched on $Device" -ForegroundColor Green
  } else {
    Write-Host "`nInstall it with:  adb -s $Device install -r `"$ApkPath`"" -ForegroundColor DarkGray
  }
}
finally {
  Set-Location $AppDir
}
