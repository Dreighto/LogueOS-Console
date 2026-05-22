' run_restart_logueos_console.vbs
' VBS wrapper for the LogueOS-RestartConsole scheduled task.
'
' wscript.exe is Window-subsystem (no console). We run powershell.exe with
' SW_HIDE at process creation so the console never flashes on restart.

Dim WshShell, fso, scriptDir, scriptPath
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
scriptPath = scriptDir & "\restart_logueos_console_task.ps1"

Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "powershell.exe -NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File """ & scriptPath & """", 0, False
