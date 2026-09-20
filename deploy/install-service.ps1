<#
.SYNOPSIS
    Registers the system as a Windows service (auto start, auto restart) using NSSM.

.DESCRIPTION
    NSSM (https://nssm.cc) must be available: put nssm.exe in deploy\tools\ or in PATH,
    or pass -NssmPath.

.EXAMPLE
    .\install-service.ps1
    .\install-service.ps1 -Port 8000 -BindAddress 127.0.0.1 -Workers 2     # behind IIS
#>
[CmdletBinding()]
param(
    [string] $ServiceName = "PoldokhtarGIS",
    [int]    $Port = 8000,
    [string] $BindAddress = "0.0.0.0",
    [int]    $Workers = 2,
    [string] $NssmPath = ""
)

$ErrorActionPreference = "Stop"
$Root    = Split-Path -Parent $PSScriptRoot
$Backend = Join-Path $Root "backend"
$VenvPy  = Join-Path $Backend ".venv\Scripts\python.exe"
$LogDir  = Join-Path $Backend "logs"

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Run this script in an elevated (Administrator) PowerShell."
}
if (-not (Test-Path $VenvPy)) { throw "Virtual environment not found. Run install.ps1 first." }

if (-not $NssmPath) {
    $local = Join-Path $PSScriptRoot "tools\nssm.exe"
    if (Test-Path $local) { $NssmPath = $local }
    elseif (Get-Command nssm.exe -ErrorAction SilentlyContinue) { $NssmPath = (Get-Command nssm.exe).Source }
}
if (-not $NssmPath -or -not (Test-Path $NssmPath)) {
    throw "nssm.exe not found. Download NSSM 2.24 from https://nssm.cc/download and copy win64\nssm.exe to $PSScriptRoot\tools\"
}

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

function Nssm { & $NssmPath @args; if ($LASTEXITCODE -ne 0) { throw "nssm $($args -join ' ') failed" } }

if (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue) {
    Write-Host "Service $ServiceName exists; reconfiguring..." -ForegroundColor Yellow
    & $NssmPath stop $ServiceName | Out-Null
} else {
    Nssm install $ServiceName $VenvPy
}

Nssm set $ServiceName Application $VenvPy
Nssm set $ServiceName AppParameters "-m uvicorn app.main:app --host $BindAddress --port $Port --workers $Workers"
Nssm set $ServiceName AppDirectory $Backend
Nssm set $ServiceName DisplayName "Poldokhtar Street Management System"
Nssm set $ServiceName Description "Poldokhtar municipality streets GIS (FastAPI + PostGIS)"
Nssm set $ServiceName Start SERVICE_AUTO_START
Nssm set $ServiceName AppEnvironmentExtra "PYTHONUTF8=1" "PYTHONIOENCODING=utf-8"
Nssm set $ServiceName AppStdout (Join-Path $LogDir "service.log")
Nssm set $ServiceName AppStderr (Join-Path $LogDir "service.log")
Nssm set $ServiceName AppRotateFiles 1
Nssm set $ServiceName AppRotateOnline 1
Nssm set $ServiceName AppRotateBytes 10485760
Nssm set $ServiceName AppExit Default Restart
Nssm set $ServiceName AppRestartDelay 5000

# Start only after PostgreSQL
$pg = Get-Service -Name "postgresql*" -ErrorAction SilentlyContinue | Select-Object -First 1
if ($pg) {
    Nssm set $ServiceName DependOnService $pg.Name
    Write-Host "Depends on service $($pg.Name)"
}

Nssm start $ServiceName
Start-Sleep -Seconds 8

$url = "http://127.0.0.1:$Port/api/health"
try {
    $health = Invoke-RestMethod -Uri $url -TimeoutSec 15
    Write-Host "Service is running. Health: $($health.status), PostGIS $($health.postgis)" -ForegroundColor Green
} catch {
    Write-Host "Service started but $url did not answer yet. Check $LogDir\service.log" -ForegroundColor Yellow
}
