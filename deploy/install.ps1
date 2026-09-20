<#
.SYNOPSIS
    Installs the Poldokhtar Street Management System (backend + database + frontend) on Windows Server.

.DESCRIPTION
    1. Checks Python and PostgreSQL/PostGIS
    2. Creates database user, database and PostGIS extensions
    3. Creates the Python virtual environment and installs packages
    4. Writes backend\.env with a random SECRET_KEY
    5. Creates the tables and the first admin user
    6. Builds the frontend (if Node.js is installed and dist is missing)
    7. Opens the firewall port (unless -BehindIIS)

    The script is idempotent: it can be run again safely.

.EXAMPLE
    .\install.ps1 -PostgresPassword "PgSuper@123" -DbPassword "PolDb@2025" -AdminPassword "Admin@2025"

.EXAMPLE
    # Offline server with pre-downloaded wheels, behind IIS
    .\install.ps1 -PostgresPassword "..." -DbPassword "..." -AdminPassword "..." -WheelsDir C:\PoldokhtarGIS\wheels -BehindIIS
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)] [string] $PostgresPassword,
    [Parameter(Mandatory = $true)] [string] $DbPassword,
    [Parameter(Mandatory = $true)] [string] $AdminPassword,
    [string] $AdminUsername = "admin",
    [string] $AdminFullName = "مدیر سامانه",
    [string] $DbHost = "localhost",
    [int]    $DbPort = 5432,
    [string] $DbName = "poldokhtar_gis",
    [string] $DbUser = "pol_user",
    [int]    $AppPort = 8000,
    [string] $PythonExe = "",
    [string] $PgBin = "",
    [string] $WheelsDir = "",
    [switch] $BehindIIS,
    [switch] $SkipFrontendBuild,
    [switch] $OverwriteEnv
)

$ErrorActionPreference = "Stop"
$Root     = Split-Path -Parent $PSScriptRoot
$Backend  = Join-Path $Root "backend"
$Frontend = Join-Path $Root "frontend"
$VenvPy   = Join-Path $Backend ".venv\Scripts\python.exe"
$EnvFile  = Join-Path $Backend ".env"

