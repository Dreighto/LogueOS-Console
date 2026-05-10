# start_logueos_console.ps1 -- entry point for the LogueOS Console production server.
# Launches `node build/index.js` on PORT=18767, HOST=0.0.0.0 with stdout/stderr
# redirected to logs\logueos_console_*.log, and respawns on non-zero exit.
#
# Mirrors the shape of project-miru's windows\start_dispatch_listener.ps1.
#
# BOOT PATH (install once, survives reboot):
#   1. Run this script once to verify it works:
#        powershell -ExecutionPolicy Bypass -File windows\start_logueos_console.ps1
#   2. Register as a Windows scheduled task (operator-side, run once from an
#      elevated PowerShell — see the TODO block at the bottom of this file).
#
# SESSION REQUIREMENT (same rule as dispatch_listener — PRO-336 / adopted-lessons):
#   This process does NOT need to be restarted by a non-elevated worker shell,
#   so a SYSTEM-logon AtStartup scheduled task (Session 0) is acceptable.
#   If that changes, switch to a shell:startup shortcut so it lands in Session 1+.
#
# ENV VARS consumed by adapter-node:
#   PORT                         TCP port (default 3000; we set 18767)
#   HOST                         Bind address (default 0.0.0.0)
#   LOGUEOS_CONSOLE_BASE_PATH    Passed through to the app (informational; the
#                                base path is baked into the build at svelte.config.js
#                                kit.paths.base='/console'; this var is for reference).
#   ORIGIN                       Required by adapter-node for CSRF protection in
#                                production. Set to the Tailscale URL.

[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Continue"

# Hide console window -- keeps taskbar clean (same technique as dispatch_listener wrapper).
try { Add-Type -Name LogueHide -Namespace W32 -MemberDefinition '[DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow(); [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);' -ErrorAction SilentlyContinue } catch {}
try { [W32.LogueHide]::ShowWindow([W32.LogueHide]::GetConsoleWindow(), 0) | Out-Null } catch {}

$scriptDir  = $PSScriptRoot
$repoRoot   = Split-Path -Parent $scriptDir
$logDir     = Join-Path $repoRoot "logs"
$buildEntry = Join-Path $repoRoot "build\index.js"
$stdoutLog  = Join-Path $logDir "logueos_console_stdout.log"
$stderrLog  = Join-Path $logDir "logueos_console_stderr.log"
$wrapperLog = Join-Path $logDir "logueos_console_wrapper.log"

# CodeRabbit fix on PR #6: respect deployment-supplied env vars; fall back to
# defaults only when not provided. Lets a future operator override at runtime
# (e.g. testing against a non-default port or origin) without editing this file.
$PORT   = if ($env:PORT)   { $env:PORT }   else { "18767" }
$HOST_  = if ($env:HOST)   { $env:HOST }   else { "0.0.0.0" }
$ORIGIN = if ($env:ORIGIN) { $env:ORIGIN } else { "https://room.taila28611.ts.net" }

$MAX_RESPAWNS    = 50
$RESPAWN_BACKOFF = 30

New-Item -ItemType Directory -Force -Path $logDir | Out-Null

function Write-WrapperLog {
    param([Parameter(Mandatory = $true)][string]$Message)
    $line = "[$(Get-Date -Format o)] start_logueos_console: $Message"
    Add-Content -Path $wrapperLog -Value $line -Encoding UTF8
}

if (-not (Test-Path $buildEntry)) {
    Write-WrapperLog "fatal: build artifact not found at $buildEntry -- run 'npm run build' first"
    exit 2
}

$nodeCmd = Get-Command "node" -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
    Write-WrapperLog "fatal: node not on PATH"
    exit 3
}

# CodeRabbit R2 fix: use resolved $PORT for idempotency check, not hardcoded
# 18767. If operator overrides $env:PORT at launch time, both the bind and the
# already-listening guard must agree on the same port.
$portInt = [int]$PORT
$portBound = Get-NetTCPConnection -LocalPort $portInt -State Listen -ErrorAction SilentlyContinue |
             Select-Object -First 1
