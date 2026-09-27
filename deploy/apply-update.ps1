<#
.SYNOPSIS
    Copies a new version (an extracted update package) over the installed system and restarts it.

.DESCRIPTION
    Run this script FROM THE EXTRACTED PACKAGE, not from the install folder:

        Expand-Archive C:\Temp\PoldokhtarGIS-update.zip C:\Temp\pol-update -Force
        C:\Temp\pol-update\deploy\apply-update.ps1

    What it does:
      1. Copies the new files into -InstallDir. These are never touched:
         backend\.env, backend\.venv, backend\logs, backend\uploads, deploy\tools, frontend\node_modules
      2. Replaces frontend\dist completely (the package contains a pre-built frontend).
      3. Runs deploy\update.ps1: database backup, stop service, pip install,
         create new tables, start service.

.EXAMPLE
    C:\Temp\pol-update\deploy\apply-update.ps1
    C:\Temp\pol-update\deploy\apply-update.ps1 -InstallDir D:\PoldokhtarGIS -SkipBackup
#>
[CmdletBinding()]
param(
    [string] $InstallDir = "C:\PoldokhtarGIS",
    [string] $ServiceName = "PoldokhtarGIS",
    [string] $WheelsDir = "",
    [switch] $SkipBackup
)

$ErrorActionPreference = "Stop"
$Source = Split-Path -Parent $PSScriptRoot

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Run this script in an elevated (Administrator) PowerShell."
}
$InstallDir = (Resolve-Path $InstallDir).Path
if ((Resolve-Path $Source).Path -eq $InstallDir) {
    throw "Run apply-update.ps1 from the extracted package folder, not from $InstallDir. To only restart/refresh, run $InstallDir\deploy\update.ps1."
}
if (-not (Test-Path (Join-Path $InstallDir "backend\.env"))) {
    throw "$InstallDir\backend\.env not found. Is -InstallDir the folder where the system is installed?"
}
if (-not (Test-Path (Join-Path $Source "frontend\dist\index.html"))) {
    throw "The package has no frontend\dist. Build it with deploy/make-package.sh (or npm run build) before packaging."
}

Write-Host "==> Copying files  $Source  ->  $InstallDir" -ForegroundColor Cyan
Get-ChildItem $Source -Recurse -File | Unblock-File

$excludeDirs  = @(".venv", "logs", "uploads", "node_modules", "tools", "__pycache__", ".git",
                  (Join-Path $Source "frontend\dist"))
$excludeFiles = @(".env", "*.pyc", ".DS_Store")
& robocopy $Source $InstallDir /E /NFL /NDL /NJH /NP /R:2 /W:2 /XD @excludeDirs /XF @excludeFiles
if ($LASTEXITCODE -ge 8) { throw "robocopy failed (exit code $LASTEXITCODE)" }

# The frontend is mirrored so old bundles are removed
& robocopy (Join-Path $Source "frontend\dist") (Join-Path $InstallDir "frontend\dist") /MIR /NFL /NDL /NJH /NP /R:2 /W:2
if ($LASTEXITCODE -ge 8) { throw "robocopy of frontend\dist failed (exit code $LASTEXITCODE)" }
$global:LASTEXITCODE = 0

$svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if (-not $svc) {
    Write-Host "[!] Windows service '$ServiceName' is not installed. After this step, stop the running server window (Ctrl+C) and start it again with .\run-server.ps1, or install the service with .\install-service.ps1" -ForegroundColor Yellow
}

$update = @{ ServiceName = $ServiceName; SkipFrontendBuild = $true }
if ($WheelsDir)  { $update.WheelsDir = $WheelsDir }
if ($SkipBackup) { $update.SkipBackup = $true }
& (Join-Path $InstallDir "deploy\update.ps1") @update

if ($svc) {
    Start-Sleep -Seconds 6
    $svc.Refresh()
    Write-Host "Service status: $($svc.Status)"
    $port = 8000
    try {
        $nssm = Join-Path $InstallDir "deploy\tools\nssm.exe"
        if (-not (Test-Path $nssm)) { $nssm = "nssm.exe" }
        $params = (& $nssm get $ServiceName AppParameters | Out-String) -replace "`0", ""
        if ($params -match '--port\s+(\d+)') { $port = [int]$Matches[1] }
    } catch { }
    try {
        $health = Invoke-RestMethod -Uri "http://127.0.0.1:$port/api/health" -TimeoutSec 15
        Write-Host "Health: $($health.status), PostGIS $($health.postgis)" -ForegroundColor Green
    } catch {
        Write-Host "[!] Health check did not answer yet. See $InstallDir\backend\logs\service.log" -ForegroundColor Yellow
    }
}
Write-Host "Update applied. Refresh the browser with Ctrl+F5." -ForegroundColor Green
