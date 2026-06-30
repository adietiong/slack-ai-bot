# Starts the Slack bot (compiled dist) if not already running.
# Invoked by the "ErpBot Start" scheduled task at 09:00 daily.
$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot   # repo root (scripts/..)
Set-Location $repo

# Already running? (matches tsx dev OR compiled dist)
$existing = Get-CimInstance Win32_Process -Filter "name='node.exe'" |
  Where-Object { $_.CommandLine -match 'index\.ts' -or $_.CommandLine -match 'dist[\\/]index\.js' }
if ($existing) {
  "already running: PID $($existing.ProcessId -join ',')"
  exit 0
}

# Resolve node (prefer PATH, fall back to known nvm location)
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { $node = "C:\nvm4w\nodejs\node.exe" }
if (-not (Test-Path $node)) { throw "node not found ($node)" }

# Pull latest into the dedicated read-only clones before launching
& (Join-Path $PSScriptRoot "pull-repos.ps1")

# Must have a build; build if dist is missing
if (-not (Test-Path (Join-Path $repo "dist\index.js"))) {
  & npm run build
}

$logDir = Join-Path $repo "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$stamp = Get-Date -Format "yyyyMMdd"
$out = Join-Path $logDir "bot-$stamp.out.log"
$err = Join-Path $logDir "bot-$stamp.err.log"

$p = Start-Process -FilePath $node -ArgumentList "dist/index.js" `
  -WorkingDirectory $repo -WindowStyle Hidden `
  -RedirectStandardOutput $out -RedirectStandardError $err -PassThru
$p.Id | Out-File -FilePath (Join-Path $PSScriptRoot "bot.pid") -Encoding ascii
"started PID $($p.Id) (node dist/index.js); log $out"