if ($portBound) {
    Write-WrapperLog "port $PORT already listening (PID=$($portBound.OwningProcess)) -- already running, exiting gracefully"
    exit 0
}

$respawns = 0
$lastExit = -1
while ($respawns -lt $MAX_RESPAWNS) {
    $portCheck = Get-NetTCPConnection -LocalPort $portInt -State Listen -ErrorAction SilentlyContinue |
                 Select-Object -First 1
    if ($portCheck) {
        Write-WrapperLog "pre-spawn port check: $PORT already listening (PID=$($portCheck.OwningProcess)) -- exiting gracefully"
        $lastExit = 0
        break
    }

    Write-WrapperLog "spawn attempt=$($respawns + 1) node=$($nodeCmd.Source) entry=$buildEntry port=$PORT"

    Push-Location -Path $repoRoot
    try {
        $env:PORT   = $PORT
        $env:HOST   = $HOST_
        $env:ORIGIN = $ORIGIN
        $cmdLine = ('"{0}" "{1}" >> "{2}" 2>> "{3}"' -f $nodeCmd.Source, $buildEntry, $stdoutLog, $stderrLog)
        & $env:ComSpec /d /c $cmdLine
        $lastExit = $LASTEXITCODE
    } finally {
        Pop-Location
    }
    Write-WrapperLog "exit code=$lastExit attempts=$($respawns + 1)"

    if ($lastExit -eq 0) {
        Write-WrapperLog "graceful exit -- not respawning"
        break
    }

    $respawns++
    if ($respawns -ge $MAX_RESPAWNS) {
        Write-WrapperLog "respawn budget exhausted ($MAX_RESPAWNS) -- giving up"
        break
    }

    Write-WrapperLog "respawning in ${RESPAWN_BACKOFF}s"
    Start-Sleep -Seconds $RESPAWN_BACKOFF
}

exit $lastExit

# ---------------------------------------------------------------------------
# TODO: Register as a Windows Scheduled Task (operator-side, run once elevated)
#
# Paste into an elevated PowerShell session:
#
#   $repoRoot  = "D:\dev\LogueOS-Console"
#   $script    = "$repoRoot\windows\start_logueos_console.ps1"
#   $action    = New-ScheduledTaskAction `
#                    -Execute "powershell.exe" `
#                    -Argument "-ExecutionPolicy Bypass -WindowStyle Hidden -File `"$script`"" `
#                    -WorkingDirectory $repoRoot
#   $trigger   = New-ScheduledTaskTrigger -AtStartup
#   $settings  = New-ScheduledTaskSettingsSet `
#                    -ExecutionTimeLimit (New-TimeSpan -Days 365) `
#                    -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) `
#                    -MultipleInstances IgnoreNew
#   $principal = New-ScheduledTaskPrincipal `
#                    -UserId "$env:USERDOMAIN\$env:USERNAME" `
#                    -LogonType S4U `
#                    -RunLevel Limited
#   Register-ScheduledTask `
#       -TaskName    "MiruRestartLogueOSConsole" `
#       -TaskPath    "\Miru\" `
#       -Action      $action `
#       -Trigger     $trigger `
#       -Settings    $settings `
#       -Principal   $principal `
#       -Description "LogueOS Console production server (port 18767, adapter-node)"
#
# Verify it starts:
#   Start-ScheduledTask -TaskPath "\Miru\" -TaskName "MiruRestartLogueOSConsole"
#   Start-Sleep 5
#   (Get-NetTCPConnection -LocalPort 18767 -State Listen -ErrorAction SilentlyContinue).OwningProcess
#
# To restart later (from any PowerShell, no elevation needed if LogonType=S4U and
# the process is in your interactive session):
#   Stop-ScheduledTask -TaskPath "\Miru\" -TaskName "MiruRestartLogueOSConsole"
#   Start-ScheduledTask -TaskPath "\Miru\" -TaskName "MiruRestartLogueOSConsole"
# ---------------------------------------------------------------------------
