<#
.SYNOPSIS
    Applies a new version: backup, stop service, install packages, build frontend, start service.

.DESCRIPTION
    Copy the new source files over the install folder first (keep backend\.env),
    or run "git pull" if the folder is a git clone. Then run this script.

.EXAMPLE
    .\update.ps1
    .\update.ps1 -WheelsDir C:\PoldokhtarGIS\wheels -SkipFrontendBuild
#>
[CmdletBinding()]
param(
    [string] $ServiceName = "PoldokhtarGIS",
    [string] $WheelsDir = "",
    [switch] $SkipBackup,
    [switch] $SkipFrontendBuild
)

$ErrorActionPreference = "Stop"
$Root     = Split-Path -Parent $PSScriptRoot
$Backend  = Join-Path $Root "backend"
$Frontend = Join-Path $Root "frontend"
$VenvPy   = Join-Path $Backend ".venv\Scripts\python.exe"

if (-not $SkipBackup) {
    Write-Host "==> Backup" -ForegroundColor Cyan
    & (Join-Path $PSScriptRoot "backup.ps1")
}

$svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($svc -and $svc.Status -eq "Running") {
    Write-Host "==> Stopping service" -ForegroundColor Cyan
    Stop-Service $ServiceName
}

Write-Host "==> Python packages" -ForegroundColor Cyan
$req = Join-Path $Backend "requirements.txt"
if ($WheelsDir) { & $VenvPy -m pip install --no-index --find-links $WheelsDir -r $req }
else { & $VenvPy -m pip install -r $req --disable-pip-version-check }
if ($LASTEXITCODE -ne 0) { throw "pip install failed" }

if (-not $SkipFrontendBuild -and (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
    Write-Host "==> Frontend build" -ForegroundColor Cyan
    Push-Location $Frontend
    try {
        & npm.cmd ci --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { throw "npm ci failed" }
        & npm.cmd run build
        if ($LASTEXITCODE -ne 0) { throw "npm run build failed" }
    } finally { Pop-Location }
}

Write-Host "==> Database schema" -ForegroundColor Cyan
$env:PYTHONUTF8 = "1"
Push-Location $Backend
try {
    & $VenvPy -m app.seed
    if ($LASTEXITCODE -ne 0) { throw "Database initialisation failed" }
} finally { Pop-Location }

if ($svc) {
    Write-Host "==> Starting service" -ForegroundColor Cyan
    Start-Service $ServiceName
}
Write-Host "Update finished." -ForegroundColor Green
