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
#      elevated PowerShell):
#        powershell -ExecutionPolicy Bypass -File windows\install_logueos_console_task.ps1
#      The task action invokes windows\tasks\run_start_logueos_console.vbs via
#      wscript.exe so the console never flashes on boot or restart-on-failure
#      (canon: 2026-05-05 -- non-VBS-wrapped PS tasks flash on Win11 24H2).
#
# SESSION REQUIREMENT (same rule as dispatch_listener -- PRO-336 / adopted-lessons):
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

# Defensive console hide: this fires AFTER the window is created so it can't
# prevent a sub-second flash. The real protection is the VBS wrapper at
# windows\tasks\run_start_logueos_console.vbs which the scheduled task action
# invokes via wscript.exe -- that suppresses console allocation at process-
# creation time. The block below remains for the case where an operator runs
# this script directly from an existing console (e.g. manual smoke test) and
# wants the wrapper to detach.
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
#
# ORIGIN default updated 2026-05-10: was https://room.taila28611.ts.net (Tailscale
# Funnel hostname) but the operator's tailnet root is owned by n8n -- the Console
# subpath gets shadowed and the Funnel TLS cert resolves to n8n. Operator
# accesses the Console via the raw Tailscale IP instead, which serves plain
# HTTP on this port. adapter-node's CSRF middleware requires the ORIGIN env
# var to match the request origin exactly (single value, no comma-separated
# list -- adapter-node rejects that with ERR_INVALID_URL). Defaulting to the
# operator-reachable URL. If the network topology changes (n8n moves, dedicated
# Console hostname appears, etc.) update both this default AND any worker
# prompts/canon that reference the URL.
$PORT   = if ($env:PORT)   { $env:PORT }   else { "18767" }
$HOST_  = if ($env:HOST)   { $env:HOST }   else { "0.0.0.0" }
# CodeRabbit R1: interpolate the resolved $PORT (NOT $env:PORT) so that if the
# operator overrides PORT at launch time, the ORIGIN default tracks it. Without
# this, an operator setting PORT=19000 would still get ORIGIN pinned to :18767
# and adapter-node CSRF would reject every request.
$ORIGIN = if ($env:ORIGIN) { $env:ORIGIN } else { "http://100.81.19.49:$PORT" }

# LOS-84: ttyd session URLs the Console /terminal/[session] route iframes.
# Tailscale Serve exposes ttyd over HTTPS at room.taila28611.ts.net:8443/{cc,gmi}
# — tailnet-only, not on the public Funnel.
$TTYD_CC_URL  = if ($env:TTYD_CC_URL)  { $env:TTYD_CC_URL }  else { "http://100.81.19.49:7681/cc/" }
$TTYD_GMI_URL = if ($env:TTYD_GMI_URL) { $env:TTYD_GMI_URL } else { "http://100.81.19.49:7682/gmi/" }

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
        $env:PORT         = $PORT
        $env:HOST         = $HOST_
        $env:ORIGIN       = $ORIGIN
        $env:TTYD_CC_URL  = $TTYD_CC_URL
        $env:TTYD_GMI_URL = $TTYD_GMI_URL
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
# Operator install (run once from an ELEVATED PowerShell on the host):
#
#   powershell -ExecutionPolicy Bypass -File windows\install_logueos_console_task.ps1
#
# That script registers MiruRestartLogueOSConsole with a task action of:
#   wscript.exe "<repo>\windows\tasks\run_start_logueos_console.vbs"
# wscript is Window-subsystem (no console allocation) and the VBS launches
# powershell.exe with SW_HIDE at process-creation time, so the console never
# flashes -- on boot, on restart-on-failure, or on manual Start-ScheduledTask
# from a non-console caller. See windows\tasks\run_start_logueos_console.vbs.
#
# Verify it starts:
#   Start-ScheduledTask -TaskPath "\Miru\" -TaskName "MiruRestartLogueOSConsole"
#   Start-Sleep 5
#   (Get-NetTCPConnection -LocalPort 18767 -State Listen -ErrorAction SilentlyContinue).OwningProcess
#
# To restart later (from any PowerShell, no elevation needed since LogonType=S4U):
#   Stop-ScheduledTask -TaskPath "\Miru\" -TaskName "MiruRestartLogueOSConsole"
#   Start-ScheduledTask -TaskPath "\Miru\" -TaskName "MiruRestartLogueOSConsole"
# ---------------------------------------------------------------------------
