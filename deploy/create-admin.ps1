<#
.SYNOPSIS
    Creates an admin user, resets a password, or lists users (runs app.manage on this server).

.DESCRIPTION
    Use this when you cannot log in (forgotten password, no admin exists) or to add another admin
    from the server console. Normal user management is done in the web UI: tab "Users".
    If -Password is omitted it is asked for (hidden input).

.EXAMPLE
    .\create-admin.ps1 -Username admin2 -FullName "Admin 2"
    .\create-admin.ps1 -Username admin -Force                  # existing user -> admin + new password
    .\create-admin.ps1 -ResetPassword -Username ali
    .\create-admin.ps1 -List
#>
[CmdletBinding()]
param(
    [string] $Username = "",
    [string] $Password = "",
    [string] $FullName = "",
    [switch] $Force,
    [switch] $ResetPassword,
    [switch] $List
)

$ErrorActionPreference = "Stop"
$Backend = Join-Path (Split-Path -Parent $PSScriptRoot) "backend"
$VenvPy  = Join-Path $Backend ".venv\Scripts\python.exe"
if (-not (Test-Path $VenvPy)) { throw "Virtual environment not found. Run install.ps1 first." }
if (-not $List -and -not $Username) { throw "Pass -Username (or -List)." }

$cliArgs = @()
if ($List) {
    $cliArgs += "list-users"
} elseif ($ResetPassword) {
    $cliArgs += @("reset-password", "--username", $Username)
} else {
    $cliArgs += @("create-admin", "--username", $Username)
    if ($FullName) { $cliArgs += @("--full-name", $FullName) }
    if ($Force)    { $cliArgs += "--force" }
}
if ($Password -and -not $List) { $cliArgs += @("--password", $Password) }

$env:PYTHONUTF8 = "1"
$env:PYTHONIOENCODING = "utf-8"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Push-Location $Backend
try {
    & $VenvPy -m app.manage @cliArgs
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
    Pop-Location
}
