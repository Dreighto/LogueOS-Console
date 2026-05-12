# install_logueos_console_task.ps1
# Registers MiruRestartLogueOSConsole as a Windows Scheduled Task.
# Idempotent: re-running unregisters and reinstalls.
#
# RUN ONCE from elevated PowerShell on the operator's machine.
# Mirrored from the TODO block in start_logueos_console.ps1; lifted into a
# standalone file so CC (or any worker) can execute it via Bash without
# heredoc quoting hell.
#
# Task action: wscript.exe launches windows\tasks\run_start_logueos_console.vbs,
# which in turn launches powershell.exe with SW_HIDE at CreateProcess time.
# This is the canon pattern (matches windows\tasks\run_dispatch_listener.vbs
# in LogueOS-Orchestrator). Running powershell.exe directly with -WindowStyle
# Hidden races the hide flag and flashes a console on Windows 11 24H2 every
# time the task fires or restarts on failure -- 2026-05-11 popup post-mortem.

$repoRoot  = $PSScriptRoot | Split-Path -Parent
$script    = Join-Path $PSScriptRoot 'start_logueos_console.ps1'
$vbsScript = Join-Path $PSScriptRoot 'tasks\run_start_logueos_console.vbs'

if (-not (Test-Path $script)) {
    Write-Output "INSTALL_FAIL: start script not found at $script"
    exit 1
}
if (-not (Test-Path $vbsScript)) {
    Write-Output "INSTALL_FAIL: VBS wrapper not found at $vbsScript"
    exit 1
}

# wscript.exe is Window-subsystem (no console) so it never flashes. The VBS
# then launches powershell.exe with SW_HIDE at process-creation time.
$action    = New-ScheduledTaskAction `
                 -Execute 'wscript.exe' `
                 -Argument "`"$vbsScript`"" `
                 -WorkingDirectory $repoRoot
$trigger   = New-ScheduledTaskTrigger -AtStartup
$settings  = New-ScheduledTaskSettingsSet `
                 -ExecutionTimeLimit (New-TimeSpan -Days 365) `
                 -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) `
                 -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal `
                 -UserId "$env:USERDOMAIN\$env:USERNAME" `
                 -LogonType S4U `
                 -RunLevel Limited

# Unregister if exists (idempotency).
$existing = Get-ScheduledTask -TaskName 'MiruRestartLogueOSConsole' -TaskPath '\Miru\' -ErrorAction SilentlyContinue
if ($existing) {
    Write-Output "INFO: existing task found, unregistering"
    Unregister-ScheduledTask -TaskName 'MiruRestartLogueOSConsole' -TaskPath '\Miru\' -Confirm:$false
}

try {
    Register-ScheduledTask `
        -TaskName    'MiruRestartLogueOSConsole' `
        -TaskPath    '\Miru\' `
        -Action      $action `
        -Trigger     $trigger `
        -Settings    $settings `
        -Principal   $principal `
        -Description 'LogueOS Console production server (port 18767, adapter-node)' `
        -ErrorAction Stop | Out-Null
    Write-Output "INSTALL_OK: MiruRestartLogueOSConsole registered under \Miru\"
    Write-Output "INFO: to start now (after stopping any existing 18767 binder):"
    Write-Output "  Start-ScheduledTask -TaskPath '\Miru\' -TaskName 'MiruRestartLogueOSConsole'"
} catch {
    Write-Output "INSTALL_FAIL: $($_.Exception.Message)"
    exit 2
}
