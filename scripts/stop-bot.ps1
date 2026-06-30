# Stops the Slack bot (any instance: tsx dev or compiled dist).
# Invoked by the "ErpBot Stop" scheduled task at 18:00 daily.
$ErrorActionPreference = "Stop"
$procs = Get-CimInstance Win32_Process -Filter "name='node.exe'" |
  Where-Object { $_.CommandLine -match 'index\.ts' -or $_.CommandLine -match 'dist[\\/]index\.js' }
if ($procs) {
  $procs.ProcessId | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }
  "stopped: PID $($procs.ProcessId -join ',')"
} else {
  "not running"
}
Remove-Item (Join-Path $PSScriptRoot "bot.pid") -ErrorAction SilentlyContinue
