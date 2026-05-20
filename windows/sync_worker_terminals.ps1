# sync_worker_terminals.ps1 -- bring the worker terminal stack in line with the
# worker registry (src/lib/config/workers.json). Run this after editing that
# file to add, remove, or swap a worker.
#
# The console dashboard reads workers.json directly, so it updates on the next
# build. The terminals are two extra moving parts that live outside the build:
#   1. ttyd processes inside WSL -- one per worker terminal
#   2. Tailscale Funnel paths    -- expose each terminal at room.taila28611.ts.net
# This script reads the same workers.json and reconciles both.
#
# Default run is a DRY RUN: it reports what is in sync and what is not, and
# prints the exact commands it would run. Pass -Apply to actually make changes.
#
#   powershell -ExecutionPolicy Bypass -File windows\sync_worker_terminals.ps1
#   powershell -ExecutionPolicy Bypass -File windows\sync_worker_terminals.ps1 -Apply
#
# ASCII only (PowerShell 5.1 reads UTF-8-no-BOM as cp1252).

[CmdletBinding()]
param([switch]$Apply)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ConsolePort  = 18767
$WslDistro    = 'Ubuntu-24.04'
$RegistryPath = Join-Path $PSScriptRoot '..\src\lib\config\workers.json'
$StartScript  = '/mnt/d/wsl-ubuntu/start-services.sh'

function Write-Head($text) {
    Write-Host ''
    Write-Host "=== $text ===" -ForegroundColor Cyan
}

if (-not (Test-Path $RegistryPath)) {
    Write-Host "FATAL: worker registry not found at $RegistryPath" -ForegroundColor Red
    exit 1
}

$registry  = Get-Content -Raw -Path $RegistryPath | ConvertFrom-Json
$terminals = @($registry.workers | Where-Object { $_.enabled -and $_.terminal })

Write-Head 'Worker terminals (from registry)'
if ($terminals.Count -eq 0) {
    Write-Host 'No terminal-bearing workers in the registry. Nothing to sync.'
    exit 0
}
foreach ($w in $terminals) {
    Write-Host ("  {0,-12} {1,-9} path {2,-8} port {3}" -f $w.id, $w.role, $w.terminal.path, $w.terminal.port)
}
if ($Apply) {
    Write-Host 'Mode: APPLY'
} else {
    Write-Host 'Mode: DRY RUN (pass -Apply to make changes)'
}

# --- 1. ttyd processes (inside WSL) ---------------------------------------
Write-Head 'ttyd processes'
if ($Apply) {
    Write-Host "Restarting the WSL terminal stack ($StartScript)..."
    wsl.exe -d $WslDistro -- bash $StartScript | Out-Null
    Start-Sleep -Seconds 2
}
foreach ($w in $terminals) {
    $port = [int]$w.terminal.port
    $listening = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue
    if ($listening) {
        Write-Host ("  OK    {0} listening on port {1}" -f $w.id, $port) -ForegroundColor Green
    } else {
        Write-Host ("  DOWN  {0} not listening on port {1}" -f $w.id, $port) -ForegroundColor Yellow
        if (-not $Apply) {
            Write-Host '        re-run with -Apply to (re)start the terminal stack'
        }
    }
}

# --- 2. Tailscale Funnel paths -------------------------------------------
Write-Head 'Tailscale Funnel paths'
$funnelStatus = ''
try {
    $funnelStatus = (tailscale funnel status 2>&1 | Out-String)
} catch {
    Write-Host "  WARN  could not read 'tailscale funnel status': $($_.Exception.Message)" -ForegroundColor Yellow
}
foreach ($w in $terminals) {
    $path   = $w.terminal.path
    $target = "http://localhost:$ConsolePort$path"
    if ($funnelStatus -match ([regex]::Escape($path) + '\s')) {
        Write-Host ("  OK    {0} exposed -> {1}" -f $path, $target) -ForegroundColor Green
    } else {
        Write-Host ("  MISS  {0} not exposed on Funnel" -f $path) -ForegroundColor Yellow
        if ($Apply) {
            Write-Host "        applying: tailscale funnel --bg --set-path=$path $target"
            & tailscale funnel --bg "--set-path=$path" $target | Out-Null
        } else {
            Write-Host "        would run: tailscale funnel --bg --set-path=$path $target"
        }
    }
}
Write-Host ''
Write-Host 'Note: if you RENAMED a terminal path, the old Funnel path is not removed'
Write-Host 'automatically. Remove it deliberately with:  tailscale funnel --set-path=/OLD off'

Write-Head 'Done'
if (-not $Apply) {
    Write-Host 'Dry run complete. Re-run with -Apply to make the changes listed above.'
} else {
    Write-Host 'Sync complete.'
}