function Step($msg)  { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Ok($msg)    { Write-Host "    [OK] $msg" -ForegroundColor Green }
function Warn($msg)  { Write-Host "    [!] $msg" -ForegroundColor Yellow }
function Assert-Exit($what) { if ($LASTEXITCODE -ne 0) { throw "$what failed (exit code $LASTEXITCODE)." } }

# ------------------------------------------------------------------ validation
if ($DbUser -notmatch '^[a-z_][a-z0-9_]*$') { throw "DbUser may contain only lowercase letters, digits and _." }
if ($DbName -notmatch '^[a-z_][a-z0-9_]*$') { throw "DbName may contain only lowercase letters, digits and _." }
foreach ($p in @($PostgresPassword, $DbPassword, $AdminPassword)) {
    if ($p.Contains('"')) { throw 'Passwords must not contain the double-quote (") character.' }
}
if ($AdminPassword.Length -lt 8 -or $AdminPassword -notmatch '\d' -or $AdminPassword -notmatch '[A-Za-z]') {
    throw "AdminPassword must be at least 8 characters and contain letters and digits."
}
if ($Root -match '[^\x00-\x7F]' -or $Root -match ' ') {
    Warn "Install path '$Root' contains spaces or non-ASCII characters. C:\PoldokhtarGIS is recommended."
}

# ------------------------------------------------------------------ Python
Step "Checking Python"
if (-not $PythonExe) {
    $candidates = @()
    if (Get-Command py -ErrorAction SilentlyContinue) {
        foreach ($v in @("3.12", "3.13", "3.11")) {
            # stderr redirection of native commands throws under "Stop" in Windows PowerShell 5.1
            $prev = $ErrorActionPreference
            $ErrorActionPreference = "Continue"
            try {
                $exe = & py "-$v" -c "import sys; print(sys.executable)" 2>$null
                if ($LASTEXITCODE -eq 0 -and $exe) { $candidates += "$exe".Trim() }
            } catch { } finally { $ErrorActionPreference = $prev }
        }
    }
    if (Get-Command python -ErrorAction SilentlyContinue) { $candidates += (Get-Command python).Source }
    $PythonExe = $candidates | Where-Object { $_ -and ($_ -notmatch 'WindowsApps') } | Select-Object -First 1
}
if (-not $PythonExe) { throw "Python 3.11+ not found. Install Python 3.12 (see docs\DEPLOY.md, step 2)." }
$pyVer = & $PythonExe -c "import sys; print('%d.%d' % sys.version_info[:2])"
Assert-Exit "Python"
if ([version]$pyVer -lt [version]"3.11") { throw "Python $pyVer is too old; 3.11 or newer is required." }
Ok "Python $pyVer at $PythonExe"

# ------------------------------------------------------------------ PostgreSQL
Step "Checking PostgreSQL"
if (-not $PgBin) {
    $psqlFound = Get-ChildItem "C:\Program Files\PostgreSQL\*\bin\psql.exe" -ErrorAction SilentlyContinue |
        Sort-Object { [int]($_.Directory.Parent.Name -replace '\D', '') } -Descending | Select-Object -First 1
    if ($psqlFound) { $PgBin = $psqlFound.DirectoryName }
}
$Psql = Join-Path $PgBin "psql.exe"
if (-not (Test-Path $Psql)) { throw "psql.exe not found. Install PostgreSQL 16 or pass -PgBin 'C:\Program Files\PostgreSQL\16\bin'." }
Ok "psql at $Psql"

$env:PGPASSWORD = $PostgresPassword
$env:PGOPTIONS  = "-c client_min_messages=warning"
$env:PGCLIENTENCODING = "UTF8"

function Invoke-Psql([string] $Database, [string] $Sql) {
    $out = & $Psql -h $DbHost -p $DbPort -U postgres -d $Database -v ON_ERROR_STOP=1 -q -t -A -c $Sql
    if ($LASTEXITCODE -ne 0) { throw "SQL failed on database '$Database': $Sql" }
    return ($out | Out-String).Trim()
}

$pgVersion = Invoke-Psql "postgres" "SHOW server_version"
Ok "Connected to PostgreSQL $pgVersion"

# ------------------------------------------------------------------ database
Step "Creating database user and database"
$pwSql = $DbPassword.Replace("'", "''")
if ((Invoke-Psql "postgres" "SELECT 1 FROM pg_roles WHERE rolname = '$DbUser'") -eq "1") {
    Invoke-Psql "postgres" "ALTER ROLE $DbUser WITH LOGIN PASSWORD '$pwSql'" | Out-Null
    Ok "User $DbUser exists (password updated)"
} else {
    Invoke-Psql "postgres" "CREATE ROLE $DbUser WITH LOGIN PASSWORD '$pwSql'" | Out-Null
    Ok "User $DbUser created"
}

if ((Invoke-Psql "postgres" "SELECT 1 FROM pg_database WHERE datname = '$DbName'") -eq "1") {
    Ok "Database $DbName already exists"
} else {
    Invoke-Psql "postgres" "CREATE DATABASE $DbName OWNER $DbUser ENCODING 'UTF8' TEMPLATE template0" | Out-Null
    Ok "Database $DbName created"
}

$available = Invoke-Psql $DbName "SELECT count(*) FROM pg_available_extensions WHERE name = 'postgis'"
if ($available -ne "1") {
    throw "PostGIS is not installed on this PostgreSQL server. Install it with Stack Builder or the PostGIS bundle (docs\DEPLOY.md, step 3.2), then run this script again."
}
Invoke-Psql $DbName "CREATE EXTENSION IF NOT EXISTS postgis; CREATE EXTENSION IF NOT EXISTS pg_trgm; GRANT ALL ON SCHEMA public TO $DbUser; ALTER DATABASE $DbName OWNER TO $DbUser" | Out-Null
$postgisVersion = Invoke-Psql $DbName "SELECT postgis_lib_version()"
Ok "PostGIS $postgisVersion enabled"
Remove-Item Env:\PGPASSWORD

# ------------------------------------------------------------------ Python environment
Step "Creating Python virtual environment"
if (-not (Test-Path $VenvPy)) {
    & $PythonExe -m venv (Join-Path $Backend ".venv")
    Assert-Exit "venv creation"
    Ok "Virtual environment created"
} else {
    Ok "Virtual environment already exists"
}

Step "Installing Python packages"
$req = Join-Path $Backend "requirements.txt"
if ($WheelsDir) {
    & $VenvPy -m pip install --no-index --find-links $WheelsDir -r $req
} else {
    & $VenvPy -m pip install --upgrade pip --disable-pip-version-check
    Assert-Exit "pip upgrade"
    & $VenvPy -m pip install -r $req --disable-pip-version-check
}
Assert-Exit "pip install"
Ok "Packages installed"

# ------------------------------------------------------------------ .env
Step "Writing configuration (backend\.env)"
if ((Test-Path $EnvFile) -and -not $OverwriteEnv) {
    Warn ".env already exists and was left unchanged (use -OverwriteEnv to regenerate)."
} else {
    $bytes = New-Object byte[] 48
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $secret = ([Convert]::ToBase64String($bytes)) -replace '[+/=]', ''
    $dbUrl  = "postgresql+psycopg://{0}:{1}@{2}:{3}/{4}" -f $DbUser, [uri]::EscapeDataString($DbPassword), $DbHost, $DbPort, $DbName
    $trust  = if ($BehindIIS) { "true" } else { "false" }
    $secure = if ($BehindIIS) { "true" } else { "false" }
    $content = @"
# Generated by deploy\install.ps1 on $(Get-Date -Format "yyyy-MM-dd HH:mm")
APP_ENV=production
DEBUG=false
DATABASE_URL=$dbUrl
SECRET_KEY=$secret
ACCESS_TOKEN_EXPIRE_MINUTES=720
COOKIE_SECURE=$secure
TRUST_PROXY_HEADERS=$trust
FIRST_ADMIN_USERNAME=$AdminUsername
FIRST_ADMIN_PASSWORD=$AdminPassword
FIRST_ADMIN_FULLNAME=$AdminFullName
CORS_ORIGINS=http://localhost:5173
MAX_UPLOAD_MB=200
"@
    # UTF-8 without BOM (a BOM would corrupt the first key)
    [System.IO.File]::WriteAllText($EnvFile, $content, (New-Object System.Text.UTF8Encoding($false)))
    Ok ".env written"
    if ($BehindIIS) { Warn "COOKIE_SECURE=true: the site must be opened over HTTPS through IIS." }
}

# ------------------------------------------------------------------ tables + admin
Step "Creating tables and first admin user"
$env:PYTHONUTF8 = "1"
Push-Location $Backend
try {
    & $VenvPy -m app.seed
    Assert-Exit "Database initialisation"
} finally {
    Pop-Location
}
Ok "Database schema ready"

# The first admin now exists; do not keep its initial password in plain text.
$envText = [System.IO.File]::ReadAllText($EnvFile)
if ($envText -match '(?m)^FIRST_ADMIN_PASSWORD=.+$') {
    $envText = $envText -replace '(?m)^FIRST_ADMIN_PASSWORD=.*$', 'FIRST_ADMIN_PASSWORD='
    [System.IO.File]::WriteAllText($EnvFile, $envText, (New-Object System.Text.UTF8Encoding($false)))
    Ok "Initial admin password removed from .env"
}

# ------------------------------------------------------------------ frontend
Step "Frontend"
$dist = Join-Path $Frontend "dist\index.html"
if ($SkipFrontendBuild) {
    Warn "Frontend build skipped by -SkipFrontendBuild."
} elseif (Get-Command npm.cmd -ErrorAction SilentlyContinue) {
    Push-Location $Frontend
    try {
        if (Test-Path "package-lock.json") { & npm.cmd ci --no-audit --no-fund } else { & npm.cmd install --no-audit --no-fund }
        Assert-Exit "npm install"
        & npm.cmd run build
        Assert-Exit "npm run build"
    } finally {
        Pop-Location
    }
    Ok "Frontend built"
} elseif (Test-Path $dist) {
    Warn "Node.js not found; using the existing pre-built frontend\dist."
} else {
    throw "frontend\dist is missing and Node.js is not installed. Install Node.js 20 LTS or copy a pre-built dist folder (docs\DEPLOY.md, step 4)."
}
if (-not (Test-Path $dist)) { throw "frontend\dist\index.html was not produced." }

# ------------------------------------------------------------------ firewall
if (-not $BehindIIS) {
    Step "Opening firewall port $AppPort"
    $ruleName = "PoldokhtarGIS-HTTP-$AppPort"
    if (-not (Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue)) {
        New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Protocol TCP -LocalPort $AppPort -Action Allow | Out-Null
        Ok "Firewall rule '$ruleName' created"
    } else {
        Ok "Firewall rule already exists"
    }
}

Write-Host ""
Write-Host "Installation completed successfully." -ForegroundColor Green
Write-Host "Next steps:"
Write-Host "  1) Test:            .\run-server.ps1 -Port $AppPort   then open http://localhost:$AppPort"
Write-Host "  2) Windows service: .\install-service.ps1 -Port $AppPort$(if ($BehindIIS) { ' -BindAddress 127.0.0.1' })"
Write-Host "  3) Log in as '$AdminUsername' and change the password immediately."
