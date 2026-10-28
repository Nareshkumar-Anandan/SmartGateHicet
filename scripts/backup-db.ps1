# ==============================================================================
# SmartGate Automated Database Backup Script (MySQL on Windows)
# ==============================================================================

param (
    [string]$DbUser = "root",
    [string]$DbPass = "Mysql@123",
    [string]$DbName = "smartgate_db",
    [string]$BackupDir = "C:\Users\Nareshkumar\Documents\SmartGate\backups",
    [int]$RetentionDays = 30
)

$ErrorActionPreference = "Stop"
$Timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$BackupFile = Join-Path $BackupDir "$($DbName)_$Timestamp.sql"

# 1. Ensure backup directory exists
if (-not (Test-Path $BackupDir)) {
    New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null
    Write-Host "[INFO] Created backup directory: $BackupDir" -ForegroundColor Cyan
}

# 2. Execute mysqldump
Write-Host "[INFO] Starting backup of database '$DbName'..." -ForegroundColor Yellow
$MysqlDumpPath = "C:\Program Files\MySQL\MySQL Server 8.0\bin\mysqldump.exe"

if (-not (Test-Path $MysqlDumpPath)) {
    $MysqlDumpPath = "mysqldump"
}

$DumpArgs = @(
    "--user=$DbUser",
    "--password=$DbPass",
    "--databases", $DbName,
    "--routines",
    "--triggers",
    "--single-transaction",
    "--result-file=$BackupFile"
)

& $MysqlDumpPath $DumpArgs

if ($LASTEXITCODE -eq 0 -and (Test-Path $BackupFile)) {
    $FileSize = (Get-Item $BackupFile).Length / 1MB
    Write-Host ("[SUCCESS] Database backup completed: {0} ({1:N2} MB)" -f $BackupFile, $FileSize) -ForegroundColor Green
} else {
    Write-Error "[ERROR] mysqldump failed with exit code $LASTEXITCODE"
    exit 1
}

# 3. Clean up older backups exceeding retention window
Write-Host "[INFO] Purging backups older than $RetentionDays days..." -ForegroundColor Yellow
$CutoffDate = (Get-Date).AddDays(-$RetentionDays)
Get-ChildItem -Path $BackupDir -Filter "$($DbName)_*.sql" -ErrorAction SilentlyContinue | Where-Object { $_.LastWriteTime -lt $CutoffDate } | ForEach-Object {
    Write-Host "[PURGE] Removing expired backup: $($_.Name)" -ForegroundColor DarkGray
    Remove-Item $_.FullName -Force
}

Write-Host "[COMPLETE] Backup routine finished successfully." -ForegroundColor Green
