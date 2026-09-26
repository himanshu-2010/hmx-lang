# hmx — Windows installer (winget -> scoop -> direct zip)
#
#   powershell -ExecutionPolicy Bypass -f install.ps1
#
# Tries winget first, then Scoop, then falls back to downloading the
# prebuilt x86_64 zip from the GitHub Release and adding it to the
# user PATH under %LOCALAPPDATA%\Programs\hmx.
[CmdletBinding()]
param(
    [string]$VERSION = "0.9.0"
)

$ErrorActionPreference = "Stop"
$BASE = "https://github.com/himanshu-2010/hmx-lang/releases/download/v$VERSION"

Write-Host "hmx: installing v$VERSION on Windows..." -ForegroundColor Magenta

# ── 1) winget ────────────────────────────────────────────────
if (Get-Command winget -ErrorAction SilentlyContinue) {
    Write-Host "hmx: winget found — installing HMX.HMX"
    try {
        & winget install --id HMX.HMX --source winget --accept-source-agreements --accept-package-agreements
        Write-Host "hmx: installed via winget!" -ForegroundColor Green
        exit 0
    } catch {
        Write-Host "hmx: winget install failed ($_) — falling back to scoop" -ForegroundColor Yellow
    }
} else {
    Write-Host "hmx: winget not found" -ForegroundColor Yellow
}

# ── 2) Scoop ─────────────────────────────────────────────────
if (Get-Command scoop -ErrorAction SilentlyContinue) {
    Write-Host "hmx: scoop found — installing via the hmx bucket"
    scoop bucket add hmx https://github.com/himanshu-2010/scoop-hmx | Out-Null
    scoop install hmx
    Write-Host "hmx: installed via scoop!" -ForegroundColor Green
    exit 0
} else {
    Write-Host "hmx: scoop not found — using the direct binary zip" -ForegroundColor Yellow
}

# ── 3) Prebuilt zip ──────────────────────────────────────────
$zip = Join-Path $env:TEMP "hmx-$VERSION.zip"
$dir = Join-Path $env:LOCALAPPDATA "Programs\hmx"
$url = "$BASE/hmx-${VERSION}-windows-x86_64.zip"

Write-Host "hmx: downloading $url"
Invoke-WebRequest -Uri $url -OutFile $zip
Write-Host "hmx: extracting to $dir"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
Expand-Archive -Path $zip -DestinationPath $dir -Force
Remove-Item $zip -Force

$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($userPath -notlike "*$dir*") {
    [Environment]::SetEnvironmentVariable("Path", "$userPath;$dir", "User")
    Write-Host "hmx: added $dir to your user PATH" -ForegroundColor Green
} else {
    Write-Host "hmx: $dir is already on your PATH" -ForegroundColor Green
}

Write-Host "hmx: installed to $dir ($env:ComSpec)" -ForegroundColor Green
Write-Host "hmx: open a NEW terminal and run:  hmx --version" -ForegroundColor Green