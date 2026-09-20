<#
.SYNOPSIS
    Runs the system in the foreground (for testing). Press Ctrl+C to stop.

.EXAMPLE
    .\run-server.ps1
    .\run-server.ps1 -Port 8080 -BindAddress 0.0.0.0
#>
[CmdletBinding()]
param(
    [int]    $Port = 8000,
    [string] $BindAddress = "0.0.0.0"
)

$ErrorActionPreference = "Stop"
$Backend = Join-Path (Split-Path -Parent $PSScriptRoot) "backend"
$VenvPy  = Join-Path $Backend ".venv\Scripts\python.exe"
if (-not (Test-Path $VenvPy)) { throw "Virtual environment not found. Run install.ps1 first." }

$env:PYTHONUTF8 = "1"
Push-Location $Backend
try {
    Write-Host "Starting on http://${BindAddress}:$Port  (API docs: /api/docs)" -ForegroundColor Cyan
    & $VenvPy -m uvicorn app.main:app --host $BindAddress --port $Port
} finally {
    Pop-Location
}
