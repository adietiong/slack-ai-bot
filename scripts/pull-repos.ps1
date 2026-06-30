# Fast-forward-pulls the bot's dedicated read-only repo clones.
# Invoked by the bot's "Pull" scheduled task and by start-bot.ps1.
# Safe: --ff-only never creates merge commits; a non-ff or dirty clone is logged and skipped.
#
# Clone paths are read from .env (BACKEND_PATH / FRONTEND_PATH) so this script
# stays generic — point those at your dedicated read-only clones.
$ErrorActionPreference = "Continue"
$envFile = Join-Path $PSScriptRoot "..\.env"
$clones = @()
if (Test-Path $envFile) {
  Get-Content $envFile | ForEach-Object {
    if ($_ -match '^\s*(BACKEND_PATH|FRONTEND_PATH)\s*=\s*(.+?)\s*$') {
      $clones += $matches[2].Trim('"').Trim("'")
    }
  }
}
foreach ($repo in $clones) {
  if (-not (Test-Path (Join-Path $repo ".git"))) { "skip (not a git repo): $repo"; continue }
  $branch = (git -C $repo rev-parse --abbrev-ref HEAD)
  $out = git -C $repo pull --ff-only 2>&1
  "[$(Get-Date -Format o)] $repo ($branch): $out"
}
