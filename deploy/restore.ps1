<#
.SYNOPSIS
    Restores the database from a backup made by backup.ps1.
    WARNING: current data is replaced by the backup contents.

.EXAMPLE
    .\restore.ps1 -BackupFile C:\Backups\PoldokhtarGIS\poldokhtar_gis_20250920_020000.dump
#>
[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = "High")]
param(
    [Parameter(Mandatory = $true)] [string] $BackupFile,
    [string] $ServiceName = "PoldokhtarGIS",
    [string] $PgBin = ""
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot "_common.ps1")

if (-not (Test-Path $BackupFile)) { throw "Backup file not found: $BackupFile" }
$db = Get-DbSettings (Join-Path $Root "backend\.env")
$PgRestore = Join-Path (Resolve-PgBin $PgBin) "pg_restore.exe"

if (-not $PSCmdlet.ShouldProcess($db.Name, "Replace database contents with $BackupFile")) { return }

$svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($svc -and $svc.Status -eq "Running") {
    Write-Host "Stopping service $ServiceName..."
    Stop-Service $ServiceName
}

$env:PGPASSWORD = $db.Password
try {
    & $PgRestore -h $db.Host -p $db.Port -U $db.User -d $db.Name --clean --if-exists --no-owner $BackupFile
    if ($LASTEXITCODE -ne 0) { Write-Host "pg_restore reported warnings (exit code $LASTEXITCODE). Review the output above." -ForegroundColor Yellow }
} finally {
    Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
}

if ($svc) {
    Start-Service $ServiceName
    Write-Host "Service $ServiceName started."
}
Write-Host "Restore finished." -ForegroundColor Green
