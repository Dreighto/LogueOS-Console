# restart_logueos_console.ps1 -- LogueOS Console restart wrapper
# Triggers the LogueOS-RestartConsole scheduled task.
# Does NOT require elevation -- Start-ScheduledTask works from any user session
# because the registered task uses Interactive + Limited.
#
# The actual restart logic lives in:
#   windows\tasks\restart_logueos_console_task.ps1
#
# Progress can be monitored via:
#   Get-Content logs\logueos_console_restart.log -Wait
#   (Get-ScheduledTaskInfo -TaskName "LogueOS-RestartConsole").LastTaskResult

[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$logDir   = Join-Path $repoRoot "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logPath  = Join-Path $logDir "logueos_console_restart.log"

function Write-LogLine {
    param([string]$Message)
    $line = "$((Get-Date -Format 'yyyy-MM-dd HH:mm:ss.fff'))`t$Message"
    Add-Content -Path $logPath -Value $line -Encoding UTF8
    Write-Host "[restart-logueos-console] $Message"
}

Set-Content -Path $logPath -Value "" -Encoding UTF8

$taskName = "LogueOS-RestartConsole"
# Path-qualified: a bare -TaskName is ambiguous if a stray same-named task
# exists at another TaskPath. The installer registers this task at the root path.
$taskPath = "\"

Write-LogLine "target_surface=LOGUEOS_CONSOLE_18767"
Write-LogLine "action=trigger_scheduled_task"

$task = Get-ScheduledTask -TaskName $taskName -TaskPath $taskPath -ErrorAction SilentlyContinue
if (-not $task) {
    Write-LogLine "ERROR: Scheduled task '$taskName' does not exist."
    Write-LogLine "Run this from an elevated shell to register it:"
    Write-LogLine "  powershell -ExecutionPolicy Bypass -File windows\install_logueos_console_task.ps1"
    exit 1
}

Write-LogLine "Starting scheduled task: $taskPath$taskName"
Start-ScheduledTask -TaskName $taskName -TaskPath $taskPath
Write-LogLine "Restart triggered via scheduled task -- no UAC required"
Write-LogLine "Monitor: Get-Content logs\logueos_console_restart.log -Wait"

Start-Sleep -Seconds 2
$taskState = (Get-ScheduledTask -TaskName $taskName -TaskPath $taskPath).State
Write-LogLine "task_state_after_trigger=$taskState"
Write-LogLine "RESTART_TRIGGERED"

exit 0
