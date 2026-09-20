<#
.SYNOPSIS
    Stops and removes the Windows service (data and files are kept).
#>
[CmdletBinding()]
param(
    [string] $ServiceName = "PoldokhtarGIS",
    [string] $NssmPath = ""
)

$ErrorActionPreference = "Stop"
if (-not $NssmPath) {
    $local = Join-Path $PSScriptRoot "tools\nssm.exe"
    $NssmPath = if (Test-Path $local) { $local } else { "nssm.exe" }
}
if (-not (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue)) {
    Write-Host "Service $ServiceName is not installed."
    return
}
& $NssmPath stop $ServiceName | Out-Null
& $NssmPath remove $ServiceName confirm
Write-Host "Service $ServiceName removed." -ForegroundColor Green
