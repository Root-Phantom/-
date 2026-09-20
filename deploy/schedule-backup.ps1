<#
.SYNOPSIS
    Registers a daily scheduled task that runs backup.ps1.

.EXAMPLE
    .\schedule-backup.ps1 -At "02:00" -BackupDir D:\Backups\PoldokhtarGIS
#>
[CmdletBinding()]
param(
    [string] $At = "02:00",
    [string] $BackupDir = "C:\Backups\PoldokhtarGIS",
    [int]    $RetentionDays = 30,
    [string] $TaskName = "PoldokhtarGIS-DailyBackup"
)

$ErrorActionPreference = "Stop"
$script = Join-Path $PSScriptRoot "backup.ps1"
$arg = "-NoProfile -ExecutionPolicy Bypass -File `"$script`" -BackupDir `"$BackupDir`" -RetentionDays $RetentionDays"

$action    = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $arg
$trigger   = New-ScheduledTaskTrigger -Daily -At $At
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
$settings  = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 2)

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
Write-Host "Scheduled task '$TaskName' registered (daily at $At)." -ForegroundColor Green
Write-Host "Run it now to test:  Start-ScheduledTask -TaskName $TaskName"
