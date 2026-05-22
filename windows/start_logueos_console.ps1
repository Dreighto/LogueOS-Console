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
# Launch via the HTTPS wrapper (windows\start_https.js) — wraps adapter-node's
# build/handler.js in https.createServer using Tailscale-minted Let's Encrypt
# certs. Listens HTTP on PORT (default 18767) AND HTTPS on HTTPS_PORT
# (default 18768). The HTTPS port is what iPhone Safari and other tailnet
# clients hit; HTTP stays for localhost.
$buildEntry = Join-Path $scriptDir "start_https.js"
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
# Console is now behind Tailscale Funnel for the iPhone-reachable HTTPS path
# (TLS terminated at Tailscale's edge, plain HTTP forwarded here). ORIGIN
# tracks the Funnel hostname so adapter-node CSRF accepts those requests.
$ORIGIN = if ($env:ORIGIN) { $env:ORIGIN } else { "https://room.taila28611.ts.net" }

# Terminal pages embed xterm.js directly on the same origin. The iframe is
# gone — wsUrl is built relative to window.location at runtime, so these
# env vars are only used for the not-yet-set fallback path and ttyd's
# /cc, /gmi paths are proxied by start_https.js to localhost:7681/7682.
$TTYD_CC_URL  = if ($env:TTYD_CC_URL)  { $env:TTYD_CC_URL }  else { "https://room.taila28611.ts.net/cc/" }
$TTYD_GMI_URL = if ($env:TTYD_GMI_URL) { $env:TTYD_GMI_URL } else { "https://room.taila28611.ts.net/gmi/" }

# HTTP Basic Auth on /console/terminal/*, /cc, /gmi. The Funnel exposes the
# Console publicly, so auth is mandatory for terminal access. Pull from the
# environment so the password lives outside source control. To set:
#   [System.Environment]::SetEnvironmentVariable('LOGUEOS_TERMINAL_AUTH',
#       'user:password', 'User')
# (then sign out / back in OR reboot OR launch this script with the env
#  var explicitly set in the same session).
$BASIC_AUTH = if ($env:LOGUEOS_TERMINAL_AUTH) { $env:LOGUEOS_TERMINAL_AUTH } else { "" }

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

# Idempotency check — Console listens HTTP on $PORT (Funnel handles TLS).
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
        $env:BASIC_AUTH   = $BASIC_AUTH
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
# That script registers LogueOS-StartConsole with a task action of:
#   wscript.exe "<repo>\windows\tasks\run_start_logueos_console.vbs"
# wscript is Window-subsystem (no console allocation) and the VBS launches
# powershell.exe with SW_HIDE at process-creation time, so the console never
# flashes -- on boot, on restart-on-failure, or on manual Start-ScheduledTask
# from a non-console caller. See windows\tasks\run_start_logueos_console.vbs.
#
# Verify it starts:
#   Start-ScheduledTask -TaskName "LogueOS-StartConsole"
#   Start-Sleep 5
#   (Get-NetTCPConnection -LocalPort 18767 -State Listen -ErrorAction SilentlyContinue).OwningProcess
#
# To restart later (kill-then-start, no elevation needed):
#   Start-ScheduledTask -TaskName "LogueOS-RestartConsole"
# ---------------------------------------------------------------------------
