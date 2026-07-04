# Registers the Windows Scheduled Tasks that run the bot automatically on a
# Mon-Fri 09:00-18:00 window (Windows only). Re-runnable: -Force overwrites.
# Tasks run as the current user, only when logged on (no stored password).
#
#   ErpBot Start  weekly Mon-Fri 09:00        -> start-bot.ps1
#   ErpBot Stop   weekly Mon-Fri 18:00        -> stop-bot.ps1
#   ErpBot Pull   every 2h                    -> pull-repos.ps1 (self-gates to window)
#   ErpBot Guard  at logon + every 15 min     -> ensure-bot-window.ps1 (self-heals; enforces window)
#
# The scripts themselves enforce the Mon-Fri 09:00-18:00 rule, so the Pull/Guard
# repeats are safe to fire around the clock — they no-op outside the window.
$ErrorActionPreference = "Stop"
$dir = $PSScriptRoot
$user = "$env:USERDOMAIN\$env:USERNAME"

# Launch through run-hidden.vbs so wscript (no console) starts PowerShell
# hidden — no window flash, and no admin/S4U required.
$vbs = Join-Path $dir "run-hidden.vbs"
function New-BotAction($script) {
  $path = Join-Path $dir $script
  New-ScheduledTaskAction -Execute "wscript.exe" -Argument "`"$vbs`" `"$path`""
}

$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 10)
$weekdays = @('Monday','Tuesday','Wednesday','Thursday','Friday')

# Start / Stop — precise weekday edges
$startTrigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek $weekdays -At 9am
$stopTrigger  = New-ScheduledTaskTrigger -Weekly -DaysOfWeek $weekdays -At 6pm

# A weekday trigger that repeats through the 09:00-18:00 window only, so
# nothing fires on weekends or off-hours. (Weekly base + intraday repetition.)
function New-WindowTrigger($interval) {
  $t = New-ScheduledTaskTrigger -Weekly -DaysOfWeek $weekdays -At 9am
  $rep = New-ScheduledTaskTrigger -Once -At 9am `
    -RepetitionInterval $interval -RepetitionDuration (New-TimeSpan -Hours 9)
  $t.Repetition = $rep.Repetition
  return $t
}

# Pull — every 2h, Mon-Fri 09:00-18:00 only
$pullTrigger = New-WindowTrigger (New-TimeSpan -Hours 2)

# Guard — every 15 min, Mon-Fri 09:00-18:00 only (self-heals crashes)
$guardTrigger = New-WindowTrigger (New-TimeSpan -Minutes 15)

Register-ScheduledTask -TaskName "ErpBot Start" -Action (New-BotAction "start-bot.ps1") `
  -Trigger $startTrigger -Settings $settings -RunLevel Limited -Force | Out-Null
Register-ScheduledTask -TaskName "ErpBot Stop" -Action (New-BotAction "stop-bot.ps1") `
  -Trigger $stopTrigger -Settings $settings -RunLevel Limited -Force | Out-Null
Register-ScheduledTask -TaskName "ErpBot Pull" -Action (New-BotAction "pull-repos.ps1") `
  -Trigger $pullTrigger -Settings $settings -RunLevel Limited -Force | Out-Null
Register-ScheduledTask -TaskName "ErpBot Guard" -Action (New-BotAction "ensure-bot-window.ps1") `
  -Trigger $guardTrigger -Settings $settings -RunLevel Limited -Force | Out-Null

"Registered: ErpBot Start / Stop / Pull / Guard (Mon-Fri 09:00-18:00)."
