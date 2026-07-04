# Window guard: enforces that the bot runs ONLY 09:00-18:00 local time.
# Inside the window  -> start it if it's down (self-heals a crash or a missed wake).
# Outside the window -> stop it if it's up.
# Wired to the "ErpBot Guard" scheduled task (on wake/unlock + every 15 min).
$ErrorActionPreference = "Stop"

$now = Get-Date
$isWeekday = $now.DayOfWeek -ne [DayOfWeek]::Saturday -and $now.DayOfWeek -ne [DayOfWeek]::Sunday
$inWindow = ($isWeekday -and $now.Hour -ge 9 -and $now.Hour -lt 18)

$running = Get-CimInstance Win32_Process -Filter "name='node.exe'" |
  Where-Object { $_.CommandLine -match 'index\.ts' -or $_.CommandLine -match 'dist[\\/]index\.js' }

if ($inWindow) {
  if ($running) {
    "in-window ($($now.ToString('HH:mm'))): already up PID $($running.ProcessId -join ',')"
  } else {
    "in-window ($($now.ToString('HH:mm'))): down -> starting"
    & (Join-Path $PSScriptRoot "start-bot.ps1")
  }
} else {
  if ($running) {
    "off-window ($($now.ToString('HH:mm'))): up -> stopping"
    & (Join-Path $PSScriptRoot "stop-bot.ps1")
  } else {
    "off-window ($($now.ToString('HH:mm'))): already down"
  }
}
