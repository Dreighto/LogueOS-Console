# restart_logueos_console_task.ps1
# The restart logic behind the "LogueOS-RestartConsole" scheduled task.
# Runs as the current user with RunLevel=Limited (Interactive logon).
# Stops whatever is on port 18767, then starts a fresh LogueOS Console process.

Set-StrictMode -Version Latest
$ErrorActionPreference = "Continue"

try { Add-Type -Name LogueOSHide -Namespace W32 -MemberDefinition '[DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow(); [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);' -ErrorAction SilentlyContinue } catch {}
try { [W32.LogueOSHide]::ShowWindow([W32.LogueOSHide]::GetConsoleWindow(), 0) | Out-Null } catch {}

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$logDir   = Join-Path $repoRoot "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$logPath = Join-Path $logDir "logueos_console_restart.log"
$port    = 18767

function Write-Log {
    param([string]$Msg)
    $line = "$((Get-Date -Format 'yyyy-MM-dd HH:mm:ss.fff'))`t$Msg"
    Add-Content -Path $logPath -Value $line -Encoding UTF8
}

Add-Content -Path $logPath -Value "" -Encoding UTF8
Write-Log "=== LogueOS-RestartConsole BEGIN ==="
Write-Log "repo_root=$repoRoot"

Write-Log "Checking for existing console on port $port..."
$listenerPids = @(
    Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue |
        ForEach-Object { [int]$_.OwningProcess } |
        Where-Object { $_ -gt 0 } |
        Sort-Object -Unique
)

if ($listenerPids.Count -eq 0) {
    Write-Log "No process found on port $port"
} else {
    foreach ($p in $listenerPids) {
        $proc = Get-Process -Id $p -ErrorAction SilentlyContinue
        $procName = if ($proc) { $proc.ProcessName } else { "<gone>" }
        Write-Log "Stopping $procName PID $p on port $port"
        try {
            Stop-Process -Id $p -Force -ErrorAction Stop
            Write-Log "Stopped PID $p"
        } catch {
            Write-Log "WARNING: Failed to stop PID $p : $($_.Exception.Message)"
        }
    }
    Write-Log "Waiting 2s for port to clear..."
    Start-Sleep -Seconds 2
}

$remaining = @(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)
if ($remaining.Count -gt 0) {
    Write-Log "ERROR: Port $port still occupied after kill attempt -- aborting"
    Write-Log "=== LogueOS-RestartConsole END (failed) ==="
    exit 1
}
Write-Log "Port $port is clear"

# Launch the console via the canon wscript + VBS wrapper, NOT powershell.exe
# directly. Start-Process powershell.exe -WindowStyle Hidden races the hide
# flag and flashes a console on Win11 24H2 (2026-05-11 popup post-mortem).
# wscript.exe is Window-subsystem -- no console, no flash. The VBS resolves
# and runs ..\start_logueos_console.ps1 itself.
$startVbs = Join-Path $PSScriptRoot "run_start_logueos_console.vbs"
Write-Log "Launching console via run_start_logueos_console.vbs (wscript, no flash)..."
if (-not (Test-Path $startVbs)) {
    Write-Log "ERROR: run_start_logueos_console.vbs not found at $startVbs"
    Write-Log "=== LogueOS-RestartConsole END (failed) ==="
    exit 1
}
try {
    Start-Process "wscript.exe" -ArgumentList "`"$startVbs`"" -ErrorAction Stop | Out-Null
    Write-Log "Console launch triggered via wscript (vbs=$startVbs)"
} catch {
    Write-Log "ERROR: wscript launch failed: $($_.Exception.Message)"
    Write-Log "=== LogueOS-RestartConsole END (failed) ==="
    exit 1
}

Write-Log "Waiting for port $port to appear (up to 30s)..."
$deadline    = (Get-Date).AddSeconds(30)
$isListening = $false
do {
    $entries = @(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)
    if ($entries.Count -gt 0) { $isListening = $true; break }
    Start-Sleep -Milliseconds 1000
} while ((Get-Date) -lt $deadline)

if ($isListening) {
    Write-Log "LogueOS Console is listening on port $port -- restart SUCCESS"
    Write-Log "=== LogueOS-RestartConsole END (success) ==="
    exit 0
} else {
    Write-Log "WARNING: LogueOS Console did not start listening within 30s"
    Write-Log "=== LogueOS-RestartConsole END (port not detected) ==="
    exit 1
}
