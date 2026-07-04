# Removes the ErpBot scheduled tasks registered by install-tasks.ps1.
$ErrorActionPreference = "Continue"
foreach ($n in "ErpBot Start","ErpBot Stop","ErpBot Pull","ErpBot Guard") {
  if (Get-ScheduledTask -TaskName $n -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $n -Confirm:$false
    "removed: $n"
  } else {
    "not found: $n"
  }
}
