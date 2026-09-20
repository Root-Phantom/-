<#
.SYNOPSIS
    Backs up the database (pg_dump, custom format) and deletes old backups.

.DESCRIPTION
    Connection settings are read from backend\.env (DATABASE_URL).

.EXAMPLE
    .\backup.ps1
    .\backup.ps1 -BackupDir D:\Backups\PoldokhtarGIS -RetentionDays 60
#>
[CmdletBinding()]
param(
    [string] $BackupDir = "C:\Backups\PoldokhtarGIS",
    [int]    $RetentionDays = 30,
    [string] $PgBin = ""
)

$ErrorActionPreference = "Stop"
$Root    = Split-Path -Parent $PSScriptRoot
$EnvFile = Join-Path $Root "backend\.env"
. (Join-Path $PSScriptRoot "_common.ps1")

$db = Get-DbSettings $EnvFile
$PgBin = Resolve-PgBin $PgBin
$PgDump = Join-Path $PgBin "pg_dump.exe"

New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null
$file = Join-Path $BackupDir ("{0}_{1}.dump" -f $db.Name, (Get-Date -Format "yyyyMMdd_HHmmss"))

$env:PGPASSWORD = $db.Password
try {
    & $PgDump -h $db.Host -p $db.Port -U $db.User -d $db.Name -F c -Z 6 -f $file
    if ($LASTEXITCODE -ne 0) { throw "pg_dump failed (exit code $LASTEXITCODE)" }
} finally {
    Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
}

$sizeMb = [math]::Round((Get-Item $file).Length / 1MB, 2)
Write-Host "Backup created: $file ($sizeMb MB)" -ForegroundColor Green

$old = Get-ChildItem $BackupDir -Filter "*.dump" | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-$RetentionDays) }
foreach ($f in $old) {
    Remove-Item $f.FullName -Force
    Write-Host "Deleted old backup: $($f.Name)"
}
