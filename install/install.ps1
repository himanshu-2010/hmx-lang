# hmx — Windows installer (winget -> scoop -> verified direct zip)
#
#   powershell -ExecutionPolicy Bypass -f install.ps1
#   powershell -ExecutionPolicy Bypass -f install.ps1 -VERSION 0.10.0
#
# With no -VERSION it resolves the newest published release from the GitHub
# API. Whatever path is taken, a direct download is checked against the
# release's SHA256SUMS before it is put on disk; winget and scoop do their own
# verification.
[CmdletBinding()]
param(
    [string]$VERSION = ""
)

$ErrorActionPreference = "Stop"

# $ErrorActionPreference = "Stop" escalates *cmdlet* errors. It does nothing for
# a native command's non-zero exit code: winget and scoop report failure that
# way, and PowerShell only sets $? = $false. Without the check below, a failed
# `winget install` fell straight through to "installed via winget!" and `exit 0`
# — the installer reporting success with nothing installed.
#
# There is no preference variable that fixes this: $PSNativeCommandUseErrorActionPreference
# arrived in PowerShell 7.4 and is $false by default, and the invocation in this
# file's header is `powershell`, i.e. Windows PowerShell 5.1, which has no such
# variable at all. So test $LASTEXITCODE and `throw` — a throw IS catchable.
$Repo  = "himanshu-2010/hmx-lang"
$Api   = "https://api.github.com/repos/$Repo"

function Write-Hmx($msg, $color = "Magenta") { Write-Host "hmx: $msg" -ForegroundColor $color }

# ── 0) Resolve the release ───────────────────────────────────
if (-not $VERSION) {
    Write-Hmx "resolving the latest release..."
    try {
        $rel = Invoke-RestMethod -Uri "$Api/releases/latest" -Headers @{ "User-Agent" = "hmx-install" }
        $VERSION = ($rel.tag_name -replace '^v', '')
    } catch {
        throw "could not reach the GitHub API ($($_.Exception.Message)). Pass -VERSION <x.y.z> explicitly."
    }
}
$Base = "https://github.com/$Repo/releases/download/v$VERSION"

# ── 1) winget ────────────────────────────────────────────────
if (Get-Command winget -ErrorAction SilentlyContinue) {
    Write-Hmx "winget found — installing HMX.HMX"
    try {
        & winget install --id HMX.HMX --source winget --version "$VERSION" --accept-source-agreements --accept-package-agreements
        if ($LASTEXITCODE -ne 0) { throw "winget exited $LASTEXITCODE" }
        Write-Hmx "installed via winget!" "Green"
        exit 0
    } catch {
        Write-Hmx "winget install failed ($_) — falling back to scoop" "Yellow"
    }
} else {
    Write-Hmx "winget not found" "Yellow"
}

# ── 2) Scoop ─────────────────────────────────────────────────
# This repo is a real scoop bucket: the manifest lives at bucket/hmx.json, which
# is where scoop looks. `bucket add` is therefore expected to succeed, and a
# failure here means something else is wrong — so the fall-through to the
# verified zip is a real fallback, not the normal path.
if (Get-Command scoop -ErrorAction SilentlyContinue) {
    Write-Hmx "scoop found — trying the hmx bucket" "Yellow"
    try {
        scoop bucket add hmx "https://github.com/$Repo" 2>$null | Out-Null
        scoop install "hmx@$VERSION"
        if ($LASTEXITCODE -ne 0) { throw "scoop exited $LASTEXITCODE" }
        Write-Hmx "installed via scoop!" "Green"
        exit 0
    } catch {
        Write-Hmx "scoop could not install hmx ($_) — using the verified direct zip" "Yellow"
    }
} else {
    Write-Hmx "scoop not found — using the direct binary zip" "Yellow"
}

# ── 3) Prebuilt zip, checksum-verified ───────────────────────
$asset = "hmx-$VERSION-windows-x86_64.zip"
$url   = "$Base/$asset"
$tmp   = Join-Path $env:TEMP "hmx-$VERSION"
$zip   = Join-Path $tmp $asset
$dir   = Join-Path $env:LOCALAPPDATA "Programs\hmx"

Write-Hmx "downloading $url"
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
try {
    Invoke-WebRequest -Uri $url -OutFile $zip

    # Verify before extracting: an unverified compiler is worse than none.
    $sumsUrl = "$Base/SHA256SUMS"
    $want = $null
    $sumsError = $null
    try {
        $sums = (Invoke-WebRequest -Uri $sumsUrl).Content
        foreach ($line in ($sums -split "`n")) {
            $parts = ($line.Trim() -split '\s+')
            if ($parts.Count -ge 2 -and $parts[1] -eq $asset) { $want = $parts[0]; break }
        }
    } catch {
        $sumsError = $_.Exception.Message
    }
    if ($want) {
        $got = (Get-FileHash -Path $zip -Algorithm SHA256).Hash.ToLower()
        if ($got -ne $want.ToLower()) {
            Remove-Item $zip -Force
            throw "checksum mismatch for ${asset}: expected $want, got $got"
        }
        Write-Hmx "checksum verified" "Green"
    } else {
        # Refusing to install is only safe if we then actually fail. A missing
        # SHA256SUMS — or one with no entry for this asset — means we cannot tell
        # a good download from a tampered one, and a compiler is the last thing to
        # install blind. This path used to warn and install anyway.
        throw "cannot verify $asset against SHA256SUMS ($sumsError) — refusing to install unverified."
    }

    Write-Hmx "extracting to $dir"
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    Expand-Archive -Path $zip -DestinationPath $dir -Force
} finally {
    Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

$exe = Join-Path $dir "hmx.exe"
if (-not (Test-Path $exe)) { throw "archive did not contain hmx.exe" }

$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($userPath -notlike "*$dir*") {
    [Environment]::SetEnvironmentVariable("Path", "$userPath;$dir", "User")
    Write-Hmx "added $dir to your user PATH" "Green"
} else {
    Write-Hmx "$dir is already on your PATH" "Green"
}

Write-Hmx "installed hmx v$VERSION to $dir" "Green"
Write-Hmx "open a NEW terminal and run:  hmx --version" "Green"
Write-Hmx "hmx transpiles to C, so a C compiler (gcc/cc/clang) must be on PATH." "Yellow"
