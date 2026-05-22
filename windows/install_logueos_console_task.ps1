# install_logueos_console_task.ps1
# Registers LogueOS-StartConsole as a Windows Scheduled Task (AtStartup).
# ALSO registers LogueOS-RestartConsole (Interactive, On-Demand kill-then-start).
# Idempotent: re-running unregisters and reinstalls both.
#
# RUN ONCE from elevated PowerShell on the operator's machine.
#
# Both tasks register at the root task path '\' (matching every other
# LogueOS-* scheduled task) and use a wscript.exe + VBS wrapper as their
# action -- never powershell.exe directly. wscript is Window-subsystem, so
# the task never flashes a console on Win11 24H2 when it fires (2026-05-11
# popup post-mortem).
# See tasks\run_start_logueos_console.vbs and tasks\run_restart_logueos_console.vbs.

$repoRoot  = $PSScriptRoot | Split-Path -Parent

# ================================================================================
# TASK 1: LogueOS-StartConsole (AtStartup)
# ================================================================================
$startupScript    = Join-Path $PSScriptRoot 'start_logueos_console.ps1'
$startupVbsScript = Join-Path $PSScriptRoot 'tasks\run_start_logueos_console.vbs'

if (-not (Test-Path $startupScript)) { Write-Output "INSTALL_FAIL: start script not found at $startupScript"; exit 1 }
if (-not (Test-Path $startupVbsScript)) { Write-Output "INSTALL_FAIL: VBS wrapper not found at $startupVbsScript"; exit 1 }

$startupAction    = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument "`"$startupVbsScript`"" -WorkingDirectory $repoRoot
$startupTrigger   = New-ScheduledTaskTrigger -AtStartup
$startupSettings  = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Days 365) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew
$startupPrincipal = New-ScheduledTaskPrincipal -UserId (whoami).Trim() -LogonType S4U -RunLevel Limited

# Defensively unregister every LogueOS-StartConsole at any TaskPath before
# registering, so a stray copy at a stale path cannot survive a reinstall.
Get-ScheduledTask -TaskName 'LogueOS-StartConsole' -ErrorAction SilentlyContinue | ForEach-Object {
    Write-Output "INFO: unregistering existing LogueOS-StartConsole at TaskPath '$($_.TaskPath)'"
    Unregister-ScheduledTask -TaskName 'LogueOS-StartConsole' -TaskPath $_.TaskPath -Confirm:$false
}
try {
    Register-ScheduledTask -TaskName 'LogueOS-StartConsole' -TaskPath '\' -Action $startupAction -Trigger $startupTrigger -Settings $startupSettings -Principal $startupPrincipal -Description 'LogueOS Console production server (port 18767, adapter-node)' -ErrorAction Stop | Out-Null
    Write-Output "INSTALL_OK: LogueOS-StartConsole registered at \"
} catch {
    Write-Output "INSTALL_FAIL: $($_.Exception.Message)"
    exit 2
}

# ================================================================================
# TASK 2: LogueOS-RestartConsole (Interactive / On-Demand Kill-then-Start)
# ================================================================================
$restartTaskScript = Join-Path $PSScriptRoot 'tasks\restart_logueos_console_task.ps1'
$restartVbsScript  = Join-Path $PSScriptRoot 'tasks\run_restart_logueos_console.vbs'

if (-not (Test-Path $restartTaskScript)) { Write-Output "INSTALL_FAIL: restart script not found at $restartTaskScript"; exit 1 }
if (-not (Test-Path $restartVbsScript)) { Write-Output "INSTALL_FAIL: restart VBS wrapper not found at $restartVbsScript"; exit 1 }

$restartAction    = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument "`"$restartVbsScript`"" -WorkingDirectory $repoRoot
$restartTrigger   = New-ScheduledTaskTrigger -Once -At "2000-01-01T00:00:00"
$restartSettings  = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Days 365)
# Interactive logon type allows the operator to trigger without UAC elevation from any shell
$restartPrincipal = New-ScheduledTaskPrincipal -UserId (whoami).Trim() -LogonType Interactive -RunLevel Limited

# Defensively unregister every LogueOS-RestartConsole at any TaskPath before
# registering, so a stray copy at a stale path cannot survive a reinstall.
Get-ScheduledTask -TaskName 'LogueOS-RestartConsole' -ErrorAction SilentlyContinue | ForEach-Object {
    Write-Output "INFO: unregistering existing LogueOS-RestartConsole at TaskPath '$($_.TaskPath)'"
    Unregister-ScheduledTask -TaskName 'LogueOS-RestartConsole' -TaskPath $_.TaskPath -Confirm:$false
}
try {
    Register-ScheduledTask -TaskName 'LogueOS-RestartConsole' -TaskPath '\' -Action $restartAction -Trigger $restartTrigger -Settings $restartSettings -Principal $restartPrincipal -Description 'Restarts the LogueOS Console on port 18767. Trigger via: Start-ScheduledTask -TaskName LogueOS-RestartConsole' -ErrorAction Stop | Out-Null
    Write-Output "INSTALL_OK: LogueOS-RestartConsole registered at \"
} catch {
    Write-Output "INSTALL_FAIL: $($_.Exception.Message)"
    exit 2
}

Write-Output ""
Write-Output "INFO: to restart now (will kill existing 18767 process):"
Write-Output "  Start-ScheduledTask -TaskName 'LogueOS-RestartConsole'"
