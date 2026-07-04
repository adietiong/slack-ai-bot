' Runs a PowerShell script with no visible window (zero console flash).
' wscript.exe has no console of its own, and Run(..., 0, False) launches
' PowerShell hidden, so scheduled tasks that go through this show nothing.
' Usage: wscript.exe run-hidden.vbs "<full path to .ps1>"
Set sh = CreateObject("WScript.Shell")
ps1 = WScript.Arguments(0)
sh.Run "powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File """ & ps1 & """", 0, False
