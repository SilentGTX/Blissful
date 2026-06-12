# Authenticode signing wrapper. Used by build.ps1 to sign both the
# blissful-shell.exe and the resulting MSI.
#
# Examples:
#   ./sign.ps1 -Path .\blissful-shell.exe -CertPath C:\certs\blissful.pfx -CertPassword 'hunter2'
#   ./sign.ps1 -Path .\Blissful-Setup-0.4.0.msi -CertPath $env:BLISSFUL_CERT_PATH -CertPassword $env:BLISSFUL_CERT_PASSWORD
#
# The cert .pfx + password are not in the repo; they live in your password
# manager / CI secrets store.

param(
  [Parameter(Mandatory)][string]$Path,
  [Parameter(Mandatory)][string]$CertPath,
  [string]$CertPassword,
  [string]$TimestampUrl = 'http://timestamp.digicert.com',
  [string]$Description = 'Blissful'
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $Path)) {
  throw "Path to sign does not exist: $Path"
}
if (-not (Test-Path $CertPath)) {
  throw "Cert .pfx does not exist: $CertPath"
}

# Find signtool. The Windows SDK puts it under multiple version dirs;
# pick the highest x64 one.
$signtoolCandidates = @()
$signtoolCandidates += Get-ChildItem 'C:\Program Files (x86)\Windows Kits\10\bin' -Recurse -Filter signtool.exe -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -like '*\x64\*' }
$signtoolCandidates += Get-ChildItem 'C:\Program Files\Windows Kits\10\bin' -Recurse -Filter signtool.exe -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -like '*\x64\*' }
$signtool = $signtoolCandidates | Sort-Object FullName -Descending | Select-Object -First 1
if (-not $signtool) {
  # Fall back to PATH lookup.
  $signtool = Get-Command signtool.exe -ErrorAction SilentlyContinue
}
if (-not $signtool) {
  throw 'signtool.exe not found. Install the Windows 10/11 SDK and re-run.'
}
$signtoolPath = $signtool.FullName ?? $signtool.Source

$args = @('sign', '/fd', 'SHA256', '/td', 'SHA256', '/tr', $TimestampUrl,
          '/f', $CertPath, '/d', $Description)
if ($CertPassword) {
  $args += @('/p', $CertPassword)
}
$args += $Path

& $signtoolPath @args
if ($LASTEXITCODE -ne 0) {
  throw "signtool failed (exit $LASTEXITCODE) signing $Path"
}
Write-Host "Signed: $Path" -ForegroundColor Green
