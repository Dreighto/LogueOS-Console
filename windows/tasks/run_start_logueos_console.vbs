' run_start_logueos_console.vbs -- canon Window-subsystem wrapper for the
' MiruRestartLogueOSConsole scheduled task.
'
' Why this file exists:
'   When Task Scheduler launches powershell.exe directly with -WindowStyle
'   Hidden, the console window is briefly visible before the hide flag takes
'   effect. On Windows 11 24H2 (Win11 Terminal default), that race produces a
'   sub-second console flash every time the task fires or restarts on failure.
'   Mirrors the run_dispatch_listener.vbs pattern in the LogueOS-Orchestrator
'   repo (canon: 2026-05-05 -- non-VBS-wrapped PowerShell scheduled tasks flash).
'
' How it works:
'   wscript.exe is Window-subsystem, so it never allocates a console of its
'   own. WshShell.Run with intWindowStyle=0 (vbHidden / SW_HIDE) launches
'   powershell.exe with the hide flag set at CreateProcess time -- no race,
'   no flash. The third argument (False) makes Run return immediately so the
'   wrapper exits while powershell keeps running.
'
' Task action should be:
'   Execute:  wscript.exe
'   Argument: "D:\dev\LogueOS-Console\windows\tasks\run_start_logueos_console.vbs"
'
' See windows\install_logueos_console_task.ps1 for the registration command.

Dim WshShell, fso, scriptDir, windowsDir, scriptPath
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
windowsDir = fso.GetParentFolderName(scriptDir)
scriptPath = windowsDir & "\start_logueos_console.ps1"

Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "powershell.exe -NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File """ & scriptPath & """", 0, False
