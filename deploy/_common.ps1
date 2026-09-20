# Shared helpers for the deploy scripts (dot-sourced; do not run directly).

function Get-DbSettings([string] $EnvFile) {
    if (-not (Test-Path $EnvFile)) { throw "$EnvFile not found. Run install.ps1 first." }
    $line = Get-Content $EnvFile -Encoding UTF8 | Where-Object { $_ -match '^\s*DATABASE_URL\s*=' } | Select-Object -First 1
    if (-not $line) { throw "DATABASE_URL not found in $EnvFile" }
    $url = ($line -split '=', 2)[1].Trim()
    if ($url -notmatch '^postgresql(\+\w+)?://(?<user>[^:]+):(?<pw>[^@]*)@(?<host>[^:/]+)(:(?<port>\d+))?/(?<db>[^?]+)') {
        throw "Could not parse DATABASE_URL in $EnvFile"
    }
    return [pscustomobject]@{
        User     = [uri]::UnescapeDataString($Matches.user)
        Password = [uri]::UnescapeDataString($Matches.pw)
        Host     = $Matches.host
        Port     = if ($Matches.port) { [int]$Matches.port } else { 5432 }
        Name     = $Matches.db
    }
}

function Resolve-PgBin([string] $PgBin) {
    if ($PgBin -and (Test-Path (Join-Path $PgBin "pg_dump.exe"))) { return $PgBin }
    $found = Get-ChildItem "C:\Program Files\PostgreSQL\*\bin\pg_dump.exe" -ErrorAction SilentlyContinue |
        Sort-Object { [int]($_.Directory.Parent.Name -replace '\D', '') } -Descending | Select-Object -First 1
    if (-not $found) { throw "PostgreSQL bin folder not found. Pass -PgBin 'C:\Program Files\PostgreSQL\16\bin'." }
    return $found.DirectoryName
}
