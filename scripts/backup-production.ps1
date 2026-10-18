param(
    [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot),
    [string]$DbPath = (Join-Path (Split-Path -Parent $PSScriptRoot) 'data\unfocus.sqlite'),
    [string]$UploadsPath = (Join-Path (Split-Path -Parent $PSScriptRoot) 'uploads'),
    [string]$BackupRoot = (Join-Path (Split-Path -Parent $PSScriptRoot) 'backups')
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $DbPath) -and -not (Test-Path $UploadsPath)) {
    throw 'No se encontró la base de datos ni la carpeta uploads para hacer backup.'
}

New-Item -ItemType Directory -Path $BackupRoot -Force | Out-Null
$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$targetPath = Join-Path $BackupRoot "unfocus-$timestamp"
New-Item -ItemType Directory -Path $targetPath -Force | Out-Null

if (Test-Path $DbPath) {
    Copy-Item $DbPath (Join-Path $targetPath 'unfocus.sqlite') -Force
}

if (Test-Path $UploadsPath) {
    Copy-Item $UploadsPath (Join-Path $targetPath 'uploads') -Recurse -Force
}

Write-Output "Backup creado en: $targetPath"
